// web/sprites.js in plain Node: the palette, the sprite data and the pixel font.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb, serverModule } from "../lib/paths.mjs";

const { G } = loadWeb();
const PALETTE_SIZE = G.PALETTE.length;
const inPalette = (spr) => spr.px.every((c) => c < PALETTE_SIZE || c === G.TRANSPARENT);

test("the palette is the five named colours, each with its RGB", () => {
  assert.deepEqual(G.PALETTE.map((p) => p.key), ["K", "C", "A", "T", "S"]);
  assert.equal(G.PALETTE_RGB.length, 5);
  for (const [i, p] of G.PALETTE.entries()) {
    const hex = "#" + G.PALETTE_RGB[i].map((v) => v.toString(16).padStart(2, "0")).join("");
    assert.equal(hex, p.hex);
  }
});

test("every static sprite is w x h pixels of palette colours or transparency", () => {
  for (const [name, spr] of Object.entries(G.SPRITES)) {
    assert.equal(spr.px.length, spr.w * spr.h, name);
    assert.ok(inPalette(spr), `${name} uses a colour outside the palette`);
  }
});

test("every animation has frames in the palette, and a duration per frame", () => {
  for (const [name, anim] of Object.entries(G.ANIMS)) {
    assert.ok(anim.frames.length > 0, name);
    assert.ok(anim.fps > 0, name);
    for (const f of anim.frames) {
      assert.equal(f.px.length, f.w * f.h, name);
      assert.ok(inPalette(f), `${name} frame outside the palette`);
    }
    if (anim.durations) assert.equal(anim.durations.length, anim.frames.length, name);
  }
});

test("every board code has a sprite: 8 stones, driftwood, 4 twins and the storm's grey", () => {
  for (const code of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
    const spr = G.pieceSprite(code);
    assert.ok(spr && spr.w > 0 && inPalette(spr), `code ${code}`);
  }
});

test("the four players' stones on one front look different from each other", () => {
  const key = (code) => Buffer.from(G.stoneSprite(code).px).toString("base64");
  assert.equal(new Set([1, 2, 3, 4].map(key)).size, 2, "base: black (1, 3) and white (2, 4)");
  assert.equal(new Set([5, 6, 7, 8].map(key)).size, 2, "pattern: gray (5, 6) and transparent (7, 8)");
  assert.notEqual(key(1), key(2));
  assert.notEqual(key(5), key(7));
});

test("every item the server can stock has an icon and a card", () => {
  const { allPowerups } = serverModule("powerups/definitions.js");
  for (const def of allPowerups()) {
    assert.ok(G.powerupIcon(def.id), `no icon for ${def.id}`);
    assert.ok(G.POWERUP_ICON_IDS.includes(def.id), `${def.id} missing from POWERUP_ICON_IDS`);
    const card = G.itemCard(def.id, def.tier);
    assert.equal(card.w, G.CARD_W, def.id);
    assert.equal(card.h, G.CARD_H, def.id);
    assert.ok(inPalette(card), def.id);
  }
});

test("the Stone Card grid draws every cell state for every player", () => {
  for (const color of [1, 2, 3, 4]) {
    for (const cells of [Array(9).fill(0), Array(9).fill(1), Array(9).fill(2), [0, 1, 2, 0, 1, 2, 0, 1, 2]]) {
      const grid = G.cardGrid(cells, color);
      assert.ok(inPalette(grid));
      const card = G.stoneCard(cells, color);
      assert.equal(card.w, G.CARD_W);
    }
  }
  const empty = G.cardGrid(Array(9).fill(0), 1).px.join();
  const full = G.cardGrid(Array(9).fill(1), 1).px.join();
  assert.notEqual(empty, full, "a stone on the card shows");
});

test("text: width grows with the text, and drawText writes only inside the surface", () => {
  for (const font of [G.FONT_SMALL, G.FONT_BIG]) {
    assert.ok(G.textWidth(font, "AB") > G.textWidth(font, "A"));
    assert.equal(G.textWidth(font, ""), 0);
  }
  const s = new G.Surface(40, 12);
  s.fill(G.TRANSPARENT);
  G.drawText(s, G.FONT_SMALL, "R3 99", 2, 2, G.INDEX.C);
  assert.ok(s.px.some((c) => c === G.INDEX.C));
  G.drawText(s, G.FONT_SMALL, "off the edge", 35, 10, G.INDEX.K); // must not throw
  assert.equal(s.px.length, 40 * 12);
});

test("the catalog (pixel-preview.html) lists the sprites", () => {
  const cat = G.catalog();
  const entries = Array.isArray(cat) ? cat : Object.values(cat);
  assert.ok(entries.length > 50);
});
