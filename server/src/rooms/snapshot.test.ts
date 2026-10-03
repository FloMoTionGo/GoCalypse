import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { DATA_DIR, makeRoom, move, passAround, seatHumans, startedRoom } from "./room.testkit";
import { queueRestore, Snapshot } from "../state/persist";

// A game outlives a server restart (state/persist.ts): what the room writes,
// when, and what a room rebuilt from it looks like.

const fileOf = (room: any) => path.join(DATA_DIR!, "rooms", `${room.roomId}.json`);
const read = (room: any): Snapshot => JSON.parse(fs.readFileSync(fileOf(room), "utf8"));

test("a waiting table is not saved; a game under way is, with seats' secrets, bots, positions and kos", () => {
  const room = makeRoom();
  const [a] = seatHumans(room, ["a"], { a: "key-a" });
  room.saveSnapshot();
  assert.equal(fs.existsSync(fileOf(room)), false);
  room.handleAddBots(a, { ids: ["pure", "items", "shark"] });
  room.saveSnapshot();
  const snap = read(room);
  assert.equal(snap.room, "go_custom");
  assert.deepEqual(Object.values(snap.keys), ["key-a"]);
  assert.deepEqual(Object.values(snap.bots!).sort(), ["items", "pure", "shark"]);
  assert.ok(Array.isArray(snap.positions) && snap.positions.length >= 1);
  assert.ok(Array.isArray(snap.kos));
  assert.equal(snap.state.status, "playing");
});

test("an unchanged game is not written again", () => {
  const { room } = startedRoom();
  room.saveSnapshot();
  fs.utimesSync(fileOf(room), new Date(0), new Date(0));
  room.saveSnapshot();
  assert.equal(fs.statSync(fileOf(room)).mtimeMs, 0);
});

test("a finished game, or a disposed room, leaves no snapshot behind", () => {
  const { room, clients } = startedRoom();
  room.saveSnapshot();
  passAround(room, clients, 4);
  room.saveSnapshot();
  assert.equal(fs.existsSync(fileOf(room)), false);
  const other = startedRoom().room;
  other.saveSnapshot();
  other.onDispose();
  assert.equal(fs.existsSync(fileOf(other)), false);
});

test("a shutdown keeps the last snapshot for the restart", () => {
  const { room } = startedRoom();
  room.onBeforeShutdown();
  room.onDispose();
  assert.ok(fs.existsSync(fileOf(room)));
});

test("a room restored from a snapshot is the same game, waiting for its humans to come back", () => {
  const { room, clients } = startedRoom();
  room.seatKeys.set(room.state.players[0].color, "restore-key");
  move(room, clients, 3, 3);
  move(room, clients, 4, 4);
  room.saveSnapshot();
  const snap = read(room);

  const back = makeRoom({ restoreToken: queueRestore(snap) });
  assert.deepEqual(Array.from(back.state.board), Array.from(room.state.board));
  assert.equal(back.state.turnCount, 2);
  assert.equal(back.state.turnIndex, room.state.turnIndex);
  assert.deepEqual(back.state.market.map((m: any) => m.id), room.state.market.map((m: any) => m.id));
  assert.ok(back.state.players.every((p: any) => !p.connected), "nobody is connected yet");
  assert.equal(back.autoDispose, false, "the room waits for its players");
  assert.equal(back.seatFor("restore-key"), back.state.players[0]);
  assert.deepEqual(Array.from(back.state.seen), Array.from(back.state.board), "seen is rebuilt");
});

test("a restored room seats the same bots it saved", () => {
  const room = makeRoom();
  const [a] = seatHumans(room, ["a"]);
  room.handleAddBots(a, { ids: ["pure", "items", "shark"] });
  room.saveSnapshot();
  const back = makeRoom({ restoreToken: queueRestore(read(room)) });
  assert.deepEqual(Object.fromEntries(back.botIds), Object.fromEntries(room.botIds));
});

test("a made-up restore token gives a fresh room", () => {
  const room = makeRoom({ restoreToken: "not-a-token" });
  assert.equal(room.state.status, "waiting");
  assert.equal(room.state.players.length, 0);
});
