import { test } from "node:test";
import assert from "node:assert/strict";
import { finalResults, Prisoners, sidesOf, SIDE_CODE, territoryOwners, territoryScore } from "./endgame";

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

function territory(rows: string[]) {
  const { board, size } = parse(rows);
  return territoryScore(board, size);
}

const NONE: Prisoners = { base: 0, pattern: 0 };

test("an empty board scores nothing for anyone, and everyone shares first place", () => {
  const t = territory(["...", "...", "..."]);
  assert.deepEqual(t, { black: 0, white: 0, gray: 0, transparent: 0 });
  const results = finalResults(t, [1, 2, 3, 4]);
  assert.deepEqual(results.map((r) => r.place), [1, 1, 1, 1]);
  assert.deepEqual(results.map((r) => r.score), [0, 0, 0, 0]);
});

test("a stone is worth the ground it surrounds, not itself", () => {
  // One black stone in the corner of a 3x3. Under area scoring this was 9:
  // eight empty points plus the stone. Territory scoring pays only the eight.
  assert.equal(territory(["1..", "...", "..."]).black, 8);
});

test("empty points count for the one side that walls them in, shared points count for no one", () => {
  const t = territory([
    "1.2.",
    "1.2.",
    "1.2.",
    "1.2.",
  ]);
  // Column 1 touches black and white: nobody's. Column 3 touches only white.
  // The stones themselves are worth nothing, so black -- who walls in no empty
  // point at all -- comes away with nothing despite four stones on the board.
  assert.equal(t.black, 0);
  assert.equal(t.white, 4);
  // All of these are base stones, i.e. walls on the pattern front. Columns 1
  // and 3 are separate regions there (column 2 is occupied), and neither
  // borders a pattern stone, so neither counts for anyone.
  assert.equal(t.gray, 0);
  assert.equal(t.transparent, 0);
});

test("a stone on the other front is a wall: it scores nothing here, and does not spoil a region", () => {
  // The gray stone walls its region in on the pattern front and is invisible on
  // the base front, where the region is left bordering nothing at all.
  assert.deepEqual(territory(["5..", "...", "..."]), { black: 0, white: 0, gray: 8, transparent: 0 });

  // A solid black stone beside a gray one: the base front sees a black stone
  // and one wall, so the seven empty points are black's; the pattern front sees
  // the mirror image and hands the same seven to gray.
  assert.deepEqual(territory(["15.", "...", "..."]), { black: 7, white: 0, gray: 7, transparent: 0 });
});

test("driftwood is a wall on both fronts", () => {
  assert.deepEqual(territory(["19.", "...", "..."]), { black: 7, white: 0, gray: 0, transparent: 0 });
});

// ---- per-point ownership (territoryOwners) -------------------------------------
//
// Same regions and the same single-border rule as territoryScore, but kept per
// point rather than folded into a total, so the client can mark the board.

test("territoryOwners marks each settled point with the side that walls it in", () => {
  const { board, size } = parse(["15.", "...", "..."]);
  const base = territoryOwners(board, size, "base");
  const pattern = territoryOwners(board, size, "pattern");
  assert.equal(base[0], 0); // the black stone itself scores nothing
  assert.equal(base[1], 0); // the gray stone is a wall on this front, not territory
  assert.equal(base.filter((c) => c === SIDE_CODE.black).length, 7);
  // The pattern front sees the mirror image: gray owns the same seven points.
  assert.equal(pattern.filter((c) => c === SIDE_CODE.gray).length, 7);
});

test("territoryOwners sums to the same totals as territoryScore", () => {
  const { board, size } = parse(["1.2.", "1.2.", "1.2.", "1.2."]);
  const totals = territoryScore(board, size);
  const base = territoryOwners(board, size, "base");
  assert.equal(base.filter((c) => c === SIDE_CODE.black).length, totals.black);
  assert.equal(base.filter((c) => c === SIDE_CODE.white).length, totals.white);
  // Column 1 (indices 1, 5, 9, 13) touches both black and white: nobody's.
  assert.deepEqual([base[1], base[5], base[9], base[13]], [0, 0, 0, 0]);
});

test("territoryOwners leaves a driftwood point unowned, same as any other wall", () => {
  const { board, size } = parse(["19.", "...", "..."]);
  const base = territoryOwners(board, size, "base");
  assert.equal(base[1], 0); // the driftwood point itself
  assert.equal(base.filter((c) => c === SIDE_CODE.black).length, 7);
});

test("the two fronts are counted independently on the same points", () => {
  // Column 0 black solid stones, column 2 gray stones, columns 1 and 3 empty.
  const t = territory([
    "1.5.",
    "1.5.",
    "1.5.",
    "1.5.",
  ]);
  // Base front: the gray stones are walls, so column 1 borders black alone and
  // column 3 borders nothing. Black takes four points.
  assert.equal(t.black, 4);
  assert.equal(t.white, 0);
  // Pattern front: the black stones are walls, so both empty columns border
  // gray alone. The same board is worth twice as much on this front.
  assert.equal(t.gray, 8);
  assert.equal(t.transparent, 0);
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

// ---- prisoners ---------------------------------------------------------------
//
// Territory belongs to a side and is shared by the two seats that hold it.
// Prisoners belong to the player who played the capturing move, which is why
// taking a group yourself beats leaving it to the ally on your front.

test("prisoners are added to the front the dead group was judged on", () => {
  const [p1] = finalResults({ black: 10, white: 0, gray: 4, transparent: 0 }, [1], [
    { base: 3, pattern: 5 },
  ]);
  assert.deepEqual([p1.baseTerritory, p1.basePrisoners, p1.base], [10, 3, 13]);
  assert.deepEqual([p1.patternTerritory, p1.patternPrisoners, p1.pattern], [4, 5, 9]);
  assert.equal(p1.score, 9); // the lower front, prisoners included
  assert.equal(p1.tiebreak, 13);
});

test("two players on one side share its territory but not its prisoners", () => {
  // 1 and 3 are both black; only 1 did the capturing there.
  const results = finalResults({ black: 10, white: 10, gray: 10, transparent: 10 }, [1, 3], [
    { base: 4, pattern: 0 },
    NONE,
  ]);
  assert.deepEqual(results.map((r) => r.baseTerritory), [10, 10]);
  assert.deepEqual(results.map((r) => r.base), [14, 10]);
  // Both fronts are level at 10, so the prisoners show up only in the tiebreak.
  assert.deepEqual(results.map((r) => r.score), [10, 10]);
  assert.deepEqual(results.map((r) => r.tiebreak), [14, 10]);
  assert.deepEqual(results.map((r) => r.place), [1, 2]);
});

test("prisoners can lift the front that was holding a score down", () => {
  // Both players hold the same ground. One took five stones on the front that
  // was its lower one, and that is the whole difference between them.
  const territoryOnly = finalResults({ black: 6, white: 6, gray: 2, transparent: 2 }, [1, 2]);
  assert.deepEqual(territoryOnly.map((r) => r.score), [2, 2]);

  const withPrisoners = finalResults({ black: 6, white: 6, gray: 2, transparent: 2 }, [1, 2], [
    { base: 0, pattern: 5 },
    NONE,
  ]);
  assert.deepEqual(withPrisoners.map((r) => r.score), [6, 2]);
  assert.deepEqual(withPrisoners.map((r) => r.place), [1, 2]);
});

test("no prisoners given is the same as none taken", () => {
  const given = finalResults({ black: 3, white: 4, gray: 5, transparent: 6 }, [1, 2, 3, 4], [NONE, NONE, NONE, NONE]);
  const omitted = finalResults({ black: 3, white: 4, gray: 5, transparent: 6 }, [1, 2, 3, 4]);
  assert.deepEqual(given, omitted);
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
