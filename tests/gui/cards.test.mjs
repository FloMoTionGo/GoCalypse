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

/** Per stall, in market order: its id, whether it is free, and what its row shows. */
const STALLS = `Array.from(marketItemsEl.querySelectorAll("button.item")).map((el, i) => ({
  id: lastState.market[i].id, free: lastState.market[i].free,
  icon: !!el.querySelector(".turn-icon"),
}))`;

test("cards: every market stall whose item takes the turn shows the turn icon, and only those", async () => {
  const stalls = await b.ev(STALLS);
  assert.equal(stalls.length, 7);
  for (const s of stalls) assert.equal(s.icon, !s.free, `${s.id} (free: ${s.free})`);
  assert.equal(stalls.find((s) => s.id === "bait").icon, false, "the Bait doesn't take the turn");
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

/** Per stall, in market order: its stock and left, and the mini cards its row shows. */
const MINIS = `Array.from(marketItemsEl.querySelectorAll("button.item")).map((el, i) => {
  const m = lastState.market[i], row = el.querySelector(".stock");
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
