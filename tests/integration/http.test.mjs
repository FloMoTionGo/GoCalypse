// The server's HTTP side (server/src/index.ts): health check, CORS and /rejoin.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "../lib/harness.mjs";

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
