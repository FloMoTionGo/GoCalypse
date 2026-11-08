// The 9x9 table in the renderer: pure Go, so no water for the market and no hand on the
// stage, and everything that is drawn round the board still has to fit a board this small.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const PALETTE = new Set(G.PALETTE_RGB.map((c) => c.join()));
const onScreen = (scene, f) => f.x >= 0 && f.y >= 0 && f.x < scene.width && f.y < scene.height;

test("9x9: only the smallest board is pure Go", () => {
  assert.deepEqual([9, 13, 19, 25].map((n) => P.isPureGo(n)), [true, false, false, false]);
});

test("9x9: the scene has no water for the market, and the stage no hand row", () => {
  const L = P.computeLayout(9), other = P.computeLayout(13);
  assert.equal(L.marketX1, L.marketX0, "no strip of water");
  assert.equal(L.stalls.length, 0, "no moorings");
  assert.ok(other.marketX1 > other.marketX0, "13x13 keeps its market");
  assert.equal(P.stageSize(9).h, P.STAGE.sky + L.height + P.STAGE.status);
  assert.equal(P.stageSize(13).h, P.STAGE.sky + other.height + P.STAGE.hand + P.STAGE.status, "and 13x13 its hand");
});

test("9x9: the four seats' islands don't run into each other", () => {
  for (const n of [9, 13, 19, 25]) {
    const { islands } = P.computeLayout(n);
    for (let i = 1; i < 4; i++) {
      assert.ok(islands[i].y >= islands[i - 1].y + islands[i - 1].h + islands[i - 1].front, `${n}: island ${i} clears the one above`);
    }
    assert.ok(islands[0].y >= 0, `${n}: the first is on the scene`);
    assert.ok(islands[3].y + islands[3].h + islands[3].front <= P.computeLayout(n).height, `${n}: the last is on the scene`);
  }
});

test("9x9: the scene draws in the palette, the festival included", () => {
  const n = 9, scene = P.createScene({ size: n });
  for (const extra of [{}, { festival: { seed: 3, start: 10 } }, { outLanterns: [0, 1, 2], stoneLanternOut: true }]) {
    const rgba = scene.render({ board: new Array(n * n).fill(0), effects: [], overlays: [], time: 25, ambientTime: 25, ...extra });
    let bad = 0;
    for (let i = 0; i < rgba.length; i += 4) if (!PALETTE.has(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`)) bad++;
    assert.equal(bad, 0, JSON.stringify(Object.keys(extra)));
  }
});

test("9x9: all twelve lanterns can be hunted, and no click box touches a playable point", () => {
  const scene = P.createScene({ size: 9 });
  assert.equal(scene.lanternGoal(false).length, 12);
  for (let t = 0; t < 240; t += 0.25) {
    for (const f of scene.floatersAt(t)) {
      if (!onScreen(scene, f)) continue;
      for (const [dx, dy] of [[-11, -11], [11, -11], [-11, 11], [11, 11], [0, 0]]) {
        assert.equal(scene.nativeToPoint(f.x + dx, f.y + dy), null, `#${f.i} at t=${t}`);
      }
    }
  }
});

test("9x9: the stone lantern has no playable point on it", () => {
  const scene = P.createScene({ size: 9 });
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const p = scene.pointToNative(x, y);
    assert.equal(scene.stoneLanternAt(p.x, p.y), false, `(${x}, ${y})`);
  }
});

test("9x9: every festival has lanterns on both sides of the board", () => {
  const scene = P.createScene({ size: 9 });
  for (let seed = 1; seed <= 60; seed++) {
    const spots = scene.festivalLayout(seed);
    assert.ok(spots.filter((q) => q.side === "right").length >= 2, `seed ${seed}: right`);
    assert.ok(spots.filter((q) => q.side === "bottom").length >= 2, `seed ${seed}: bottom`);
  }
});

test("9x9: a whole stage fits a common window at a bigger scale than 13x13", () => {
  assert.ok(P.pickScale(1920, 950, 1, 9).k >= P.pickScale(1920, 950, 1, 13).k);
});

test("final board: a dead stone is drawn faded, in the palette", () => {
  const n = 9, scene = P.createScene({ size: n }), board = new Array(n * n).fill(0), at = 4 * n + 4;
  board[at] = 1;
  const base = { board, effects: [], overlays: [], time: 5, ambientTime: 5 };
  const plain = Uint8ClampedArray.from(scene.render(base)), marked = Uint8ClampedArray.from(scene.render({ ...base, deadStones: [at] }));
  let differs = 0, bad = 0;
  for (let i = 0; i < marked.length; i += 4) {
    if (plain[i] !== marked[i] || plain[i + 1] !== marked[i + 1] || plain[i + 2] !== marked[i + 2]) differs++;
    if (!PALETTE.has(`${marked[i]},${marked[i + 1]},${marked[i + 2]}`)) bad++;
  }
  assert.ok(differs > 10, `${differs} pixels change`);
  assert.equal(bad, 0);
});
