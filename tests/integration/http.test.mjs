// The server's HTTP side (server/src/index.ts): health check, CORS and /rejoin.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, startServer, until } from "../lib/harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server && (await server.stop()));

const rejoin = (body, headers = { "Content-Type": "application/json" }) =>
  fetch(`${server.http}/rejoin`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

test("GET /healthz answers ok", async () => {
  const res = await fetch(`${server.http}/healthz`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
});

test("a CORS preflight for /rejoin is allowed from any origin", async () => {
  const res = await fetch(`${server.http}/rejoin`, { method: "OPTIONS", headers: { Origin: "https://example.org" } });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
  assert.match(res.headers.get("access-control-allow-methods"), /POST/);
  assert.match(res.headers.get("access-control-allow-headers"), /Content-Type/);
});

test("/rejoin with a key no game knows is a 404, not a seat", async () => {
  const res = await rejoin({ playerKey: "nobody-has-this-key" });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "no game to rejoin" });
});

test("/rejoin with no key, a non-string key, or no JSON at all is a 404", async () => {
  for (const body of [{}, { playerKey: 42 }, { playerKey: ["a"] }, { playerKey: "" }]) {
    assert.equal((await rejoin(body)).status, 404, JSON.stringify(body));
  }
  assert.equal((await rejoin("not json at all", { "Content-Type": "text/plain" })).status, 404);
});

test("a malformed JSON body is refused without taking the server down", async () => {
  const res = await rejoin("{ broken", { "Content-Type": "application/json" });
  assert.ok(res.status >= 400 && res.status < 500, `status ${res.status}`);
  assert.equal((await fetch(`${server.http}/healthz`)).status, 200);
});

test("a huge key is cut down, not stored or echoed", async () => {
  const res = await rejoin({ playerKey: "k".repeat(100_000) });
  assert.equal(res.status, 404);
  assert.ok((await res.text()).length < 200);
});

test("no response names the framework in x-powered-by, and every one says nosniff", async () => {
  for (const [what, res] of [
    ["/healthz", await fetch(`${server.http}/healthz`)],
    ["/history", await fetch(`${server.http}/history`)],
    ["/rejoin", await rejoin({ playerKey: "nobody" })],
  ]) {
    assert.equal(res.headers.get("x-powered-by"), null, `${what} names no framework`);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff", `${what} says nosniff`);
  }
});

test("/rejoin answers no-store, so no cache ever hands a seat back", async () => {
  const res = await rejoin({ playerKey: "nobody-at-all" });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("the 11th /rejoin within a minute from one address is refused with 429 and a Retry-After", async () => {
  const own = await startServer(); // its own server: the budget is per address, and this file's other tests spend it too
  try {
    const post = () =>
      fetch(`${own.http}/rejoin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerKey: "nobody" }) });
    for (let i = 1; i <= 10; i++) assert.equal((await post()).status, 404, `call ${i} is answered`);
    const res = await post();
    assert.equal(res.status, 429);
    assert.ok(Number(res.headers.get("retry-after")) > 0, "says when to try again");
    assert.equal((await fetch(`${own.http}/healthz`)).status, 200, "and the server goes on");
  } finally {
    await own.stop();
  }
});

// GET /tables (review U5): who is waiting, so the home screen can say so before
// anyone clicks Play. Only public go_custom tables with a free seat count.
const { Client } = colyseus();
const sit = (room, options) => new Client(server.ws).create(room, { playerKey: `tables-${Math.random().toString(36).slice(2)}`, ...options });
const tablesNow = async () => {
  const res = await fetch(`${server.http}/tables`);
  assert.equal(res.status, 200);
  return (await res.json()).tables;
};

test("GET /tables lists no table when nobody is waiting", async () => {
  assert.deepEqual(await tablesNow(), []);
});

test("GET /tables counts the people waiting at each board size, and a table is gone once its game starts", async () => {
  const first = await sit("go_custom", { name: "Waiting", size: 19 });
  const debug = await sit("go_debug", { name: "Debugging", size: 13 });
  try {
    await until(async () => (await tablesNow()).length === 1, 5000, "the table to be listed");
    assert.deepEqual(await tablesNow(), [{ size: 19, waiting: 1, tables: 1 }], "one person at 19x19; the debug table is not offered");
    const second = await new Client(server.ws).joinById(first.roomId, { playerKey: `tables-${Date.now()}`, name: "Second" });
    try {
      await until(async () => (await tablesNow())[0]?.waiting === 2, 5000, "the second person to be counted");
      first.send("addBots", { ids: ["pure", "pure"] });
      await until(() => first.state.status === "playing", 5000, "the game to start");
      await until(async () => (await tablesNow()).length === 0, 5000, "the started game to leave the list");
    } finally {
      await leaveQuietly(second);
    }
  } finally {
    await leaveQuietly(first);
    await leaveQuietly(debug);
  }
});
