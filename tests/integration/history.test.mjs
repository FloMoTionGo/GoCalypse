// Game history over HTTP (server/src/history/): GET /history and
// GET /history/:id against a real server, with games played over WebSockets
// and games seeded into its data folder.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { colyseus, leaveQuietly, startServer, tempDir, until } from "../lib/harness.mjs";
import { at, boardAfter, fixtureGames, seedHistory } from "../lib/historyFixtures.mjs";

const { Client } = colyseus();
let server; // played games
let seeded; // the fixture games only
const open = [];
before(async () => {
  server = await startServer();
  const dataDir = tempDir("history-seeded");
  seedHistory(dataDir);
  seeded = await startServer({ dataDir });
});
after(async () => {
  for (const r of open) await leaveQuietly(r);
  await server?.stop();
  await seeded?.stop();
});

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const getJson = async (base, url) => {
  const res = await fetch(`${base.http}${url}`);
  return { status: res.status, headers: res.headers, body: res.headers.get("content-type")?.includes("json") ? await res.json() : await res.text() };
};

async function table(names = ["A", "B", "C", "D"], srv = server) {
  const rooms = [await new Client(srv.ws).create("go_custom", { name: names[0], playerKey: `${names[0]}-${stamp()}` })];
  for (let i = 1; i < names.length; i++) rooms.push(await new Client(srv.ws).joinById(rooms[0].roomId, { name: names[i], playerKey: `${names[i]}-${stamp()}` }));
  open.push(...rooms);
  await until(() => rooms[0].state.status === "playing", 5000, "the game to start");
  return rooms;
}

const onTurn = (rooms) => rooms.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);

async function passOut(rooms) {
  for (let i = 0; i < 4; i++) {
    const before = rooms[0].state.turnCount;
    onTurn(rooms).send("pass");
    await until(() => rooms[0].state.turnCount > before || rooms[0].state.status === "finished", 5000, `pass ${i + 1}`);
  }
  await until(() => rooms[0].state.status === "finished", 5000, "the game to finish");
}

test("history http: a fresh server lists no games", async () => {
  const fresh = await startServer();
  try {
    const { status, body } = await getJson(fresh, "/history");
    assert.equal(status, 200);
    assert.deepEqual(body, { games: [], total: 0 });
  } finally {
    await fresh.stop();
  }
});

test("history http: a played-out match is listed with its players and served whole by its id", async () => {
  const rooms = await table(["Ann", "Ben", "Cid", "Dee"]);
  const first = onTurn(rooms);
  first.send("move", { x: 6, y: 6, axis: "base" });
  await until(() => rooms[0].state.turnCount === 1, 5000, "the move to land");
  await passOut(rooms);
  const list = await until(async () => {
    const r = await getJson(server, "/history");
    return r.body.games?.length ? r : null;
  }, 5000, "the game in the list");
  assert.equal(list.status, 200);
  const game = list.body.games[0];
  assert.deepEqual(game.players.map((p) => p.name).sort(), ["Ann", "Ben", "Cid", "Dee"]);
  assert.equal(game.outcome, "finished");
  assert.equal(game.frames, undefined, "the list holds no frames");
  assert.ok(game.endedAt <= Date.now() && game.endedAt >= game.startedAt);

  const { status, body } = await getJson(server, `/history/${game.id}`);
  assert.equal(status, 200);
  assert.equal(body.id, game.id);
  const color = Array.from(rooms[0].state.players).find((p) => p.sessionId === first.sessionId).color;
  const i = body.frames.findIndex((f) => f.a && f.a[2] === 6 && f.a[3] === 6);
  assert.ok(i > 0);
  assert.equal(boardAfter(body, i)[6 * 13 + 6], color, "the replayed board holds the stone");
});

test("history http: a game under way is neither listed nor served", async () => {
  const before = (await getJson(server, "/history")).body.total;
  const rooms = await table(["Eve", "Fay", "Gus", "Hal"]);
  onTurn(rooms).send("move", { x: 2, y: 2, axis: "base" });
  await until(() => rooms[0].state.turnCount === 1, 5000, "the move to land");
  const snapFile = path.join(server.dataDir, "rooms", `${rooms[0].roomId}.json`);
  const snap = await until(() => {
    try {
      const s = JSON.parse(fs.readFileSync(snapFile, "utf8"));
      return s.history?.id ? s : null;
    } catch {
      return null;
    }
  }, 5000, "the snapshot with the game's record");
  assert.equal((await getJson(server, "/history")).body.total, before);
  assert.equal((await getJson(server, `/history/${snap.history.id}`)).status, 404);
});

test("history http: from and to keep the games that ended in that window, newest first", async () => {
  const ids = async (q) => (await getJson(seeded, `/history${q}`)).body.games.map((g) => g.id);
  assert.deepEqual(await ids(""), ["fx-game-oct01", "fx-game-sep15", "fx-game-sep01"]);
  assert.deepEqual(await ids(`?from=${at(2026, 9, 2, 0)}&to=${at(2026, 10, 1, 0)}`), ["fx-game-sep15"]);
  assert.deepEqual(await ids(`?from=${at(2026, 9, 15, 0)}`), ["fx-game-oct01", "fx-game-sep15"]);
  assert.deepEqual(await ids(`?to=${at(2026, 9, 2, 0)}`), ["fx-game-sep01"]);
  assert.deepEqual(await ids(`?limit=1`), ["fx-game-oct01"]);
  assert.equal((await getJson(seeded, "/history?limit=1")).body.total, 3);
});

test("history http: a seeded game is served exactly as it was saved", async () => {
  const { status, body } = await getJson(seeded, "/history/fx-game-sep01");
  assert.equal(status, 200);
  assert.deepEqual(body, fixtureGames()[0]);
});

test("history http: a malformed query is a 400; an unknown or malformed id is a 404", async () => {
  for (const q of ["?from=yesterday", "?limit=lots", "?to=-1", "?from=2000&to=1000"]) {
    const r = await getJson(seeded, `/history${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(typeof r.body.error, "string", q);
  }
  for (const id of ["nope-nope-nope", "..%2F..%2Fpackage", "..%5Crooms", "x"]) {
    assert.equal((await getJson(seeded, `/history/${id}`)).status, 404, id);
  }
});

test("history http: GET /history answers any origin (the web client is served elsewhere)", async () => {
  const res = await fetch(`${seeded.http}/history`, { headers: { Origin: "https://flomotiongo.github.io" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("history http: saved games outlive a restart, and a game the restart cut into keeps its earlier moves", async () => {
  const dataDir = tempDir("history-restart");
  let srv = await startServer({ dataDir });
  try {
    const keys = ["K1", "K2", "K3", "K4"].map((n) => `${n}-${stamp()}`);
    const rooms = [await new Client(srv.ws).create("go_custom", { name: "R1", playerKey: keys[0] })];
    for (let i = 1; i < 4; i++) rooms.push(await new Client(srv.ws).joinById(rooms[0].roomId, { name: `R${i + 1}`, playerKey: keys[i] }));
    await until(() => rooms[0].state.status === "playing", 5000, "the game to start");
    onTurn(rooms).send("move", { x: 9, y: 9, axis: "base" });
    await until(() => rooms[0].state.turnCount === 1, 5000, "the move to land");
    const snapFile = path.join(dataDir, "rooms", `${rooms[0].roomId}.json`);
    await until(() => JSON.parse(fs.readFileSync(snapFile, "utf8")).state.turnCount >= 1, 5000, "the snapshot after the move");
    await srv.stop();
    for (const r of rooms) await leaveQuietly(r, 100);

    srv = await startServer({ dataDir });
    const back = [];
    for (const key of keys) {
      const res = await until(async () => {
        const r = await fetch(`${srv.http}/rejoin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerKey: key }) });
        return r.ok ? r : null;
      }, 10000, "the seat after the restart");
      back.push(await new Client(srv.ws).consumeSeatReservation(await res.json()));
    }
    open.push(...back);
    await until(() => back.every((r) => r.state.status === "playing"), 5000, "the restored game");
    await passOut(back);
    const game = await until(async () => (await getJson(srv, "/history")).body.games?.[0], 5000, "the game in the list");
    const record = (await getJson(srv, `/history/${game.id}`)).body;
    assert.ok(record.frames.some((f) => f.a && f.a[2] === 9 && f.a[3] === 9), "the move from before the restart");

    await srv.stop();
    srv = await startServer({ dataDir });
    assert.deepEqual((await getJson(srv, "/history")).body.games.map((g) => g.id), [game.id], "still there after another restart");
  } finally {
    await srv.stop();
  }
});
