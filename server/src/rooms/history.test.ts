import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { DATA_DIR, makeRoom, move, onTurn, passAround, playerOf, seatHumans, startedRoom } from "./room.testkit";
import { queueRestore } from "../state/persist";
import { recorderModule, storeModule } from "../history/history.testkit";

// Every game a room plays is saved for replays (history/): when, what, and
// never before it is over.

/** What is on disk for this room's game, read fresh: no cache shared with the room. */
function saved(room: any) {
  const { HistoryStore, historyDir } = storeModule();
  return new HistoryStore(historyDir()).get(room.recorder.id);
}

function snapshotOf(room: any) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR!, "rooms", `${room.roomId}.json`), "utf8"));
}

test("history room: a game played to the end is saved once, as finished, with every seat's place", () => {
  const { room, clients } = startedRoom();
  move(room, clients, 6, 6);
  passAround(room, clients, 4);
  assert.equal(room.state.status, "finished");
  const record = saved(room);
  assert.ok(record, "the game is in the store");
  assert.equal(record.outcome, "finished");
  assert.equal(record.room, "go_custom");
  assert.equal(record.size, 13);
  assert.equal(record.players.length, 4);
  assert.ok(record.players.every((p: any) => p.place >= 1));
  assert.deepEqual(record.players.map((p: any) => p.color), [1, 2, 3, 4]);
  assert.ok(record.endedAt >= record.startedAt);
  assert.equal(record.turns, room.state.turnCount);
  assert.equal(record.territory.base.length, 169);
});

test("history room: the saved frames play the game back, from the empty board to Game over", () => {
  const { boardAt } = recorderModule();
  const { room, clients } = startedRoom();
  const first = move(room, clients, 6, 6);
  const color = playerOf(room, first).color;
  move(room, clients, 2, 3, "pattern");
  passAround(room, clients, 4);
  const record = saved(room);
  assert.ok(boardAt(record, 0).every((c: number) => c === 0), "frame 0 is the empty board");
  const stoneFrame = record.frames.findIndex((f: any) => f.a && f.a[2] === 6 && f.a[3] === 6);
  assert.ok(stoneFrame > 0, "a frame for the first stone");
  assert.equal(boardAt(record, stoneFrame)[6 * 13 + 6], color);
  assert.match(record.frames[stoneFrame].e, /played \(6, 6\)/);
  assert.equal(record.frames.filter((f: any) => /passed/.test(f.e)).length, 3, "the three passes before the last");
  assert.match(record.frames[record.frames.length - 1].e, /^Game over/);
  assert.deepEqual(boardAt(record, record.frames.length - 1), room.state.board.toArray());
});

test("history room: the second stone of Stepping Stones gets a frame of its own", () => {
  const { room, clients } = startedRoom();
  playerOf(room, onTurn(room, clients)).extra = 1;
  move(room, clients, 1, 1);
  move(room, clients, 1, 2);
  passAround(room, clients, 4);
  const frames = saved(room).frames.filter((f: any) => f.a && f.a[0] === "move");
  assert.deepEqual(frames.map((f: any) => [f.a[2], f.a[3]]), [[1, 1], [1, 2]]);
});

test("history room: a game under way is not in the store, nor in its list", () => {
  const { room, clients } = startedRoom();
  move(room, clients, 4, 4);
  const { HistoryStore, historyDir } = storeModule();
  const store = new HistoryStore(historyDir());
  assert.equal(store.get(room.recorder.id), undefined);
  assert.ok(!store.list({ limit: 200 }).games.some((g: any) => g.id === room.recorder.id));
  room.onDispose();
});

test("history room: a game closed mid-way is saved as abandoned", () => {
  const { room, clients } = startedRoom();
  move(room, clients, 4, 4);
  room.onDispose();
  const record = saved(room);
  assert.ok(record);
  assert.equal(record.outcome, "abandoned");
  assert.ok(record.frames.some((f: any) => f.a && f.a[2] === 4 && f.a[3] === 4));
});

test("history room: a game closed before its first turn, or a lobby, is not saved", () => {
  const { room } = startedRoom();
  room.onDispose();
  assert.equal(saved(room), undefined);
  const lobby = makeRoom();
  seatHumans(lobby, ["a", "b"]);
  lobby.onDispose();
  assert.equal(lobby.recorder, undefined, "no record before the game starts");
});

test("history room: a server shutdown saves nothing yet; the restored room carries on the same record", () => {
  const { room, clients } = startedRoom();
  move(room, clients, 3, 3);
  room.onBeforeShutdown();
  room.onDispose();
  assert.equal(saved(room), undefined, "a shutdown is not the end of the game");
  const restored = makeRoom({ restoreToken: queueRestore(snapshotOf(room)) });
  assert.equal(restored.recorder.id, room.recorder.id);
  for (let i = 0; i < 4; i++) restored.applyPass(restored.state.turnIndex);
  assert.equal(restored.state.status, "finished");
  const record = saved(restored);
  assert.ok(record.frames.some((f: any) => f.a && f.a[2] === 3 && f.a[3] === 3), "the move from before the restart");
  assert.equal(record.startedAt, room.recorder.startedAt);
  restored.onDispose();
});

test("history room: the record holds no player's secret key or session id", () => {
  const room = makeRoom();
  const clients = seatHumans(room, ["a", "b", "c", "d"], { a: "secret-key-a", b: "secret-key-b", c: "secret-key-c", d: "secret-key-d" });
  move(room, clients, 0, 0);
  passAround(room, clients, 4);
  const text = JSON.stringify(saved(room));
  assert.doesNotMatch(text, /secret-key/);
  assert.doesNotMatch(text, /sessionId/);
});

test("history room: a debug room's game is saved and tagged go_debug", () => {
  const { room, clients } = startedRoom({ debug: true });
  passAround(room, clients, 4);
  assert.equal(saved(room).room, "go_debug");
});

test("history room: with HISTORY=off nothing is recorded or saved", () => {
  process.env.HISTORY = "off";
  try {
    const { room, clients } = startedRoom();
    move(room, clients, 5, 5);
    passAround(room, clients, 4);
    assert.equal(room.recorder, undefined);
  } finally {
    delete process.env.HISTORY;
  }
  const { room, clients } = startedRoom();
  passAround(room, clients, 4);
  assert.ok(saved(room), "on again by default");
});
