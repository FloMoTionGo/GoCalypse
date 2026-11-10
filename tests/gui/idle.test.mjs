// An idle table in a real browser: drawn at the ambient rate, not every frame (P1).
// A regular 13x13 table, not a debug room: a debug room rolls for a river creature
// every 2 turns and for a storm every 6, so its table is rarely still (moved here from
// game.test.mjs, 2026-11-10, after a creature failed it on CI). A regular table rolls
// for neither before the market opens at round 6, so my first turn is still for sure.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Idler", nowelcome: "1" }));
  await b.waitFor("!!window.GoLobbyIsland", 10000, "the lobby board");
  await rig.joinWithBots([0, 0, 0]); // three Hontes: no items
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
});

after(async () => rig?.close());

test("idle: an idle table is drawn at the ambient rate, not every frame (P1)", async () => {
  // My turn, the last stone's landing played out, the mouse off the board: nothing
  // on the scene moves but the water, the lanterns and the last-move ember, which
  // step at 10 and 6 frames a second.
  await b.ev("(() => { window.__renders = 0; const r0 = scene.render; scene.render = function (...a) { window.__renders++; return r0.apply(this, a); }; return true; })()");
  await rig.waitMyTurn();
  await wait(1500);
  await b.ev("hoverPoint = null; true");
  const still = await b.ev(
    "({ size: lastState.size, effects: effects.length, storm: !!storm, creatures: [riverCreatures.crab, riverCreatures.spirit].filter(Boolean).length, lit: overlays.filter((o) => o.kind === 'fire' || o.kind === 'ward').length, lingering: turnCount < stormUntil, passSign: passFlashAt !== undefined && clock() - passFlashAt < 2.5, hover: hoverPoint, armed: selectedPowerup })"
  );
  assert.deepEqual(still, { size: 13, effects: 0, storm: false, creatures: 0, lit: 0, lingering: false, passSign: false, hover: null, armed: null }, "the table is still");
  await b.ev("window.__renders = 0; true");
  await wait(2000);
  const renders = await b.ev("window.__renders");
  assert.ok(renders >= 8, `the scene still moves: ${renders} frames in 2 s`);
  assert.ok(renders <= 40, `but is not redrawn every frame: ${renders} frames in 2 s (30 a second would be 60)`);
  rig.assertClean("the idle table");
});
