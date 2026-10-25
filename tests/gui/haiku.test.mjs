// Haiku points in a real browser (ideas.md §11.11): a glyph on each point still to
// collect, gone once a stone collects it, and the haiku's card in the hand with its
// level in pips. A debug room with three bots, without storms (their grey would
// hide whose stone is whose); the tests share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;
let point; // the haiku point this page collects: {x, y, haiku, line}

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Poet", room: "go_debug", nowelcome: "1", nostorm: "1" }));
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing' && lastState.haiku && lastState.haiku.length === 9", 15000, "the game with its haiku");
});

after(async () => {
  await rig?.close();
});

test("haiku: each point still to collect is on the board as a glyph", async () => {
  await rig.waitMyTurn();
  point = await b.ev(`(() => { const p = Array.from(lastState.haiku).find((h) => !h.by && !board[h.y * lastState.size + h.x]); return p && { x: p.x, y: p.y, haiku: p.haiku, line: p.line }; })()`);
  assert.ok(point, "a haiku point free to take");
  assert.equal(await b.ev(`overlays.filter((o) => o.kind === "haiku").length`), await b.ev("Array.from(lastState.haiku).filter((h) => !h.by).length"));
  assert.equal(await b.ev(`overlays.some((o) => o.kind === "haiku" && o.x === ${point.x} && o.y === ${point.y} && o.axis === "${point.haiku}" && o.until === ${point.line})`), true);
});

test("haiku: a stone on it collects the line: the glyph goes, and the card comes with one pip lit", async () => {
  await rig.playAt(point.x, point.y, "left", `Array.from(lastState.haiku).some((h) => h.x === ${point.x} && h.y === ${point.y} && h.by === myPlayer.color)`, "the line collected");
  await b.waitFor(`!overlays.some((o) => o.kind === "haiku" && o.x === ${point.x} && o.y === ${point.y})`, 3000, "the glyph gone");
  await b.waitFor(`!!handEl.querySelector('.card.haiku-card[data-id="haiku_${point.haiku}"]')`, 5000, "the haiku's card in the hand");
  assert.equal(await b.ev(`handEl.querySelector('.card.haiku-card[data-id="haiku_${point.haiku}"]').dataset.level`), "1");
  assert.match(await b.ev(`handEl.querySelector('.card.haiku-card').getAttribute("aria-label")`), /level 1/i);
  rig.assertClean("the haiku");
});

test("haiku: the card highlights only the lines I collected of its haiku", async () => {
  const card = `handEl.querySelector('.card.haiku-card[data-id="haiku_${point.haiku}"]')`;
  assert.equal(await b.ev(`${card}.querySelectorAll(".haiku-line").length`), 3, "all three lines on the card");
  assert.deepEqual(await b.ev(`Array.from(${card}.querySelectorAll(".haiku-line.got")).map((el) => Number(el.dataset.line))`), [point.line]);
});
