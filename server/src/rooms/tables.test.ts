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
  assert.deepEqual(summarizeTables([listing({ size: undefined }), listing({ size: 11 }), listing({ size: "19" })]), [{ size: 13, waiting: 1, tables: 1 }]);
});

// Lobby islands (tasks/2026-11-02_lobby_islands): the home screen draws every open
// table as an islet, so GET /tables also lists them one by one, with who sits
// where (a seat's index is its colour - 1) but never anyone's name.
const at = (s: number) => new Date(Date.UTC(2026, 10, 2, 10, 0, s)).toISOString();

test("tables: each open lobby is listed with its four seats by colour, people as p and bots by kind, oldest first", () => {
  const { listTables } = tables();
  const out = listTables([
    listing({ roomId: "b", createdAt: at(5), size: 19, clients: 1, maxClients: 3, metadata: { seats: [null, "p", "bot:shark", null] } }),
    listing({ roomId: "a", createdAt: at(0), metadata: { seats: ["p", null, null, null] } }),
  ]);
  assert.deepEqual(out, [
    { roomId: "a", size: 13, seats: ["p", null, null, null] },
    { roomId: "b", size: 19, seats: [null, "p", "bot:shark", null] },
  ]);
});

test("tables: a locked, private, full, empty or strange-sized table is not listed as a lobby", () => {
  const { listTables } = tables();
  const seats = { seats: ["p", null, null, null] };
  const out = listTables([
    listing({ roomId: "l", locked: true, metadata: seats }),
    listing({ roomId: "v", private: true, metadata: seats }),
    listing({ roomId: "f", clients: 4, metadata: seats }),
    listing({ roomId: "e", clients: 0, metadata: seats }),
    listing({ roomId: "s", size: 11, metadata: seats }),
  ]);
  assert.deepEqual(out, []);
});

test("tables: seats a room never published, or published wrong, are read as its people in the first seats", () => {
  const { listTables } = tables();
  const out = listTables([
    listing({ roomId: "none", createdAt: at(0), clients: 2 }),
    listing({ roomId: "short", createdAt: at(1), metadata: { seats: ["p"] } }),
    listing({ roomId: "junk", createdAt: at(2), metadata: { seats: ["p", "<b>hi</b>", null, null] } }),
    listing({ roomId: "name", createdAt: at(3), metadata: { seats: ["Alice", null, null, null] } }),
  ]);
  assert.deepEqual(out.map((t: any) => [t.roomId, t.seats]), [
    ["none", ["p", "p", null, null]],
    ["short", ["p", null, null, null]],
    ["junk", ["p", null, null, null]],
    ["name", ["p", null, null, null]],
  ]);
});

test("tables: no more than 24 lobbies are listed, the oldest ones", () => {
  const { listTables } = tables();
  const many = Array.from({ length: 30 }, (_, i) => listing({ roomId: `r${String(i).padStart(2, "0")}`, createdAt: at(59 - i), metadata: { seats: ["p", null, null, null] } }));
  const out = listTables(many);
  assert.equal(out.length, 24);
  assert.equal(out[0].roomId, "r29", "the oldest first");
  assert.ok(!out.some((t: any) => ["r00", "r01", "r02", "r03", "r04", "r05"].includes(t.roomId)), "the six newest wait for room");
});

test("tables: a table whose game started is remembered for 15 seconds with its seats, then forgotten", () => {
  const { StartedTables } = tables();
  const started = new StartedTables();
  started.record({ roomId: "a", size: 13, seats: ["p", "p", "bot:pure", "p"] }, 1_000);
  assert.deepEqual(started.list(1_000 + 14_999), [{ roomId: "a", size: 13, seats: ["p", "p", "bot:pure", "p"], at: 1_000 }]);
  assert.deepEqual(started.list(1_000 + 15_001), []);
});
