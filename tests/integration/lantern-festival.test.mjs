// The Lantern Festival over the wire (tasks/2026-11-08_lantern_card/PLAN.md): one player's
// card reaches every client at the table, and no more often than it should.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, startServer, until, wait } from "../lib/harness.mjs";

const { Client } = colyseus();
let server;
const open = [];

before(async () => {
  server = await startServer();
});
after(async () => {
  for (const r of open) await leaveQuietly(r);
  await server?.stop();
});

/** Four real clients at a fresh table, each recording the festivals it is sent. */
async function table(tag) {
  const stamp = `${tag}-${Date.now()}`;
  const host = await new Client(server.ws).create("go_debug", { name: "A", playerKey: `${stamp}-a` });
  const rooms = [host];
  for (const n of "BCD") rooms.push(await new Client(server.ws).joinById(host.roomId, { name: n, playerKey: `${stamp}-${n}` }));
  open.push(...rooms);
  const got = rooms.map(() => []);
  rooms.forEach((r, i) => r.onMessage("lanternFestival", (m) => got[i].push(m)));
  const me = (r) => Array.from(r.state.players).find((p) => p.sessionId === r.sessionId);
  await until(() => rooms.every((r) => r.state.status === "playing" && me(r)), 5000, "the game to start");
  return { rooms, got, me };
}

test("lantern festival over the wire: all four clients at a table receive it, with who lit it", async () => {
  const { rooms, got, me } = await table("all");
  const finder = rooms[2], p = me(finder);
  finder.send("lanternFestival");
  await until(() => got.every((list) => list.length === 1), 3000, "every client to hear of it");
  for (const list of got) assert.deepEqual(list, [{ by: p.color, name: p.name }]);
});

test("lantern festival over the wire: a flood of messages from one seat makes one festival", async () => {
  const { rooms, got } = await table("flood");
  for (let i = 0; i < 25; i++) rooms[0].send("lanternFestival");
  await until(() => got[1].length >= 1, 3000, "the festival");
  await wait(400);
  for (const list of got) assert.equal(list.length, 1);
});
