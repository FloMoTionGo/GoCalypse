// Cards and stalls in a real browser (ideas.md §11.1, §11.2): which items take
// the turn, and how much of each stall is left. A debug room with three bots
// (rich, market open at once). Tests in this file share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Carder", room: "go_debug" }));
  await rig.joinWithBots([0, 0, 0]); // three Hontes: they never buy, so the stock is all mine to change
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
  await b.waitFor("welcomeEl.open", 5000, "the welcome dialog");
  await b.ev("welcomeCloseButton.click(); true");
  await b.waitFor("!welcomeEl.open", 3000, "the dialog to close");
});
after(async () => rig?.close());

/** Per stall (its button marked with its item): its id, whether it is free, and what its row shows. */
const STALLS = `Array.from(marketItemsEl.querySelectorAll("button.item")).map((el) => {
  const m = Array.from(lastState.market).find((s) => s.id === el.dataset.id);
  return { id: m.id, free: m.free, icon: !!el.querySelector(".turn-icon") };
})`;

test("cards: every market stall whose item takes the turn shows the turn icon, and only those", async () => {
  const stalls = await b.ev(STALLS);
  assert.equal(stalls.length, 7);
  for (const s of stalls) assert.equal(s.icon, !s.free, `${s.id} (free: ${s.free})`);
  assert.equal(stalls.find((s) => s.id === "bait").icon, false, "the Bait doesn't take the turn");
});

test("cards: the market has two columns, the cozy stalls on the left and the rest on the right, the turn icon on each card's top-left corner", async () => {
  const m = await b.ev(`(() => {
    const cols = Array.from(marketItemsEl.children).map((col) => Array.from(col.querySelectorAll("button.item")).map((el) => {
      const s = Array.from(lastState.market).find((x) => x.id === el.dataset.id), r = el.getBoundingClientRect();
      const i = el.querySelector(".turn-icon"), ir = i && i.getBoundingClientRect(), st = el.querySelector(".stock"), sr = st && st.getBoundingClientRect();
      return { tier: s.tier, left: r.left, corner: ir ? Math.abs(ir.left - r.left) < 4 && Math.abs(ir.top - r.top) < 4 : null,
        clear: ir && sr ? ir.bottom <= sr.top + 0.5 : true };
    }));
    return cols;
  })()`);
  assert.equal(m.length, 2, "two columns");
  assert.ok(m[0].length > 0 && m[0].every((s) => s.tier === 1), "the left column: tier 1");
  assert.ok(m[1].length > 0 && m[1].every((s) => s.tier >= 2), "the right column: tiers 2 and 3");
  assert.ok(m[1][0].left > m[0][0].left, "side by side");
  for (const s of m.flat()) {
    if (s.corner !== null) assert.equal(s.corner, true, "the turn icon on the top-left corner");
    assert.equal(s.clear, true, "clear of the stock");
  }
});

test("cards: a market stall shows its name, price and stock, and its description beside it on hover", async () => {
  const p = await b.ev(`(() => {
    const el = marketItemsEl.querySelector("button.item"), r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: el.dataset.id, descShown: !!el.querySelector(".desc") && el.querySelector(".desc").getBoundingClientRect().height > 0 };
  })()`);
  assert.equal(p.descShown, false, "the description is not on the card");
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await b.waitFor("!!document.querySelector('.market-tip')", 2000, "the description tip");
  const tip = await b.ev(`(() => { const t = document.querySelector(".market-tip"), r = t.getBoundingClientRect();
    return { text: t.textContent, w: r.width, h: r.height }; })()`);
  const desc = await b.ev(`Array.from(lastState.market).find((m) => m.id === ${JSON.stringify(p.id)}).description`);
  assert.ok(tip.text.includes(desc), "it says what the item does");
  assert.ok(tip.w > 0 && tip.h > 0, "on screen");
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await b.waitFor("!document.querySelector('.market-tip')", 2000, "the tip gone once the pointer leaves");
});

test("cards: How to play marks the items that take the turn, and says what the icon means", async () => {
  await b.ev("helpButton.click(); true");
  await b.waitFor("welcomeEl.open", 3000, "How to play");
  const rows = await b.ev(`Array.from(document.querySelectorAll("#welcome-powerups .welcome-item")).map((el) => ({
    name: el.querySelector(".title span").textContent, icon: !!el.querySelector(".turn-icon") }))`);
  const stalls = await b.ev(`Array.from(lastState.market).filter((m) => m.id !== "bait").map((m) => ({ name: m.name, free: m.free }))`);
  assert.equal(rows.length, stalls.length);
  rows.forEach((r, i) => assert.equal(r.icon, !stalls[i].free, r.name));
  assert.match(await b.ev(`document.getElementById("welcome-turn-legend").textContent`), /takes your turn/i);
  assert.equal(await b.ev(`!!document.querySelector("#welcome-turn-legend .turn-icon")`), true, "the legend shows the icon");
  await b.ev("welcomeCloseButton.click(); true");
  await b.waitFor("!welcomeEl.open", 3000, "the dialog to close");
});

test("cards: a card in my hand says whether using it takes the turn", async () => {
  const turnTaker = await b.ev(`(() => {
    const i = Array.from(lastState.market).findIndex((m) => !m.free && !m.removal);
    return i < 0 ? null : lastState.market[i].id;
  })()`);
  for (const id of [turnTaker, "bait"].filter(Boolean)) {
    await b.ev(`room.send("buy", { id: ${JSON.stringify(id)} }); true`);
    await b.waitFor(`!!handEl.querySelector('.card[data-id=${JSON.stringify(id)}]')`, 5000, `${id} in my hand`);
  }
  if (turnTaker) {
    const card = await b.ev(`(() => { const c = handEl.querySelector('.card[data-id=${JSON.stringify(turnTaker)}]');
      return { turn: c.dataset.turn, label: c.getAttribute("aria-label") }; })()`);
    assert.equal(card.turn, "1", turnTaker);
    assert.match(card.label, /Takes your turn/);
  }
  const bait = await b.ev(`(() => { const c = handEl.querySelector('.card[data-id="bait"]');
    return { turn: c.dataset.turn, label: c.getAttribute("aria-label") }; })()`);
  assert.equal(bait.turn, "0");
  assert.match(bait.label, /Doesn't take your turn/);
  rig.assertClean("the cards");
});

/** Per stall: its stock and left, and the mini cards its row shows. */
const MINIS = `Array.from(marketItemsEl.querySelectorAll("button.item")).map((el) => {
  const m = Array.from(lastState.market).find((s) => s.id === el.dataset.id), row = el.querySelector(".stock");
  return { id: m.id, stock: m.stock, left: m.left,
    filled: row ? row.querySelectorAll("img.mini-left").length : -1,
    outlines: row ? row.querySelectorAll("img.mini-gone").length : -1,
    words: row ? row.getAttribute("aria-label") : "", oldLabel: !!el.querySelector(".left") };
})`;

test("cards: each stall shows its copies as mini cards, one filled for every copy left", async () => {
  for (const s of await b.ev(MINIS)) {
    assert.equal(s.filled, s.left, `${s.id}: ${s.left} left`);
    assert.equal(s.filled + s.outlines, s.stock, `${s.id}: ${s.stock} copies in all`);
    assert.equal(s.oldLabel, false, `${s.id}: no "N left" text any more`);
    assert.match(s.words, new RegExp(`${s.left} of ${s.stock} left`), `${s.id}: the words are still there for a screen reader`);
  }
});

test("cards: a buy takes one filled mini card off its stall", async () => {
  const before = await b.ev(MINIS);
  const pick = before.find((s) => s.id !== "bait" && s.left === s.stock && s.stock > 1);
  assert.ok(pick, "a stall nobody has bought from");
  await b.ev(`room.send("buy", { id: ${JSON.stringify(pick.id)} }); true`);
  await b.waitFor(`lastState.market.find((m) => m.id === ${JSON.stringify(pick.id)}).left === ${pick.left - 1}`, 5000, "the buy");
  await b.waitFor(`(${MINIS}).find((s) => s.id === ${JSON.stringify(pick.id)}).filled === ${pick.left - 1}`, 3000, "one mini card fewer");
  const after = (await b.ev(MINIS)).find((s) => s.id === pick.id);
  assert.equal(after.outlines, 1);
});

test("cards: a sold-out stall shows only outlines", async () => {
  const one = (await b.ev(MINIS)).find((s) => s.stock === 1);
  assert.ok(one, "the tier 3 stall holds a single copy");
  await b.ev(`room.send("buy", { id: ${JSON.stringify(one.id)} }); true`);
  await b.waitFor(`lastState.market.find((m) => m.id === ${JSON.stringify(one.id)}).left === 0`, 5000, "the last copy bought");
  await b.waitFor(`(${MINIS}).find((s) => s.id === ${JSON.stringify(one.id)}).filled === 0`, 3000, "the stall emptied");
  const s = (await b.ev(MINIS)).find((x) => x.id === one.id);
  assert.deepEqual([s.filled, s.outlines], [0, 1]);
  rig.assertClean("the stalls");
});

// The Stone Card is the Kata (型) now (ideas.md §11.4): its id stays stone_card.
const KATA = `handEl.querySelector('.card[data-id="stone_card"]')`;

test("cards: the Kata's face shows its name and kanji, and exact numbers instead of instructions", async () => {
  const face = await b.ev(`({ name: ${KATA}.querySelector(".card-name").textContent, text: ${KATA}.querySelector(".card-text").textContent,
    label: ${KATA}.getAttribute("aria-label") })`);
  assert.match(face.name, /型/);
  assert.match(face.name, /Kata/);
  assert.match(face.text, /^\d\/9\b/, face.text);
  assert.ok(face.text.length <= 40, `${face.text.length} characters: ${face.text}`);
  assert.doesNotMatch(face.text, /click|button/i, "no instructions on the face");
  assert.match(face.label, /Kata/);
  assert.match(face.label, /Takes your turn/);
});

test("cards: the Kata's help is three short blocks, and says it takes the turn", async () => {
  const help = await b.ev(`(() => {
    const h = stoneCardHelp(myPlayer);
    return { blocks: Array.from(h.querySelectorAll(".help-block")).map((el) => el.textContent.trim()), all: h.textContent };
  })()`);
  assert.equal(help.blocks.length, 3, help.blocks.join(" | "));
  for (const block of help.blocks) {
    const words = block.split(/\s+/).length;
    assert.ok(words <= 45, `${words} words: ${block}`);
  }
  assert.match(help.all, /Kata/);
  assert.match(help.all, /takes your turn/i);
  assert.doesNotMatch(help.all, /Stone Card/);
});

test("cards: nothing on the page calls it the Stone Card any more", async () => {
  await b.ev("helpButton.click(); true");
  await b.waitFor("welcomeEl.open", 3000, "How to play");
  const texts = await b.ev(`(() => {
    const out = [document.getElementById("welcome").textContent, gameEl.textContent];
    out.push(...Array.from(document.querySelectorAll("[title], [aria-label]")).map((el) => (el.getAttribute("title") || "") + " " + (el.getAttribute("aria-label") || "")));
    setSelectedPowerup("stone_card");
    out.push(boardHintEl.textContent);
    setSelectedPowerup(null);
    return out;
  })()`);
  await b.ev("welcomeCloseButton.click(); true");
  for (const t of texts) assert.doesNotMatch(t, /Stone Card/, t.slice(0, 200));
  assert.ok(texts.some((t) => /\bKata\b/.test(t)), "the Kata is named");
  assert.match(texts.at(-1), /Kata/, "the aiming hint");
  rig.assertClean("the Kata");
});
