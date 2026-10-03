// web/pixelScene.js in plain Node: layout, hit-testing, rendering and the
// effects a board change turns into.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const RGB = new Set(G.PALETTE_RGB.map(([r, g, b]) => `${r},${g},${b},255`));

function base(n, extra = {}) {
  return Object.assign(
    { time: 3, ambientTime: 3, board: new Array(n * n).fill(0), overlays: [], effects: [], myColor: 1, turnCount: 0, roundLength: 4, stormUntil: 0 },
    extra
  );
}

/** A board with every kind of piece on it, and some of everything around it. */
function busy(n) {
  const board = new Array(n * n).fill(0);
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].forEach((code, i) => (board[(1 + i) * n - 2 - (i % 5)] = code));
  return base(n, {
    board,
    lastMove: { x: 3, y: 3 },
    hover: { x: 6, y: 6 },
    hoverKind: "stone",
    overlays: [
      { kind: "lily", x: 2, y: 2, owner: 2, until: 8 },
      { kind: "ward", x: 4, y: 4, owner: 3, until: 8 },
      { kind: "fire", x: 5, y: 5, owner: 0, until: 9 },
      { kind: "seed", x: 7, y: 7, owner: 1, until: 6, axis: "pattern" },
      { kind: "fog", x: 1, y: 8, owner: 2, until: 6 },
      { kind: "mist", x: 8, y: 1, owner: 4, until: 6 },
    ],
    effects: P.EFFECT_KINDS.map((k, i) => P.makeEffect(k, i % n, 9, { code: 2, from: 6, owner: 2 }, 2.9)),
    fireflies: 123,
    passFlash: 2.8,
  });
}

test("layout grows with the board and every intersection maps to a native pixel and back", () => {
  let last = 0;
  for (const size of [9, 13, 19]) {
    const scene = P.createScene({ size });
    assert.equal(scene.layout.size, size);
    assert.ok(scene.width > last);
    last = scene.width;
    assert.equal(scene.rgba.length, scene.width * scene.height * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const p = scene.pointToNative(x, y);
        assert.ok(p.x >= 0 && p.x < scene.width && p.y >= 0 && p.y < scene.height);
        assert.deepEqual(scene.nativeToPoint(p.x, p.y), { x, y });
        assert.deepEqual(scene.nativeToPoint(p.x + 3, p.y - 3), { x, y }, "a click near the point counts");
      }
    }
  }
});

test("a click far off the grid is no point at all", () => {
  const scene = P.createScene({ size: 13 });
  assert.equal(scene.nativeToPoint(0, 0), null);
  assert.equal(scene.nativeToPoint(scene.width - 1, scene.height - 1), null);
});

test("the intersections are on the kaya, the corner of the scene is not", () => {
  const scene = P.createScene({ size: 13 });
  const p = scene.pointToNative(6, 6);
  assert.equal(scene.regionAt(p.x, p.y), P.REGION.KAYA);
  assert.notEqual(scene.regionAt(0, 0), P.REGION.KAYA);
});

test("a busy board renders opaque pixels in the five palette colours only", () => {
  const scene = P.createScene({ size: 13 });
  const rgba = scene.render(busy(13));
  for (let i = 0; i < rgba.length; i += 4) {
    const px = `${rgba[i]},${rgba[i + 1]},${rgba[i + 2]},${rgba[i + 3]}`;
    if (!RGB.has(px)) assert.fail(`pixel ${i / 4} is ${px}, outside the palette`);
  }
});

test("rendering is a pure function of the state: same state, same pixels", () => {
  const a = P.createScene({ size: 13 }).render(busy(13)).slice();
  const b = P.createScene({ size: 13 }).render(busy(13));
  assert.deepEqual(Buffer.from(b), Buffer.from(a));
});

test("a stone changes the picture where it stands", () => {
  const scene = P.createScene({ size: 13 });
  const empty = scene.render(base(13)).slice();
  const s = base(13);
  s.board[6 * 13 + 6] = 1;
  const one = scene.render(s);
  const { x, y } = scene.pointToNative(6, 6);
  const changed = (x0, y0) => {
    let d = 0;
    for (let yy = y0 - 7; yy <= y0 + 7; yy++) {
      for (let xx = x0 - 7; xx <= x0 + 7; xx++) {
        const i = (yy * scene.width + xx) * 4;
        if (one[i] !== empty[i] || one[i + 1] !== empty[i + 1] || one[i + 2] !== empty[i + 2]) d++;
      }
    }
    return d;
  };
  assert.ok(changed(x, y) > 50, "the stone covers its point");
  const far = scene.pointToNative(1, 1);
  assert.equal(changed(far.x, far.y), 0, "and nothing far from it");
});

test("diffBoards: a new stone is placed, a lost one captured, the storm's grey alone is nothing", () => {
  const prev = [0, 2, 3, 0], next = [1, 0, G.GREY_STONE, 0];
  const { effects, lastMove } = P.diffBoards(prev, next, 2, 5);
  assert.deepEqual(effects.map((e) => [e.kind, e.x, e.y]), [["place", 0, 0], ["capture", 1, 0]]);
  assert.deepEqual(lastMove, { x: 0, y: 0 });
  assert.deepEqual(P.diffBoards(null, next, 2, 5).effects, []);
  // And back: the storm passing turns grey stones to colour, which is nothing happening either.
  assert.deepEqual(P.diffBoards([G.GREY_STONE, 0, 0, 0], [3, 0, 0, 0], 2, 5).effects, []);
  assert.deepEqual(P.diffTurn([G.GREY_STONE, 2, 0, 0], [3, G.GREY_STONE, 0, 0], 2, null, [], 5), []);
});

test("diffTurn picks each item's own animation", () => {
  const n = 3, t = 1;
  const kinds = (prev, next, action, extra) => P.diffTurn(prev, next, n, action, [], t, extra).map((e) => e.kind);
  assert.deepEqual(kinds([0, 0, 0, 0, 0, 0, 0, 0, 0], [9, 0, 0, 0, 0, 0, 0, 0, 0], null), ["drop"]);
  assert.deepEqual(kinds([9, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], null), ["driftAway"]);
  assert.deepEqual(kinds([1, 0, 0, 0, 0, 0, 0, 0, 0], [5, 0, 0, 0, 0, 0, 0, 0, 0], null), ["flip"]);
  assert.deepEqual(kinds([2, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], { kind: "powerup", id: "gust", x: 0, y: 0 }), ["gust"]);
  assert.deepEqual(kinds([2, 0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], { kind: "powerup", id: "remove_stone", x: 0, y: 0 }), ["snipe"]);
  assert.deepEqual(kinds([0, 1, 0, 0, 0, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0, 0, 0], { kind: "powerup", id: "ferry", x: 0, y: 0 }), ["place"], "the ferried stone's old point goes quietly");
  assert.deepEqual(kinds([0, 0, 0, 0, 2, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], { kind: "powerup", id: "bomb", x: 1, y: 1 }), ["capture", "firework"]);
  assert.deepEqual(kinds([0, 0, 0, 0, 2, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0], null, [{ kind: "fire", x: 1, y: 1 }]), ["burnAway"]);
});

test("every effect kind animates (reduced motion may skip it), and is pruned once it has run", () => {
  for (const kind of P.EFFECT_KINDS) {
    for (const reduced of [false, true]) {
      const e = P.makeEffect(kind, 0, 0, {}, 10);
      const d = P.effectDuration(e, reduced);
      if (!reduced) assert.ok(d > 0, `${kind} has no animation`);
      assert.ok(d <= P.effectDuration(e, false), `${kind}: reduced motion runs no longer`);
      if (d > 0) assert.equal(P.effectDone(e, 10 + d / 2, reduced), false);
      assert.equal(P.effectDone(e, 10 + d + 1e-6, reduced), true);
      assert.deepEqual(P.pruneEffects([e], 10 + d + 1e-6, reduced), []);
    }
  }
});

test("storm timing: the phase runs STORM_SECONDS, bolts fall in order, the grey lingers by rounds", () => {
  assert.equal(P.stormPhase(-1, 3, false), null);
  assert.equal(P.stormPhase(P.STORM_SECONDS, 3, false), null);
  const early = P.stormPhase(P.boltTime(1) - 0.01, 3, false);
  assert.deepEqual(early.landed, [true, false, false]);
  const late = P.stormPhase(P.boltTime(2) + 0.01, 3, false);
  assert.ok(late.weight > 0 && late.landed.every(Boolean));
  assert.ok(late.bolts[2] >= 0 && late.bolts[0] === -1, "only the bolt just fallen is flashing");
  assert.equal(P.stormPhase(1, 3, true).rain, 0, "no rain with reduced motion");
  assert.ok(P.boltTime(0) < P.boltTime(1) && P.boltTime(1) < P.boltTime(2));
  assert.equal(P.stormLinger(100, 108, 4), 1);
  assert.equal(P.stormLinger(106, 108, 4), 0.5);
  assert.equal(P.stormLinger(108, 108, 4), 0);
  assert.equal(P.stormLinger(100, 108, 0), 0);
});

test("star points sit on the grid, symmetric about the centre", () => {
  for (const size of [9, 13, 19]) {
    const stars = P.starPoints(size);
    assert.ok(stars.length > 0);
    const key = (p) => `${p.x},${p.y}`;
    const set = new Set(stars.map(key));
    for (const p of stars) {
      assert.ok(p.x >= 0 && p.x < size && p.y >= 0 && p.y < size);
      assert.ok(set.has(key({ x: size - 1 - p.x, y: size - 1 - p.y })));
    }
  }
});
