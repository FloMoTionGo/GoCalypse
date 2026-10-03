import { test } from "node:test";
import assert from "node:assert/strict";
import { at, fakeClient, makeRoom, move, notices, onTurn, passAround, playerOf, put, seatHumans, startedRoom } from "./room.testkit";
import { stoneCode } from "../rules/goRules";
import { SEAT_BONUS } from "./GoRoom";

// The room's turn loop as a client drives it: seats, moves, passes and the end of the game.

test("four joins fill the table with colors 1 to 4 and start the game", () => {
  const room = makeRoom();
  seatHumans(room, ["a", "b", "c"]);
  assert.equal(room.state.status, "waiting");
  seatHumans(room, ["d"]);
  assert.equal(room.state.status, "playing");
  const colors = room.state.players.map((p: any) => p.color).sort();
  assert.deepEqual(colors, [1, 2, 3, 4]);
  assert.equal(room.state.players[room.state.turnIndex].color, 1, "color 1 moves first");
});

test("a fifth join is turned away", () => {
  const { room } = startedRoom();
  assert.throws(() => room.onJoin(fakeClient("e"), { name: "e" }), /full/);
  assert.equal(room.state.players.length, 4);
});

test("later seats in the turn order start with SEAT_BONUS more fireflies each", () => {
  const { room } = startedRoom();
  for (const p of room.state.players) assert.equal(p.fireflies, SEAT_BONUS * (p.color - 1), `color ${p.color}`);
});

test("every seat is dealt a Stone Card and nothing else", () => {
  const { room } = startedRoom();
  for (const p of room.state.players) {
    assert.deepEqual(Array.from(p.powerups), ["stone_card"]);
    assert.equal(p.card.length, 9);
  }
});

test("turns go by color, 1 -> 2 -> 3 -> 4 -> 1, whatever order the seats joined in", () => {
  const { room, clients } = startedRoom();
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) {
    seen.push(room.state.players[room.state.turnIndex].color);
    move(room, clients, i, 0);
  }
  assert.deepEqual(seen, [1, 2, 3, 4, 1]);
  assert.equal(room.state.turnCount, 5);
});

test("a move lands the stone, pays 3 fireflies, counts the move and hands the turn on", () => {
  const { room, clients } = startedRoom();
  const mover = playerOf(room, onTurn(room, clients));
  const before = mover.fireflies;
  move(room, clients, 6, 6, "pattern");
  assert.equal(at(room, 6, 6), stoneCode(mover.color, "pattern"));
  assert.equal(mover.fireflies, before + 3);
  assert.equal(mover.moves, 1);
  assert.equal(room.state.turnCount, 1);
  assert.notEqual(room.state.players[room.state.turnIndex], mover);
  assert.match(room.state.lastEvent, /played \(6, 6\)/);
  assert.equal(room.state.action.kind, "move");
  assert.equal(room.state.action.x, 6);
  assert.equal(room.state.action.player, mover.color);
});

test("a move out of turn, on a taken point or off the board changes nothing and says nothing", () => {
  const { room, clients } = startedRoom();
  const waiting = clients.find((c) => c !== onTurn(room, clients))!;
  room.handleMove(waiting, { x: 1, y: 1 });
  assert.equal(at(room, 1, 1), 0);
  move(room, clients, 2, 2);
  const turn = room.state.turnCount;
  const client = move(room, clients, 2, 2);
  move(room, clients, -1, 0);
  move(room, clients, 13, 0);
  room.handleMove(onTurn(room, clients), null);
  room.handleMove(onTurn(room, clients), { x: "1", y: 1 });
  assert.equal(room.state.turnCount, turn);
  assert.deepEqual(notices(waiting), []);
  assert.deepEqual(notices(client), []);
});

test("a stone with no liberties is refused with a notice, and the turn stays", () => {
  const { room, clients } = startedRoom();
  // Color 1 (black base) is on turn; white base stones close the corner.
  put(room, 1, 0, stoneCode(2, "base"));
  put(room, 0, 1, stoneCode(2, "base"));
  const client = move(room, clients, 0, 0);
  assert.equal(at(room, 0, 0), 0);
  assert.equal(room.state.turnCount, 0);
  assert.match(notices(client).at(-1)!, /No liberties/);
});

test("a capture lifts the stone and pays the taker a prisoner, a point of score and 5 fireflies", () => {
  const { room, clients } = startedRoom();
  put(room, 0, 0, stoneCode(2, "base"));
  put(room, 1, 0, stoneCode(1, "base"));
  const taker = playerOf(room, onTurn(room, clients));
  const before = taker.fireflies;
  move(room, clients, 0, 1);
  assert.equal(at(room, 0, 0), 0);
  assert.equal(taker.score, 1);
  assert.equal(taker.basePrisoners, 1);
  assert.equal(taker.patternPrisoners, 0);
  assert.equal(taker.fireflies, before + 3 + 5);
  assert.match(room.state.lastEvent, /captured 1/);
});

test("a pass takes the turn, marks the seat, and any stone clears the run of passes", () => {
  const { room, clients } = startedRoom();
  passAround(room, clients, 2);
  assert.equal(room.state.passes, 2);
  assert.equal(room.state.players.filter((p: any) => p.passed).length, 2);
  assert.match(room.state.lastEvent, /passed \(2 of 4 in a row\)/);
  move(room, clients, 3, 3);
  assert.equal(room.state.passes, 0);
  assert.ok(room.state.players.every((p: any) => !p.passed));
});

test("a pass out of turn is ignored", () => {
  const { room, clients } = startedRoom();
  const waiting = clients.find((c) => c !== onTurn(room, clients))!;
  room.handlePass(waiting);
  assert.equal(room.state.passes, 0);
  assert.equal(room.state.turnCount, 0);
});

test("four passes in a row end the game: scored, placed and announced", () => {
  const { room, clients } = startedRoom();
  move(room, clients, 3, 3);
  passAround(room, clients, 4);
  const state = room.state;
  assert.equal(state.status, "finished");
  assert.equal(state.baseTerritoryOwner.length, state.size * state.size);
  assert.equal(state.patternTerritoryOwner.length, state.size * state.size);
  assert.ok(state.players.every((p: any) => p.place >= 1 && p.place <= 4));
  assert.ok(state.players.some((p: any) => p.place === 1));
  assert.match(state.lastEvent, /^Game over: .* (wins|share first place) with \d+\.$/);
});

test("a finished game takes no more moves, passes or buys", () => {
  const { room, clients } = startedRoom({ debug: true });
  passAround(room, clients, 4);
  const turn = room.state.turnCount;
  const client = clients[0];
  room.handleMove(client, { x: 5, y: 5 });
  room.handlePass(client);
  room.handleBuy(client, { id: room.state.market[0].id });
  assert.equal(at(room, 5, 5), 0);
  assert.equal(room.state.turnCount, turn);
  assert.equal(playerOf(room, client).powerups.length, 1);
});

test("a waiting table takes no moves", () => {
  const room = makeRoom();
  const [a] = seatHumans(room, ["a", "b"]);
  room.handleMove(a, { x: 5, y: 5 });
  room.handlePass(a);
  assert.equal(at(room, 5, 5), 0);
  assert.equal(room.state.passes, 0);
});

test("a storm still burning when the game ends is put out on the final board", () => {
  const { room, clients } = startedRoom();
  room.state.storm.until = room.state.turnCount + 12;
  passAround(room, clients, 4);
  assert.equal(room.state.storm.until, room.state.turnCount);
});
