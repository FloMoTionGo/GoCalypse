// A game outlives a server restart (was findings-tests/server-restore-b5.mjs and
// -b11.mjs, which needed a hand restart): the server is killed mid-game and
// started again on the same data folder, and the player comes back.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { colyseus, leaveQuietly, startServer, tempDir, until, wait } from "../lib/harness.mjs";

const { Client } = colyseus();
const NAMES = { pure: "Honte", items: "Tenuki", shark: "Ko" }; // recruit id -> seated name (bots/styles.ts)
const dataDir = tempDir("restart");
const key = `restart-${Date.now()}`;
let server, beforeSnap, back;

const snapshotFor = (k) => {
  const dir = path.join(dataDir, "rooms");
  if (!fs.existsSync(dir)) return null;
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const snap = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    if (Object.values(snap.keys).includes(k)) return snap;
  }
  return null;
};
const me = (r) => Array.from(r.state.players).find((p) => p.sessionId === r.sessionId);

before(async () => {
  server = await startServer({ dataDir });
  const r = await new Client(server.ws).create("go_debug", { name: "Back", playerKey: key });
  r.send("addBots", { ids: ["pure", "items", "shark"] });
  await until(() => r.state.status === "playing" && r.state.players[r.state.turnIndex]?.sessionId === r.sessionId, 15000, "my turn");
  const i = Array.from(r.state.seen).findIndex((c) => !c);
  r.send("move", { x: i % r.state.size, y: (i / r.state.size) | 0, axis: "base" });
  await until(() => snapshotFor(key)?.state.turnCount >= 1, 10000, "a snapshot after my move");
  beforeSnap = snapshotFor(key);
  await server.stop(); // killed, as a crash or a machine stop would
  server = await startServer({ dataDir });
});
after(async () => {
  if (back) await leaveQuietly(back);
  await server?.stop();
});

test("restart: the snapshot holds the seated bots, the positions and the kos", () => {
  const bots = beforeSnap.state.players.filter((p) => p.bot);
  assert.equal(bots.length, 3);
  for (const p of bots) assert.equal(NAMES[beforeSnap.bots[p.color]], p.name, `seat ${p.color}`);
  assert.ok(beforeSnap.positions.length >= 2);
  assert.ok(Array.isArray(beforeSnap.kos));
});

test("restart: /rejoin hands the seat back in the restored game, still human", async () => {
  const res = await fetch(`${server.http}/rejoin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerKey: key }) });
  assert.equal(res.status, 200);
  back = await new Client(server.ws).consumeSeatReservation(await res.json());
  await until(() => me(back), 5000, "my seat");
  assert.equal(back.state.status, "playing");
  assert.equal(me(back).bot, false);
  assert.ok(back.state.turnCount >= beforeSnap.state.turnCount);
});

test("restart (B5): the restored room still hides the true board and the bots' purses", async () => {
  await until(() => back, 5000, "the rejoin above");
  assert.ok(!back.state.board || back.state.board.length === 0);
  assert.equal(back.state.seen.length, back.state.size ** 2);
  assert.ok(back.state.seen.filter(Boolean).length > 0, "seen is rebuilt");
  assert.equal(typeof me(back).fireflies, "number");
  assert.ok(Array.from(back.state.players).filter((p) => p !== me(back)).every((p) => p.fireflies === undefined));
});

test("restart (B11): the same bot on every seat, the positions and the held kos kept", async () => {
  await wait(2500); // the bots play on and the restored room saves again
  const after = snapshotFor(key);
  assert.ok(after, "the restored room saves its own snapshot");
  assert.deepEqual(after.bots, beforeSnap.bots);
  assert.ok(beforeSnap.positions.every((k) => after.positions.includes(k)));
  const held = beforeSnap.kos.filter((ko) => ko.until > after.state.turnCount);
  assert.ok(held.every((ko) => after.kos.some((k) => JSON.stringify(k) === JSON.stringify(ko))));
});
