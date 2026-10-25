// Haiku points over real sockets (ideas.md §11.11): every client sees the nine
// points; a stone on one collects its line for its player, every client sees
// the point taken, and the haiku's card comes to that player's hand.
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

const me = (r) => Array.from(r.state.players).find((p) => p.sessionId === r.sessionId);

test("haiku over the wire: a stone on a haiku point collects the line, for every client to see", async () => {
  const rooms = [await new Client(server.ws).create("go_custom", { name: "A" })];
  for (const name of ["B", "C", "D"]) rooms.push(await new Client(server.ws).joinById(rooms[0].roomId, { name }));
  open.push(...rooms);
  await until(() => rooms.every((r) => r.state.status === "playing" && r.state.haiku?.length === 9), 5000, "the game with its haiku");
  const r = rooms.find((x) => x.state.players[x.state.turnIndex]?.sessionId === x.sessionId);
  const p = r.state.haiku[0];
  const [x, y, id] = [p.x, p.y, p.haiku];
  r.send("move", { x, y, axis: "base" });
  const color = me(r).color;
  await until(() => rooms.every((c) => Array.from(c.state.haiku).find((h) => h.x === x && h.y === y).by === color), 5000, "the line taken for everyone");
  await until(() => Array.from(me(r).powerups).includes(`haiku_${id}`), 5000, "the card in my hand");
  assert.ok(Array.from(me(r).haikuLines).some((n) => n === 1));
  for (const c of rooms) assert.match(c.state.lastEvent, /haiku|月|川|木/);
});
