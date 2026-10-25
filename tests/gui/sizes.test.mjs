// Picking the board size on the home screen's lobby board (ideas.md §11.10):
// three points above Start, 13, 19 and 25; a black stone on one picks it, the
// page remembers it, Join says it, and the table is that size.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Sizer", room: "go_debug", nowelcome: "1" }));
  await b.waitFor("!!window.GoLobbyIsland", 10000, "the lobby board");
});

after(async () => {
  await rig?.close();
});

/** Where the lobby board's size point for `n` is: { col, row }. */
const sizePoint = (n) => b.ev(`window.GoLobbyIsland.sizes.find((s) => s.size === ${n})`);

test("lobby: the board offers 13, 19 and 25 above Start, and 13 is picked to begin with", async () => {
  const sizes = await b.ev("window.GoLobbyIsland.sizes.map((s) => s.size)");
  assert.deepEqual(sizes, [13, 19, 25]);
  assert.equal(await b.ev("boardSizePick()"), 13);
  assert.doesNotMatch(await b.ev("joinButton.textContent"), /×/, "the default needs no word");
});

test("lobby: a black stone on 19 picks it, Join says so, and the page remembers it", async () => {
  const p = await sizePoint(19);
  await rig.clickLobby(p.col, p.row);
  assert.equal(await b.ev("boardSizePick()"), 19);
  assert.match(await b.ev("joinButton.textContent"), /19×19/);
  await b.load(rig.url({ name: "Sizer", room: "go_debug", nowelcome: "1" }));
  await b.waitFor("!!window.GoLobbyIsland", 10000, "the lobby board again");
  assert.equal(await b.ev("boardSizePick()"), 19, "remembered");
});

test("lobby: picking 19 gives a 19-line board at the table", async () => {
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState && lastState.size === 19", 15000, "a 19x19 table");
  await b.waitFor("scene && scene.layout.size === 19", 5000, "a 19x19 scene");
  await wait(300);
  const m = await b.ev(`({ scrolls: document.documentElement.scrollHeight > innerHeight, w: scene.width })`);
  assert.equal(m.scrolls, false, "the bigger stage still fits the window");
  rig.assertClean("the 19x19 table");
});

test("table: on a 19x19 table in a 1080p window the hand stays under the board", async () => {
  await b.cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 950, deviceScaleFactor: 1, mobile: false });
  await wait(400);
  const m = await b.ev(`(() => {
    const hand = document.getElementById("hand"), sidebar = document.getElementById("sidebar");
    const h = hand.getBoundingClientRect(), bd = boardEl.getBoundingClientRect(), sb = sidebar.getBoundingClientRect();
    return {
      inSidebar: sidebar.contains(hand),
      under: h.top >= Math.max(bd.bottom, sb.bottom) - 0.5,
      onStage: h.right <= sb.right + 0.5,
      scrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    };
  })()`);
  await b.cdp("Emulation.clearDeviceMetricsOverride", {});
  await wait(300);
  assert.equal(m.inSidebar, false, "not in the sidebar");
  assert.equal(m.under, true, "under the board and the sidebar");
  assert.equal(m.onStage, true, "no wider than the stage");
  assert.equal(m.scrolls, false, "and the stage still fits the window");
  rig.assertClean("the hand on a 19x19 table");
});
