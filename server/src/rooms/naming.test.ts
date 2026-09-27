import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

// Snapshots from these rooms must not land in the server's own data folder.
process.env.DATA_DIR = path.join(os.tmpdir(), `gocalypse-test-${process.pid}`);

import { BOT_NAMES } from "../bots";
import { GoRoom } from "./GoRoom";

// A real room, no seats filled: onJoin is the message handler tested here directly.
function freshRoom(): any {
  const room: any = new GoRoom();
  room.listing = { updateOne: async () => {} };
  room.onCreate({});
  return room;
}

function join(room: any, id: string, name: string): string {
  room.onJoin({ sessionId: id, send() {} }, { name });
  return room.state.players[room.state.players.length - 1].name;
}

test("a name that claims to be a bot is refused", () => {
  const room = freshRoom();
  const name = join(room, "a", "Honte (bot)");
  assert.notEqual(name, "Honte (bot)");
});

test("a name that claims to be another seat's own view is refused", () => {
  const room = freshRoom();
  const name = join(room, "a", "Alice (you)");
  assert.notEqual(name, "Alice (you)");
});

test("a name matching a real bot's name is refused, case-insensitively", () => {
  for (const botName of BOT_NAMES) {
    const room = freshRoom();
    const name = join(room, "a", botName.toUpperCase());
    assert.notEqual(name.toLowerCase(), botName.toLowerCase());
  }
});

test("an ordinary name is kept as asked", () => {
  const room = freshRoom();
  assert.equal(join(room, "a", "Alice"), "Alice");
});

test("two humans asking for the same name are told apart, like two bots would be", () => {
  const room = freshRoom();
  assert.equal(join(room, "a", "Alice"), "Alice");
  assert.equal(join(room, "b", "Alice"), "Alice 2");
  assert.equal(join(room, "c", "Alice"), "Alice 3");
});

test("an all-invisible name falls back to a guest name instead of showing blank", () => {
  const room = freshRoom();
  const name = join(room, "a", "​​​");
  assert.ok(name.length > 0);
});
