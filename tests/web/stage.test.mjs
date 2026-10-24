// One pixel grid for the whole game screen (ideas.md §11.9) and the header in
// the game's own style (§11.8): the stage in art pixels, the scale k that fits
// it into the window in whole device pixels, and the header's sprites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const RGB = new Set(G.PALETTE_RGB.map(([r, g, b]) => `${r},${g},${b}`));
const inPalette = (spr) => Array.from(spr.px).every((i) => i === 255 || RGB.has(G.PALETTE_RGB[i].join()));

test("stage: k is the largest whole scale that fits the window's physical pixels, capped at 1920x1080, never 0", () => {
  assert.equal(P.pickScale(1920, 950, 1, 13).k, 2);
  assert.equal(P.pickScale(1536, 760, 1.25, 13).k, 2, "the same physical pixels give the same k");
  assert.equal(P.pickScale(3840, 2100, 1.5, 13).k, 2, "capped at 1920x1080");
  assert.equal(P.pickScale(300, 200, 1, 13).k, 1, "never 0");
  assert.equal(P.pickScale(1920, 950, 1, 13).handInSidebar, false, "the hand stays under the board when that is as big");
  const big = P.pickScale(2560, 1300, 1, 25);
  assert.deepEqual([big.k, big.handInSidebar], [2, true], "25x25: the hand moves into the sidebar for a bigger k");
});

test("stage: the scene, a gap and the sidebar across; the header, the scene, the hand and the status lines down", () => {
  const L = P.computeLayout(13);
  const under = P.stageSize(13, false), side = P.stageSize(13, true);
  assert.ok(under.w > L.width + 100 && under.w < L.width + 160, `width ${under.w}`);
  assert.ok(under.h > L.height + 60 && under.h < L.height + 130, `height ${under.h}`);
  assert.equal(side.w, under.w);
  assert.ok(side.h < under.h, "the hand in the sidebar frees the row under the board");
  assert.ok(P.stageSize(19, false).w > under.w && P.stageSize(25, false).h > P.stageSize(19, false).h);
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
