// The Lantern Festival (tasks/2026-11-08_lantern_card/PLAN.md): a finder's card asks the
// room to show the whole table an animation. One message in, one broadcast out, and the
// game itself doesn't change in any way.
import { makeRoom, notices, seatHumans, startedRoom } from "./room.testkit";
import { fakeClient } from "./room.testkit";
import { test } from "node:test";
import assert from "node:assert/strict";

/** Records what the room broadcasts. */
function listen(room: any): [string, any][] {
  const out: [string, any][] = [];
  room.broadcast = (type: string, message: unknown) => {
    out.push([type, message]);
  };
  return out;
}
const AFTER_A_FESTIVAL = 60_000; // ms: longer than any festival lasts

test("lantern festival: a seated player's message goes to the whole table, with their colour and name", () => {
  const { room, clients } = startedRoom();
  const sent = listen(room);
  room.handleLanternFestival(clients[1]);
  const player = room.state.players.find((p: any) => p.sessionId === clients[1].sessionId);
  assert.deepEqual(sent, [["lanternFestival", { by: player.color, name: player.name }]]);
});

test("lantern festival: a seat gets one festival a game", (t) => {
  let now = 1_000_000;
  t.mock.method(Date, "now", () => now);
  const { room, clients } = startedRoom();
  const sent = listen(room);
  room.handleLanternFestival(clients[0]);
  room.handleLanternFestival(clients[0]);
  now += AFTER_A_FESTIVAL;
  room.handleLanternFestival(clients[0]);
  assert.equal(sent.length, 1);
  assert.deepEqual(notices(clients[0]), [], "a repeat is dropped without a word");
});

test("lantern festival: a client without a seat starts nothing", () => {
  const { room } = startedRoom();
  const sent = listen(room);
  room.handleLanternFestival(fakeClient("nobody"));
  assert.deepEqual(sent, []);
});

test("lantern festival: a second seat during a festival is told to wait, and may go when it is over", (t) => {
  let now = 2_000_000;
  t.mock.method(Date, "now", () => now);
  const { room, clients } = startedRoom();
  const sent = listen(room);
  room.handleLanternFestival(clients[0]);
  room.handleLanternFestival(clients[1]);
  assert.equal(sent.length, 1, "one at a time");
  assert.equal(notices(clients[1]).length, 1, "and the second player hears why");
  now += AFTER_A_FESTIVAL;
  room.handleLanternFestival(clients[1]);
  assert.equal(sent.length, 2, "the wait didn't use up their festival");
});

test("lantern festival: a player in the waiting room can start one", () => {
  const room = makeRoom();
  const [client] = seatHumans(room, ["early"]);
  const sent = listen(room);
  assert.notEqual(room.state.status, "playing");
  room.handleLanternFestival(client);
  assert.equal(sent.length, 1);
});

test("lantern festival: the game state is byte for byte the same before and after", () => {
  const { room, clients } = startedRoom();
  listen(room);
  const before = JSON.stringify(room.state.toJSON());
  room.handleLanternFestival(clients[2]);
  assert.equal(JSON.stringify(room.state.toJSON()), before);
});
