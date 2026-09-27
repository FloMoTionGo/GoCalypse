import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

// Snapshots from these rooms must not land in the server's own data folder.
process.env.DATA_DIR = path.join(os.tmpdir(), `gocalypse-test-${process.pid}`);

import { boardIndex, stoneCode } from "../rules/goRules";
import { CARD_BASE, CARD_CENTRE, STONE_CARD } from "../rules/stoneCard";
import { GoRoom } from "./GoRoom";

// findings B12: stones an item puts down obey the same two ko rules as a move.

const B = stoneCode(1, "base");
const W = stoneCode(2, "base");

/**
 * A real four-seat room with the ko from ko.test.ts in its corner, just taken
 * by black at (2,1): white's retake at (1,1) is held until black moves again.
 */
function heldKo() {
  const room: any = new GoRoom();
  room.listing = { updateOne: async () => {} };
  room.onCreate({});
  for (const id of ["a", "b", "c", "d"]) room.onJoin({ sessionId: id, send() {} }, { name: id });
  const state = room.state;
  const size: number = state.size;
  const put = (x: number, y: number, code: number) => (state.board[boardIndex(size, x, y)] = code);
  for (const [x, y] of [[1, 0], [0, 1], [1, 2], [2, 1]]) put(x, y, B);
  for (const [x, y] of [[2, 0], [3, 1], [2, 2]]) put(x, y, W);
  const turn: number = state.turnCount;
  const taken = [{ point: { x: 1, y: 1 }, color: 2, view: "base" as const }];
  room.kos.open(state.board.toArray(), boardIndex(size, 2, 1), taken, turn, turn + 4);
  return {
    room,
    state,
    turn,
    white: state.players.findIndex((p: any) => p.color === 2) as number,
    at: (x: number, y: number): number => state.board[boardIndex(size, x, y)],
    close() {
      room.clock.clear();
      room.onDispose();
    },
  };
}

test("an item can't take back a held ko, and can once its taker has moved again", () => {
  const t = heldKo();
  assert.equal(t.room.placeStoneFor(t.white, 1, 1, W), null);
  assert.equal(t.at(1, 1), 0, "refused: nothing placed");
  assert.equal(t.at(2, 1), B, "refused: nothing captured");

  t.state.turnCount = t.turn + 4;
  assert.equal(t.room.placeStoneFor(t.white, 1, 1, W), 1);
  assert.equal(t.at(1, 1), W);
  assert.equal(t.at(2, 1), 0);
  t.close();
});

test("an item can't bring back a board position that has stood before", () => {
  const t = heldKo();
  const size: number = t.state.size;
  t.state.board[boardIndex(size, 8, 8)] = W;
  t.room.positions.record(t.state.board.toArray());
  t.state.board[boardIndex(size, 8, 8)] = 0;
  assert.equal(t.room.placeStoneFor(t.white, 8, 8, W), null);
  assert.equal(t.at(8, 8), 0);
  assert.equal(t.room.placeStoneFor(t.white, 9, 9, W), 0, "any new position is fine");
  t.close();
});

test("a seed blocked by a held ko waits a turn instead of withering, then grows", () => {
  const t = heldKo();
  t.room.addEffect("seed", 1, 1, 2, 0, "base");
  t.room.expireEffects();
  assert.equal(t.at(1, 1), 0, "not grown into the held ko");
  const seeds = Array.from(t.state.effects).filter((e: any) => e.kind === "seed");
  assert.equal(seeds.length, 1, "still in the ground");
  assert.equal((seeds[0] as any).until, t.turn + 1, "tries again next turn");

  t.state.turnCount = t.turn + 4;
  t.room.expireEffects();
  assert.equal(t.at(1, 1), W, "grows once the ko is free");
  assert.equal(t.at(2, 1), 0);
  t.close();
});

test("a seed refused for anything but a ko still withers", () => {
  const t = heldKo();
  t.room.addEffect("seed", 0, 1, 2, 0, "base"); // occupied by black
  t.room.expireEffects();
  assert.equal(Array.from(t.state.effects).filter((e: any) => e.kind === "seed").length, 0);
  t.close();
});

test("a Stone Card can't take back a held ko either", () => {
  const t = heldKo();
  const white = t.state.players[t.white];
  white.card[CARD_CENTRE] = CARD_BASE;
  assert.ok(Array.from(white.powerups).includes(STONE_CARD));
  t.state.turnIndex = t.white;
  assert.match(t.room.applyPlayCard(t.white, { x: 1, y: 1 }), /^Ko:/);
  assert.equal(t.at(1, 1), 0);
  assert.equal(t.at(2, 1), B);

  t.state.turnCount = t.turn + 4;
  assert.equal(t.room.applyPlayCard(t.white, { x: 1, y: 1 }), null);
  assert.equal(t.at(1, 1), W);
  t.close();
});
