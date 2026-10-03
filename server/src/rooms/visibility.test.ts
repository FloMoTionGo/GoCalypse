import { test } from "node:test";
import assert from "node:assert/strict";
import { onTurn, passAround, playerOf, put, startedRoom } from "./room.testkit";
import { boardIndex, DRIFTWOOD, GREY_STONE, stoneCode } from "../rules/goRules";
import { BoardEffect } from "../state/GoState";

// findings B5 at the room level: GoState.seen and each seat's StateView, the
// only things a client is ever sent about the board and the other seats.

function effect(room: any, kind: string, x: number, y: number, owner: number, until: number) {
  const e = new BoardEffect();
  Object.assign(e, { kind, x, y, owner, until });
  room.state.effects.push(e);
}

const seen = (room: any, x: number, y: number) => room.state.seen[boardIndex(room.state.size, x, y)];

test("with nothing hidden, seen is the true board", () => {
  const { room } = startedRoom();
  put(room, 2, 3, stoneCode(1, "base"));
  put(room, 4, 4, DRIFTWOOD);
  room.onBeforePatch();
  assert.deepEqual(Array.from(room.state.seen), Array.from(room.state.board));
});

test("a fog hides the stone under it from everyone, its owner included", () => {
  const { room } = startedRoom();
  put(room, 5, 5, stoneCode(2, "base"));
  effect(room, "fog", 5, 5, 2, 8);
  room.onBeforePatch();
  assert.equal(seen(room, 5, 5), 0);
  for (const p of room.state.players) assert.equal(p.misted.length, 0);
});

test("a stone under a Mist is 0 for the table and handed to its owner through misted", () => {
  const { room } = startedRoom();
  const code = stoneCode(3, "pattern");
  put(room, 6, 2, code);
  effect(room, "mist", 6, 2, 3, 8);
  room.onBeforePatch();
  const i = boardIndex(room.state.size, 6, 2);
  assert.equal(room.state.seen[i], 0);
  for (const p of room.state.players) {
    assert.deepEqual(Array.from(p.misted), p.color === 3 ? [i, code] : [], `color ${p.color}`);
  }
});

test("an effect whose time is up hides nothing", () => {
  const { room } = startedRoom();
  put(room, 1, 1, stoneCode(1, "base"));
  effect(room, "fog", 1, 1, 1, 0);
  room.onBeforePatch();
  assert.equal(seen(room, 1, 1), stoneCode(1, "base"));
});

test("while a storm's grey lasts every player stone is sent as the grey stone, driftwood as itself", () => {
  const { room } = startedRoom();
  put(room, 1, 1, stoneCode(1, "base"));
  put(room, 2, 2, stoneCode(4, "pattern"));
  put(room, 3, 3, DRIFTWOOD);
  put(room, 8, 8, stoneCode(2, "base"));
  effect(room, "mist", 8, 8, 2, 8);
  room.state.storm.until = room.state.turnCount + 12;
  room.onBeforePatch();
  assert.equal(seen(room, 1, 1), GREY_STONE);
  assert.equal(seen(room, 2, 2), GREY_STONE);
  assert.equal(seen(room, 3, 3), DRIFTWOOD);
  const owner = room.state.players.find((p: any) => p.color === 2);
  assert.deepEqual(Array.from(owner.misted), [boardIndex(room.state.size, 8, 8), GREY_STONE], "even one's own misted stone is grey");
});

test("once the game is over seen is the true board, fog, mist and grey or not", () => {
  const { room, clients } = startedRoom();
  put(room, 5, 5, stoneCode(2, "base"));
  effect(room, "fog", 5, 5, 2, 100);
  room.state.storm.until = 100;
  passAround(room, clients, 4);
  assert.equal(room.state.status, "finished");
  assert.deepEqual(Array.from(room.state.seen), Array.from(room.state.board));
});

test("each client's view holds its own seat only, until the game ends and holds every seat", () => {
  const { room, clients } = startedRoom();
  for (const c of clients) {
    for (const p of room.state.players) assert.equal(c.view.has(p), p === playerOf(room, c), `${c.sessionId} sees ${p.name}`);
  }
  (room as any).clients = Object.assign(clients, { getById: (id: string) => clients.find((c) => c.sessionId === id) });
  passAround(room, clients, 4);
  for (const c of clients) for (const p of room.state.players) assert.ok(c.view.has(p));
});

test("a bot sees the board a human in its seat would", () => {
  const { room, clients } = startedRoom();
  const me = playerOf(room, onTurn(room, clients));
  const rival = room.state.players.find((p: any) => p !== me);
  put(room, 9, 9, stoneCode(rival.color, "base"));
  effect(room, "mist", 9, 9, rival.color, 8);
  const view = room.botView(room.state.turnIndex);
  const i = boardIndex(room.state.size, 9, 9);
  assert.equal(view.board[i], 0);
  assert.equal(view.isFogged(i), true, "a rival's mist is no place to play");
});
