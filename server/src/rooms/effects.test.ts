import { test } from "node:test";
import assert from "node:assert/strict";
import { at, move, notices, onTurn, playerOf, put, startedRoom } from "./room.testkit";
import { DRIFTWOOD, stoneCode, twinCode } from "../rules/goRules";
import { FIRE_ROUNDS } from "../rules/storm";
import { BoardEffect } from "../state/GoState";

// Timed board effects and lit items as the room runs them turn by turn
// (expireEffects, rollForStorm, the checks in applyMove).

function effect(room: any, kind: string, x: number, y: number, owner: number, until: number) {
  const e = new BoardEffect();
  Object.assign(e, { kind, x, y, owner, until });
  room.state.effects.push(e);
}

test("driftwood floats away when its time is up", () => {
  const { room, clients } = startedRoom();
  put(room, 4, 4, DRIFTWOOD);
  effect(room, "drift", 4, 4, 0, 1);
  move(room, clients, 0, 0);
  assert.equal(at(room, 4, 4), 0);
  assert.equal(room.state.effects.length, 0);
});

test("a fire that dies takes the stone it was burning, and pays its owner 3 fireflies", () => {
  const { room, clients } = startedRoom();
  put(room, 8, 8, stoneCode(3, "base"));
  effect(room, "fire", 8, 8, 0, 1);
  const owner = room.state.players.find((p: any) => p.color === 3);
  const before = owner.fireflies;
  move(room, clients, 0, 0);
  assert.equal(at(room, 8, 8), 0);
  assert.equal(owner.fireflies, before + 3, "color 3 is not the mover, so this is the consolation alone");
});

test("nothing is played into a fire, a fog, or a rival's lily pad", () => {
  const { room, clients } = startedRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  const rival = room.state.players.find((p: any) => p !== me).color;
  effect(room, "fire", 1, 1, 0, 9);
  effect(room, "fog", 2, 2, rival, 9);
  effect(room, "lily", 3, 3, rival, 9);
  for (const [x, y] of [[1, 1], [2, 2], [3, 3]]) room.handleMove(client, { x, y });
  assert.deepEqual(notices(client), [
    "That point is still burning after the storm.",
    "That point is lost in fog: no stone can be placed there.",
    "That point is reserved by someone's lily pad.",
  ]);
  assert.equal(room.state.turnCount, 0);
});

test("one's own lily pad takes one's stone, and is used up by it", () => {
  const { room, clients } = startedRoom();
  const me = playerOf(room, onTurn(room, clients));
  effect(room, "lily", 3, 3, me.color, 9);
  move(room, clients, 3, 3);
  assert.equal(at(room, 3, 3), stoneCode(me.color, "base"));
  assert.ok(!room.state.effects.some((e: any) => e.kind === "lily"));
});

test("a group kept alive by a ward with no liberties left is taken off when the ward lapses", () => {
  const { room, clients } = startedRoom();
  // A white base stone in the corner, its liberties filled by black base stones.
  put(room, 0, 0, stoneCode(2, "base"));
  put(room, 1, 0, stoneCode(1, "base"));
  put(room, 0, 1, stoneCode(3, "base"));
  effect(room, "ward", 0, 0, 2, 1);
  const scores = room.state.players.map((p: any) => p.score);
  move(room, clients, 6, 6);
  assert.equal(at(room, 0, 0), 0);
  assert.deepEqual(room.state.players.map((p: any) => p.score), scores, "credited to no one");
});

test("a lit Twin Wick makes the next stone a twin, whichever button", () => {
  const { room, clients } = startedRoom();
  const me = playerOf(room, onTurn(room, clients));
  me.twin = true;
  move(room, clients, 5, 5, "pattern");
  assert.equal(at(room, 5, 5), twinCode(me.color));
  assert.equal(me.twin, false);
});

test("Stepping Stones: the first stone keeps the turn, the second ends it", () => {
  const { room, clients } = startedRoom();
  const me = playerOf(room, onTurn(room, clients));
  me.extra = 1;
  move(room, clients, 5, 5);
  assert.equal(room.state.players[room.state.turnIndex], me);
  assert.match(room.state.lastEvent, /moves again/);
  move(room, clients, 6, 5);
  assert.notEqual(room.state.players[room.state.turnIndex], me);
});

test("a lit Firefly Jar doubles capture fireflies and burns down one turn at a time", () => {
  const { room, clients } = startedRoom();
  const me = playerOf(room, onTurn(room, clients));
  me.jar = 2;
  put(room, 0, 0, stoneCode(2, "base"));
  put(room, 1, 0, stoneCode(1, "base"));
  const before = me.fireflies;
  move(room, clients, 0, 1);
  assert.equal(me.fireflies, before + 3 + 2 * 5);
  assert.equal(me.jar, 1);
});

test("a roll turn with the odds piled up breaks a storm: bolts, fires, the grey and the news", () => {
  const { room, clients } = startedRoom();
  room.state.turnCount = room.state.storm.every - 1;
  room.state.storm.calm = 19; // any face now reaches 20
  move(room, clients, 0, 0);
  const s = room.state.storm;
  assert.equal(s.seq, 1);
  assert.ok(s.strikes >= 1 && s.strikes <= 3);
  assert.equal(s.calm, 0);
  assert.equal(s.until, room.state.turnCount + FIRE_ROUNDS * 4);
  assert.equal(room.state.effects.filter((e: any) => e.kind === "fire").length, s.strikes);
  assert.match(room.state.lastEvent, /thunderstorm breaks/);
  assert.equal(s.chance, 5);
  assert.equal(s.level, "unlikely");
});

test("a calm roll makes the next one likelier, and the forecast says so", () => {
  const { room, clients } = startedRoom();
  room.state.turnCount = room.state.storm.every - 1;
  const random = Math.random;
  Math.random = () => 0; // a 1 on the die
  try {
    move(room, clients, 0, 0);
  } finally {
    Math.random = random;
  }
  const s = room.state.storm;
  assert.equal(s.roll, 1);
  assert.equal(s.seq, 0);
  assert.equal(s.calm, 1);
  assert.equal(s.chance, 10);
  assert.equal(s.rolledAt, room.state.turnCount);
});

test("no roll is made between roll turns", () => {
  const { room, clients } = startedRoom();
  move(room, clients, 0, 0);
  assert.equal(room.state.storm.roll, 0);
});
