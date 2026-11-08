// The Landing (tasks/2026-11-07_turn_landing/PLAN.md): the turn overview moves out
// of the sidebar into the river. Left of the deck, one island per seat in turn
// order, its lantern hanging over the channel and lit on that seat's turn;
// lanterns drifting round the islands on loops of their own. The boat with the
// round on its sign drifts along the wide river at the bottom.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { P } = loadWeb();
const SIZES = [13, 19, 25];
const OLD_WIDTH = { 13: 256, 19: 352, 25: 448 }; // the scene before the landing
const LANDING = 146;

/** The pixels of a box of an RGBA frame, as one string. */
function box(rgba, W, [x0, y0, w, h]) {
  const out = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(rgba.slice((y * W + x) * 4, (y * W + x) * 4 + 3).join());
  return out.join("|");
}

/** How many pixels differ between two frames outside a box. */
function diffOutside(a, b, W, H, [x0, y0, w, h]) {
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) continue;
    const i = (y * W + x) * 4;
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

const seatsLit = (lit) => [1, 2, 3, 4].map((color, i) => ({ color, lit: i === lit }));
const draw = (scene, state) => Uint8ClampedArray.from(scene.render({ board: [], ...state }));

/** Where two frames differ: the box round it, or null. */
function diffBox(a, b, W, H) {
  let out = null;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue;
    out = out || { x0: x, x1: x, y0: y, y1: y };
    out.x0 = Math.min(out.x0, x); out.x1 = Math.max(out.x1, x); out.y0 = Math.min(out.y0, y); out.y1 = Math.max(out.y1, y);
  }
  return out;
}

test("landing: the scene gains a landing 146 art px wide left of the deck, and the deck moves right with it", () => {
  for (const n of SIZES) {
    const L = P.computeLayout(n);
    assert.equal(L.landingW, LANDING, `${n}: the landing`);
    assert.equal(L.streamX1 + 2, OLD_WIDTH[n] + LANDING, `${n}: the channel and bank end wider by it alone`);
    assert.equal(L.boardX, LANDING + 13, `${n}: the deck after the landing and the old 13 px channel`);
    assert.equal(L.height, P.computeLayout(n).height);
  }
});

test("landing: four islands, one a seat, each centred on an eighth of the deck's height, with water all round it", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    const L = scene.layout;
    assert.equal(L.islands.length, 4, `${n}: four islands`);
    L.islands.forEach((isl, i) => {
      const where = `${n}x${n} island ${i}`;
      const mid = isl.y + (isl.h + isl.front) / 2, want = L.boardY + ((2 * i + 1) * L.boardH) / 8;
      assert.ok(Math.abs(mid - want) <= 1, `${where}: centred on its eighth (${mid} vs ${want})`);
      assert.ok(isl.x >= 8 && isl.x + isl.w <= L.channelX0, `${where}: left of the channel`);
      assert.ok(L.boardX - L.channelX0 >= 21, `${where}: the channel holds a lantern and the boat`);
      const midY = isl.y + (isl.h >> 1), x = isl.x + (isl.w >> 1) + 7;
      assert.equal(scene.regionAt(isl.x + 20, isl.y + 10), P.REGION.ISLAND, `${where}: the island itself`);
      assert.equal(scene.regionAt(isl.x - 3, midY), P.REGION.WATER, `${where}: water on its left`);
      assert.equal(scene.regionAt(isl.x + isl.w + 3, midY), P.REGION.WATER, `${where}: water on its right`);
      assert.equal(scene.regionAt(x, isl.y - 3), P.REGION.WATER, `${where}: water above`);
      assert.equal(scene.regionAt(x, isl.y + isl.h + isl.front + 4), P.REGION.WATER, `${where}: water below`);
    });
  }
});

test("landing: the stage is wider by the landing alone, and a maximised window keeps the board's scale on every size", () => {
  // k per size [13, 19, 25] before the landing (tasks/2026-11-07_turn_landing/stage-k-table.cjs): width is free.
  const want = [[3840, 2260, [5, 4, 3]], [3840, 2030, [4, 3, 3]], [2560, 1310, [3, 2, 2]], [1920, 1070, [2, 2, 1.5]], [1920, 950, [2, 1.5, 1.5]], [1366, 650, [1.5, 1, 1]]];
  SIZES.forEach((n, i) => {
    assert.equal(P.stageSize(n).w, OLD_WIDTH[n] + LANDING + 72, `${n}: across: the old scene, the landing and the market's water`);
    for (const [w, h, ks] of want) assert.equal(P.pickScale(w, h, 1, n).k, ks[i], `${n}x${n} in ${w}x${h}`);
  });
});

test("landing: each seat's lantern hangs over the channel by its island, lit on that seat's turn and dark otherwise; an open seat has none", () => {
  const scene = P.createScene({ size: 13 });
  const L = scene.layout, W = scene.width;
  const lantern = (i) => [L.channelCx - 9, L.islands[i].y - 6, 19, 17];
  const at = (seats) => draw(scene, { time: 1, reducedMotion: true, seats });
  const lit0 = at(seatsLit(0)), lit2 = at(seatsLit(2));
  assert.notEqual(box(lit0, W, lantern(0)), box(lit2, W, lantern(0)), "seat 1's lantern goes out when the turn moves on");
  assert.notEqual(box(lit0, W, lantern(2)), box(lit2, W, lantern(2)), "seat 3's lights up");
  assert.equal(box(lit0, W, lantern(1)), box(lit2, W, lantern(1)), "seat 2's stays dark");
  const open = seatsLit(0);
  open[3] = null;
  assert.notEqual(box(lit0, W, lantern(3)), box(at(open), W, lantern(3)), "an open seat: no lantern");
});

test("round boat: it drifts left and right along the wide river at the bottom on its own clock, only the number on its sign following the play", () => {
  const scene = P.createScene({ size: 19 });
  const L = scene.layout, W = scene.width, H = scene.height;
  const frame = (o) => draw(scene, { time: 1, seats: seatsLit(1), ...o });
  // The sign is what differs between round 4 and round 9.
  const sign = (ambientTime, seats = seatsLit(1)) => diffBox(frame({ ambientTime, seats, round: 4 }), frame({ ambientTime, seats, round: 9 }), W, H);
  const seen = new Set();
  for (const t of [0, 20, 40, 60, 80, 100, 120]) {
    const s = sign(t);
    assert.ok(s, `at ${t}s: the round on its sign`);
    assert.ok(s.y0 >= L.riverY0, `at ${t}s: on the wide river, below the deck (${s.y0})`);
    assert.ok(s.x0 >= 20 && s.x1 < L.streamX1, `at ${t}s: under the deck and the landing, not past the channel`);
    seen.add(s.x0);
  }
  assert.ok(seen.size >= 5, "it travels along the river");
  const a = sign(30), b = sign(31);
  assert.ok(Math.abs(a.x0 - b.x0) <= 6, `slowly: ${Math.abs(a.x0 - b.x0)} px in a second`);
  assert.equal(sign(45, seatsLit(2)).x0, sign(45, seatsLit(0)).x0, "a new turn doesn't move it");
  const still = (time) => draw(scene, { time, reducedMotion: true, round: 4 });
  assert.equal(box(still(1), W, [0, L.riverY0, W, H - L.riverY0]), box(still(9), W, [0, L.riverY0, W, H - L.riverY0]), "with reduced motion it holds still");
});

test("landing: lanterns drift round the islands on loops of their own, never over an island or the deck, each loop closing in LANDING_LOOP", () => {
  assert.ok(P.LANDING_LOOP >= 60, "a long loop, so the pattern doesn't show");
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    const L = scene.layout;
    const first = scene.landingLanterns(0);
    assert.ok(first.length >= 8, `${n}: eight lanterns or more`);
    for (let t = 0; t < P.LANDING_LOOP; t += 0.25) {
      for (const p of scene.landingLanterns(t)) {
        const x0 = p.x - 3, x1 = p.x + 3, y0 = p.y - 3, y1 = p.y + 4; // the 7x8 lantern
        assert.ok(x0 >= 0 && x1 < L.boardX, `${n} at ${t}s: in the landing's water (${p.x},${p.y})`);
        for (const isl of L.islands) {
          const over = x1 >= isl.x && x0 < isl.x + isl.w && y1 >= isl.y && y0 < isl.y + isl.h + isl.front;
          assert.ok(!over, `${n} at ${t}s: a lantern over island at ${isl.y} (${p.x},${p.y})`);
        }
      }
    }
    assert.deepEqual(scene.landingLanterns(P.LANDING_LOOP), first, `${n}: the loops close`);
    const loops = scene.landingLoops;
    assert.ok(new Set(loops.map((l) => l.speed.toFixed(2))).size >= 4, `${n}: their speeds differ, no copied pattern`);
    assert.ok(new Set(loops.map((l) => `${l.from}-${l.to}`)).size >= 5, `${n}: round one, two or three islands`);
    for (let i = 0; i < 4; i++) assert.ok(loops.some((l) => l.from <= i && i <= l.to), `${n}: island ${i} has lanterns round it`);
  }
});

test("landing: the drifting lanterns are drawn where they float on the scene's ambient clock, and light the water round them", () => {
  const { G } = loadWeb();
  const AMBER = G.PALETTE_RGB[G.INDEX.A].join(), CREAM = G.PALETTE_RGB[G.INDEX.C].join();
  const scene = P.createScene({ size: 19 });
  const W = scene.width;
  for (const ambientTime of [2, 37.5]) {
    const rgba = draw(scene, { time: 1, ambientTime, seats: seatsLit(0) });
    const px = (x, y) => rgba.slice((y * W + x) * 4, (y * W + x) * 4 + 3).join();
    let drawn = 0, lit = 0;
    for (const p of scene.landingLanterns(ambientTime)) {
      let paper = 0, glow = 0;
      for (let y = p.y - 3; y <= p.y + 4; y++) for (let x = p.x - 3; x <= p.x + 3; x++) if (px(x, y) === AMBER || px(x, y) === CREAM) paper++;
      for (let y = p.y - 9; y <= p.y + 9; y++) for (let x = p.x - 9; x <= p.x + 9; x++) {
        const d = Math.hypot(x - p.x, y - p.y);
        if (d > 5 && d < 9 && scene.regionAt(x, y) === P.REGION.WATER && px(x, y) === AMBER) glow++;
      }
      if (paper >= 6) drawn++;
      if (glow >= 3) lit++;
    }
    // A lantern can pass behind a hanging lantern or the boat for a moment: most, not all.
    assert.ok(drawn >= 6, `at ${ambientTime}s: ${drawn} lanterns drawn where they float`);
    assert.ok(lit >= 6, `at ${ambientTime}s: ${lit} lanterns light the water round them`);
  }
});
