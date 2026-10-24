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

test("the turn icon is a 9x9 ring around a 1, in palette colours", () => {
  const icon = G.SPRITES.turnIcon;
  assert.ok(icon, "SPRITES.turnIcon");
  assert.deepEqual([icon.w, icon.h], [9, 9]);
  assert.ok(inPalette(icon));
  const opaque = icon.px.filter((c) => c !== G.TRANSPARENT).length;
  assert.ok(opaque >= 25 && opaque < 81, `${opaque} opaque pixels: a ring with a hole, not a blob`);
});

test("an item card whose use takes the turn carries the turn icon in its top-right corner, and nowhere else", () => {
  for (const [id, tier] of [["driftwood", 1], ["skiff", 2], ["remove_stone", 3]]) {
    const plain = G.itemCard(id, tier);
    const marked = G.itemCard(id, tier, { turn: true });
    assert.equal(G.itemCard(id, tier, { turn: false }).px.join(), plain.px.join(), `${id}: no flag, no icon`);
    assert.ok(inPalette(marked));
    let changed = 0;
    for (let y = 0; y < G.CARD_H; y++) {
      for (let x = 0; x < G.CARD_W; x++) {
        const i = y * G.CARD_W + x;
        if (plain.px[i] === marked.px[i]) continue;
        changed++;
        assert.ok(x >= G.CARD_W - 13 && y < 13, `${id}: pixel (${x}, ${y}) changed outside the top-right corner`);
      }
    }
    assert.ok(changed >= 20, `${id}: the icon shows (${changed} pixels)`);
  }
});

test("a stall's mini card is a quarter of a hand card in its tier's colour; a sold copy is only a dotted outline", () => {
  const frame = { 1: G.INDEX.T, 2: G.INDEX.A, 3: G.INDEX.C };
  assert.equal(G.CARD_W * 13, G.CARD_H * 9, "hand cards are 9:13");
  const seen = new Set();
  for (const tier of [1, 2, 3]) {
    const left = G.miniCard(tier, "left");
    const gone = G.miniCard(tier, "gone");
    for (const spr of [left, gone]) {
      assert.deepEqual([spr.w, spr.h], [9, 13], `tier ${tier}`);
      assert.ok(inPalette(spr));
    }
    assert.ok(left.px.includes(frame[tier]), `tier ${tier}: its frame colour`);
    const opaque = (spr) => spr.px.filter((c) => c !== G.TRANSPARENT).length;
    assert.ok(opaque(gone) > 0 && opaque(gone) < opaque(left) / 2, `tier ${tier}: a sold copy is an outline`);
    assert.ok(gone.px.every((c) => c === G.TRANSPARENT || c === G.INDEX.S), "the outline is slate");
    seen.add(left.px.join());
  }
  assert.equal(seen.size, 3, "the tiers look different");
});

test("the Kata's face wears the turn icon on its top-right corner: playing it takes the turn", () => {
  const icon = G.SPRITES.turnIcon;
  for (const cells of [Array(9).fill(0), [0, 1, 2, 0, 1, 2, 0, 1, 2]]) {
    const card = G.stoneCard(cells, 2);
    for (let y = 0; y < icon.h; y++) {
      for (let x = 0; x < icon.w; x++) {
        const v = icon.px[y * icon.w + x];
        if (v === G.TRANSPARENT) continue;
        assert.equal(card.px[y * G.CARD_W + G.CARD_W - icon.w + x], v, `icon pixel (${x}, ${y})`);
      }
    }
  }
});

test("the catalog (pixel-preview.html) lists the sprites", () => {
  const cat = G.catalog();
  const entries = Array.isArray(cat) ? cat : Object.values(cat);
  assert.ok(entries.length > 50);
});
