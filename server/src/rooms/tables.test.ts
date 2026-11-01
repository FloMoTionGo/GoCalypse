import { test } from "node:test";
import assert from "node:assert/strict";

// rooms/tables.ts: what GET /tables tells the home screen about who is waiting
// (review U5). Loaded at run time, so these show red on their own until the
// module is in. The route itself is tested against a real server
// (tests/integration/http.test.mjs).
function tables(): any {
  return require("./tables");
}

/** A room listing as the matchmaker keeps it: `size` is the filter option the client joined with. */
function listing(over: Record<string, unknown> = {}) {
  return { name: "go_custom", clients: 1, maxClients: 4, locked: false, private: false, size: 13, ...over };
}

test("tables: the people waiting are counted per board size, smallest board first", () => {
  const { summarizeTables } = tables();
  const out = summarizeTables([listing({ size: 19, clients: 2 }), listing({ size: 13 }), listing({ size: 19, clients: 1, roomId: "b" })]);
  assert.deepEqual(out, [
    { size: 13, waiting: 1, tables: 1 },
    { size: 19, waiting: 3, tables: 2 },
  ]);
});

test("tables: a locked, private, full or empty table is nobody to join", () => {
  const { summarizeTables } = tables();
  assert.deepEqual(summarizeTables([listing({ locked: true }), listing({ private: true }), listing({ clients: 4 }), listing({ clients: 0 })]), []);
});

test("tables: a table that never said its size is the 13x13 everyone knows, and a strange size is left out", () => {
  const { summarizeTables } = tables();
  assert.deepEqual(summarizeTables([listing({ size: undefined }), listing({ size: 9 }), listing({ size: "19" })]), [{ size: 13, waiting: 1, tables: 1 }]);
});
