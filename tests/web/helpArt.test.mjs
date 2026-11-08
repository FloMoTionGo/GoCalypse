// web/helpArt.js in Node: the pictures of How to play. Every one is built from
// the game's own sprites and stays inside the 5-colour palette, like the scene.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { WEB, loadWeb } from "../lib/paths.mjs";

const require = createRequire(import.meta.url);
const art = () => require(path.join(WEB, "helpArt.js"));
const html = () => fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const { G } = loadWeb();

const inPalette = (spr) => spr.px.every((v) => v === G.TRANSPARENT || (v >= 0 && v <= 4));
const drawn = (spr) => spr.px.some((v) => v !== G.TRANSPARENT);
const sheetOf = (pic) => (pic.sheet ? pic.sheet : pic);
const frame = (book, n) => book.sheet.px.filter((_, i) => Math.floor((i % book.sheet.w) / book.w) === n);

test("help art: every picture index.html's How to play names is drawn, inside the palette", () => {
  const names = [...html().matchAll(/data-art="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(names.length >= 12, `pictures named: ${names.join(", ")}`);
  for (const name of new Set(names)) {
    assert.equal(typeof art().PICTURES[name], "function", `${name} exists`);
    const spr = sheetOf(art().PICTURES[name]());
    assert.ok(spr.w > 0 && spr.h > 0, `${name} has a size`);
    assert.equal(spr.px.length, spr.w * spr.h, `${name} is whole`);
    assert.ok(drawn(spr), `${name} is not blank`);
    assert.ok(inPalette(spr), `${name} is in the palette`);
  }
});

test("help art: a flipbook's sheet is its frames side by side", () => {
  for (const name of ["capture", "passes", "riverNight"]) {
    const book = art().PICTURES[name]();
    assert.ok(book.frames >= 2, `${name} has frames: ${book.frames}`);
    assert.equal(book.sheet.w, book.w * book.frames, `${name}'s sheet width`);
    assert.equal(book.sheet.h, book.h, `${name}'s sheet height`);
  }
});

test("help art: the capture flipbook starts with the stone on the board and ends with it gone", () => {
  const book = art().PICTURES.capture();
  const white = (n) => frame(book, n).filter((v) => v === G.INDEX.C).length;
  assert.ok(white(0) > 0, "the white stone is there at the start");
  assert.ok(white(book.frames - 1) < white(0), "and it is gone at the end");
});

test("help art: the pass flipbook adds one pass a step, up to all four", () => {
  const book = art().PICTURES.passes();
  const inked = (n) => frame(book, n).filter((v) => v !== G.TRANSPARENT).length;
  for (let n = 0; n < 4; n++) assert.ok(inked(n + 1) > inked(n), `step ${n + 1} draws more than step ${n}`);
});

test("index.html's How to play chapters share one name, so only one is open at a time", () => {
  const h = html();
  const start = h.indexOf('<dialog id="welcome"');
  const dialog = h.slice(start, h.indexOf("</dialog>", start));
  const folds = [...dialog.matchAll(/<details\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(folds.length, 9, `chapters: ${folds.length}`);
  const names = new Set(folds.map((f) => (f.match(/\bname="([^"]+)"/) || [])[1]));
  assert.equal(names.size, 1, `one name: ${[...names].join(", ")}`);
  assert.ok([...names][0], "and it is set");
});

test("index.html loads helpArt.js from the site after sprites.js and before main.js", () => {
  const h = html();
  const at = (src) => h.indexOf(`<script src="${src}"></script>`);
  assert.ok(at("helpArt.js") > at("sprites.js"), "after sprites.js");
  assert.ok(at("helpArt.js") < at("main.js"), "before main.js");
});
