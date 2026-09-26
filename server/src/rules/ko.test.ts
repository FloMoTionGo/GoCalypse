import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCaptures, boardIndex, stoneCode } from "./goRules";
import { KoWatch, koOpenedBy, PositionHistory } from "./ko";

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

// ---- the ko, held for a round -------------------------------------------------

/** Plays a solid stone on a copy of the board and returns the new board with what it lifted. */
function take(board: number[], x: number, y: number, player: number) {
  const next = board.slice();
  const code = stoneCode(player, "base");
  next[boardIndex(SIZE, x, y)] = code;
  return { board: next, captured: applyCaptures(next, SIZE, x, y, code) };
}

test("a single stone taken by a lone stone left on one liberty opens a ko", () => {
  const { board, captured } = take(parse(KO), 2, 1, 1);
  assert.deepEqual(koOpenedBy(board, SIZE, boardIndex(SIZE, 2, 1), captured), {
    point: boardIndex(SIZE, 1, 1),
    stone: boardIndex(SIZE, 2, 1),
    code: 1,
  });
});

test("a take that leaves the taker room to breathe is no ko", () => {
  // White's corner stone has one liberty; black takes it from the open side.
  const { board, captured } = take(parse(["21..", "....", "....", "...."]), 0, 1, 1);
  assert.equal(captured.length, 1);
  assert.equal(koOpenedBy(board, SIZE, boardIndex(SIZE, 0, 1), captured), null);
});

test("a ko is held for a round, whatever the seats in between play", () => {
  const kos = new KoWatch(SIZE);
  const taken = take(parse(KO), 2, 1, 1); // turn 0: black takes
  kos.open(taken.board, boardIndex(SIZE, 2, 1), taken.captured, 0, 4);

  // Turns 1 and 2 go elsewhere, so the retake is a new position and superko lets it through.
  let board = play(taken.board, 0, 3, 3);
  board = play(board, 3, 3, 4);
  const retake = take(board, 1, 1, 2);
  assert.deepEqual(retake.captured.map((c) => c.point), [{ x: 2, y: 1 }]);

  const at = boardIndex(SIZE, 1, 1);
  assert.equal(kos.blocks(at, retake.captured, 3), true, "still the taker's round");
  assert.equal(kos.blocks(at, retake.captured, 4), false, "the taker has had its turn back");
});

test("a stone that is not the ko's own is not held by it", () => {
  const kos = new KoWatch(SIZE);
  const taken = take(parse(KO), 2, 1, 1);
  kos.open(taken.board, boardIndex(SIZE, 2, 1), taken.captured, 0, 4);
  const other = [{ point: { x: 2, y: 1 }, color: 3, view: "base" as const }];
  assert.equal(kos.blocks(boardIndex(SIZE, 1, 1), other, 1), false);
});
