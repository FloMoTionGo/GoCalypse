import { test } from "node:test";
import assert from "node:assert/strict";
import { routesModule } from "./history.testkit";

// history/routes.ts: what GET /history accepts. The routes themselves are
// tested against a real server (tests/integration/history.test.mjs).

test("history routes: no query lists everything, 50 at a time", () => {
  const { parseListQuery } = routesModule();
  assert.deepEqual(parseListQuery({}), { limit: 50 });
});

test("history routes: from, to and limit are read as whole numbers", () => {
  const { parseListQuery } = routesModule();
  assert.deepEqual(parseListQuery({ from: "1000", to: "2000", limit: "10" }), { from: 1000, to: 2000, limit: 10 });
});

test("history routes: limit is held between 1 and 200", () => {
  const { parseListQuery } = routesModule();
  assert.equal(parseListQuery({ limit: "5000" }).limit, 200);
  assert.equal(parseListQuery({ limit: "0" }).limit, 1);
});

test("history routes: a from, to or limit that isn't a number is an error, not a guess", () => {
  const { parseListQuery } = routesModule();
  for (const q of [{ from: "yesterday" }, { to: "1e400" }, { limit: "ten" }, { from: ["1", "2"] }, { from: "-5" }, { to: "1.5" }]) {
    assert.ok(typeof parseListQuery(q).error === "string", JSON.stringify(q));
  }
});

test("history routes: from after to is an error", () => {
  const { parseListQuery } = routesModule();
  assert.ok(typeof parseListQuery({ from: "2000", to: "1000" }).error === "string");
});
