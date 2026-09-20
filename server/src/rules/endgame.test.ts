import { test } from "node:test";
import assert from "node:assert/strict";
import { areaScore, finalResults, sidesOf } from "./endgame";

/**
 * A board from rows of text: "." is empty, 1-4 a player's solid stone, 5-8 a
 * player's gray or transparent stone, 9 driftwood. Player 1 is black+gray, 2 white+gray,
 * 3 black+transparent, 4 white+transparent.
 */
function parse(rows: string[]): { board: number[]; size: number } {
  const size = rows.length;
  for (const row of rows) assert.equal(row.length, size, "test boards are square");
  return { board: rows.join("").split("").map((c) => (c === "." ? 0 : Number(c))), size };
}

function area(rows: string[]) {
  const { board, size } = parse(rows);
  return areaScore(board, size);
}

test("an empty board scores nothing for anyone, and everyone shares first place", () => {
  const a = area(["...", "...", "..."]);
  assert.deepEqual(a, { black: 0, white: 0, gray: 0, transparent: 0 });
  const results = finalResults(a, [1, 2, 3, 4]);
  assert.deepEqual(results.map((r) => r.place), [1, 1, 1, 1]);
  assert.deepEqual(results.map((r) => r.score), [0, 0, 0, 0]);
});

test("stones count, empty points count for the one side that walls them in, shared points count for no one", () => {
  const a = area([
    "1.2.",
    "1.2.",
    "1.2.",
    "1.2.",
  ]);
  // Column 1 touches black and white: nobody's. Column 3 touches only white.
  assert.equal(a.black, 4);
  assert.equal(a.white, 4 + 4);
  // All of these are base stones, i.e. walls on the pattern front.
  assert.equal(a.gray, 0);
  assert.equal(a.transparent, 0);
});

test("a stone on the other front is a wall: it scores nothing here, and does not spoil a region", () => {
  // The gray stone counts on the pattern front only.
  const onlyPattern = area(["5..", "...", "..."]);
  assert.deepEqual(onlyPattern, { black: 0, white: 0, gray: 9, transparent: 0 });

  // A solid black stone beside a gray stone: the black front sees a black
  // stone and one wall, so the whole empty region is black's; the pattern front
  // sees the mirror image and hands the same region to gray.
  const both = area(["15.", "...", "..."]);
  assert.deepEqual(both, { black: 1 + 7, white: 0, gray: 1 + 7, transparent: 0 });
});

test("driftwood is a wall on both fronts", () => {
  const a = area(["19.", "...", "..."]);
  assert.deepEqual(a, { black: 8, white: 0, gray: 0, transparent: 0 });
});

test("the two fronts are counted independently on the same points", () => {
  // Columns: black solid stones, transparent stones, white solid stones, then
  // an empty column.
  const a = area([
    "172.",
    "172.",
    "172.",
    "172.",
  ]);
  // Base front: black 4 (col 0), white 4 (col 2), and the empty column touches
  // only white, so it is white's too. The transparent stones are walls here.
  assert.equal(a.black, 4);
  assert.equal(a.white, 8);
  // Pattern front: only col 1 has stones that count. The empty column touches
  // nothing but walls there, so it is nobody's.
  assert.equal(a.transparent, 4);
  assert.equal(a.gray, 0);
});

test("everyone belongs to one side on each front", () => {
  assert.deepEqual(sidesOf(1), { base: "black", pattern: "gray" });
  assert.deepEqual(sidesOf(2), { base: "white", pattern: "gray" });
  assert.deepEqual(sidesOf(3), { base: "black", pattern: "transparent" });
  assert.deepEqual(sidesOf(4), { base: "white", pattern: "transparent" });
});

test("a player's final score is the lower of their two sides, and the higher one breaks ties", () => {
  const results = finalResults({ black: 10, white: 6, gray: 8, transparent: 12 }, [1, 2, 3, 4]);
  const byColor = new Map(results.map((r) => [r.color, r]));

  assert.deepEqual(
    [byColor.get(1)!.base, byColor.get(1)!.pattern, byColor.get(1)!.score, byColor.get(1)!.tiebreak],
    [10, 8, 8, 10]
  ); // black+gray
  assert.deepEqual(
    [byColor.get(2)!.base, byColor.get(2)!.pattern, byColor.get(2)!.score, byColor.get(2)!.tiebreak],
    [6, 8, 6, 8]
  ); // white+gray
  assert.deepEqual(
    [byColor.get(3)!.base, byColor.get(3)!.pattern, byColor.get(3)!.score, byColor.get(3)!.tiebreak],
    [10, 12, 10, 12]
  ); // black+transparent
  assert.deepEqual(
    [byColor.get(4)!.base, byColor.get(4)!.pattern, byColor.get(4)!.score, byColor.get(4)!.tiebreak],
    [6, 12, 6, 12]
  ); // white+transparent

  // Players 2 and 4 both score 6; the higher side (12 against 8) puts 4 ahead.
  assert.deepEqual([1, 2, 3, 4].map((c) => byColor.get(c)!.place), [2, 4, 1, 3]);
});

test("players level on score and tiebreak share a place, and the next place is skipped", () => {
  const results = finalResults({ black: 9, white: 3, gray: 9, transparent: 3 }, [1, 2, 3, 4]);
  // 1: (9,9)   2: (3,9)   3: (3,9)   4: (3,3)
  assert.deepEqual(results.map((r) => r.place), [1, 2, 2, 4]);
});

test("results come back in the order the combos were given", () => {
  const results = finalResults({ black: 1, white: 2, gray: 3, transparent: 4 }, [4, 1]);
  assert.deepEqual(results.map((r) => r.color), [4, 1]);
});
