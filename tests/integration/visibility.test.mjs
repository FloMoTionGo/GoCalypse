// findings B5 over the wire (was findings-tests/server-b5.mjs): what each client
// is actually sent. Four real clients at one go_debug table (rich, storms
// rolled every 6 turns).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, startServer, until, wait } from "../lib/harness.mjs";

const { Client } = colyseus();
const GREY = 14, DRIFTWOOD = 9;
let server, rooms, size;
const me = (r) => Array.from(r.state.players).find((p) => p.sessionId === r.sessionId);
const other = (r, s) => Array.from(r.state.players).find((p) => p.sessionId === s.sessionId);
const onTurn = () => rooms.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);
const visible = (r) => {
  const cells = Array.from(r.state.seen);
  const m = Array.from(me(r).misted || []);
  for (let i = 0; i + 1 < m.length; i += 2) cells[m[i]] = m[i + 1];
  return cells;
};

/** Plays one turn for whoever is to move: a random point that looks free to them. */
async function playTurn() {
  const r = onTurn();
  if (!r) return null;
  const before = r.state.turnCount;
  for (let tries = 0; tries < 8; tries++) {
    const free = visible(r).map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
    const i = free[Math.floor(Math.random() * free.length)];
    r.send("move", { x: i % size, y: (i / size) | 0, axis: Math.random() < 0.5 ? "base" : "pattern" });
    for (let k = 0; k < 40 && r.state.turnCount === before; k++) await wait(25);
    if (r.state.turnCount !== before) return { r, i };
  }
  return null;
}

before(async () => {
  server = await startServer();
  // A table whose market stocks Mist (the stalls are drawn per match).
  for (let tries = 0; tries < 60 && !rooms; tries++) {
    const host = await new Client(server.ws).create("go_debug", { name: "A", playerKey: `b5-a-${Date.now()}` });
    await until(() => host.state.market?.length > 0, 5000, "the market");
    if (!Array.from(host.state.market).some((m) => m.id === "mist")) {
      await host.leave(true);
      continue;
    }
    rooms = [host];
    for (const n of "BCD") rooms.push(await new Client(server.ws).joinById(host.roomId, { name: n, playerKey: `b5-${n}-${Date.now()}` }));
  }
  assert.ok(rooms, "a table with Mist in its market");
  await until(() => rooms.every((r) => r.state.status === "playing" && me(r)), 5000, "the game to start");
  size = rooms[0].state.size;
});
after(async () => {
  for (const r of rooms || []) await leaveQuietly(r);
  await server?.stop();
});

test("B5: no client is sent the true board; everyone gets seen", () => {
  for (const r of rooms) {
    assert.ok(!r.state.board || r.state.board.length === 0);
    assert.equal(r.state.seen.length, size * size);
  }
});

test("B5: own private fields arrive, a rival's don't, public ones do", () => {
  const [A, B] = rooms;
  assert.ok(typeof me(A).fireflies === "number" && me(A).fireflies > 0);
  const aSeenByB = other(B, A);
  for (const field of ["fireflies", "powerups", "bought", "mist", "misted"]) assert.equal(aSeenByB[field], undefined, field);
  assert.equal(aSeenByB.name, "A");
  assert.equal(typeof aSeenByB.score, "number");
});

test("B5: a stone under a Mist reaches its owner only", async () => {
  const [A, B] = rooms;
  while (onTurn() !== A) await playTurn();
  A.send("buy", { id: "mist" });
  await until(() => Array.from(me(A).powerups).includes("mist"), 5000, "A's Mist in A's satchel");
  assert.equal(other(B, A).powerups, undefined);
  A.send("usePowerup", { id: "mist" });
  await until(() => me(A).mist === true, 5000, "A's Mist lit");
  assert.equal(other(B, A).mist, undefined);
  const played = await playTurn();
  assert.equal(played?.r, A, "A played under the Mist");
  await wait(300);
  const i = played.i;
  assert.ok(visible(A)[i] > 0 && Array.from(me(A).misted).includes(i), "A sees their own misted stone");
  for (const r of rooms.slice(1)) assert.equal(r.state.seen[i], 0);
});

test("B5: during a storm's grey no client is sent a stone's colour; after it the colours come back", async () => {
  const [A, B] = rooms;
  let checked = false, back = false;
  for (let t = 0; t < 500 && !back; t++) {
    if (!(await playTurn())) await wait(100);
    const s = A.state;
    if (!checked && s.turnCount < s.storm.until) {
      await wait(200);
      const leaks = rooms.map((r) =>
        Array.from(r.state.seen).concat(Array.from(me(r).misted).filter((_, k) => k % 2)).filter((c) => c && c !== GREY && c !== DRIFTWOOD).length
      );
      assert.ok(Array.from(B.state.seen).some((c) => c === GREY), "the grey is on");
      assert.deepEqual(leaks, [0, 0, 0, 0]);
      checked = true;
    }
    if (checked && s.turnCount >= s.storm.until) {
      await wait(200);
      back = Array.from(B.state.seen).some((c) => c >= 1 && c <= 8) && !Array.from(B.state.seen).includes(GREY);
    }
  }
  assert.ok(checked, "a storm broke");
  assert.ok(back, "the colours came back");
});

test("B5: at the end the true board and everyone's fireflies are shown to all", async () => {
  const [A, B] = rooms;
  for (let t = 0; t < 60 && A.state.status !== "finished"; t++) {
    onTurn()?.send("pass");
    await wait(120);
  }
  await until(() => B.state.status === "finished", 5000, "the game to finish");
  await wait(200);
  assert.ok(Array.from(B.state.players).every((p) => typeof p.fireflies === "number"));
  assert.ok(!Array.from(B.state.seen).includes(GREY));
  assert.ok(Array.from(B.state.seen).filter(Boolean).length > 0);
});
