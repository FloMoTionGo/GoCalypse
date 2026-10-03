import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeClient, makeRoom, playerOf, seatHumans, startedRoom } from "./room.testkit";
import { findRoomForKey, GoRoom, SEAT_BONUS } from "./GoRoom";

// Seats coming and going: bots asked for, players leaving and coming back, and
// the debug room's settings.

test("addBots seats the asked-for bots, under their own names, without sockets", () => {
  const room = makeRoom();
  const [a] = seatHumans(room, ["a"]);
  room.handleAddBots(a, { ids: ["pure", "shark"] });
  const bots = room.state.players.filter((p: any) => p.bot);
  assert.deepEqual(bots.map((p: any) => p.name).sort(), ["Honte", "Ko"]);
  for (const b of bots) assert.equal(b.sessionId, `bot:${b.color}`);
  assert.equal(room.state.status, "waiting");
  assert.equal(room.maxClients, 2, "matchmaking stops at the seats left");
});

test("the same bot may be asked for twice, and is told apart", () => {
  const room = makeRoom();
  const [a] = seatHumans(room, ["a", "b"]);
  room.handleAddBots(a, { ids: ["pure", "pure"] });
  assert.deepEqual(room.state.players.filter((p: any) => p.bot).map((p: any) => p.name).sort(), ["Honte", "Honte 2"]);
  assert.equal(room.state.status, "playing", "the fourth seat starts the game");
});

test("never more than 3 bots, nor more than the free seats, and unknown ids are skipped", () => {
  const room = makeRoom();
  const [a] = seatHumans(room, ["a"]);
  room.handleAddBots(a, { ids: ["nobody", 42, "pure", "pure", "pure", "pure"] });
  assert.equal(room.state.players.filter((p: any) => p.bot).length, 1, "only the first three entries are read: one of them a bot");
  room.handleAddBots(a, { ids: ["shark", "shark"] });
  assert.equal(room.state.players.length, 4);
  assert.equal(room.state.players.filter((p: any) => p.bot).length, 3);
});

test("addBots from someone not at the table, with no list, or after the start does nothing", () => {
  const room = makeRoom();
  seatHumans(room, ["a"]);
  room.handleAddBots(fakeClient("stranger"), { ids: ["pure"] });
  room.handleAddBots(fakeClient("a"), null);
  room.handleAddBots(fakeClient("a"), { ids: "pure" });
  assert.equal(room.state.players.length, 1);
  const { room: started, clients } = startedRoom();
  started.handleAddBots(clients[0], { ids: ["pure"] });
  assert.equal(started.state.players.length, 4);
});

test("leaving a waiting table frees the seat at once", async () => {
  const room = makeRoom();
  const [a, b] = seatHumans(room, ["a", "b"], { a: "key-a" });
  await room.onLeave(a, false);
  assert.deepEqual(room.state.players.map((p: any) => p.name), ["b"]);
  assert.equal(room.seatKeys.size, 0);
  room.onJoin(fakeClient("c"), { name: "c" });
  assert.equal(room.state.players.length, 2);
  void b;
});

test("leaving a game on purpose hands the seat to a bot at once", async () => {
  const { room, clients } = startedRoom();
  const leaver = playerOf(room, clients[1]);
  await room.onLeave(clients[1], true);
  assert.equal(leaver.bot, true);
  assert.equal(leaver.connected, false, "still shown as the player's seat");
  assert.match(room.state.lastEvent, /left; .* plays the seat/);
});

test("a table left to bots alone closes", async () => {
  const room = makeRoom();
  const [a] = seatHumans(room, ["a"]);
  room.handleAddBots(a, { ids: ["pure", "pure", "pure"] });
  await room.onLeave(a, true);
  room.scheduleBotTurn();
  assert.ok(room.disconnects >= 1);
});

test("a player's secret finds their seat in a game under way, and nowhere else", () => {
  const room = makeRoom();
  const key = `secret-${process.pid}-${Date.now()}`;
  seatHumans(room, ["a", "b"], { a: key });
  assert.equal(room.seatFor(key), undefined, "not while waiting");
  seatHumans(room, ["c", "d"]);
  assert.equal(room.seatFor(key)?.name, "a");
  assert.equal(findRoomForKey(key), room);
  assert.equal(room.seatFor("someone-else"), undefined);
  assert.equal(room.seatFor(""), undefined);
});

test("coming back with the secret takes the same seat on the new socket", () => {
  const key = `back-${process.pid}-${Date.now()}`;
  const room = makeRoom();
  seatHumans(room, ["a", "b", "c", "d"], { b: key });
  const seat = room.state.players.find((p: any) => p.name === "b");
  seat.connected = false;
  const fresh = fakeClient("b-new");
  room.onJoin(fresh, { name: "whatever", playerKey: key });
  assert.equal(room.state.players.length, 4);
  assert.equal(seat.sessionId, "b-new");
  assert.equal(seat.connected, true);
  assert.equal(seat.name, "b");
  assert.ok(fresh.view.has(seat));
  assert.match(room.state.lastEvent, /b is back/);
});

test("once under way the table keeps room for returning players' reservations", () => {
  const { room } = startedRoom();
  assert.equal(room.maxClients, 8);
});

test("a bot on turn plays: a stone, an item or a pass, and the turn moves on", () => {
  const room = makeRoom();
  const [a] = seatHumans(room, ["a"]);
  room.handleAddBots(a, { ids: ["balanced", "items", "shark"] });
  const human = playerOf(room, a);
  for (let i = 0; i < 12; i++) {
    if (room.state.players[room.state.turnIndex] === human) room.handlePass(a);
    else room.runBotTurn();
  }
  assert.equal(room.state.turnCount, 12);
  assert.ok(room.state.board.some((c: number) => c !== 0), "the bots put stones down");
});

test("the debug room starts everyone rich, opens the market at once and rolls for storms every 6 turns", () => {
  const { room } = startedRoom({ debug: true });
  for (const p of room.state.players) assert.equal(p.fireflies, 1200 + SEAT_BONUS * (p.color - 1));
  assert.equal(room.state.shopAfter, 0);
  assert.equal(room.state.storm.every, 6);
});

test("create options can't make a room rich or change its weather", () => {
  const room: any = new GoRoom();
  room.listing = { updateOne: async () => {} };
  room.onCreate({ startingFireflies: 9999, stormEvery: 1, shopAfterMoves: 0 } as any);
  assert.equal(room.state.storm.every, 20);
  assert.equal(room.state.shopAfter, 5);
  room.onJoin(fakeClient("a"), { name: "a", startingFireflies: 9999 } as any);
  assert.equal(room.state.players[0].fireflies, 0);
});

test("a throw inside a message handler is caught by the room, not the process", () => {
  const { room, clients } = startedRoom();
  assert.equal(typeof room.onUncaughtException, "function", "Colyseus only wraps handlers when this is defined");
  void clients;
});
