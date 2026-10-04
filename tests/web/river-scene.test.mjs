// The river crab and the river spirit in web/pixelScene.js: where they stand
// on the pier, their animations (climbing out of the water onto the board,
// idling on it with their timer overhead, taking stones, taking a Bait, going
// back into the water) and the stones they take leaving the board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const RGB = new Set(G.PALETTE_RGB.map(([r, g, b]) => `${r},${g},${b},255`));
const N = 13;
const KINDS = ["crab", "spirit"];

function base(extra = {}) {
  return Object.assign(
    { time: 50, ambientTime: 50, board: new Array(N * N).fill(0), overlays: [], effects: [], myColor: 1, turnCount: 6, roundLength: 4, stormUntil: 0 },
    extra
  );
}

/** Every spot a creature can come up at: in front of each edge point, on each side. */
function spots() {
  const out = [];
  for (let i = 0; i < N; i++) {
    out.push({ side: "top", x: i, y: 0 }, { side: "bottom", x: i, y: N - 1 });
    out.push({ side: "left", x: 0, y: i }, { side: "right", x: N - 1, y: i });
  }
  return out;
}

/** How many pixels of two RGBA buffers differ inside a box around (cx, cy). */
function changed(a, b, width, cx, cy, r) {
  let n = 0;
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const k = (y * width + x) * 4;
      if (a[k] !== b[k] || a[k + 1] !== b[k + 1] || a[k + 2] !== b[k + 2]) n++;
    }
  }
  return n;
}

function inPalette(rgba) {
  for (let k = 0; k < rgba.length; k += 4) {
    if (!RGB.has(`${rgba[k]},${rgba[k + 1]},${rgba[k + 2]},${rgba[k + 3]}`)) return false;
  }
  return true;
}

const up = (kind, extra = {}) => ({ kind, side: "top", x: 6, y: 0, reach: [5, 6, 7], by: 17, rise: 10, ...extra });

test("river creatures: they stand on the board's wooden frame in front of the edge point they face, on all four sides, off the grid", () => {
  const scene = P.createScene({ size: N });
  const L = scene.layout;
  for (const s of spots()) {
    const a = scene.creatureAnchor(s.side, s.x, s.y);
    const w = scene.waterAnchor(s.side, s.x, s.y);
    const p = scene.pointToNative(s.x, s.y);
    const where = `${s.side} ${s.x},${s.y}`;
    // a is where its feet are; the middle of its body is a few rows up.
    assert.equal(scene.regionAt(a.x, a.y - 4), P.REGION.FRAME, `${where}: on the frame`);
    assert.equal(scene.regionAt(w.x, w.y), P.REGION.WATER, `${where}: it climbs out of the water there`);
    if (s.side === "top") assert.ok(a.y < L.kayaY && Math.abs(a.x - p.x) < P.SPACING / 2, where);
    if (s.side === "bottom") assert.ok(a.y >= L.kayaY + L.kayaH && Math.abs(a.x - p.x) < P.SPACING / 2, where);
    if (s.side === "left") assert.ok(a.x < L.kayaX && Math.abs(a.y - 4 - p.y) < P.SPACING / 2, where);
    if (s.side === "right") assert.ok(a.x >= L.kayaX + L.kayaW && Math.abs(a.y - 4 - p.y) < P.SPACING / 2, where);
  }
});

test("river creatures: crab and spirit climb out, idle, take, go back into the water; or, fed a Bait, eat it and go", () => {
  const phase = (c, t) => P.creaturePhase(c, t).phase;
  for (const kind of KINDS) {
    const c = up(kind);
    assert.equal(phase(c, 10.1), "climb", kind);
    const mid = P.creaturePhase(c, 10 + P.RIVER_CLIMB_SECONDS / 2).u;
    assert.ok(mid > 0.4 && mid < 0.6, `${kind} halfway up`);
    assert.equal(phase(c, 10 + P.RIVER_CLIMB_SECONDS + 0.01), "idle");
    assert.equal(phase(c, 10 + 500), "idle", "it idles for as long as its timer runs");
    assert.equal(phase({ ...c, rise: undefined }, 3), "idle", "already up when the page joined: no climb");

    const took = { ...c, takeAt: 40, leave: 40 + P.RIVER_TAKE_SECONDS };
    assert.equal(phase(took, 40.1), "take");
    assert.equal(phase(took, 40 + P.RIVER_TAKE_SECONDS + 0.1), "leave");
    assert.equal(phase(took, 40 + P.RIVER_TAKE_SECONDS + P.RIVER_LEAVE_SECONDS + 0.1), "gone");

    const fed = { ...c, fedAt: 40, leave: 40 + P.RIVER_FEED_SECONDS };
    assert.equal(phase(fed, 40.1), "feed");
    assert.equal(phase(fed, 40 + P.RIVER_FEED_SECONDS + 0.1), "leave");
    assert.equal(phase(fed, 40 + P.RIVER_FEED_SECONDS + P.RIVER_LEAVE_SECONDS + 0.1), "gone");

    const empty = { ...c, leave: 40 };
    assert.equal(phase(empty, 40.1), "leave", "empty-handed, it goes at once");
    assert.equal(phase(empty, 40 + P.RIVER_LEAVE_SECONDS + 0.01), "gone");
    assert.equal(phase({ ...c, rise: 30, takeAt: 30.5, leave: 30.5 + P.RIVER_TAKE_SECONDS }, 30.6), "take", "a take cuts a climb short");
  }
  assert.equal(phase(null, 5), "gone");
});

test("river creatures: every phase of both is drawn in the palette, they move while they idle, and their reach is ringed while they wait", () => {
  const scene = P.createScene({ size: N });
  const W = scene.width;
  const a = scene.creatureAnchor("top", 6, 0);
  const reachPts = [[5, 0], [6, 0], [7, 0]];
  const none = Uint8ClampedArray.from(scene.render(base()));
  const at = (t, c) => Uint8ClampedArray.from(scene.render(base({ time: t, river: [c] })));
  const idles = {};
  for (const kind of KINDS) {
    const c = up(kind);
    const frames = {
      climbing: at(10 + P.RIVER_CLIMB_SECONDS * 0.7, c),
      idle: at(50, c),
      taking: at(40 + P.RIVER_TAKE_SECONDS / 2, { ...c, takeAt: 40, leave: 40 + P.RIVER_TAKE_SECONDS }),
      feeding: at(40 + P.RIVER_FEED_SECONDS / 2, { ...c, fedAt: 40, leave: 40 + P.RIVER_FEED_SECONDS }),
      leaving: at(40 + P.RIVER_LEAVE_SECONDS * 0.3, { ...c, leave: 40 }),
    };
    for (const [name, buf] of Object.entries(frames)) {
      assert.ok(changed(buf, none, W, a.x, a.y - 4, 9) > 10, `${kind} ${name}: it shows by the frame`);
      assert.ok(inPalette(buf), `${kind} ${name}: palette colours only`);
    }
    // The idle loop moves on the scene's own clock (time), not the ambient one.
    assert.ok(changed(frames.idle, at(50.4, c), W, a.x, a.y - 4, 9) > 0, `${kind} moves while it waits`);
    const leaving = frames.leaving;
    for (const [x, y] of reachPts) {
      const p = scene.pointToNative(x, y);
      assert.ok(changed(frames.idle, none, W, p.x, p.y, 10) > 0, `${kind}: (${x}, ${y}) ringed while it waits`);
      assert.equal(changed(leaving, none, W, p.x, p.y + 2, 6), 0, `${kind}: no ring on (${x}, ${y}) once it leaves`);
    }
    const gone = at(40 + P.RIVER_LEAVE_SECONDS + 1, { ...c, leave: 40 });
    assert.equal(changed(gone, none, W, a.x, a.y - 4, 12), 0, `${kind}: nothing left once it has gone`);
    idles[kind] = frames.idle;
  }
  assert.ok(changed(idles.crab, idles.spirit, W, a.x, a.y - 4, 9) > 10, "a crab and a spirit look different");
});

test("river creatures: the timer over their head shows the rounds left", () => {
  assert.deepEqual([5, 8, 9, 12, 13, 16, 17].map((t) => P.roundsLeft(17, t, 4)), [3, 3, 2, 2, 1, 1, 0]);
  const scene = P.createScene({ size: N });
  const W = scene.width;
  for (const side of ["top", "right", "bottom", "left"]) {
    const [x, y] = side === "top" ? [6, 0] : side === "bottom" ? [6, 12] : side === "left" ? [0, 6] : [12, 6];
    const c = { kind: "crab", side, x, y, reach: [], by: 17 };
    const a = scene.creatureAnchor(side, x, y);
    const t = scene.timerAnchor(side, x, y);
    const three = Uint8ClampedArray.from(scene.render(base({ turnCount: 5, river: [c] })));
    const one = Uint8ClampedArray.from(scene.render(base({ turnCount: 14, river: [c] })));
    const without = Uint8ClampedArray.from(scene.render(base({ turnCount: 5 })));
    assert.ok(changed(three, without, W, t.x, t.y, 3) > 3, `${side}: a timer is drawn`);
    assert.ok(changed(three, one, W, t.x, t.y, 3) > 0, `${side}: 3 rounds left looks different from 1`);
    assert.ok(Math.hypot(t.x - a.x, t.y - (a.y - 4)) < 20, `${side}: the timer sits by the creature`);
    assert.ok(inPalette(three) && inPalette(one));
  }
});

test("river creatures: the crab's stone and every stone the spirit steals leave in its hands, not as a capture", () => {
  const prev = new Array(N * N).fill(0);
  prev[5] = 1;
  prev[6] = 2;
  prev[7] = 3;
  prev[40] = 4;
  const next = prev.slice();
  next[5] = next[6] = next[7] = 0;
  next[40] = 0; // and an ordinary capture elsewhere in the same update
  const fx = P.diffTurn(prev, next, N, null, [], 7, [], [{ kind: "spirit", took: [5, 6, 7], side: "top", x: 6, y: 0 }]);
  const kinds = Object.fromEntries(fx.map((e) => [e.y * N + e.x, e.kind]));
  assert.deepEqual([kinds[5], kinds[6], kinds[7], kinds[40]], ["riverTake", "riverTake", "riverTake", "capture"]);
  const take = fx.find((e) => e.kind === "riverTake" && e.x === 6);
  assert.deepEqual([take.code, take.creature, take.side, take.sx, take.sy], [2, "spirit", "top", 6, 0]);
  assert.ok(P.EFFECT_KINDS.includes("riverTake"));
  assert.ok(Math.abs(P.effectDuration(take, false) - P.RIVER_TAKE_SECONDS) < 0.05, "the effect lasts as long as the take");

  const pinched = P.diffTurn([0, 0, 3, 0], [0, 0, 0, 0], 2, null, [], 7, [], [{ kind: "crab", took: [2], side: "left", x: 0, y: 1 }]);
  assert.deepEqual(pinched.map((e) => [e.kind, e.creature]), [["riverTake", "crab"]]);

  const scene = P.createScene({ size: N });
  for (const kind of KINDS) {
    const e = P.makeEffect("riverTake", 6, 0, { code: 2, creature: kind, side: "top", sx: 6, sy: 0 }, 7);
    const p = scene.pointToNative(6, 0);
    const still = Uint8ClampedArray.from(scene.render(base({ board: next })));
    const lifting = Uint8ClampedArray.from(scene.render(base({ board: next, time: 7.3, effects: [e] })));
    assert.ok(changed(lifting, still, scene.width, p.x, p.y, 12) > 10, `${kind}: the stone is drawn on its way`);
    assert.ok(inPalette(lifting));
  }
});
