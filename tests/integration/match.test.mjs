// Whole matches over real sockets (was findings-tests/server-e2e.mjs and
// server-names.mjs): seats, drops and returns, races, names and the end of a game.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, startServer, until, wait } from "../lib/harness.mjs";

const { Client } = colyseus();
let server;
const open = [];
before(async () => (server = await startServer()));
after(async () => {
  for (const r of open) await leaveQuietly(r);
  await server?.stop();
});

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const me = (r) => Array.from(r.state.players).find((p) => p.sessionId === r.sessionId);

async function table(room, names = ["A", "B", "C", "D"], keys = names.map((n) => `${n}-${stamp()}`)) {
  const rooms = [await new Client(server.ws).create(room, { name: names[0], playerKey: keys[0] })];
  for (let i = 1; i < names.length; i++) rooms.push(await new Client(server.ws).joinById(rooms[0].roomId, { name: names[i], playerKey: keys[i] }));
  open.push(...rooms);
  await until(() => rooms.every((r) => r.state.players?.length === names.length), 5000, "every client to see every seat");
  return { rooms, keys };
}

test("four humans at a table start the game, colors 1-4, all connected", async () => {
  const { rooms } = await table("go_custom");
  await until(() => rooms[0].state.status === "playing", 5000, "the game to start");
  const colors = Array.from(rooms[0].state.players).map((p) => p.color).sort();
  assert.deepEqual(colors, [1, 2, 3, 4]);
  assert.ok(Array.from(rooms[0].state.players).every((p) => p.connected && !p.bot));
});

test("B1: a dropped player comes back through /rejoin to the same seat, still human", async () => {
  const { rooms, keys } = await table("go_debug");
  await until(() => rooms[0].state.status === "playing", 5000, "the game to start");
  const colorBefore = me(rooms[3]).color;
  rooms[3].connection.close(3000); // an unexpected drop, not a consented leave
  await wait(400);
  const res = await fetch(`${server.http}/rejoin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerKey: keys[3] }) });
  assert.equal(res.status, 200, "/rejoin during the grace window");
  const back = await new Client(server.ws).consumeSeatReservation(await res.json());
  open.push(back);
  await until(() => me(back), 5000, "my seat in the state");
  assert.equal(back.roomId, rooms[0].roomId);
  assert.equal(me(back).color, colorBefore);
  assert.equal(me(back).bot, false);
  await until(() => me(back).connected, 5000, "the seat to show connected");
  assert.equal(back.state.players.length, 4);
});

test("B3: two players racing for the last seat: exactly one gets it", async () => {
  const host = await new Client(server.ws).create("go_debug", { name: "H", playerKey: `host-${stamp()}` });
  open.push(host);
  host.send("addBots", { ids: ["pure", "balanced"] });
  await until(() => host.state.players.length === 3, 5000, "two bots to sit down");
  const results = await Promise.allSettled([1, 2].map((i) => new Client(server.ws).joinById(host.roomId, { name: `R${i}`, playerKey: `race-${i}-${stamp()}` })));
  for (const r of results) if (r.value) open.push(r.value);
  await wait(400);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const colors = Array.from(host.state.players).map((p) => p.color).sort();
  assert.deepEqual(colors, [1, 2, 3, 4]);
});

test("B22: names that fake a bot or a (you) tag, hide characters or twin another are not given as asked", async () => {
  const asks = ["Honte (bot)", "Alice (you)", "Al​i‮ce", "Al​i‮ce"];
  const { rooms } = await table("go_custom", asks);
  const names = rooms.map((r) => me(r).name);
  assert.ok(!/\((bot|you)\)\s*$/i.test(names[0]) && names[0] !== "Honte", names[0]);
  assert.ok(!/\((bot|you)\)\s*$/i.test(names[1]), names[1]);
  assert.equal(names[2], "Alice");
  assert.equal(names[3], "Alice 2");
});

test("a played-out match: a move, four passes, and the scores for everyone to see", async () => {
  const { rooms } = await table("go_custom");
  await until(() => rooms[0].state.status === "playing", 5000, "the game to start");
  const onTurn = () => rooms.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);
  const first = onTurn();
  first.send("move", { x: 6, y: 6, axis: "base" });
  await until(() => rooms[0].state.turnCount === 1, 5000, "the move to land");
  assert.equal(rooms[1].state.seen[6 * 13 + 6], me(first).color, "every client sees the stone");
  for (let i = 0; i < 4; i++) {
    const r = onTurn();
    const before = rooms[0].state.turnCount;
    r.send("pass");
    await until(() => rooms[0].state.turnCount > before || rooms[0].state.status === "finished", 5000, `pass ${i + 1}`);
  }
  await until(() => rooms.every((r) => r.state.status === "finished"), 5000, "the game to finish");
  const players = Array.from(rooms[2].state.players);
  assert.ok(players.every((p) => typeof p.fireflies === "number"), "everyone's fireflies are shown at the end");
  assert.ok(players.some((p) => p.place === 1));
  assert.match(rooms[0].state.lastEvent, /^Game over/);
});

test("a refused move is answered with a notice to that client only", async () => {
  const { rooms } = await table("go_custom");
  await until(() => rooms[0].state.status === "playing", 5000, "the game to start");
  const onTurn = rooms.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);
  const heard = new Map(rooms.map((r) => [r, []]));
  for (const r of rooms) r.onMessage("notice", (text) => heard.get(r).push(text));
  onTurn.send("move", { x: 0, y: 0, axis: "base" });
  await until(() => rooms[0].state.turnCount === 1, 5000, "the first move");
  const next = rooms.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);
  next.send("buy", { id: rooms[0].state.market[0].id }); // the market opens after 5 moves
  await until(() => heard.get(next).length > 0, 5000, "the notice");
  assert.match(heard.get(next)[0], /Night Market opens after 5 moves/);
  assert.ok(rooms.filter((r) => r !== next).every((r) => heard.get(r).length === 0));
});
