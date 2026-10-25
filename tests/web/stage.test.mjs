// One pixel grid for the whole game screen (ideas.md §11.9) and the header in
// the game's own style (§11.8): the stage in art pixels, the scale k that fits
// it into the window in whole device pixels, and the header's sprites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const RGB = new Set(G.PALETTE_RGB.map(([r, g, b]) => `${r},${g},${b}`));
const inPalette = (spr) => Array.from(spr.px).every((i) => i === 255 || RGB.has(G.PALETTE_RGB[i].join()));

test("stage: k is the largest whole scale that fills the window's physical pixels with the hand under the board, uncapped, never 0", () => {
  assert.equal(P.pickScale(1920, 950, 1, 13).k, 2);
  assert.equal(P.pickScale(1536, 760, 1.25, 13).k, 2, "the same physical pixels give the same k");
  assert.equal(P.pickScale(2560, 1310, 1, 13).k, 3, "1440p: a step more than 1080p");
  assert.equal(P.pickScale(3840, 2175, 1, 13).k, 5, "a 4K window: no cap");
  assert.equal(P.pickScale(3840, 2100, 1.5, 13).k, 7, "physical pixels, whatever the display scaling");
  assert.equal(P.pickScale(300, 200, 1, 13).k, 1, "never 0");
  assert.equal(P.pickScale(2560, 1300, 1, 25).k, 2, "25x25 in 1440p, with the hand row");
});

test("stage: the hand stays under the board on every board size, whatever the window", () => {
  for (const size of [13, 19, 25]) {
    for (const [w, h, dpr] of [[1920, 950, 1], [1536, 864, 1.25], [2560, 1300, 1], [3840, 2175, 1]]) {
      assert.ok(!P.pickScale(w, h, dpr, size).handInSidebar, `${size}x${size} in ${w}x${h} at ${dpr}`);
    }
  }
});

test("stage: the scene, a gap and the sidebar across; the header, the scene, the hand row and the status lines down, on every board size", () => {
  assert.equal(P.STAGE.header, 18 * 0.85, "the header at 85%");
  assert.equal(P.STAGE.hand, 3 + (52 + 6) * 1.5, "the hand's cards at 150%");
  const L = P.computeLayout(13), s = P.stageSize(13);
  assert.ok(s.w > L.width + 190 && s.w < L.width + 220, `width ${s.w}`);
  assert.ok(s.h > L.height + 60 && s.h < L.height + 140, `height ${s.h}`);
  for (const size of [13, 19, 25]) {
    const Ln = P.computeLayout(size), sn = P.stageSize(size), S = P.STAGE;
    assert.equal(sn.w, Ln.width + S.gap + S.sidebar, `${size}: across`);
    assert.equal(sn.h, S.header + S.gap + Ln.height + S.hand + S.status, `${size}: down, the hand row included`);
  }
  assert.ok(P.stageSize(19).w > s.w && P.stageSize(25).h > P.stageSize(19).h);
});

test("home stage: k is the whole scale nearest to 75% of the window's physical pixels, never more than fits, never 0", () => {
  const stage = { w: 539, h: 455 }; // the narrowest scene and the home screen's height, in art px
  assert.equal(P.HOME.share, 0.75);
  assert.equal(P.pickHomeScale(1920, 950, 1, stage).k, 2, "1080p: 2 is nearer 75% than 1");
  assert.equal(P.pickHomeScale(1536, 760, 1.25, stage).k, 2, "the same physical pixels give the same k");
  assert.equal(P.pickHomeScale(2560, 1310, 1, stage).k, 2);
  assert.equal(P.pickHomeScale(3840, 2175, 1, stage).k, 4);
  assert.equal(P.pickHomeScale(3840, 1950, 1, stage).k, 3);
  assert.equal(P.pickHomeScale(300, 200, 1, stage).k, 1, "never 0");
  for (const [w, h] of [[1100, 950], [1920, 1000], [2560, 1440], [3840, 2400]]) {
    const { k } = P.pickHomeScale(w, h, 1, stage);
    assert.ok(stage.w * k <= w && stage.h * k <= h, `${w}x${h}: k=${k} fits`);
  }
});

test("home stage: the river spans 75% of the window's width at that scale, never narrower than the word", () => {
  const stage = { w: 539, h: 455 };
  assert.equal(P.pickHomeScale(1920, 950, 1, stage).sceneW, 720);
  assert.equal(P.pickHomeScale(3840, 2175, 1, stage).sceneW, 720);
  assert.equal(P.pickHomeScale(1000, 950, 1, stage).sceneW, 750);
  assert.equal(P.pickHomeScale(600, 950, 1, stage).sceneW, 539);
});

test("sprites: the big pixel font spells every capital letter, and the header's marks", () => {
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ?/-") {
    const g = G.FONT_BIG.glyphs[ch];
    assert.ok(g, `big ${ch}`);
    assert.equal(g.h, 6);
    assert.ok(g.bits.some(Boolean), `${ch} has ink`);
  }
  assert.ok(G.textWidth(G.FONT_BIG, "YOUR TURN") > 30);
});

test("sprites: a plank button is drawn to any size in the palette, with hover and disabled faces", () => {
  const faces = ["normal", "hover", "disabled"].map((state) => G.plankButton(30, 12, state));
  for (const f of faces) {
    assert.deepEqual([f.w, f.h], [30, 12]);
    assert.ok(inPalette(f));
  }
  assert.equal(new Set(faces.map((f) => f.px.join())).size, 3, "three different faces");
  const wide = G.plankButton(60, 12, "normal");
  assert.equal(wide.w, 60, "it stretches without blurring: drawn to size, not scaled");
});

test("sprites: the turn lantern holds a player's two stones, lit on their turn and dark otherwise", () => {
  const lit = G.turnLantern(1, true), dark = G.turnLantern(1, false), other = G.turnLantern(4, true);
  for (const l of [lit, dark, other]) {
    assert.ok(l.h <= 18 && l.w <= 24, `${l.w}x${l.h} fits the header`);
    assert.ok(inPalette(l));
  }
  assert.notEqual(lit.px.join(), dark.px.join());
  assert.notEqual(lit.px.join(), other.px.join(), "another player's stones");
});
