import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRoom, seatHumans } from "./room.testkit";

// /rejoin finds a returning player's room by its key (GoRoom.findRoomForKey):
// an index the rooms keep, not a scan of every live room per request
// (tasks/security_fixes T7). The index's size is read at run time, so these
// show red on their own until it exists.
function goRoom(): any {
  return require("./GoRoom");
}

test("a key maps to its room until the room is disposed", () => {
  const { findRoomForKey, keysIndexed } = goRoom();
  const room = makeRoom();
  seatHumans(room, ["a", "b", "c", "d"], { a: "key-a", b: "key-b", c: "key-c", d: "key-d" });
  assert.equal(room.state.status, "playing");
  assert.equal(findRoomForKey("key-c"), room);
  assert.equal(keysIndexed(), 4);
  room.onDispose();
  assert.equal(keysIndexed(), 0, "a disposed room's keys are forgotten");
  assert.equal(findRoomForKey("key-c"), undefined);
});

test("a player who leaves a waiting table takes their key out of the index", async () => {
  const { keysIndexed } = goRoom();
  const room = makeRoom();
  const [first] = seatHumans(room, ["a", "b"], { a: "key-a", b: "key-b" });
  assert.equal(keysIndexed(), 2);
  await room.onLeave(first, true);
  assert.equal(keysIndexed(), 1);
  room.onDispose();
  assert.equal(keysIndexed(), 0);
});
