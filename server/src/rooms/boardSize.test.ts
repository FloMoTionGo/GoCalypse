import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { DATA_DIR, makeRoom, move, seatHumans } from "./room.testkit";
import { queueRestore } from "../state/persist";
import { pickStrikes } from "../rules/storm";

// 19x19 and 25x25 boards beside the 13x13 default (ideas.md §11.10): the room
// takes its size from the create options, a restored game keeps its own, and
// the storm's bolts scale with the board (D-Q8).

// rules/storm.ts stormStrikes, loaded per test so each fails on its own until it exists.
const stormStrikes = (size: number): number => require("../rules/storm").stormStrikes(size);

test("board size: a room made for 19x19 has 361 points and a 19-wide ko watch; 25x25 has 625", () => {
  const nineteen = makeRoom({ size: 19 });
  assert.equal(nineteen.state.size, 19);
  assert.equal(nineteen.state.board.length, 361);
  assert.equal(nineteen.kos.size, 19);
  const big = makeRoom({ size: 25 });
  assert.deepEqual([big.state.size, big.state.board.length, big.kos.size], [25, 625, 25]);
});

test("board size: anything but 13, 19 or 25 makes a 13x13 room", () => {
  for (const size of [7, 21, "19", -1, 1e9, null, undefined, 19.5]) {
    const room = makeRoom({ size });
    assert.deepEqual([room.state.size, room.state.board.length, room.kos.size], [13, 169, 13], String(size));
  }
});

test("board size: a 19x19 game restored from its snapshot is still 19x19", () => {
  const room = makeRoom({ size: 19 });
  const clients = seatHumans(room);
  move(room, clients, 17, 17);
  room.saveSnapshot();
  const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR!, "rooms", `${room.roomId}.json`), "utf8"));
  const back = makeRoom({ restoreToken: queueRestore(snap) });
  assert.deepEqual([back.state.size, back.state.board.length, back.kos.size], [19, 361, 19]);
  assert.equal(back.state.board[17 * 19 + 17], room.state.board[17 * 19 + 17]);
  assert.notEqual(back.state.board[17 * 19 + 17], 0);
});

test("storm: up to 3 bolts on 13x13, 6 on 19x19 and 11 on 25x25", () => {
  assert.deepEqual([13, 19, 25].map(stormStrikes), [3, 6, 11]);
  const all = Array.from({ length: 625 }, (_, i) => i);
  assert.equal(pickStrikes(all, () => 0.999, stormStrikes(25)).length, 11);
});

test("storm: a storm on 25x25 can bring more than 3 bolts down, and the state holds every one", () => {
  const room = makeRoom({ size: 25 });
  seatHumans(room);
  const random = Math.random;
  Math.random = () => 0.999; // a 20 on the die, then as many bolts as may fall
  try {
    room.state.storm.calm = 30;
    room.rollForStorm();
  } finally {
    Math.random = random;
  }
  const storm = room.state.storm;
  assert.equal(storm.strikes, 11);
  const bolts = Array.from(storm.bolts ?? []);
  assert.equal(bolts.length, 11);
  assert.deepEqual([storm.strike0, storm.strike1, storm.strike2], bolts.slice(0, 3), "the first three where older clients look");
  assert.equal(new Set(bolts).size, 11);
});
