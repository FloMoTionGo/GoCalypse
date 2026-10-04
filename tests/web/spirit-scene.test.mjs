// The river spirit in web/pixelScene.js: where it sits, its four animations
// (emerging, idling until it acts, taking a stone, receding) and the stone it
// takes leaving the board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const RGB = new Set(G.PALETTE_RGB.map(([r, g, b]) => `${r},${g},${b},255`));
const N = 13;

function base(extra = {}) {
  return Object.assign(
    { time: 50, ambientTime: 50, board: new Array(N * N).fill(0), overlays: [], effects: [], myColor: 1, turnCount: 6, roundLength: 4, stormUntil: 0 },
    extra
  );
}

/** Every spot the spirit can rise at: in front of each edge point, on each side. */
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

test("river spirit: it sits in the water in front of the edge point it faces, on all four sides", () => {
  const scene = P.createScene({ size: N });
  const L = scene.layout;
  for (const s of spots()) {
    const a = scene.spiritAnchor(s.side, s.x, s.y);
    const p = scene.pointToNative(s.x, s.y);
    assert.equal(scene.regionAt(a.x, a.y), P.REGION.WATER, `${s.side} ${s.x},${s.y} in the water`);
    if (s.side === "top") assert.ok(a.y < L.boardY && Math.abs(a.x - p.x) < P.SPACING / 2, `top ${s.x}`);
    if (s.side === "bottom") assert.ok(a.y >= L.riverY0 && Math.abs(a.x - p.x) < P.SPACING / 2, `bottom ${s.x}`);
    if (s.side === "left") assert.ok(a.x < L.boardX && Math.abs(a.y - p.y) < P.SPACING / 2, `left ${s.y}`);
    if (s.side === "right") assert.ok(a.x >= L.streamX0 && Math.abs(a.y - p.y) < P.SPACING / 2, `right ${s.y}`);
  }
});

test("river spirit: its animations run in order, emerging, idling until it acts, taking a stone, receding", () => {
  const rise = 10;
  const up = { side: "top", x: 6, y: 0, reach: [5, 6, 7], rise };
  const phase = (sp, t) => P.spiritPhase(sp, t).phase;
  assert.equal(phase(up, rise + 0.1), "rise");
  assert.ok(P.spiritPhase(up, rise + P.SPIRIT_RISE_SECONDS / 2).u > 0.4 && P.spiritPhase(up, rise + P.SPIRIT_RISE_SECONDS / 2).u < 0.6);
  assert.equal(phase(up, rise + P.SPIRIT_RISE_SECONDS + 0.01), "idle");
  assert.equal(phase(up, rise + 500), "idle", "it idles for as long as it waits");
  assert.equal(phase({ ...up, rise: undefined }, 3), "idle", "already up when the page joined: no rise");
  const takeAt = 40;
  const took = { ...up, takeAt, sink: takeAt + P.SPIRIT_TAKE_SECONDS };
  assert.equal(phase(took, takeAt + 0.1), "take");
  assert.equal(phase(took, takeAt + P.SPIRIT_TAKE_SECONDS + 0.1), "sink");
  assert.equal(phase(took, takeAt + P.SPIRIT_TAKE_SECONDS + P.SPIRIT_SINK_SECONDS + 0.1), "gone");
  const empty = { ...up, sink: 40 };
  assert.equal(phase(empty, 40.1), "sink", "empty-handed, it sinks at once");
  assert.equal(phase(empty, 40 + P.SPIRIT_SINK_SECONDS + 0.01), "gone");
  assert.equal(phase({ ...up, rise: 30, takeAt: 30.5, sink: 30.5 + P.SPIRIT_TAKE_SECONDS }, 30.6), "take", "a take cuts a rise short");
  assert.equal(phase(null, 5), "gone");
});

test("river spirit: every phase is drawn in the palette, it moves while it idles, and its reach is ringed while it waits", () => {
  const scene = P.createScene({ size: N });
  const W = scene.width;
  const anchor = scene.spiritAnchor("top", 6, 0);
  const reachPts = [[5, 0], [6, 0], [7, 0]];
  const reach = reachPts.map(([x, y]) => y * N + x);
  const none = Uint8ClampedArray.from(scene.render(base()));
  const at = (t, sp) => Uint8ClampedArray.from(scene.render(base({ time: t, ambientTime: 50, spirit: sp })));
  const up = { side: "top", x: 6, y: 0, reach, rise: 10 };

  const rising = at(10 + P.SPIRIT_RISE_SECONDS * 0.6, up);
  const idle = at(50, up);
  const idleLater = at(50.4, up);
  const taking = at(40 + P.SPIRIT_TAKE_SECONDS / 2, { ...up, takeAt: 40, sink: 40 + P.SPIRIT_TAKE_SECONDS });
  const sinking = at(40 + P.SPIRIT_SINK_SECONDS / 2, { ...up, sink: 40 });
  const gone = at(40 + P.SPIRIT_SINK_SECONDS + 1, { ...up, sink: 40 });
  for (const [name, buf] of Object.entries({ rising, idle, taking, sinking })) {
    assert.ok(changed(buf, none, W, anchor.x, anchor.y, 8) > 10, `${name}: the spirit shows in the water`);
    assert.ok(inPalette(buf), `${name}: palette colours only`);
  }
  // The idle loop moves on the scene's own clock (time), not the ambient one.
  assert.ok(changed(idle, idleLater, W, anchor.x, anchor.y, 8) > 0, "it bobs while it waits");
  for (const [x, y] of reachPts) {
    const p = scene.pointToNative(x, y);
    assert.ok(changed(idle, none, W, p.x, p.y, 10) > 0, `reach (${x}, ${y}) ringed while it waits`);
    assert.equal(changed(sinking, none, W, p.x, p.y, 10), 0, `no ring on (${x}, ${y}) once it sinks`);
  }
  assert.equal(changed(gone, none, W, anchor.x, anchor.y, 10), 0, "nothing left once it has gone under");
});

test("river spirit: a stone it took leaves the board in the spirit's hands, not as a capture", () => {
  const prev = new Array(N * N).fill(0);
  prev[6] = 2;
  prev[40] = 3;
  const next = prev.slice();
  next[6] = 0;
  next[40] = 0; // and an ordinary capture elsewhere in the same update
  const fx = P.diffTurn(prev, next, N, null, [], 7, [], { took: 6, side: "top", x: 6, y: 0 });
  const kinds = Object.fromEntries(fx.map((e) => [e.y * N + e.x, e.kind]));
  assert.equal(kinds[6], "spiritTake");
  assert.equal(kinds[40], "capture");
  const take = fx.find((e) => e.kind === "spiritTake");
  assert.equal(take.code, 2);
  assert.equal(take.side, "top");
  assert.ok(P.EFFECT_KINDS.includes("spiritTake"));
  assert.ok(Math.abs(P.effectDuration(take, false) - P.SPIRIT_TAKE_SECONDS) < 0.05, "the effect lasts as long as the take");

  const scene = P.createScene({ size: N });
  const p = scene.pointToNative(6, 0);
  const still = Uint8ClampedArray.from(scene.render(base({ board: next })));
  const lifting = Uint8ClampedArray.from(scene.render(base({ board: next, time: 7.3, effects: [take] })));
  assert.ok(changed(lifting, still, scene.width, p.x, p.y, 12) > 10, "the stone is drawn on its way to the spirit");
  assert.ok(inPalette(lifting));
});
