import { mock, test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

// Snapshots from these rooms must not land in the server's own data folder.
process.env.DATA_DIR = path.join(os.tmpdir(), `gocalypse-test-${process.pid}`);

import { boardIndex, GREY_STONE, stoneCode } from "../rules/goRules";
import { GoRoom } from "./GoRoom";

// findings B13: a bot sees what a human in its seat is sent, nothing more.

function table() {
  const room: any = new GoRoom();
  room.listing = { updateOne: async () => {} };
  room.onCreate({});
  for (const id of ["a", "b", "c", "d"]) room.onJoin({ sessionId: id, send() {} }, { name: id });
  const state = room.state;
  const size: number = state.size;
  const seat = (color: number): number => state.players.findIndex((p: any) => p.color === color);
  return {
    room,
    state,
    idx: (x: number, y: number) => boardIndex(size, x, y),
    put: (x: number, y: number, code: number) => (state.board[boardIndex(size, x, y)] = code),
    view: (color: number) => room.botView(seat(color)),
    close() {
      room.clock.clear();
      room.onDispose();
    },
  };
}

test("with nothing hidden, a bot sees the true board", () => {
  const t = table();
  t.put(3, 3, stoneCode(1, "base"));
  t.put(4, 4, stoneCode(2, "pattern"));
  assert.deepEqual(t.view(1).board, t.state.board.toArray());
  t.close();
});

test("a fogged stone is hidden from every bot, its owner's included", () => {
  const t = table();
  t.put(5, 5, stoneCode(1, "base"));
  t.room.addEffect("fog", 5, 5, 2, 2);
  for (const color of [1, 2, 3]) {
    const v = t.view(color);
    assert.equal(v.board[t.idx(5, 5)], 0);
    assert.equal(v.isFogged(t.idx(5, 5)), true, "and still off limits");
  }
  t.close();
});

test("a misted stone is seen by its owner only; rivals just know not to play there", () => {
  const t = table();
  const code = stoneCode(1, "pattern");
  t.put(6, 6, code);
  t.room.addEffect("mist", 6, 6, 1, 1);
  const mine = t.view(1);
  assert.equal(mine.board[t.idx(6, 6)], code);
  assert.equal(mine.isFogged(t.idx(6, 6)), false);
  const rival = t.view(2);
  assert.equal(rival.board[t.idx(6, 6)], 0, "the front stays secret");
  assert.equal(rival.isFogged(t.idx(6, 6)), true, "the mist itself is in plain sight");
  t.close();
});

test("under the storm's grey a bot can't tell whose stone is whose, its own included", () => {
  const t = table();
  t.put(2, 2, stoneCode(1, "base"));
  t.put(2, 3, stoneCode(2, "base"));
  t.state.storm.until = t.state.turnCount + 4;
  const v = t.view(1);
  assert.equal(v.board[t.idx(2, 2)], GREY_STONE);
  assert.equal(v.board[t.idx(2, 3)], GREY_STONE);
  t.state.storm.until = t.state.turnCount;
  assert.equal(t.view(1).board[t.idx(2, 2)], stoneCode(1, "base"), "colours back once it clears");
  t.close();
});

test("a bot plays on through a storm's grey instead of stalling", () => {
  const t = table();
  for (const p of t.state.players) p.bot = true;
  t.state.players[0].bot = false; // one human left, or the room closes itself
  for (let x = 0; x < 6; x++) t.put(x, 0, stoneCode(1 + (x % 2), "base"));
  t.state.storm.until = t.state.turnCount + 40;
  let guard = 0;
  while (t.state.players[t.state.turnIndex].bot && guard++ < 10) {
    const before = t.state.turnCount;
    t.room.runBotTurn();
    assert.equal(t.state.turnCount, before + 1, "the turn moved on");
  }
  assert.ok(t.state.passes < 3, "bots played stones, not passes");
  t.close();
});

// findings.md P3 item 2: the view's isWarded, lilyOwnerAt, isBurning, isFogged
// and hasSeed each walked the effects list on every call, and the bots call
// them per stone, per candidate.
test("a bot's view answers isWarded, lilyOwnerAt, isBurning, isFogged and hasSeed without scanning the effects", () => {
  const t = table();
  const { room, state } = t;
  const n = state.size * state.size;
  room.addEffect("ward", 2, 2, 1, 2);
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) room.addEffect("fog", 6 + dx, 6 + dy, 2, 1);
  room.addEffect("fire", 9, 9, 0, 1);
  room.addEffect("lily", 1, 10, 3, 2);
  room.addEffect("seed", 10, 1, 4, 3); // a seed: nobody's point yet
  room.addEffect("seed", 11, 11, 2, 2); // a sprout: its planter's
  room.addEffect("ward", 0, 0, 1, 0); // lapsed this turn: counts for nothing
  const expected = Array.from({ length: n }, (_, i) => [
    room.isWarded(i),
    room.reservedFor(i),
    room.isBurning(i),
    room.isFogged(i),
    room.effectAt("seed", i) !== undefined,
  ]);
  assert.ok(expected.some((e) => e[0]) && expected.some((e) => e[1] === 3) && expected.some((e) => e[1] === 2), "the board has wards, a lily and a sprout");
  assert.ok(expected.some((e) => e[2]) && expected.some((e) => e[3]) && expected.some((e) => e[4]), "and a fire, fog and seeds");
  assert.equal(expected[0][0], false, "the lapsed ward wards nothing");

  const view = t.view(1);
  const scan = mock.method(room, "effectAt");
  try {
    const got = Array.from({ length: n }, (_, i) => [view.isWarded(i), view.lilyOwnerAt(i), view.isBurning(i), view.isFogged!(i), view.hasSeed!(i)]);
    assert.deepEqual(got, expected, "the view's answers are the room's");
    assert.equal(scan.mock.callCount(), 0, "and none of them walked the effects");
  } finally {
    scan.mock.restore();
    t.close();
  }
});
