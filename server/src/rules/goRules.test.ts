import { test } from "node:test";
import assert from "node:assert/strict";
import { applyCaptures, boardIndex, findGroup, isSuicide } from "./goRules";

// Identity: 1 = black+dots, 2 = white+dots, 3 = black+stripes, 4 = white+stripes.
// Two independent views: base (black 1,3 vs white 2,4) and pattern (dots 1,2 vs stripes 3,4).

test("base view: white captures black regardless of the surrounding stones' pattern", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = 1; // black+dots, the target
  board[boardIndex(size, 1, 2)] = 2; // white+dots
  board[boardIndex(size, 3, 2)] = 4; // white+stripes
  board[boardIndex(size, 2, 1)] = 2; // white+dots
  board[boardIndex(size, 2, 3)] = 4; // white+stripes, last move

  const captured = applyCaptures(board, size, 2, 3, 4);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].color, 1);
});

test("pattern view: dots captures stripes regardless of the surrounding stones' base", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = 3; // black+stripes, the target
  board[boardIndex(size, 1, 2)] = 1; // black+dots
  board[boardIndex(size, 3, 2)] = 2; // white+dots
  board[boardIndex(size, 2, 1)] = 1; // black+dots
  board[boardIndex(size, 2, 3)] = 2; // white+dots, last move

  const captured = applyCaptures(board, size, 2, 3, 2);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].color, 3);
});

test("surrounding with the same base (mixed pattern) does not trigger a base capture", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = 1; // black+dots, the target
  board[boardIndex(size, 1, 2)] = 3; // black+stripes -- same base, no threat
  board[boardIndex(size, 3, 2)] = 3;
  board[boardIndex(size, 2, 1)] = 3; // last move

  const captured = applyCaptures(board, size, 2, 1, 3);
  assert.equal(captured.length, 0);
});

test("black+dots and black+stripes merge into one group on the base view", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = 1; // black+dots
  board[boardIndex(size, 2, 3)] = 3; // black+stripes, adjacent

  const { group, liberties } = findGroup(board, size, 2, 2, "base");
  assert.equal(group.length, 2);
  assert.equal(liberties, 6); // 3 open sides each
});

test("the same two stones are separate groups on the pattern view", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = 1; // dots
  board[boardIndex(size, 2, 3)] = 3; // stripes, adjacent but different pattern

  const { group, liberties } = findGroup(board, size, 2, 2, "pattern");
  assert.equal(group.length, 1);
  assert.equal(liberties, 3); // only this stone's own open sides
});

test("a move that would leave zero liberties on both views is suicide", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  // Surround center (1,1) on all four sides with white+stripes (color 4) --
  // a black+dots stone (color 1) placed there has 0 liberties on both views.
  board[boardIndex(size, 0, 1)] = 4;
  board[boardIndex(size, 2, 1)] = 4;
  board[boardIndex(size, 1, 0)] = 4;
  board[boardIndex(size, 1, 2)] = 4;
  board[boardIndex(size, 1, 1)] = 1; // simulate the placement under test

  assert.equal(isSuicide(board, size, 1, 1), true);
});

test("dying on ONE view is still suicide, even with liberties on the other -- no cross-view rescue", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  // Two neighbors share pattern (dots) with the placed stone, so the
  // pattern-view group extends through them and has liberties (4, per
  // findGroup's per-neighbor counting) -- but the base view is still a lone
  // black stone boxed in on all four sides, with 0 liberties. Each view is
  // an independent, self-contained ruleset: good pattern-view liberties
  // don't save a base-view death.
  board[boardIndex(size, 0, 1)] = 2; // white+dots -- shares pattern, not base
  board[boardIndex(size, 2, 1)] = 4; // white+stripes
  board[boardIndex(size, 1, 0)] = 2; // white+dots -- shares pattern, not base
  board[boardIndex(size, 1, 2)] = 4; // white+stripes
  board[boardIndex(size, 1, 1)] = 1; // black+dots

  const base = findGroup(board, size, 1, 1, "base");
  const pattern = findGroup(board, size, 1, 1, "pattern");
  assert.equal(base.liberties, 0);
  assert.ok(pattern.liberties > 0);
  assert.equal(isSuicide(board, size, 1, 1), true);
});

test("not suicide when a real empty point is adjacent (both views see it)", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  // Only 3 sides occupied by the true rival (white+stripes); the 4th side
  // is genuinely empty, so both views count it as a liberty.
  board[boardIndex(size, 0, 1)] = 4;
  board[boardIndex(size, 1, 0)] = 4;
  board[boardIndex(size, 1, 2)] = 4;
  // (2, 1) left empty
  board[boardIndex(size, 1, 1)] = 1; // black+dots

  assert.equal(isSuicide(board, size, 1, 1), false);
});
