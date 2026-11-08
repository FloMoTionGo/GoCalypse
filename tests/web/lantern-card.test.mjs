// The lantern hunt in the renderer: the twelve floating lanterns a player turns off, the
// stone lantern that is the thirteenth, and the Lantern Festival that follows: in the dark,
// lanterns rise from the water, float onto the border and light the board from there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const SIZES = [13, 19, 25];
const LAYOUTS = 60;
const REGION_WATER = 1, REGION_FRAME = 2, REGION_KAYA = 3;

const blank = (n) => ({ board: new Array(n * n).fill(0), effects: [], overlays: [] });
const draw = (scene, state) => Uint8ClampedArray.from(scene.render(state));
const PALETTE = new Set(G.PALETTE_RGB.map((c) => c.join()));

function offPalette(rgba) {
  let bad = 0;
  for (let i = 0; i < rgba.length; i += 4) if (!PALETTE.has(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`)) bad++;
  return bad;
}
function sameBytes(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
const onScreen = (scene, f) => f.x >= 0 && f.y >= 0 && f.x < scene.width && f.y < scene.height;
const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

/** Every lantern index but `keep`. */
const allBut = (keep) => Array.from({ length: 12 }, (_, i) => i).filter((i) => i !== keep);

test("lantern hunt: the scene has 12 floating lanterns with stable indices, at every board size", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    const a = scene.floatersAt(3.2), b = scene.floatersAt(41.7);
    assert.deepEqual(a.map((f) => f.i), allBut(-1), `${n}: indices 0 to 11, in order`);
    assert.deepEqual(b.map((f) => f.i), allBut(-1), `${n}: the same later`);
    assert.ok(a.some((f, k) => f.x !== b[k].x || f.y !== b[k].y), `${n}: and they move`);
  }
});

test("lantern hunt: positions are judged on the frame's own ambient tick", () => {
  const scene = P.createScene({ size: 19 });
  assert.deepEqual(scene.floatersAt(5.01), scene.floatersAt(5.09), "the same tick, the same picture");
});

test("lantern hunt: a click counts within 11 art px of a lantern and not beyond", () => {
  const scene = P.createScene({ size: 19 });
  const t = 37;
  for (const f of scene.floatersAt(t).filter((q) => q.x > 16 && q.y > 16 && q.x < scene.width - 16 && q.y < scene.height - 16)) {
    const others = allBut(f.i);
    assert.equal(scene.lanternAt(f.x, f.y, t, others), f.i, `#${f.i} at its middle`);
    assert.equal(scene.lanternAt(f.x + 11, f.y - 11, t, others), f.i, `#${f.i} at the box's corner`);
    assert.equal(scene.lanternAt(f.x + 12, f.y, t, others), null, `#${f.i} just outside the box`);
  }
});

test("lantern hunt: of two lanterns close together a click takes the nearest one still on", () => {
  const scene = P.createScene({ size: 13 });
  let pair = null;
  for (let t = 0; t < 120 && !pair; t += 0.1) {
    const all = scene.floatersAt(t).filter((f) => onScreen(scene, f));
    for (const a of all) for (const b of all) if (a.i < b.i && cheb(a, b) > 0 && cheb(a, b) <= 5) pair = pair || { t, a, b };
  }
  assert.ok(pair, "two lanterns come close at some point");
  const { t, a, b } = pair;
  assert.equal(scene.lanternAt(a.x, a.y, t, []), a.i, "the nearer one first");
  assert.equal(scene.lanternAt(a.x, a.y, t, [a.i]), b.i, "then the one beside it");
});

test("lantern hunt: a lantern already out isn't found again, and open water finds nothing", () => {
  const scene = P.createScene({ size: 19 });
  const f = scene.floatersAt(50).find((q) => onScreen(scene, q));
  assert.equal(scene.lanternAt(f.x, f.y, 50, allBut(-1)), null, "all out: nothing to find");
  const L = scene.layout;
  assert.equal(scene.lanternAt(L.gridX + 8, L.gridY + 8, 50, []), null, "the board is no lantern");
});

test("lantern hunt: a lantern off screen can't be clicked", () => {
  const scene = P.createScene({ size: 19 });
  let found = null;
  for (let t = 0; t < 240 && !found; t += 0.1) {
    const f = scene.floatersAt(t).find((q) => q.x < 0 && q.x >= -6);
    if (f) found = { t, f };
  }
  assert.ok(found, "a lantern is just off the left edge at some point");
  assert.equal(scene.lanternAt(0, found.f.y, found.t, allBut(found.f.i)), null);
});

test("lantern hunt: no lantern's click box ever touches a playable point, at any board size", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    for (let t = 0; t < 240; t += 0.25) {
      for (const f of scene.floatersAt(t)) {
        if (!onScreen(scene, f)) continue;
        for (const [dx, dy] of [[-11, -11], [11, -11], [-11, 11], [11, 11], [0, 0]]) {
          assert.equal(scene.nativeToPoint(f.x + dx, f.y + dy), null, `${n}: #${f.i} at t=${t}`);
        }
      }
    }
  }
});

test("lantern hunt: with reduced motion the goal is the lanterns on screen, so it can be reached", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    assert.equal(scene.lanternGoal(false).length, 12, `${n}: all twelve in motion`);
    const still = scene.lanternGoal(true);
    const visible = scene.floatersAt(0).filter((f) => onScreen(scene, f)).map((f) => f.i);
    assert.deepEqual(still, visible, `${n}: exactly those on screen while the clock stands`);
    assert.ok(still.length < 12 && still.length >= 11, `${n}: ${still.length}`);
  }
});

test("lantern hunt: a lantern turned off goes dark for that player, and only round it, in the palette", () => {
  const n = 19, scene = P.createScene({ size: n }), t = 37;
  const f = scene.floatersAt(t).find((q) => q.x > 20 && q.y > 20 && q.x < scene.width - 20 && q.y < scene.height - 20);
  const base = { ...blank(n), time: t, ambientTime: t };
  const on = draw(scene, base), off = draw(scene, { ...base, outLanterns: [f.i] });
  let changed = 0, far = 0, shine = [0, 0];
  for (let y = 0; y < scene.height; y++) for (let x = 0; x < scene.width; x++) {
    const i = (y * scene.width + x) * 4;
    shine[0] += on[i] + on[i + 1] + on[i + 2];
    shine[1] += off[i] + off[i + 1] + off[i + 2];
    if (off[i] === on[i] && off[i + 1] === on[i + 1] && off[i + 2] === on[i + 2]) continue;
    changed++;
    if (Math.max(Math.abs(x - f.x), Math.abs(y - f.y)) > 18) far++;
  }
  assert.ok(changed > 0, "turning it off shows");
  assert.equal(far, 0, "and only round it");
  assert.ok(shine[1] < shine[0], "the scene is darker for it");
  assert.equal(offPalette(off), 0);
});

test("stone lantern: a click on it is told from the board, and no playable point is on it, at any board size", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n }), b = scene.stoneLantern;
    assert.equal(scene.stoneLanternAt(b.x + (b.w >> 1), b.y + (b.h >> 1)), true, `${n}: its middle`);
    assert.equal(scene.stoneLanternAt(b.x - 1, b.y), false, `${n}: just left of it`);
    assert.equal(scene.stoneLanternAt(b.x, b.y + b.h), false, `${n}: just under it`);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const p = scene.pointToNative(x, y);
      assert.equal(scene.stoneLanternAt(p.x, p.y), false, `${n}: the point (${x}, ${y}) still plays`);
    }
  }
});

test("stone lantern: turned off it loses its light, and stays in the palette", () => {
  const n = 13, scene = P.createScene({ size: n }), t = 37, b = scene.stoneLantern;
  const base = { ...blank(n), time: t, ambientTime: t };
  const on = draw(scene, base), off = draw(scene, { ...base, stoneLanternOut: true });
  let shine = [0, 0];
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
    const i = (y * scene.width + x) * 4;
    shine[0] += on[i] + on[i + 1] + on[i + 2];
    shine[1] += off[i] + off[i + 1] + off[i + 2];
  }
  assert.ok(shine[1] < shine[0], "darker where it stands");
  assert.equal(offPalette(off), 0);
});

test("lantern festival: it lasts 34 seconds", () => {
  assert.equal(P.FESTIVAL_SECONDS, 34);
});

test("lantern festival: every screen gets the same seed from the room and who lit it", () => {
  assert.equal(P.festivalSeed("room1", 2), P.festivalSeed("room1", 2));
  assert.notEqual(P.festivalSeed("room1", 2), P.festivalSeed("room1", 3), "each seat's festival differs");
  assert.notEqual(P.festivalSeed("room1", 2), P.festivalSeed("room2", 2), "and each game's");
});

test("lantern festival: the same seed gives the same layout, and another seed another", () => {
  const scene = P.createScene({ size: 19 });
  assert.deepEqual(scene.festivalLayout(11), scene.festivalLayout(11));
  assert.notDeepEqual(scene.festivalLayout(11), scene.festivalLayout(12));
});

test("lantern festival: every lantern comes to rest on the right or bottom border, touching no number", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n }), L = scene.layout;
    const px = draw(scene, { ...blank(n), time: 3, ambientTime: 3 });
    const isNumber = (x, y) => {
      const i = (y * scene.width + x) * 4;
      const numbered = y < L.boardY + L.frame || x < L.boardX + L.frame; // the stone lantern's glow is amber too, on the other two
      return numbered && scene.regionAt(x, y) === REGION_FRAME && px[i] === 0xd4 && px[i + 1] === 0x90 && px[i + 2] === 0x40;
    };
    for (let seed = 0; seed < LAYOUTS; seed++) {
      const spots = scene.festivalLayout(seed);
      assert.ok(spots.length >= 10, `${n}/${seed}: a festival, not a handful (${spots.length})`);
      for (const q of spots) {
        assert.ok(q.side === "right" || q.side === "bottom", q.side);
        if (q.side === "right") {
          assert.ok(q.x - 3 >= L.boardRight - L.frame && q.x + 3 < L.boardRight, `${n}/${seed}: inside the right border`);
        } else {
          assert.ok(q.y - 5 >= L.boardBottom - L.frame && q.y + 3 < L.boardBottom, `${n}/${seed}: inside the bottom border`);
        }
        assert.equal(scene.regionAt(q.x, q.y), REGION_FRAME, `${n}/${seed}: on the frame`);
        // The stone lantern stands in the bottom right corner, drawn in front of the border.
        const tx = L.gridX + L.gridSpan + 2, ty = L.gridY + L.gridSpan + 12 - 21;
        assert.ok(q.x + 4 < tx || q.x - 4 >= tx + 15 || q.y + 4 < ty || q.y - 5 >= ty + 26, `${n}/${seed}: clear of the stone lantern at ${q.x},${q.y}`);
        for (let y = q.y - 5; y <= q.y + 4; y++) for (let x = q.x - 4; x <= q.x + 4; x++) {
          assert.equal(isNumber(x, y), false, `${n}/${seed}: clear of the numbers`);
        }
      }
    }
  }
});

test("lantern festival: every lantern starts on open water", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    for (let seed = 0; seed < LAYOUTS; seed++) {
      for (const q of scene.festivalLayout(seed)) {
        for (let y = q.sy - 5; y <= q.sy + 4; y++) for (let x = q.sx - 4; x <= q.sx + 4; x++) {
          assert.equal(scene.regionAt(x, y), REGION_WATER, `${n}/${seed}: ${x},${y}`);
        }
      }
    }
  }
});

test("lantern festival: lanterns keep their distance, at rest and in the water", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    for (let seed = 0; seed < LAYOUTS; seed++) {
      const spots = scene.festivalLayout(seed);
      for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) {
        assert.ok(Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y) >= 11, `${n}/${seed}: at rest`);
        assert.ok(Math.hypot(spots[a].sx - spots[b].sx, spots[a].sy - spots[b].sy) >= 10, `${n}/${seed}: in the water`);
      }
    }
  }
});

test("lantern festival: the layout looks irregular: no gap over 100 px, no more than 3 neighbours in line, at least 2 a side", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    for (let seed = 0; seed < LAYOUTS; seed++) {
      const spots = scene.festivalLayout(seed);
      for (const side of ["right", "bottom"]) {
        const along = side === "right" ? "y" : "x", across = side === "right" ? "x" : "y";
        const row = spots.filter((q) => q.side === side).sort((a, b) => a[along] - b[along]);
        assert.ok(row.length >= 2, `${n}/${seed}: ${side} has ${row.length}`);
        let run = 1;
        for (let i = 1; i < row.length; i++) {
          assert.ok(row[i][along] - row[i - 1][along] <= 100, `${n}/${seed}: a hole on the ${side}`);
          run = Math.abs(row[i][across] - row[i - 1][across]) <= 1 ? run + 1 : 1;
          assert.ok(run <= 3, `${n}/${seed}: ${run} in line on the ${side}`);
        }
        const gaps = row.slice(1).map((q, i) => q[along] - row[i][along]);
        if (gaps.length >= 4) assert.ok(new Set(gaps).size >= 3, `${n}/${seed}: gaps on the ${side} are not all alike`);
      }
    }
  }
});

test("lantern festival: nothing shows before it starts or after it ends", () => {
  const n = 13, scene = P.createScene({ size: n });
  const festival = { seed: 7, start: 10 };
  for (const time of [9, 10 + P.FESTIVAL_SECONDS + 0.1]) {
    const base = { ...blank(n), time, ambientTime: time };
    assert.ok(sameBytes(draw(scene, base), draw(scene, { ...base, festival })), `t=${time}`);
  }
  const during = { ...blank(n), time: 27, ambientTime: 27 };
  assert.ok(!sameBytes(draw(scene, during), draw(scene, { ...during, festival })), "while between those it does show");
});

test("lantern festival: at its height every lantern is on the border, in the palette throughout", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n }), W = scene.width, seed = 5, spots = scene.festivalLayout(seed);
    const festival = { seed, start: 0 };
    for (let time = 0; time <= P.FESTIVAL_SECONDS; time += 1.5) {
      assert.equal(offPalette(draw(scene, { ...blank(n), time, ambientTime: time, festival })), 0, `${n}: t=${time} stays in the palette`);
    }
    const time = 17, base = { ...blank(n), time, ambientTime: time };
    const off = draw(scene, base), on = draw(scene, { ...base, festival });
    for (const q of spots) {
      let differs = 0;
      for (let y = q.y - 3; y <= q.y + 3; y++) for (let x = q.x - 3; x <= q.x + 3; x++) {
        const i = (y * W + x) * 4;
        if (off[i] !== on[i] || off[i + 1] !== on[i + 1] || off[i + 2] !== on[i + 2]) differs++;
      }
      assert.ok(differs >= 12, `${n}: a lantern at ${q.x},${q.y}`);
    }
  }
});

/** The mean brightness of the pixels `keep` accepts. */
function shine(rgba, W, H, keep) {
  let sum = 0, count = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!keep(x, y)) continue;
    const i = (y * W + x) * 4;
    sum += rgba[i] + rgba[i + 1] + rgba[i + 2];
    count++;
  }
  return count ? sum / count : 0;
}

test("lantern festival: the scene goes dark for it, and comes back", () => {
  const n = 13, scene = P.createScene({ size: n }), W = scene.width, H = scene.height;
  const festival = { seed: 5, start: 0 }, water = (x, y) => scene.regionAt(x, y) === REGION_WATER;
  const at = (time, f) => shine(draw(scene, { ...blank(n), time, ambientTime: time, ...(f ? { festival: f } : {}) }), W, H, water);
  assert.ok(at(17, festival) < at(17) * 0.85, "the water is much darker at its height");
  assert.ok(at(0.2, festival) > at(17, festival), "it fades in");
  assert.ok(at(P.FESTIVAL_SECONDS - 0.2, festival) > at(17, festival), "and out");
});

test("lantern festival: the risen lanterns shine onto the board, beside them more than in the middle", () => {
  const n = 13, scene = P.createScene({ size: n }), W = scene.width, H = scene.height, spots = scene.festivalLayout(5);
  const base = { ...blank(n), time: 17, ambientTime: 17 };
  const on = draw(scene, { ...base, festival: { seed: 5, start: 0 } }), off = draw(scene, base);
  const kaya = (x, y) => scene.regionAt(x, y) === REGION_KAYA;
  const near = (x, y) => spots.some((q) => Math.hypot(x - q.x, y - q.y) < 12);
  const L = scene.layout, cx = L.gridX + L.gridSpan / 2, cy = L.gridY + L.gridSpan / 2;
  const edgeOverMiddle = (rgba) => shine(rgba, W, H, (x, y) => kaya(x, y) && near(x, y)) - shine(rgba, W, H, (x, y) => kaya(x, y) && Math.hypot(x - cx, y - cy) < 24);
  assert.ok(edgeOverMiddle(on) > edgeOverMiddle(off) + 15, `edge over middle: ${edgeOverMiddle(on)} in the festival, ${edgeOverMiddle(off)} without`);
});

test("lantern festival: a black stone and a white one can still be told apart in the dark", () => {
  const n = 13, scene = P.createScene({ size: n }), W = scene.width, H = scene.height, c = (n - 1) >> 1;
  const state = blank(n);
  state.board[c * n + c - 1] = 1;
  state.board[c * n + c + 1] = 2;
  const on = draw(scene, { ...state, time: 17, ambientTime: 17, festival: { seed: 5, start: 0 } });
  const round = (gx) => { const p = scene.pointToNative(gx, c); return (x, y) => Math.hypot(x - p.x, y - p.y) < 4; };
  assert.ok(shine(on, W, H, round(c + 1)) > shine(on, W, H, round(c - 1)) + 150);
});

test("lantern festival: with reduced motion the lanterns simply sit on the border until it ends", () => {
  const n = 19, scene = P.createScene({ size: n });
  const festival = { seed: 3, start: 10 }, base = { ...blank(n), reducedMotion: true };
  const early = draw(scene, { ...base, time: 10.5, festival }), late = draw(scene, { ...base, time: 40, festival });
  assert.ok(sameBytes(early, late), "no rising, no crossing, no bob");
  assert.ok(!sameBytes(early, draw(scene, { ...base, time: 10.5 })), "and they are there");
  assert.ok(sameBytes(draw(scene, { ...base, time: 45, festival }), draw(scene, { ...base, time: 45 })), "and then gone");
});

test("lantern festival: there is no Lantern Card any more, in the sprites or the market", () => {
  assert.equal(G.lanternCard, undefined);
  assert.equal(G.SPRITES.lanternCardIcon, undefined);
  assert.ok(!G.POWERUP_ICON_IDS.includes("lantern_card"));
});
