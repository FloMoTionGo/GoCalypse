// A 9x9 table in a real browser: pure Go. The lobby offers it, and nothing of the Night
// Market, the hand, the Kata, the haiku or the fireflies shows. Three bots in a debug room.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Niner", room: "go_debug", nowelcome: "1", size: "9" }));
  await b.waitFor("!!window.GoLobbyIsland", 10000, "the lobby board");
});

after(async () => rig?.close());

test("nine: the lobby board offers a 9x9 table and says what it leaves out", async () => {
  assert.equal(await b.ev("window.GoLobbyIsland.sizes.some((s) => s.size === 9)"), true);
  assert.equal(await b.ev("boardSizePick()"), 9, "asked for in the address");
  assert.match(await b.ev("joinButton.textContent"), /9×9/);
});

test("nine: the table is 9x9 with no market, hand, Kata, haiku or fireflies on show", async () => {
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState && lastState.size === 9 && lastState.status === 'playing'", 15000, "a 9x9 table");
  await b.waitFor("scene && scene.layout.size === 9", 5000, "a 9x9 scene");
  const m = await b.ev(`({
    stalls: lastState.market.length,
    boats: marketItemsEl.querySelectorAll("button").length,
    status: marketStatusEl.textContent,
    view: marketView(lastState),
    hand: handEl.hidden && handEl.getBoundingClientRect().height === 0,
    powerups: Array.from(myPlayer.powerups).length,
    haiku: lastState.haiku.length,
    kata: document.querySelectorAll("#players .kata").length,
    scrolls: document.documentElement.scrollHeight > innerHeight,
  })`);
  assert.deepEqual(m, { stalls: 0, boats: 0, status: "", view: null, hand: true, powerups: 0, haiku: 0, kata: 0, scrolls: false });
  rig.assertClean("the 9x9 table");
});

test("nine: the scene is told no fireflies, and How to play says what this table leaves out", async () => {
  await b.ev("window.__r0 = scene.render; window.__f = 'unset'; scene.render = function (v) { window.__f = v.fireflies; return window.__r0.call(this, v); }; true");
  await b.waitFor("window.__f !== 'unset'", 3000, "a frame");
  assert.equal(await b.ev("window.__f === undefined"), true);
  await b.ev("scene.render = window.__r0; true");
  await b.ev("helpButton.click(); true");
  await b.waitFor("welcomeEl.open", 3000, "How to play");
  assert.match(await b.ev("document.getElementById('welcome-pure').textContent"), /pure Go/);
  assert.equal(await b.ev("document.getElementById('welcome-pure').hidden"), false);
  await b.ev("welcomeCloseButton.click(); true");
  await b.waitFor("!welcomeEl.open", 3000, "How to play to close");
});

test("nine: a stone can be played on it", async () => {
  await rig.waitMyTurn();
  const turn = await b.ev("turnCount");
  await rig.clickBoard(4, 4);
  await b.waitFor(`turnCount > ${turn}`, 4000, "the move");
  rig.assertClean("after a move");
});
