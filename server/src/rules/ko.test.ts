import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCaptures, boardIndex, stoneCode } from "./goRules";
import { PositionHistory } from "./ko";

const SIZE = 4;

function parse(rows: string[]): number[] {
  return rows.join("").split("").map((c) => (c === "." ? 0 : Number(c)));
}

/** Plays a solid stone on a copy of the board and returns the board that results. */
function play(board: number[], x: number, y: number, player: number): number[] {
  const next = board.slice();
  const code = stoneCode(player, "base");
  next[boardIndex(SIZE, x, y)] = code;
  applyCaptures(next, SIZE, x, y, code);
  return next;
}

// Black (1) surrounds white's (1,1) on three sides; white surrounds the empty (2,1).
// Black takes the stone by playing (2,1), and white retakes by playing (1,1).
const KO = [".12.", "12.2", ".12.", "...."];

test("retaking a ko at once repeats the position", () => {
  const start = parse(KO);
  const history = new PositionHistory();
  history.record(start);

  const afterBlack = play(start, 2, 1, 1);
  assert.notDeepEqual(afterBlack, start);
  assert.equal(history.repeats(afterBlack), false);
  history.record(afterBlack);

  const afterWhite = play(afterBlack, 1, 1, 2);
  assert.deepEqual(afterWhite, start);
  assert.equal(history.repeats(afterWhite), true);
});

test("the ko is caught even when other seats play in between", () => {
  const start = parse(KO);
  const history = new PositionHistory();
  history.record(start);
  let board = play(start, 2, 1, 1);
  history.record(board);
  // Two other seats put stones down far from the fight, then the retake comes.
  board = play(board, 0, 3, 3);
  history.record(board);
  board = play(board, 3, 3, 4);
  history.record(board);
  // Their stones are still there, so this is a new position: not a ko.
  assert.equal(history.repeats(play(board, 1, 1, 2)), false);
});

test("a position that never stood before is fine", () => {
  const history = new PositionHistory();
  history.record(parse(["1...", "....", "....", "...."]));
  assert.equal(history.repeats(parse([".1..", "....", "....", "...."])), false);
});

test("the same points retaken by another colour count as a repeat", () => {
  const history = new PositionHistory();
  history.record(parse(["1...", "....", "....", "...."]));
  assert.equal(history.repeats(parse(["2...", "....", "....", "...."])), true);
});
