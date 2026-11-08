// Sky and garland (tasks/2026-11-08_storm_in_board): the Storm box leaves the sidebar. The
// forecast is a band of night sky over the far bank, in the row the header gave up, with the
// header's planks in it; the garland is the dial, one lantern a turn between rolls; and the
// stone lantern stands in the board's bottom right corner, in front of whatever is played there.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { loadWeb, WEB } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const SIZES = [13, 19, 25];
const skies = () => G.STORM_SKIES.map((s) => s.id);
const rgb = (c) => G.PALETTE_RGB[G.INDEX[c]].join();
const pixel = (rgba, W, x, y) => rgba.slice((y * W + x) * 4, (y * W + x) * 4 + 3).join();
const empty = (n) => new Array(n * n).fill(0);
const draw = (scene, state) => Uint8ClampedArray.from(scene.render({ board: empty(scene.layout.size), time: 0, reducedMotion: true, ...state }));

/** The rows of a sky band, as one string: rows 0 to 8 are above the rain and the flash. */
const rows = (W, id, f, to = 9) => Array.from(G.skyBand(W, id, f).px.slice(0, W * to)).join();

/** Is the paper of this garland lantern lit? Its middle is drawn over any light from its neighbours. */
function lit(rgba, W, g) {
  let paper = 0;
  for (let y = 3; y < 8; y++) for (let x = g.x - 1; x <= g.x + 1; x++) {
    const c = pixel(rgba, W, x, y);
    if (c === rgb("A") || c === rgb("C")) paper++;
  }
  return paper >= 8; // most of its middle: a firefly drifting past is a few pixels
}

/** Where the stone lantern's sprite belongs: on the frame beside the corner point, over the edge of a stone there. */
function lanternAt(scene) {
  const n = scene.layout.size, c = scene.pointToNative(n - 1, n - 1);
  return { x: c.x + 3, y: c.y + 12 - 21, c };
}
/** [x, y, colour] of the lantern sprite's own pixels, placed at (x0, y0). */
function spritePixels(x0, y0) {
  const spr = G.ANIMS.toro.frames[0], out = [];
  for (let y = 0; y < spr.h; y++) for (let x = 0; x < spr.w; x++) {
    const v = spr.px[y * spr.w + x];
    if (v !== G.TRANSPARENT) out.push([x0 + x, y0 + y, G.PALETTE_RGB[v].join()]);
  }
  return out;
}

test("sky stage: no sidebar, and the sky row replaces the header row and its gap, so the stage is the scene's width and no taller", () => {
  assert.equal(G.SKY_H, 21);
  assert.equal(P.STAGE.sky, G.SKY_H);
  assert.ok(G.SKY_H <= 18 * 0.85 + 6, "no taller than the header and the gap it replaces");
  for (const n of SIZES) {
    const L = P.computeLayout(n), s = P.stageSize(n);
    assert.equal(s.w, L.width, `${n}: as wide as the scene`);
    assert.equal(s.h, P.STAGE.sky + L.height + P.STAGE.hand + P.STAGE.status, `${n}: down`);
  }
});

test("sky band: the scene's width by 21 rows, in the five colours, for every sky in both frames", () => {
  for (const n of SIZES) {
    const W = P.computeLayout(n).width;
    for (const id of skies()) for (const f of [0, 1]) {
      const band = G.skyBand(W, id, f);
      assert.deepEqual([band.w, band.h], [W, 21], `${n} ${id}`);
      assert.ok(band.px.every((v) => v >= 0 && v < G.PALETTE_RGB.length), `${n} ${id}: palette only, no holes`);
    }
  }
});

test("sky band: no cloud reaches the header's planks, the turn or the forecast's words, on any board size, even drifting", () => {
  for (const n of SIZES) {
    const W = P.computeLayout(n).width, plan = G.skyPlan(W);
    for (const id of skies()) for (const [cx] of G.skyClouds(id, W)) for (const [a, b] of plan.guards) {
      assert.ok(cx + G.SKY_CLOUD_REACH + 1 <= a || cx - G.SKY_CLOUD_REACH - 1 >= b, `${n} ${id}: a cloud at ${cx} under ${a}-${b}`);
    }
  }
});

test("sky band: the worse the odds the more clouds, and the moon is gone behind them", () => {
  const W = P.computeLayout(19).width;
  const count = (id) => G.skyClouds(id, W).length;
  assert.equal(count("clear"), 0);
  assert.equal(count("wisps"), 0);
  assert.ok(count("clouding") < count("overcast") && count("overcast") < count("rain") && count("rain") < count("thunder"));
});

test("sky band: in rain coming and thunder brewing the clouds hold still while the rain and the flash move", () => {
  for (const n of SIZES) {
    const W = P.computeLayout(n).width;
    for (const id of ["rain", "thunder"]) {
      assert.equal(rows(W, id, 0), rows(W, id, 1), `${n} ${id}: the clouds hold still`);
      assert.notEqual(rows(W, id, 0, 21), rows(W, id, 1, 21), `${n} ${id}: the rain and the flash move`);
    }
  }
});

test("sky band: the calmer skies keep their slow drift", () => {
  const W = P.computeLayout(19).width;
  for (const id of ["clouding", "overcast"]) assert.notEqual(rows(W, id, 0), rows(W, id, 1), id);
});

test("garland: one lantern a turn between rolls, spread over the scene's width, on every board size", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n });
    for (const every of [20, 6]) {
      const list = scene.garlandAt(every);
      assert.equal(list.length, every, `${n}: ${every} lanterns`);
      assert.equal(list[0].x, 10, `${n}: from the left end`);
      assert.ok(list[every - 1].x >= scene.width - 14 && list[every - 1].x < scene.width - 5, `${n}: to the rope's end, ${list[every - 1].x}`);
      for (let i = 1; i < every; i++) assert.ok(list[i].x > list[i - 1].x + 8, `${n}: lantern ${i} clear of the last`);
    }
  }
});

test("garland: only the lanterns for the turns left are lit, going out from the left", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n }), W = scene.width, list = scene.garlandAt(20);
    for (const left of [20, 13, 1]) {
      const frame = draw(scene, { garland: { every: 20, left } });
      list.forEach((g, i) => assert.equal(lit(frame, W, g), i >= 20 - left, `${n}: ${left} left, lantern ${i}`));
    }
  }
});

test("garland: the next lantern to go blinks, quicker on the last turn, and holds still with reduced motion", () => {
  const scene = P.createScene({ size: 19 }), W = scene.width, list = scene.garlandAt(20);
  const at = (left, time, reducedMotion) => lit(draw(scene, { garland: { every: 20, left }, time, reducedMotion }), W, list[20 - left]);
  assert.equal(at(13, 0.1, false), true, "on");
  assert.equal(at(13, 0.7, false), false, "off 0.6 s later");
  assert.equal(at(1, 0.1, false), true, "the last turn: on");
  assert.equal(at(1, 0.3, false), false, "off 0.25 s later");
  assert.equal(at(13, 0.7, true), true, "reduced motion: lit and still");
});

test("garland: with no forecast every lantern of the plain garland stays lit", () => {
  const scene = P.createScene({ size: 19 }), frame = draw(scene, {});
  const list = scene.garlandAt();
  assert.ok(list.length > 0);
  for (const g of list) assert.equal(lit(frame, scene.width, g), true, `lantern at ${g.x}`);
});

test("How to play: the forecast's picture is a stretch of garland, the lanterns gone on the left and those to come on the right", () => {
  const pic = createRequire(import.meta.url)(path.join(WEB, "helpArt.js")).PICTURES.dial();
  const lights = (x0, x1) => {
    let n = 0;
    for (let y = 0; y < pic.h; y++) for (let x = x0; x < x1; x++) {
      const v = pic.px[y * pic.w + x];
      if (v === G.INDEX.A || v === G.INDEX.C) n++;
    }
    return n;
  };
  assert.equal(lights(0, pic.w >> 1), 0, "the left half is out");
  assert.ok(lights(pic.w >> 1, pic.w) > 0, "the right half is lit");
});

test("How to play: the forecast is the sky over the river and the garland counts the turns, with no sidebar and no dial", () => {
  const js = fs.readFileSync(path.join(WEB, "main.js"), "utf8");
  assert.match(js, /"The forecast", "The sky over the river is the next roll's chance/);
  assert.match(js, /The garland has a lantern per turn between rolls/);
  assert.doesNotMatch(js, /The sky in the sidebar/);
  assert.doesNotMatch(js, /Its dial has a dot/);
});

test("stone lantern: it stands on the frame beside the board's bottom right corner at its own size, over the edge of the corner stone, its light with it", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n }), W = scene.width, frame = draw(scene, {});
    const at = lanternAt(scene);
    for (const [x, y, c] of spritePixels(at.x, at.y)) assert.equal(pixel(frame, W, x, y), c, `${n}: the sprite at ${x},${y}`);
    const over = spritePixels(at.x, at.y).filter(([x, y]) => Math.abs(x - at.c.x) <= 7 && Math.abs(y - at.c.y) <= 7).length;
    assert.ok(over > 0, `${n}: over the edge of a stone on the corner point`);
    let glow = 0;
    for (let y = at.y; y < at.y + 26; y++) for (let x = at.x - 12; x < at.x + 26; x++) {
      if (scene.regionAt(x, y) === P.REGION.FRAME && pixel(frame, W, x, y) === rgb("A")) glow++;
    }
    assert.ok(glow > 0, `${n}: its light falls on the frame round it`);
  }
});

test("stone lantern: its shine lies over a stone and over the hover stone on the corner point", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n }), W = scene.width, at = lanternAt(scene);
    const lantern = new Set(spritePixels(at.x, at.y).map(([x, y]) => `${x},${y}`));
    const lit = (frame, spr, x0, y0) => {
      let changed = 0;
      for (let y = 0; y < spr.h; y++) for (let x = 0; x < spr.w; x++) {
        const v = spr.px[y * spr.w + x];
        if (v === G.TRANSPARENT || lantern.has(`${x0 + x},${y0 + y}`)) continue;
        if (pixel(frame, W, x0 + x, y0 + y) !== G.PALETTE_RGB[v].join()) changed++;
      }
      return changed;
    };
    const placed = empty(n); placed[n * n - 1] = 2;
    const stone = G.stoneSprite(2), half = (stone.w - 1) >> 1;
    assert.ok(lit(draw(scene, { board: placed }), stone, at.c.x - half, at.c.y - half) > 0, `${n}: the stone`);
    const ghost = G.splitPreviewSprite(2), lift = 2; // no bob with reduced motion
    const frame = draw(scene, { hover: { x: n - 1, y: n - 1 }, hoverKind: "stone", myColor: 2 });
    assert.ok(lit(frame, ghost, at.c.x - half, at.c.y - lift - half) > 0, `${n}: the hover stone`);
  }
});

test("stone lantern: the bottom left corner no longer has one", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n }), W = scene.width, frame = draw(scene, {});
    const old = spritePixels(3, scene.height - 2 - 22);
    const same = old.filter(([x, y, c]) => pixel(frame, W, x, y) === c).length;
    assert.ok(same < old.length * 0.5, `${n}: ${same} of ${old.length} of its pixels still there`);
  }
});

test("stone lantern: a stone and the hover stone on the corner point go behind it and still show round it", () => {
  for (const n of SIZES) {
    const scene = P.createScene({ size: n }), W = scene.width, at = lanternAt(scene);
    const mine = spritePixels(at.x, at.y);
    const lantern = new Set(mine.map(([x, y]) => `${x},${y}`));
    const plain = draw(scene, {});
    const placed = empty(n); placed[n * n - 1] = 2;
    const states = { stone: { board: placed }, hover: { hover: { x: n - 1, y: n - 1 }, hoverKind: "stone", myColor: 2 } };
    for (const [name, state] of Object.entries(states)) {
      const frame = draw(scene, state);
      for (const [x, y, c] of mine) assert.equal(pixel(frame, W, x, y), c, `${n} ${name}: the lantern is untouched at ${x},${y}`);
      let shows = 0;
      for (let y = at.c.y - 10; y <= at.c.y + 10; y++) for (let x = at.c.x - 10; x <= at.c.x + 10; x++) {
        if (!lantern.has(`${x},${y}`) && pixel(frame, W, x, y) !== pixel(plain, W, x, y)) shows++;
      }
      assert.ok(shows > 0, `${n} ${name}: still shows beside the lantern`);
    }
  }
});
