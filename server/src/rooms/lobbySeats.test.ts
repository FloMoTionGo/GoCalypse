import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRoom, seatHumans } from "./room.testkit";

// Lobby islands (tasks/2026-11-02_lobby_islands): a waiting table tells the
// matchmaker who sits where, as its listing's metadata, so GET /tables can draw
// it as an islet; a table whose game starts is remembered for a moment, so the
// home screen can sink its islet with lanterns rather than quietly.
function tables(): any {
  return require("./tables");
}

const seatsOf = (room: any) => room.listing.metadata?.seats;
const colourOf = (room: any, name: string) => room.state.players.find((p: any) => p.name === name)?.color;

test("lobby seats: a waiting table publishes who sits where as people join, bots sit down and people leave", async () => {
  const room = makeRoom({ size: 19 });
  assert.deepEqual(seatsOf(room), [null, null, null, null], "an empty table says so");
  const [a, b] = seatHumans(room, ["a", "b"]);
  const want: (string | null)[] = [null, null, null, null];
  want[colourOf(room, "a") - 1] = "p";
  want[colourOf(room, "b") - 1] = "p";
  assert.deepEqual(seatsOf(room), want, "two people, each at their colour");

  room.handleAddBots(a, { ids: ["shark"] });
  const bot = room.state.players.find((p: any) => p.bot);
  want[bot.color - 1] = "bot:shark";
  assert.deepEqual(seatsOf(room), want, "the bot by its kind");

  await room.onLeave(b, true);
  const left: (string | null)[] = [null, null, null, null];
  left[colourOf(room, "a") - 1] = "p";
  left[bot.color - 1] = "bot:shark";
  assert.deepEqual(seatsOf(room), left, "the seat of the one who left is free again");
  assert.ok(!JSON.stringify(room.listing.metadata).includes('"a"'), "no names in the listing");
});

test("lobby seats: a public table that fills is remembered as just started, a debug table is not", () => {
  const { startedTables } = tables();
  const room = makeRoom();
  seatHumans(room);
  assert.equal(room.state.status, "playing");
  const entry = startedTables.list().find((e: any) => e.roomId === room.roomId);
  assert.ok(entry, "the started table is remembered");
  assert.equal(entry.size, 13);
  assert.deepEqual(entry.seats, ["p", "p", "p", "p"]);

  const debug = makeRoom({ debug: true });
  seatHumans(debug);
  assert.equal(debug.state.status, "playing");
  assert.ok(!startedTables.list().some((e: any) => e.roomId === debug.roomId), "debug tables never show on the home screen");
});
