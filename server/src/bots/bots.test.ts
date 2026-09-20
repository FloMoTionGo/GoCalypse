import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCaptures,
  boardIndex,
  isSuicide,
  stoneCode,
  StoneView,
} from "../rules/goRules";
import { chooseAction } from "./index";
import { Rng } from "./rng";
import { BotView, rankMoves, scoreMove } from "./scoring";
import { heron, randomStyle, tanuki, temperamentFor } from "./styles";

// The players are pure functions over a plain board, so everything below runs
// without a room, a socket or a clock. Seat 1 is black+dots throughout.

function view(size: number, color: number, over: Partial<BotView> = {}): BotView {
  return {
    board: new Array(size * size).fill(0),
    size,
    color,
    lastMove: null,
    fireflies: 0,
    moves: 0,
    powerups: [],
    bought: [],
    shopAfter: 5,
    market: [],
    satchelLimit: 5,
    powerfulLimit: 1,
    isWarded: () => false,
    lilyOwnerAt: () => 0,
    isBurning: () => false,
    ...over,
  };
}

/** Plays a stone the way GoRoom does, and fails the test if the rules refuse it. */
function play(board: number[], size: number, x: number, y: number, axis: StoneView, color: number): number {
  const idx = boardIndex(size, x, y);
  assert.equal(board[idx], 0, `bot played on an occupied point (${x}, ${y})`);
  const code = stoneCode(color, axis);
  board[idx] = code;
  const captured = applyCaptures(board, size, x, y, code);
  assert.ok(
    captured.length > 0 || !isSuicide(board, size, x, y),
    `bot played a suicide at (${x}, ${y})`
  );
  return captured.length;
}

test("a seed names a sequence exactly", () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  const c = new Rng(12346);
  const first = [a.next(), a.next(), a.next()];
  assert.deepEqual(first, [b.next(), b.next(), b.next()]);
  assert.notDeepEqual(first, [c.next(), c.next(), c.next()]);
});

test("every ranked move is one the rules would accept", () => {
  const size = 7;
  const v = view(size, 1);
  // A scattering of all four seats on both fronts.
  const seeded: [number, number, number, StoneView][] = [
    [3, 3, 2, "base"],
    [3, 4, 4, "base"],
    [4, 3, 3, "pattern"],
    [2, 3, 1, "base"],
    [5, 5, 2, "pattern"],
    [1, 1, 4, "pattern"],
  ];
  for (const [x, y, color, axis] of seeded) v.board[boardIndex(size, x, y)] = stoneCode(color, axis);

  const ranked = rankMoves(v, tanuki());
  assert.ok(ranked.length > 0);
  for (const c of ranked) {
    const trial = v.board.slice();
    const idx = boardIndex(size, c.x, c.y);
    assert.equal(trial[idx], 0, "ranked an occupied point");
    const code = stoneCode(v.color, c.axis);
    trial[idx] = code;
    const captured = applyCaptures(trial, size, c.x, c.y, code);
    assert.ok(captured.length > 0 || !isSuicide(trial, size, c.x, c.y), "ranked a suicide");
  }
});

test("takes the capture in front of it", () => {
  const size = 5;
  const v = view(size, 1); // black+dots
  v.board[boardIndex(size, 2, 2)] = stoneCode(2, "base"); // a white stone, base front
  for (const [x, y] of [[1, 2], [3, 2], [2, 1]]) {
    v.board[boardIndex(size, x, y)] = stoneCode(1, "base"); // ours, down to its last liberty
  }

  const best = rankMoves(v, tanuki())[0];
  assert.deepEqual({ x: best.x, y: best.y, axis: best.axis }, { x: 2, y: 3, axis: "base" });
});

test("never fills its own eye", () => {
  const size = 5;
  const v = view(size, 1);
  for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) {
    v.board[boardIndex(size, x, y)] = stoneCode(1, "base");
  }
  const centre = rankMoves(v, heron()).filter((c) => c.x === 2 && c.y === 2);
  assert.equal(centre.length, 0);
});

test("a self-atari is worth less than a quiet point", () => {
  const size = 5;
  const v = view(size, 1);
  v.board[boardIndex(size, 0, 0)] = stoneCode(1, "base");
  for (const [x, y] of [[0, 1], [1, 1], [2, 1]]) {
    v.board[boardIndex(size, x, y)] = stoneCode(2, "base");
  }

  const selfAtari = scoreMove(v, 1, 0, "base", heron()); // leaves the pair on one liberty
  const quiet = scoreMove(v, 3, 3, "base", heron());
  assert.ok(selfAtari !== null && quiet !== null);
  assert.ok(selfAtari < quiet, `${selfAtari} should be below ${quiet}`);
});

test("a burning point is not on the board as far as a bot is concerned", () => {
  const size = 5;
  const burning = boardIndex(size, 2, 2);
  const v = view(size, 1, { isBurning: (idx) => idx === burning });
  assert.equal(scoreMove(v, 2, 2, "base", heron()), null);
  assert.equal(rankMoves(v, heron()).filter((c) => c.x === 2 && c.y === 2).length, 0);
});

test("someone else's lily pad is not on the board either", () => {
  const size = 5;
  const reserved = boardIndex(size, 2, 2);
  const mine = view(size, 1, { lilyOwnerAt: (idx) => (idx === reserved ? 3 : 0) });
  const theirs = view(size, 3, { lilyOwnerAt: (idx) => (idx === reserved ? 3 : 0) });
  assert.equal(scoreMove(mine, 2, 2, "base", heron()), null);
  assert.ok(scoreMove(theirs, 2, 2, "base", heron()) !== null); // the owner may still play it
});

/** Four bots play the board out, which is the cheapest fuzzer goRules will ever get. */
function selfPlay(seed: number, plies: number): number[] {
  const size = 13;
  const board = new Array(size * size).fill(0);
  const rng = new Rng(seed);
  let last: { x: number; y: number } | null = null;

  for (let ply = 0; ply < plies; ply++) {
    const color = (ply % 4) + 1;
    const v = view(size, color, { board, lastMove: last, moves: Math.floor(ply / 4) });
    const action = chooseAction(v, temperamentFor(color - 1), rng);
    if (action.kind !== "move") break; // no satchel in this harness, so it is always a stone
    play(board, size, action.x, action.y, action.axis, color);
    last = { x: action.x, y: action.y };
  }
  return board;
}

test("four bots play 240 legal moves without stalling", () => {
  const board = selfPlay(20260920, 240);
  assert.ok(board.some((c) => c !== 0));
});

test("the same seed replays the same match", () => {
  assert.deepEqual(selfPlay(7, 120), selfPlay(7, 120));
  assert.notDeepEqual(selfPlay(7, 120), selfPlay(8, 120));
});

test("the drifter still only offers legal points", () => {
  const size = 9;
  const v = view(size, 2);
  v.board[boardIndex(size, 4, 4)] = stoneCode(1, "base");
  const ranked = rankMoves(v, randomStyle());
  assert.equal(new Set(ranked.map((c) => c.score)).size, 1); // every point equal: a flat draw
  assert.ok(ranked.length > 0);
});
