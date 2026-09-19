import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCaptures,
  axisOf,
  boardIndex,
  canPlaceNeutral,
  DRIFTWOOD,
  findGroup,
  flipStone,
  isSuicide,
  ownerOf,
  stoneCode,
} from "./goRules";

// Player identity: 1 = black+dots, 2 = white+dots, 3 = black+stripes, 4 = white+stripes.
// A move chooses which axis that stone fights on:
//   stoneCode(player, "base")    -> solid black/white, neutral (a wall) on the pattern view.
//   stoneCode(player, "pattern") -> grey dots/stripes, neutral (a wall) on the base view.

test("stoneCode / ownerOf / axisOf round-trip", () => {
  const base = stoneCode(3, "base");
  const pattern = stoneCode(3, "pattern");
  assert.equal(ownerOf(base), 3);
  assert.equal(axisOf(base), "base");
  assert.equal(ownerOf(pattern), 3);
  assert.equal(axisOf(pattern), "pattern");
  assert.notEqual(base, pattern);
});

test("base-axis stones from different players (1 black, 3 black) merge and are captured together", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = stoneCode(1, "base"); // black, player 1
  board[boardIndex(size, 2, 3)] = stoneCode(3, "base"); // black, player 3 -- merges with the above
  board[boardIndex(size, 1, 2)] = stoneCode(2, "base"); // white
  board[boardIndex(size, 3, 2)] = stoneCode(4, "base"); // white
  board[boardIndex(size, 2, 1)] = stoneCode(2, "base"); // white
  board[boardIndex(size, 1, 3)] = stoneCode(4, "base"); // white
  board[boardIndex(size, 3, 3)] = stoneCode(2, "base"); // white
  board[boardIndex(size, 2, 4)] = stoneCode(4, "base"); // white, last move -- completes the surround

  const captured = applyCaptures(board, size, 2, 4, stoneCode(4, "base"));
  const owners = captured.map((c) => ownerOf(c.color)).sort();
  assert.equal(captured.length, 2);
  assert.deepEqual(owners, [1, 3]);
});

test("a pattern-axis (grey) stone is a wall on the base view: blocks, but can't be captured or merged there", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = stoneCode(1, "base"); // black, the target
  board[boardIndex(size, 1, 2)] = stoneCode(3, "pattern"); // grey wall -- occupies but neutral on base
  board[boardIndex(size, 3, 2)] = stoneCode(2, "base"); // white
  board[boardIndex(size, 2, 1)] = stoneCode(2, "base"); // white
  board[boardIndex(size, 2, 3)] = stoneCode(2, "base"); // white, last move -- all 4 sides now occupied

  const captured = applyCaptures(board, size, 2, 3, stoneCode(2, "base"));
  assert.equal(captured.length, 1);
  assert.equal(ownerOf(captured[0].color), 1);
});

test("a base-axis move never triggers a pattern-view capture, even against a real pattern rival", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  // A lone grey+dots stone (player 1) surrounded by grey+stripes (rivals on
  // pattern) plus one base-axis stone as the actual last move.
  board[boardIndex(size, 2, 2)] = stoneCode(1, "pattern"); // grey dots
  board[boardIndex(size, 1, 2)] = stoneCode(3, "pattern"); // grey stripes -- pattern rival
  board[boardIndex(size, 3, 2)] = stoneCode(3, "pattern"); // grey stripes
  board[boardIndex(size, 2, 1)] = stoneCode(3, "pattern"); // grey stripes
  board[boardIndex(size, 2, 3)] = stoneCode(2, "base"); // white, last move -- a base-axis move

  // The base-axis move only fights the base war; it must not reach into the
  // pattern-view capture even though the target has 0 pattern-view liberties.
  const captured = applyCaptures(board, size, 2, 3, stoneCode(2, "base"));
  assert.equal(captured.length, 0);
});

test("that same pattern-view kill DOES happen when the last move is itself pattern-axis", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = stoneCode(1, "pattern"); // grey dots
  board[boardIndex(size, 1, 2)] = stoneCode(3, "pattern"); // grey stripes
  board[boardIndex(size, 3, 2)] = stoneCode(3, "pattern"); // grey stripes
  board[boardIndex(size, 2, 1)] = stoneCode(3, "pattern"); // grey stripes
  board[boardIndex(size, 2, 3)] = stoneCode(3, "pattern"); // grey stripes, last move

  const captured = applyCaptures(board, size, 2, 3, stoneCode(3, "pattern"));
  assert.equal(captured.length, 1);
  assert.equal(ownerOf(captured[0].color), 1);
  assert.equal(axisOf(captured[0].color), "pattern");
});

test("a wall neighbor blocks a liberty without joining the group", () => {
  const size = 5;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 2, 2)] = stoneCode(1, "base");
  board[boardIndex(size, 2, 3)] = stoneCode(3, "pattern"); // grey wall, adjacent

  const { group, liberties } = findGroup(board, size, 2, 2, "base");
  assert.equal(group.length, 1); // did not merge
  assert.equal(liberties, 3); // 4 sides minus the one the wall occupies
});

test("suicide is checked only on the placed stone's own axis", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  // Center surrounded on all 4 sides by pattern-axis (grey) stones -- a
  // base-axis placement here has 0 real base-view liberties (all neighbors
  // are walls on the base view, so none merge and none are empty).
  board[boardIndex(size, 0, 1)] = stoneCode(3, "pattern");
  board[boardIndex(size, 2, 1)] = stoneCode(3, "pattern");
  board[boardIndex(size, 1, 0)] = stoneCode(3, "pattern");
  board[boardIndex(size, 1, 2)] = stoneCode(3, "pattern");
  board[boardIndex(size, 1, 1)] = stoneCode(1, "base");

  assert.equal(isSuicide(board, size, 1, 1), true);
});

test("not suicide when a real liberty or an allied merge exists on the placed stone's own axis", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 0, 1)] = stoneCode(3, "pattern"); // wall on base view
  board[boardIndex(size, 2, 1)] = stoneCode(3, "pattern"); // wall on base view
  board[boardIndex(size, 1, 0)] = stoneCode(2, "base"); // white -- occupied, blocks
  // (1, 2) left empty -> a real liberty on the base view
  board[boardIndex(size, 1, 1)] = stoneCode(1, "base");

  assert.equal(isSuicide(board, size, 1, 1), false);
});

test("driftwood is owned by no one and is a wall on both views", () => {
  assert.equal(ownerOf(DRIFTWOOD), 0);
  const size = 3;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 1, 1)] = stoneCode(1, "base");
  board[boardIndex(size, 1, 0)] = DRIFTWOOD;
  const base = findGroup(board, size, 1, 1, "base");
  assert.equal(base.group.length, 1);
  assert.equal(base.liberties, 3);

  // A lone driftwood surrounded by rivals on every view is never captured.
  const b2 = new Array(size * size).fill(0);
  b2[boardIndex(size, 1, 1)] = DRIFTWOOD;
  b2[boardIndex(size, 0, 1)] = stoneCode(2, "base");
  b2[boardIndex(size, 2, 1)] = stoneCode(2, "base");
  b2[boardIndex(size, 1, 0)] = stoneCode(4, "pattern");
  b2[boardIndex(size, 1, 2)] = stoneCode(4, "pattern");
  assert.equal(applyCaptures(b2, size, 1, 2, stoneCode(4, "pattern")).length, 0);
  assert.equal(applyCaptures(b2, size, 2, 1, stoneCode(2, "base")).length, 0);
  assert.equal(b2[boardIndex(size, 1, 1)], DRIFTWOOD);
});

test("driftwood can't be dropped where it would smother a group", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  // Black corner stone at (0,0) with one liberty left at (1,0).
  board[boardIndex(size, 0, 0)] = stoneCode(1, "base");
  board[boardIndex(size, 0, 1)] = stoneCode(2, "base");
  assert.equal(canPlaceNeutral(board, size, 1, 0), false);
  assert.equal(canPlaceNeutral(board, size, 2, 2), true);
  assert.equal(canPlaceNeutral(board, size, 0, 1), false); // occupied
});

test("a protected (warded) group survives with zero liberties", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  board[boardIndex(size, 0, 0)] = stoneCode(1, "base");
  board[boardIndex(size, 1, 0)] = stoneCode(2, "base");
  board[boardIndex(size, 0, 1)] = stoneCode(2, "base"); // last move
  const warded = new Set([boardIndex(size, 0, 0)]);
  const captured = applyCaptures(board, size, 0, 1, stoneCode(2, "base"), (i) => warded.has(i));
  assert.equal(captured.length, 0);
  assert.equal(board[boardIndex(size, 0, 0)], stoneCode(1, "base"));
  // Same position without the ward: captured.
  assert.equal(applyCaptures(board, size, 0, 1, stoneCode(2, "base")).length, 1);
});

test("flipStone moves a stone to its other axis and captures on the new view", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  // Grey dots (player 1) at (0,0), hemmed in by a stripes stone and ...
  board[boardIndex(size, 0, 0)] = stoneCode(1, "pattern");
  board[boardIndex(size, 1, 0)] = stoneCode(3, "pattern");
  // ... player 3's solid black stone at (0,1), which flips to grey stripes.
  board[boardIndex(size, 0, 1)] = stoneCode(3, "base");
  const captured = flipStone(board, size, 0, 1);
  assert.ok(captured);
  assert.equal(captured!.length, 1);
  assert.equal(ownerOf(captured![0].color), 1);
  assert.equal(board[boardIndex(size, 0, 1)], stoneCode(3, "pattern"));
  assert.equal(board[boardIndex(size, 0, 0)], 0);
});

test("flipStone refuses a flip that leaves the flipped stone without liberties", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  // Solid black corner stone whose neighbours are stripes (rivals of dots on the pattern view).
  board[boardIndex(size, 0, 0)] = stoneCode(1, "base");
  board[boardIndex(size, 1, 0)] = stoneCode(3, "pattern");
  board[boardIndex(size, 0, 1)] = stoneCode(3, "pattern");
  const before = board.slice();
  assert.equal(flipStone(board, size, 0, 0), null);
  assert.deepEqual(board, before);
});

test("flipStone refuses a flip that strands a former group-mate", () => {
  const size = 3;
  const board = new Array(size * size).fill(0);
  // Black chain (0,0)-(1,0) whose only liberties come through (1,0).
  board[boardIndex(size, 0, 0)] = stoneCode(1, "base");
  board[boardIndex(size, 1, 0)] = stoneCode(3, "base");
  board[boardIndex(size, 0, 1)] = stoneCode(2, "base");
  // Flipping (1,0) to pattern turns it into a wall on the base view, leaving (0,0) with none.
  const before = board.slice();
  assert.equal(flipStone(board, size, 1, 0), null);
  assert.deepEqual(board, before);
});
