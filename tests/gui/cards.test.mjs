// Cards and stalls in a real browser (ideas.md §11.1, §11.2): which items take
// the turn, and what a stall says on hover. A debug room with three bots
// (rich, market open at once). Tests in this file share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
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
    const i = Array.from(lastState.market).findIndex((m) => !m.free);
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

// Review D6: the Kata already glows when a stone can be added; the 9.6 px tracked
// "UPGRADABLE" under it was the smallest text on screen and said nothing more.
test("cards: an upgradable Kata says so by its glow alone, with no word under it (D6)", async () => {
  const r = await b.ev(`(() => { const c = document.querySelector(".stone-card"); return { up: cardUpgradable(myPlayer), glow: c.classList.contains("upgradable"), text: c.textContent }; })()`);
  assert.equal(r.up, true, "rich enough to add a stone");
  assert.equal(r.glow, true, "the card glows");
  assert.doesNotMatch(r.text, /upgradable/i, "no word under it");
});

// Review D4: in the tips a line break reads better than a middle dot.
test("cards: the Kata's help gives each heading's when a line of its own, with no middle dots (D4)", async () => {
  const help = await b.ev(`(() => {
    const h = stoneCardHelp(myPlayer);
    return { all: h.textContent, heads: Array.from(h.querySelectorAll("h4, h5")).map((el) => ({ text: el.textContent, lines: el.querySelectorAll(".help-when").length })) };
  })()`);
  assert.doesNotMatch(help.all, /·/, help.all);
  assert.equal(help.heads.length, 3, JSON.stringify(help.heads));
  for (const head of help.heads) assert.equal(head.lines, 1, `a second line in "${head.text}"`);
});

test("cards: the hover titles on the Kata's points and the players' stones give each click a line, no middle dots (D4)", async () => {
  const titles = await b.ev(`Array.from(document.querySelectorAll(".stone-card .card-cell[title], #players .stones[title]")).map((el) => el.title)`);
  assert.ok(titles.length >= 13, `${titles.length} titles: nine points and four players`);
  for (const t of titles) {
    assert.doesNotMatch(t, /·/, t);
    assert.match(t, /\n/, `a line per click: ${t}`);
  }
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

// Review U6: on a tablet nothing hovers, so the cards' 5 px text could never be read.
// The first tap on a card shows it enlarged (the Kata's live copy, whose points take
// stones); a tap on the card already shown acts as a click; a tap elsewhere lets it go.
test("cards: on a touch screen the first tap shows a card enlarged, the next one plays it (U6)", async () => {
  const touch = (type, at) => b.cdp("Input.dispatchTouchEvent", { type, touchPoints: at ? [{ x: at.x, y: at.y }] : [] });
  const tap = async (at) => { await touch("touchStart", at); await touch("touchEnd"); await wait(150); };
  const centre = (sel) => b.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; el.scrollIntoView({ block: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await b.ev("hideCardZoom(); setSelectedPowerup(null); noticeEl.textContent = ''; true");
  await b.cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  try {
    const kata = await centre(`#hand .card[data-id="stone_card"] .card-name`);
    await tap(kata);
    await b.waitFor("!!document.querySelector('.card.zoom.live')", 2000, "the Kata enlarged");
    assert.equal(await b.ev("selectedPowerup"), null, "the first tap only shows it");
    assert.equal(await b.ev("noticeEl.textContent"), "", "and says nothing");
    // A point of the enlarged Kata takes a stone, as a click on it does.
    await b.ev(`(() => { window.__upgrades = 0; const send = room.send; room.send = function (t, m) { if (t === "upgradeCard") window.__upgrades++; return send.call(this, t, m); }; return true; })()`);
    const cell = await centre(".card.zoom.live .card-cell:not(.set)");
    assert.ok(cell, "an empty point on the enlarged Kata");
    await tap(cell);
    await b.waitFor("window.__upgrades === 1", 3000, "a stone put on the Kata");
    // Still shown after the hand is drawn again, until a tap elsewhere.
    await wait(400);
    assert.equal(await b.ev("!!document.querySelector('.card.zoom.live')"), true, "still enlarged");
    await tap(await centre("#weather"));
    await b.waitFor("!document.querySelector('.card.zoom')", 2000, "the enlarged card let go");
    // Shown, then a second tap on the hand's card is the click: armed, or told why not.
    await tap(kata);
    await b.waitFor("!!document.querySelector('.card.zoom.live')", 2000, "the Kata enlarged again");
    await tap(kata);
    await b.waitFor(`selectedPowerup === "stone_card" || /Kata/.test(noticeEl.textContent)`, 2000, "the second tap to play it");
  } finally {
    await b.cdp("Emulation.setTouchEmulationEnabled", { enabled: false });
    await b.ev("hideCardZoom(); setSelectedPowerup(null); true");
  }
});
