// Untrusted input over the socket (security-and-hardening): whatever a client
// sends, the server stays up, the game is unchanged, and create options grant
// nothing.
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

const me = (r) => Array.from(r.state.players).find((p) => p.sessionId === r.sessionId);
const JUNK = [undefined, null, 0, -1, 1e308, NaN, "", "x".repeat(1000), [], [1, 2], {}, { x: "1", y: "1" }, { x: 1.5, y: 2 },
  { x: -1, y: 0 }, { x: 99, y: 99 }, { id: { toString: 1 } }, { id: "__proto__" }, { id: "constructor" }, { cell: 99 }, { cell: -1 },
  { cell: 1.5 }, { ids: "pure" }, { ids: Array(100).fill("nobody") }, { target: "a" }, { target: { x: "a" } }, { __proto__: { x: 1 } }];
const TYPES = ["move", "pass", "buy", "usePowerup", "addBots", "upgradeCard", "flipCardStone", "removeCardStone"];

test("junk in every message type changes nothing and takes nothing down", async () => {
  const host = await new Client(server.ws).create("go_custom", { name: "Fuzz", playerKey: `fuzz-${Date.now()}` });
  open.push(host);
  await until(() => me(host), 5000, "my seat");
  let closed = null;
  host.onLeave((code) => (closed = code));
  for (const type of TYPES) for (const junk of JUNK) host.send(type, junk);
  await wait(800);
  assert.equal(closed, null, "junk inside the protocol does not get the socket closed");
  assert.equal((await fetch(`${server.http}/healthz`)).status, 200);
  const state = host.state;
  assert.equal(state.players.length, 1, "no bots seated by junk");
  assert.equal(state.status, "waiting");
  assert.ok(Array.from(state.seen).every((c) => c === 0), "the board is empty");
  assert.deepEqual(Array.from(me(host).card), [0, 0, 0, 0, 0, 0, 0, 0, 0], "the Stone Card is untouched");
  assert.deepEqual(Array.from(me(host).powerups), ["stone_card"]);
  assert.equal(me(host).fireflies, 0);
  // And it still plays: the same socket can seat bots afterwards.
  host.send("addBots", { ids: ["pure", "pure", "pure"] });
  await until(() => state.status === "playing", 5000, "the game to start after the junk");
});

// Colyseus closes a socket that breaks the protocol; the point is that it is
// that socket alone, and the server goes on.
for (const [what, send, code] of [
  ["an oversized message", (r) => r.send("move", "x".repeat(100_000)), 1009],
  ["an unknown message type", (r) => r.send("no-such-message", {}), 4002],
]) {
  test(`${what} closes that socket only; the server and the other players go on`, async () => {
    const bad = await new Client(server.ws).create("go_custom", { name: "Bad" });
    const good = await new Client(server.ws).joinById(bad.roomId, { name: "Good" });
    open.push(good);
    await until(() => good.state.players?.length === 2, 5000, "both seated");
    let closed = null;
    bad.onLeave((c) => (closed = c));
    send(bad);
    await until(() => closed !== null, 5000, "the bad socket to close");
    assert.equal(closed, code);
    assert.equal((await fetch(`${server.http}/healthz`)).status, 200);
    good.send("addBots", { ids: ["pure", "pure"] });
    await until(() => good.state.players.length >= 3, 5000, "the good client to go on playing");
  });
}

test("create options can't grant fireflies, weather or a restored state", async () => {
  const r = await new Client(server.ws).create("go_custom", {
    name: "Greedy",
    startingFireflies: 99999,
    stormEvery: 1,
    shopAfterMoves: 0,
    restoreToken: "guessed-token",
  });
  open.push(r);
  await until(() => me(r), 5000, "my seat");
  assert.equal(me(r).fireflies, 0);
  assert.equal(r.state.shopAfter, 5);
  assert.equal(r.state.storm.every, 20);
  assert.equal(r.state.turnCount, 0);
});

test("a name is sanitized and capped, however long or strange", async () => {
  const r = await new Client(server.ws).create("go_custom", { name: "\u0000‮" + "N".repeat(500) });
  open.push(r);
  await until(() => me(r), 5000, "my seat");
  const name = me(r).name;
  assert.ok(name.length > 0 && name.length <= 24, `${name.length} characters`);
  assert.ok(!/[\u0000-\u001f‪-‮]/.test(name));
});

test("joining a room that doesn't exist is refused cleanly", async () => {
  await assert.rejects(new Client(server.ws).joinById("no-such-room", { name: "x" }));
  assert.equal((await fetch(`${server.http}/healthz`)).status, 200);
});
