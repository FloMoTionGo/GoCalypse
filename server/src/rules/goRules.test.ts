import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCaptures, boardIndex, findGroup, isAllied } from "./goRules";

// Identity: 1 = black+dots, 2 = white+dots, 3 = black+stripes, 4 = white+stripes.

test("alliance matrix", () => {
  assert.equal(isAllied(1, 2), true, "1-2 share dots");
  assert.equal(isAllied(1, 3), true, "1-3 share black");
  assert.equal(isAllied(2, 4), true, "2-4 share white");
  assert.equal(isAllied(3, 4), true, "3-4 share stripes");
  assert.equal(isAllied(1, 4), false, "1-4 are the sole rivals (share nothing)");
  assert.equal(isAllied(2, 3), false, "2-3 are the sole rivals (share nothing)");
  assert.equal(isAllied(1, 1), true, "a color is always allied with itself");
  assert.equal(isAllied(1, 0), false, "empty is never allied");
});

test("a lone stone dies only when surrounded by its one true rival", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = 4;
  board[boardIndex(size, 1, 2)] = 1;
  board[boardIndex(size, 3, 2)] = 1;
  board[boardIndex(size, 2, 1)] = 1;
  board[boardIndex(size, 2, 3)] = 1; // last move

  const captured = applyCaptures(board, size, 2, 3, 1);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].color, 4);
});

test("surrounding with allies does not capture", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = 4;
  board[boardIndex(size, 1, 2)] = 2; // allied (white)
  board[boardIndex(size, 3, 2)] = 3; // allied (stripes)
  board[boardIndex(size, 2, 1)] = 2; // allied (white), last move

  const captured = applyCaptures(board, size, 2, 1, 2);
  assert.equal(captured.length, 0);
});

test("allied adjacent stones merge into one group and share liberties", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = 1;
  board[boardIndex(size, 2, 3)] = 3; // allied via black base

  const { group, liberties } = findGroup(board, size, 2, 2);
  assert.equal(group.length, 2);
  assert.equal(liberties, 6);
});

test("a mixed allied group can be wiped out as collateral damage", () => {
  // Alliance isn't transitive (1 allies with 2 and 3, but 2 and 3 are rivals
  // of each other), so a merged 1+3 group can still be fully captured by a
  // color-2 stone even though 2 is individually allied with the 1 member.
  const size = 3;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 1, 0)] = 1;
  board[boardIndex(size, 1, 1)] = 3;
  board[boardIndex(size, 0, 0)] = 2;
  board[boardIndex(size, 2, 0)] = 2;
  board[boardIndex(size, 0, 1)] = 2;
  board[boardIndex(size, 2, 1)] = 2;
  board[boardIndex(size, 1, 2)] = 2; // last move

  const captured = applyCaptures(board, size, 1, 2, 2);
  const colors = captured.map((c) => c.color).sort();
  assert.equal(captured.length, 2);
  assert.deepEqual(colors, [1, 3]);
});
