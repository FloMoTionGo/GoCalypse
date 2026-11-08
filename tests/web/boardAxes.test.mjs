// The main board's edges: letters down the side from A, numbers along the top
// from 1, and the same names wherever a line of text points at the board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWeb } from "../lib/paths.mjs";

const { G, P } = loadWeb();
const LETTERS = "ABCDEFGHJKLMNOPQRSTUVWXYZ"; // no I, as on a Go board: one per row of the largest table, 25x25

function base(n, extra = {}) {
  return Object.assign(
    { time: 3, ambientTime: 3, board: new Array(n * n).fill(0), overlays: [], effects: [], myColor: 1, turnCount: 0, roundLength: 4, stormUntil: 0 },
    extra
  );
}

/** One frame of a scene, with every piece of text it wrote and where. */
function written(size, extra) {
  const scene = P.createScene({ size });
  const real = G.drawText, texts = [];
  G.drawText = (surface, font, text, x, y, color) => {
    texts.push({ font: font.name, text, x, y });
    return real(surface, font, text, x, y, color);
  };
  try {
    scene.render(base(size, extra));
  } finally {
    G.drawText = real;
  }
  return { L: scene.layout, texts };
}

/** The label over column i, and the one left of row i, in the small margin font. */
function marginLabels({ L, texts }) {
  const small = texts.filter((t) => t.font === "small");
  const over = (i) => small.find((t) => t.y < L.gridY && t.x + (G.textWidth(G.FONT_SMALL, t.text) >> 1) === L.gridX + i * P.SPACING);
  const beside = (i) => small.find((t) => t.x < L.kayaX && t.y === L.gridY + i * P.SPACING - 2);
  return { over, beside };
}

for (const size of [9, 13, 19, 25]) {
  test(`board axes: a ${size}x${size} board numbers its columns from 1 and letters its rows from A`, () => {
    const { over, beside } = marginLabels(written(size));
    const columns = [], rows = [];
    for (let i = 0; i < size; i++) {
      columns.push(over(i)?.text);
      rows.push(beside(i)?.text);
    }
    assert.deepEqual(columns, Array.from({ length: size }, (_, i) => String(i + 1)));
    assert.deepEqual(rows, [...LETTERS.slice(0, size)]);
  });
}

test("board axes: the hovered point's tags show its column number and row letter", () => {
  const frame = written(13, { hover: { x: 3, y: 4 }, hoverKind: "none" });
  const { L, texts } = frame;
  const big = texts.filter((t) => t.font === "big");
  const top = big.find((t) => t.y < L.gridY && Math.abs(t.x - (L.gridX + 3 * P.SPACING)) <= 6);
  const side = big.find((t) => t.x < L.kayaX && Math.abs(t.y - (L.gridY + 4 * P.SPACING)) <= 6);
  assert.equal(top?.text, "4", "column index 3 is column 4");
  assert.equal(side?.text, "E", "row index 4 is row E");
  const { over, beside } = marginLabels(frame);
  assert.equal(over(3), undefined, "the tag stands in for the column's small label");
  assert.equal(beside(4), undefined, "and for the row's");
});

test("board axes: both board fonts can write every row letter, each one its own shape", () => {
  for (const font of [G.FONT_SMALL, G.FONT_BIG]) {
    const shapes = [...LETTERS].map((ch) => {
      const g = font.glyphs[ch];
      assert.ok(g, `${font.name} has ${ch}`);
      assert.ok(g.bits.some(Boolean), `${font.name} ${ch} has ink`);
      return g.w + ":" + g.bits.join("");
    });
    assert.equal(new Set(shapes).size, LETTERS.length, `${font.name}: no two letters alike`);
  }
});

test("board axes: pointLabel names a point by row letter and column number", () => {
  assert.equal(P.pointLabel(0, 0), "A1");
  assert.equal(P.pointLabel(3, 4), "E4");
  assert.equal(P.pointLabel(0, 7), "H1");
  assert.equal(P.pointLabel(0, 8), "J1", "the ninth row skips I");
  assert.equal(P.pointLabel(24, 24), "Z25");
});

test("board axes: namePoints turns the server's (x, y) into the board's own names", () => {
  assert.equal(P.namePoints("Ann played (3, 4), captured 1"), "Ann played E4, captured 1");
  assert.equal(P.namePoints("moving a stone from (0, 1) to (2, 12)"), "moving a stone from B1 to N3");
  assert.equal(P.namePoints("A crab climbs out of the water beside (12, 0): done"), "A crab climbs out of the water beside A13: done");
});

test("board axes: namePoints leaves any other text alone", () => {
  assert.equal(P.namePoints("Game started"), "Game started");
  assert.equal(P.namePoints("Ann passed"), "Ann passed");
  assert.equal(P.namePoints("off the board (0, 25)"), "off the board (0, 25)", "there is no 26th row");
});
