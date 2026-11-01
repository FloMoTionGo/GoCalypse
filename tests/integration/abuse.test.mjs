// Abuse limits (security-and-hardening; tasks/security_fixes T5, T6): what one
// address may hold at once, and what one client may send per second. The server
// starts with low caps (GOCALYPSE_MAX_*), so the tests can reach them from
// 127.0.0.1. Tests run in order and share the server.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, startServer, until, wait } from "../lib/harness.mjs";

const { Client } = colyseus();
let server;
const open = [];
before(async () => (server = await startServer({ env: { GOCALYPSE_MAX_ROOMS_PER_IP: "2", GOCALYPSE_MAX_SOCKETS_PER_IP: "3" } })));
after(async () => {
  for (const r of open) await leaveQuietly(r);
  await server?.stop();
});

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const create = (name) => new Client(server.ws).create("go_custom", { name, playerKey: `${name}-${stamp()}` });
const joinById = (id, name) => new Client(server.ws).joinById(id, { name, playerKey: `${name}-${stamp()}` });
/** What the server said when it refused, or null when it let the client in (the room is kept, to be closed). */
async function refusal(promise) {
  try {
    open.push(await promise);
    return null;
  } catch (err) {
    return err.message || String(err);
  }
}

test("a third table from one address is refused while two are open, and says so", async () => {
  const first = await create("One");
  open.push(first);
  assert.equal(await refusal(create("Two")), null);
  const why = await refusal(create("Three"));
  assert.ok(why, "the third create is refused");
  assert.match(why, /tables/i, `it says why: ${why}`);
  // The first table left (its only player gone, the room closes) frees the address.
  await leaveQuietly(first);
  await wait(500);
  assert.equal(await refusal(create("Three again")), null, "a table left is a table freed");
});

test("the 4th socket from one address is refused when the cap is 3", async () => {
  // From the test above: two tables with one socket each.
  const table = open[1].roomId;
  assert.equal(await refusal(joinById(table, "Twoo")), null, "a third socket, into an open table");
  const why = await refusal(joinById(table, "Twooo"));
  assert.ok(why, "the fourth socket is refused");
  assert.match(why, /connections/i, `it says why: ${why}`);
});

// Debug tables (go_debug, every item from the first turn) exist for local and
// staging servers only, unless DEBUG_ROOMS says otherwise (T9).
for (const [what, env, offered] of [
  ["go_debug is not offered when NODE_ENV is production and DEBUG_ROOMS is off", { NODE_ENV: "production" }, false],
  ["go_debug is offered when DEBUG_ROOMS is on even in production", { NODE_ENV: "production", DEBUG_ROOMS: "on" }, true],
]) {
  test(what, async () => {
    const own = await startServer({ env });
    const rooms = [];
    try {
      const custom = await new Client(own.ws).joinOrCreate("go_custom", { name: "Prod" });
      rooms.push(custom);
      let debug = null;
      try {
        debug = await new Client(own.ws).joinOrCreate("go_debug", { name: "Dbg" });
        rooms.push(debug);
      } catch (err) {
        assert.equal(offered, false, `go_debug refused: ${err.message}`);
      }
      assert.equal(debug !== null, offered);
    } finally {
      for (const r of rooms) await leaveQuietly(r);
      await own.stop();
    }
  });
}

test("a client that floods 200 moves in a second gets one notice and the room still answers it afterwards", async () => {
  for (const r of open.splice(0)) await leaveQuietly(r);
  await wait(500);
  const host = await create("Flood");
  open.push(host);
  const notices = [];
  host.onMessage("notice", (text) => notices.push(text));
  host.send("addBots", { ids: ["pure", "pure", "pure"] });
  await until(() => host.state.status === "playing", 5000, "the game to start");
  for (let i = 0; i < 200; i++) host.send("move", { x: i % 13, y: Math.floor(i / 13) % 13 });
  await wait(600);
  assert.equal(notices.filter((n) => /slow down/i.test(n)).length, 1, `one notice about the flood: ${JSON.stringify(notices)}`);
  assert.equal((await fetch(`${server.http}/healthz`)).status, 200);
  // A few seconds on the budget has refilled: a legal move on my turn is taken.
  await wait(2500);
  await until(() => host.state.players[host.state.turnIndex]?.sessionId === host.sessionId, 20000, "my turn");
  const before = host.state.turnCount;
  const n = host.state.size;
  const free = Array.from(host.state.seen).findIndex((c) => c === 0);
  host.send("move", { x: free % n, y: Math.floor(free / n) });
  await until(() => host.state.turnCount > before, 5000, "the move to be taken");
});
