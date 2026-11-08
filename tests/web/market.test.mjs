// The Night Market on the water (tasks/2026-11-07_night_market_water/PLAN.md, v5):
// the stalls leave the sidebar for seven small boats in a strip of water right of
// the lantern channel, each held at its bow by a pole fixed in the riverbed. The
// boat bobs; the lantern hovering over it answers the bob late; the string of
// stock lanterns behind the stern is one piece with the hull.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const SIZES = [13, 19, 25];
const OLD_WIDTH = { 13: 402, 19: 498, 25: 594 }; // the scene before the market
const MARKET_W = 72;
const IDS = ["bait", "driftwood", "fog", "lily_pad", "kite", "skiff", "remove_stone"];
const [K, C, A, , S] = ["K", "C", "A", "T", "S"].map((c) => G.PALETTE_RGB[G.INDEX[c]].join());

const stall = (id, state, o = {}) => ({ id, state, price: 35, stock: 6, left: 6, turn: false, ...o });
const seven = (state, o) => IDS.map((id) => stall(id, state, o));
const OPEN_SIGN = { text: "NIGHT MARKET", lit: true };
const market = (stalls, sign = OPEN_SIGN) => ({ sign, stalls });
const draw = (scene, state) => Uint8ClampedArray.from(scene.render({ board: [], ...state }));
const still = (scene, stalls, sign) => draw(scene, { time: 1, reducedMotion: true, market: market(stalls, sign) });
const pixel = (rgba, W, x, y) => rgba.slice((y * W + x) * 4, (y * W + x) * 4 + 3).join();

/** A box of a frame, as one string. */
function box(rgba, W, [x0, y0, w, h]) {
  const out = [];
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push(pixel(rgba, W, x, y));
  return out.join("|");
}

/** How many pixels differ between two frames outside a box. */
function diffOutside(a, b, W, H, [x0, y0, w, h]) {
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (x >= x0 && x < x0 + w && y >= y0 && y < y0 + h) continue;
    if (pixel(a, W, x, y) !== pixel(b, W, x, y)) n++;
  }
  return n;
}

// Where every frame of the hovering lantern has paper.
const frames = G.ANIMS.garlandAmber.frames, LANTERN = [];
for (let y = 0; y < frames[0].h; y++) for (let x = 0; x < frames[0].w; x++) {
  if (frames.every((f) => f.px[y * f.w + x] !== G.TRANSPARENT)) LANTERN.push([x, y]);
}
/** Lit paper of a boat's hovering lantern: its amber and cream cells. */
function paper(rgba, W, at) {
  return LANTERN.filter(([x, y]) => [A, C].includes(pixel(rgba, W, at.x + x, at.y + y))).length;
}

/** The cells of the pole at mooring `m`, each with the colour it must always have. */
function poleCells(m) {
  const cells = [[m.poleX, m.wl - 6, C]];
  for (let y = m.wl - 5; y <= m.wl; y++) cells.push([m.poleX - 1, y, K], [m.poleX, y, S], [m.poleX + 1, y, K]);
  return cells;
}

const T0 = 3.3, FRAMES = 80, FPS = 10;
const time = (f) => T0 + f / FPS;

test("market: the scene gains 72 art px of water right of the lantern channel, the bank moved out past it, on every board size", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    const L = scene.layout, y = L.boardY + 50;
    assert.equal(L.marketX0, L.streamX1, `${n}: it starts where the channel ends`);
    assert.equal(L.marketX1, L.marketX0 + MARKET_W, `${n}: ${MARKET_W} px of it`);
    assert.equal(L.width, OLD_WIDTH[n] + MARKET_W, `${n}: the scene is wider by it alone`);
    for (const x of [L.marketX0 + 2, L.marketX0 + 36, L.marketX1 - 3]) assert.equal(scene.regionAt(x, y), P.REGION.WATER, `${n}: water at ${x}`);
    assert.equal(scene.regionAt(L.width - 1, y), P.REGION.BANK, `${n}: the bank past it`);
  }
});

test("market: the sidebar gives up what the market takes, so the stage keeps its width and no window loses a scale step", () => {
  assert.equal(P.STAGE.sidebar, 192);
  for (const n of SIZES) assert.equal(P.stageSize(n).w, OLD_WIDTH[n] + P.STAGE.gap + 264, `${n}: as wide as before`);
});

test("market: seven moorings on every board size, in the market's water, each 32 rows or more from the next, clear of the sign and the near bank", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    const L = scene.layout;
    assert.equal(L.stalls.length, 7, `${n}: seven boats`);
    L.stalls.forEach((m, i) => {
      const where = `${n}x${n} boat ${i}`;
      const boat = scene.marketBoat(i, 0, stall(IDS[i], "open"));
      assert.ok(m.cx - 8 >= L.marketX0 && m.cx + 8 < L.marketX1, `${where}: the hull in the market's water`);
      assert.equal(m.poleX, m.cx + (m.flip ? 14 : -14), `${where}: the pole at the bow, away from the string`);
      for (const [x, y] of poleCells(m)) assert.equal(scene.regionAt(x, y), P.REGION.WATER, `${where}: the pole stands in water at ${x},${y}`);
      for (const b of boat.string) assert.ok(b.x > L.marketX0 && b.x < L.marketX1, `${where}: its string in the market's water`);
      assert.ok(boat.lantern.y > L.topBank + 12, `${where}: the lantern below the sign`);
      assert.ok(m.wl + 4 < L.height - 4, `${where}: above the near bank`);
      if (i) assert.ok(m.wl - L.stalls[i - 1].wl >= 32, `${where}: 32 rows or more below the one before`);
    });
  }
});

test("market: a boat's hit area covers its hull, lantern and tag, and no other boat's hull or lantern lies in it", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    const L = scene.layout;
    for (const state of ["open", "bought", "sold"]) {
      const boxes = IDS.map((id, i) => P.marketBox(L, i, stall(id, state)));
      const inBox = (b, x, y) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
      L.stalls.forEach((m, i) => {
        const where = `${n}x${n} boat ${i} (${state})`, boat = scene.marketBoat(i, 0, stall(IDS[i], state));
        const b = boxes[i];
        assert.ok(inBox(b, m.cx - 8, m.wl) && inBox(b, m.cx + 8, m.wl), `${where}: its hull`);
        assert.ok(inBox(b, boat.lantern.x, boat.lantern.y), `${where}: its lantern`);
        assert.ok(b.x >= L.marketX0 - 2 && b.x + b.w <= L.marketX1 + 2, `${where}: its hit area over the market's water`);
        boxes.forEach((other, j) => {
          if (j === i) return;
          assert.ok(!inBox(other, m.cx, m.wl - 2), `${where}: not its hull inside boat ${j}'s hit area`);
          assert.ok(!inBox(other, boat.lantern.x + 3, boat.lantern.y + 4), `${where}: not its lantern inside boat ${j}'s hit area`);
        });
      });
    }
  }
});

test("market: every pole stands still through the whole loop while its boat bobs beside it", () => {
  const scene = P.createScene({ size: 19 });
  const L = scene.layout, W = scene.width, stalls = seven("open");
  const bobs = L.stalls.map(() => new Set());
  for (let f = 0; f < FRAMES; f++) {
    const t = time(f);
    const rgba = draw(scene, { time: t, market: market(stalls) });
    L.stalls.forEach((m, i) => {
      for (const [x, y, want] of poleCells(m)) assert.equal(pixel(rgba, W, x, y), want, `frame ${f}: pole ${i} at ${x},${y}`);
      const boat = scene.marketBoat(i, t, stalls[i]);
      bobs[i].add(boat.y);
      assert.equal(pixel(rgba, W, m.cx, boat.y), K, `frame ${f}: boat ${i}'s keel is where it says`);
    });
  }
  bobs.forEach((b, i) => assert.ok(b.size >= 2, `boat ${i} bobs`));
});

test("market: the hovering lantern replays its boat's bob 0.6 s late, and only a lantern still selling sways", () => {
  const scene = P.createScene({ size: 19 });
  const L = scene.layout, W = scene.width, stalls = seven("open");
  L.stalls.forEach((_, i) => {
    const late = new Set(), inStep = new Set(), xs = new Set(), outX = new Set(), outLate = new Set();
    for (let f = 0; f < FRAMES; f++) {
      const t = time(f), boat = scene.marketBoat(i, t, stalls[i]);
      const out = scene.marketBoat(i, t, stall(IDS[i], "sold"));
      late.add(boat.lantern.y - scene.marketBoat(i, t - 0.6, stalls[i]).y);
      inStep.add(boat.lantern.y - boat.y);
      xs.add(boat.lantern.x);
      outX.add(out.lantern.x);
      outLate.add(out.lantern.y - scene.marketBoat(i, t - 0.6, stalls[i]).y);
    }
    assert.equal(late.size, 1, `boat ${i}: the lantern is the boat's bob, 0.6 s late`);
    assert.ok(inStep.size >= 2, `boat ${i}: not in step with it`);
    assert.ok(xs.size >= 2, `boat ${i}: a lit lantern sways`);
    assert.equal(outX.size, 1, `boat ${i}: an unlit one doesn't`);
    assert.equal(outLate.size, 1, `boat ${i}: but it still follows the boat late`);
  });
  for (const t of [3.3, 4.7, 6.1]) {
    const rgba = draw(scene, { time: t, market: market(stalls) });
    L.stalls.forEach((_, i) => assert.ok(paper(rgba, W, scene.marketBoat(i, t, stalls[i]).lantern) > 8, `at ${t}: lantern ${i} is drawn where it says`));
  }
});

test("market: the stock string moves as one with its boat, a small lantern lit for every copy left and dark for every copy sold", () => {
  const scene = P.createScene({ size: 19 });
  const W = scene.width, stalls = seven("open", { stock: 6, left: 2 });
  stalls.forEach((s, i) => {
    const shapes = new Set();
    for (let f = 0; f < FRAMES; f += 3) {
      const t = time(f), boat = scene.marketBoat(i, t, s);
      assert.equal(boat.string.length, 6, `boat ${i}: one lantern a copy`);
      shapes.add(boat.string.map((b) => `${b.x}:${b.y - boat.y}`).join());
      const rgba = draw(scene, { time: t, market: market(stalls) });
      boat.string.forEach((b, k) => {
        assert.equal(pixel(rgba, W, b.x, b.y - 1), k < 2 ? C : S, `frame ${f}: boat ${i} lantern ${k}'s cap`);
        assert.equal(pixel(rgba, W, b.x, b.y), k < 2 ? A : K, `frame ${f}: boat ${i} lantern ${k}'s paper`);
      });
    }
    assert.equal(shapes.size, 1, `boat ${i}: the string keeps one shape against its hull`);
  });
});

test("market: the lantern says whether you can buy: lit, half lit when you can't, out once it's gone", () => {
  const scene = P.createScene({ size: 19 });
  const W = scene.width;
  const lit = (state) => {
    const stalls = seven(state);
    return paper(still(scene, stalls), W, scene.marketBoat(3, 0, stalls[3]).lantern);
  };
  assert.ok(lit("open") > lit("poor"), "lit brighter than half lit");
  assert.ok(lit("poor") > 0, "half lit is still lit");
  for (const state of ["bought", "sold", "closed"]) assert.equal(lit(state), 0, `${state}: out`);
});

test("market: a sold-out boat is empty and says SOLD, an open one carries its item and its price", () => {
  const scene = P.createScene({ size: 19 });
  const L = scene.layout, W = scene.width, m = L.stalls[0];
  const hullTop = m.wl - G.SPRITES.boatHull.h + 1;
  const goods = [m.cx - 7, hullTop - 11, 15, 9], tag = [m.cx + 4, hullTop - 21, 30, 12];
  const none = still(scene, []), open = still(scene, [stall("fog", "open")]), sold = still(scene, [stall("fog", "sold", { left: 0 })]);
  assert.notEqual(box(open, W, goods), box(none, W, goods), "the item stands in an open boat");
  assert.equal(box(sold, W, goods), box(none, W, goods), "a sold-out boat is empty");
  assert.notEqual(box(open, W, tag), box(none, W, tag), "the price on its tag");
  assert.notEqual(box(sold, W, tag), box(open, W, tag), "a sold-out boat's tag says so instead of the price");
});

test("market: the turn marker is on boats whose item takes the turn, on the side away from the price tag", () => {
  const scene = P.createScene({ size: 19 });
  const L = scene.layout, W = scene.width, H = scene.height;
  [0, 1].forEach((i) => {
    const m = L.stalls[i], hullTop = m.wl - G.SPRITES.boatHull.h + 1;
    const fill = [stall("bait", "open"), stall("fog", "open")].slice(0, i);
    const without = still(scene, fill.concat(stall("kite", "open", { turn: false })));
    const withIt = still(scene, fill.concat(stall("kite", "open", { turn: true })));
    const side = m.cx - L.marketX0 > L.marketX1 - m.cx ? -1 : 1;
    const marker = [side < 0 ? m.cx + 4 : m.cx - 12, hullTop - 17, 9, 9];
    assert.notEqual(box(withIt, W, marker), box(without, W, marker), `boat ${i}: the marker`);
    assert.equal(diffOutside(withIt, without, W, H, marker), 0, `boat ${i}: and nothing else changes`);
  });
});

test("market: before it opens the sign reads OPENS n/5, every lantern and string is out and no boat shows a price", () => {
  const scene = P.createScene({ size: 19 });
  const L = scene.layout, W = scene.width, sign = [L.marketX0, L.topBank + 2, MARKET_W, 10];
  const stalls = seven("closed");
  const opens = { text: "OPENS 3/5", lit: false };
  const closed = still(scene, stalls, opens), open = still(scene, seven("open"));
  assert.notEqual(box(closed, W, sign), box(open, W, sign), "the sign says so");
  assert.notEqual(box(closed, W, sign), box(still(scene, stalls, { text: "OPENS 4/5", lit: false }), W, sign), "and how far off it is");
  stalls.forEach((s, i) => {
    const boat = scene.marketBoat(i, 0, s);
    assert.equal(paper(closed, W, boat.lantern), 0, `boat ${i}: the lantern out`);
    for (const b of boat.string) assert.equal(pixel(closed, W, b.x, b.y), K, `boat ${i}: the string dark`);
  });
  const m = L.stalls[0], tag = [m.cx + 4, m.wl - 24, 30, 11];
  assert.equal(box(still(scene, stalls.slice(0, 1), opens), W, tag), box(still(scene, [], opens), W, tag), "no price");
});

test("market: a view without a market leaves its water empty", () => {
  const scene = P.createScene({ size: 19 });
  const L = scene.layout, W = scene.width;
  const none = draw(scene, { time: 1, reducedMotion: true }), some = still(scene, seven("open"));
  const poles = (rgba) => L.stalls.filter((m) => pixel(rgba, W, m.poleX - 1, m.wl - 3) === K && pixel(rgba, W, m.poleX + 1, m.wl - 3) === K).length;
  assert.equal(poles(some), 7, "seven poles with a market");
  assert.equal(poles(none), 0, "none without one");
});

test("market: with reduced motion the market holds one picture", () => {
  const scene = P.createScene({ size: 19 });
  const L = scene.layout, W = scene.width, zone = [L.marketX0, 0, MARKET_W, scene.height], m = market(seven("open"));
  assert.equal(L.stalls.length, 7);
  assert.equal(box(draw(scene, { time: 1, reducedMotion: true, market: m }), W, zone), box(draw(scene, { time: 7, reducedMotion: true, market: m }), W, zone));
});
