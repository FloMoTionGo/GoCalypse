// 19x19 and 25x25 tables over real sockets (ideas.md §11.10): Quick join only
// finds a waiting table of the size asked for, and a table is the size it was made.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, startServer, until } from "../lib/harness.mjs";

const { Client } = colyseus();
let server;
const open = [];
before(async () => (server = await startServer()));
after(async () => {
  for (const r of open) await leaveQuietly(r);
  await server?.stop();
});

const join = async (options) => {
  const room = await new Client(server.ws).joinOrCreate("go_custom", options);
  open.push(room);
  await until(() => room.state.size > 0, 5000, "the first state");
  return room;
};

test("sizes over the wire: a 19x19 join doesn't sit down at a waiting 13x13 table, and a 13x13 one does", async () => {
  const small = await join({ name: "Thirteen", size: 13 });
  const big = await join({ name: "Nineteen", size: 19 });
  assert.notEqual(big.roomId, small.roomId, "a table of its own size");
  assert.equal(big.state.size, 19);
  assert.equal(big.state.seen.length, 361);
  const again = await join({ name: "Another13", size: 13 });
  assert.equal(again.roomId, small.roomId, "the waiting 13x13 table");
  assert.equal(small.state.size, 13);
});

test("sizes over the wire: a 25x25 table is made for a 25x25 join", async () => {
  const room = await join({ name: "TwentyFive", size: 25 });
  assert.equal(room.state.size, 25);
  assert.equal(room.state.seen.length, 625);
});
