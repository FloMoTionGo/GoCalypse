import { test } from "node:test";
import assert from "node:assert/strict";
import { boardIndex, twinCode } from "./goRules";

// Which stones are dead when a Chinese or Japanese table ends: rules/deadStones.ts.
// A group goes only when it plainly can't live and the side around it plainly does.
// When in doubt, it stands.

const deadStones = (board: number[], size: number): number[] => require("./deadStones").deadStones(board, size);

// B black and W white (the base front), G gray and T transparent (the pattern front), . empty.
const CODES: Record<string, number> = { ".": 0, B: 1, W: 2, G: 5, T: 7 };

function parse(rows: string[]): { board: number[]; size: number } {
  return { board: rows.join("").split("").map((c) => CODES[c]), size: rows.length };
}
const deadOf = (rows: string[]) => {
  const { board, size } = parse(rows);
  return deadStones(board, size).map((i) => [i % size, Math.floor(i / size)]);
};

test("dead stones: a lone stone inside the other side's ground is dead", () => {
  assert.deepEqual(deadOf([
    "....B..",
    ".W..B..",
    "....B..",
    "BBBBB..",
    ".......",
    ".......",
    ".......",
  ]), [[1, 1]]);
});

test("dead stones: two stones apart in the same ground both go", () => {
  assert.deepEqual(deadOf([
    "....B..",
    ".W..B..",
    "...WB..",
    "BBBBB..",
    ".......",
    ".......",
    ".......",
  ]), [[1, 1], [3, 2]]);
});

test("dead stones: a group with two eyes inside the other side's ground lives", () => {
  assert.deepEqual(deadOf([
    "WWWWB..",
    "W.W.B..",
    "WWWWB..",
    "BBBBB..",
    ".......",
    ".......",
    ".......",
  ]), []);
});

test("dead stones: a group with one small eye and no way out is dead", () => {
  assert.deepEqual(deadOf([
    "......B",
    ".WWW..B",
    ".W.W..B",
    ".WWW..B",
    "......B",
    "BBBBBBB",
    ".......",
  ]).length, 8);
});

test("dead stones: two groups that share their liberties, neither with two eyes, both stand (seki)", () => {
  assert.deepEqual(deadOf([
    "..BW...",
    "..BW...",
    "BBBWWWW",
    ".......",
    ".......",
    ".......",
    ".......",
  ]), []);
});

test("dead stones: a stone in the open is not dead, however alone", () => {
  assert.deepEqual(deadOf([
    ".......",
    ".W.....",
    ".......",
    ".......",
    ".....B.",
    ".......",
    ".......",
  ]), []);
});

test("dead stones: stones in ground too wide to call settled stand", () => {
  const rows = Array.from({ length: 9 }, (_, y) => (y === 8 ? "BBBBBBBBB" : y === 3 ? "..W.....B" : "........B"));
  assert.deepEqual(deadOf(rows), [], "64 points of ground on a 9x9 is open board");
});

test("dead stones: a surrounder that can't live either leaves the stone standing", () => {
  assert.deepEqual(deadOf([
    "..BWWWW",
    ".WB.WT.",
    "..BWWWW",
    "BBBWTTT",
    "WWWWT..",
    "TTTTT..",
    ".......",
  ]).filter(([x, y]) => x === 1 && y === 1), [], "black's ground is under six points and black has no other eye");
});

test("dead stones: it works the same on the pattern front", () => {
  assert.deepEqual(deadOf([
    "....G..",
    ".T..G..",
    "....G..",
    "GGGGG..",
    ".......",
    ".......",
    ".......",
  ]), [[1, 1]]);
});

test("dead stones: a stone of the other front is a wall here, and neither lives nor dies by this ground", () => {
  // The gray stone at (2, 1) is invisible to the black and white fight: it walls, and borders nobody.
  assert.deepEqual(deadOf([
    "....B..",
    ".WG.B..",
    "....B..",
    "BBBBB..",
    ".......",
    ".......",
    ".......",
  ]), [[1, 1]]);
});

test("dead stones: a twin stone goes only if it is dead on both of its fronts", () => {
  const size = 7;
  const { board } = parse([
    "....B..",
    ".W..B..",
    "....B..",
    "BBBBB..",
    ".......",
    ".......",
    ".......",
  ]);
  board[boardIndex(size, 1, 1)] = twinCode(2); // white and gray: on the pattern front it has only open ground
  assert.deepEqual(deadStones(board, size), []);
});

test("dead stones: the same board gives the same answer every time, in board order", () => {
  const { board, size } = parse([
    "....B..",
    ".W..B..",
    "...WB..",
    "BBBBB..",
    ".......",
    ".......",
    ".......",
  ]);
  const first = deadStones(board, size);
  assert.deepEqual(deadStones(board.slice(), size), first);
  assert.deepEqual(first, first.slice().sort((a, b) => a - b));
});

test("dead stones: it leaves the board it is given alone, and a 25x25 board takes no time", () => {
  const size = 25;
  const board = new Array(size * size).fill(0);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if ((x + y) % 3 === 0) board[y * size + x] = 1 + ((x * 7 + y * 3) % 2);
  const before = board.slice();
  const t0 = Date.now();
  deadStones(board, size);
  assert.deepEqual(board, before);
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0} ms`);
});
