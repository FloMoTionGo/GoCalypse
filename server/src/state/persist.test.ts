import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

// A folder of our own: ROOMS_DIR is read when persist.ts loads.
const DATA = path.join(os.tmpdir(), `gocalypse-persist-test-${process.pid}`);
process.env.DATA_DIR = DATA;

import { deleteSnapshot, loadSnapshots, queueRestore, restoreState, saveSnapshot, takeRestore } from "./persist";
import { BoardEffect, GoState, MarketItem, PlayerState } from "./GoState";

const ROOMS = path.join(DATA, "rooms");

test("a saved snapshot loads back as written, and leaves no temp file", () => {
  saveSnapshot("r1", JSON.stringify({ room: "go_custom", keys: { 1: "k" }, state: { size: 13 } }));
  const found = loadSnapshots().find((s) => s.roomId === "r1");
  assert.ok(found);
  assert.equal(found!.snapshot.room, "go_custom");
  assert.deepEqual(found!.snapshot.keys, { 1: "k" });
  assert.deepEqual(fs.readdirSync(ROOMS).filter((f) => f.endsWith(".tmp")), []);
});

test("saving again replaces the snapshot; deleting removes it, twice is harmless", () => {
  saveSnapshot("r2", JSON.stringify({ room: "a", keys: {}, state: {} }));
  saveSnapshot("r2", JSON.stringify({ room: "b", keys: {}, state: {} }));
  assert.equal(loadSnapshots().find((s) => s.roomId === "r2")!.snapshot.room, "b");
  deleteSnapshot("r2");
  deleteSnapshot("r2");
  assert.equal(loadSnapshots().find((s) => s.roomId === "r2"), undefined);
});

test("an unreadable snapshot is skipped, and other files are ignored", () => {
  fs.mkdirSync(ROOMS, { recursive: true });
  fs.writeFileSync(path.join(ROOMS, "broken.json"), "{ not json");
  fs.writeFileSync(path.join(ROOMS, "notes.txt"), "hello");
  const error = console.error;
  console.error = () => {};
  try {
    const ids = loadSnapshots().map((s) => s.roomId);
    assert.ok(!ids.includes("broken"));
    assert.ok(!ids.includes("notes"));
  } finally {
    console.error = error;
    fs.rmSync(path.join(ROOMS, "broken.json"));
  }
});

test("a restore token works once, and only a string from queueRestore is one", () => {
  const snap = { room: "go_custom", keys: {}, state: {} };
  const token = queueRestore(snap);
  assert.equal(takeRestore(token), snap);
  assert.equal(takeRestore(token), undefined);
  assert.equal(takeRestore(undefined), undefined);
  assert.equal(takeRestore({ token } as unknown), undefined);
  assert.equal(takeRestore("guessed"), undefined);
});

test("restoreState rebuilds players, market, effects and nested state from toJSON", () => {
  const state = new GoState();
  state.turnCount = 17;
  state.storm.seq = 2;
  for (let i = 0; i < 4; i++) state.board.push(i);
  const p = new PlayerState();
  p.name = "Ann";
  p.color = 3;
  p.powerups.push("stone_card", "mist");
  state.players.push(p);
  const m = new MarketItem();
  m.id = "mist";
  m.left = 2;
  state.market.push(m);
  const e = new BoardEffect();
  e.kind = "ward";
  e.x = 4;
  state.effects.push(e);

  const copy = new GoState();
  restoreState(copy, JSON.parse(JSON.stringify(state.toJSON())));
  assert.deepEqual(copy.toJSON(), state.toJSON());
});
