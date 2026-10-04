import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { at, DATA_DIR, makeRoom, move, onTurn, passAround, put, startedRoom } from "./room.testkit";
import { boardIndex, DRIFTWOOD, stoneCode } from "../rules/goRules";
import { BoardEffect } from "../state/GoState";
import { queueRestore } from "../state/persist";

// The river spirit (rules/spirit.ts): every 5 turns a D6 is rolled, and on a 4,
// 5 or 6 a spirit rises from the river beside the board. One to three turns
// later it takes one of the stones within its reach on the outer ring, picked
// at random, and sinks back. Its dice are scripted here through spiritRandom.

/** A random() that hands out these values in turn, then repeats the last. */
function script(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

const DIE = (face: number) => (face - 0.5) / 6; // random() that rolls this face on a D6
const SPOT = (n: number) => (n + 0.5) / 52; // the n-th of 52 spots: top 0-12, right 13-25, bottom 26-38, left 39-51
const WAIT = (turns: number) => (turns - 0.5) / 3; // acts this many turns after rising
const PICK = (k: number, of: number) => (k + 0.5) / of; // the k-th of `of` stones within reach

// Isolated points well inside the board, so the moves that pass the turns
// capture nothing and never stand within the spirit's reach.
const INSIDE: [number, number][] = [];
for (let y = 2; y <= 10; y += 2) for (let x = 2; x <= 10; x += 2) INSIDE.push([x, y]);

/** Plays `n` turns, each a stone on the next free inside point. */
function turns(room: any, clients: any[], n: number) {
  for (let k = 0; k < n; k++) {
    const [x, y] = INSIDE.find(([px, py]) => at(room, px, py) === 0)!;
    const before = room.state.turnCount;
    move(room, clients, x, y);
    assert.equal(room.state.turnCount, before + 1, `a turn at (${x}, ${y})`);
  }
}

function effect(room: any, kind: string, x: number, y: number, owner: number) {
  const e = new BoardEffect();
  Object.assign(e, { kind, x, y, owner, until: 1000 });
  room.state.effects.push(e);
}

const idx = (x: number, y: number) => boardIndex(13, x, y);
const reachOf = (room: any) => [room.state.spirit.reach0, room.state.spirit.reach1, room.state.spirit.reach2].sort((a, b) => a - b);

/** A started room whose spirit rises on turn 5 facing (6, 0) from the top, and acts `wait` turns later. */
function risen(wait: number, ...more: number[]) {
  const { room, clients } = startedRoom();
  room.spiritRandom = script(DIE(5), SPOT(6), WAIT(wait), ...more);
  turns(room, clients, 5);
  return { room, clients };
}

test("river spirit: a D6 every 5 turns, and on a 1, 2 or 3 it stays under, with no better odds after a miss", () => {
  const { room, clients } = startedRoom();
  room.spiritRandom = script(DIE(1), DIE(2), DIE(3));
  assert.equal(room.state.spirit.every, 5);
  turns(room, clients, 4);
  assert.equal(room.state.spirit.rolledAt, 0, "no roll before turn 5");
  turns(room, clients, 1);
  assert.deepEqual([room.state.spirit.roll, room.state.spirit.rolledAt, room.state.spirit.out], [1, 5, false]);
  turns(room, clients, 4);
  assert.equal(room.state.spirit.rolledAt, 5, "the next roll waits 5 turns");
  turns(room, clients, 1);
  assert.deepEqual([room.state.spirit.roll, room.state.spirit.rolledAt, room.state.spirit.out], [2, 10, false]);
  turns(room, clients, 5);
  // A storm's calm rolls add up; the spirit's don't: a 3 after two misses is still a miss.
  assert.deepEqual([room.state.spirit.roll, room.state.spirit.rolledAt, room.state.spirit.out], [3, 15, false]);
  assert.equal(room.state.spirit.seq, 0, "it never rose");
});

test("river spirit: on a 4, 5 or 6 it rises beside the board, facing an edge point, with three ring points in reach", () => {
  for (const face of [4, 5, 6]) {
    const { room, clients } = startedRoom();
    room.spiritRandom = script(DIE(face), SPOT(6), WAIT(2));
    turns(room, clients, 5);
    const s = room.state.spirit;
    assert.equal(s.roll, face);
    assert.equal(s.out, true, `rises on a ${face}`);
    assert.equal(s.seq, 1);
    assert.deepEqual([s.side, s.x, s.y], ["top", 6, 0]);
    assert.deepEqual(reachOf(room), [idx(5, 0), idx(6, 0), idx(7, 0)]);
    assert.equal(s.rose, 5);
    assert.equal(s.by, 8, "it acts by the third turn after rising");
  }
  const { room, clients } = startedRoom();
  room.spiritRandom = script(DIE(4), SPOT(39), WAIT(1)); // the left side's first spot: the top-left corner
  turns(room, clients, 5);
  assert.deepEqual([room.state.spirit.side, room.state.spirit.x, room.state.spirit.y], ["left", 0, 0]);
  assert.deepEqual(reachOf(room), [idx(0, 0), idx(1, 0), idx(0, 1)].sort((a, b) => a - b));
});

test("river spirit: it takes one stone within its reach, picked at random, on the turn it drew", () => {
  const { room, clients } = risen(3, PICK(1, 3));
  put(room, 5, 0, stoneCode(1, "base"));
  put(room, 6, 0, stoneCode(2, "pattern"));
  put(room, 7, 0, stoneCode(3, "base"));
  turns(room, clients, 2);
  assert.equal(room.state.spirit.out, true, "still waiting on turn 7");
  assert.deepEqual([at(room, 5, 0), at(room, 6, 0), at(room, 7, 0)].map(Boolean), [true, true, true]);
  turns(room, clients, 1);
  const left = [idx(5, 0), idx(6, 0), idx(7, 0)].filter((i) => room.state.board[i] !== 0);
  assert.equal(left.length, 2, "exactly one stone is gone");
  assert.equal(room.state.spirit.out, false, "it sank back");
  assert.equal(room.state.spirit.took, idx(6, 0), "the middle one of three, as drawn");
  assert.equal(room.state.board[room.state.spirit.took], 0);
});

test("river spirit: stones outside its reach are left alone, and with none in reach it sinks back empty-handed", () => {
  const { room, clients } = risen(1);
  for (const [x, y] of [[4, 0], [8, 0], [6, 1], [12, 6], [0, 12]] as [number, number][]) put(room, x, y, stoneCode(2, "base"));
  const before = Array.from(room.state.board);
  turns(room, clients, 1);
  assert.equal(room.state.spirit.out, false);
  assert.equal(room.state.spirit.took, -1);
  for (const [x, y] of [[4, 0], [8, 0], [6, 1], [12, 6], [0, 12]] as [number, number][]) {
    assert.equal(at(room, x, y), before[idx(x, y)], `(${x}, ${y}) untouched`);
  }
  assert.match(room.state.lastEvent, /river spirit/i);
});

test("river spirit: a warded, fogged or misted stone, or driftwood, is out of its reach", () => {
  const { room, clients } = risen(1);
  put(room, 5, 0, stoneCode(1, "base"));
  effect(room, "ward", 5, 0, 1);
  put(room, 6, 0, stoneCode(2, "base"));
  effect(room, "mist", 6, 0, 2);
  put(room, 7, 0, DRIFTWOOD);
  turns(room, clients, 1);
  assert.equal(room.state.spirit.took, -1);
  assert.deepEqual([at(room, 5, 0), at(room, 6, 0), at(room, 7, 0)], [stoneCode(1, "base"), stoneCode(2, "base"), DRIFTWOOD]);

  const fogged = risen(1);
  put(fogged.room, 6, 0, stoneCode(4, "pattern"));
  effect(fogged.room, "fog", 6, 0, 1);
  turns(fogged.room, fogged.clients, 1);
  assert.equal(fogged.room.state.spirit.took, -1);
  assert.equal(at(fogged.room, 6, 0), stoneCode(4, "pattern"));
});

test("river spirit: the owner of the stone it takes is paid 3 fireflies, and nobody gets a prisoner", () => {
  const { room, clients } = risen(1);
  put(room, 7, 0, stoneCode(3, "pattern"));
  const owner = room.state.players.find((p: any) => p.color === 3);
  const before = room.state.players.map((p: any) => [p.fireflies, p.score, p.basePrisoners, p.patternPrisoners]);
  room.handlePass(onTurn(room, clients)); // a pass earns nothing itself
  assert.equal(room.state.spirit.took, idx(7, 0));
  room.state.players.forEach((p: any, i: number) => {
    const [ff, score, base, pattern] = before[i];
    assert.equal(p.fireflies, ff + (p === owner ? 3 : 0), `color ${p.color} fireflies`);
    assert.deepEqual([p.score, p.basePrisoners, p.patternPrisoners], [score, base, pattern], `color ${p.color} prisoners`);
  });
});

test("river spirit: its news is added to the turn's event, not put in its place", () => {
  const { room, clients } = startedRoom();
  room.spiritRandom = script(DIE(6), SPOT(20), WAIT(1));
  turns(room, clients, 4);
  move(room, clients, 6, 6);
  assert.match(room.state.lastEvent, /played \(6, 6\)/);
  assert.match(room.state.lastEvent, /river spirit/i);
});

test("river spirit: a game that ends while it is out sends it back into the water", () => {
  // Four turns played, then four passes: the first rises it (turn 5, to act on
  // turn 8), the last ends the game on turn 7.
  const { room, clients } = startedRoom();
  room.spiritRandom = script(DIE(4), SPOT(6), WAIT(3));
  turns(room, clients, 4);
  put(room, 6, 0, stoneCode(1, "base"));
  passAround(room, clients, 3);
  assert.equal(room.state.spirit.out, true, "up when the last pass comes");
  passAround(room, clients, 1);
  assert.equal(room.state.status, "finished");
  assert.equal(room.state.spirit.out, false);
  assert.equal(room.state.spirit.took, -1);
  assert.equal(at(room, 6, 0), stoneCode(1, "base"));
});

test("river spirit: it and the turn it will act on survive a snapshot restore", () => {
  const { room } = risen(2);
  room.saveSnapshot();
  const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR!, "rooms", `${room.roomId}.json`), "utf8"));
  const back = makeRoom({ restoreToken: queueRestore(snap) });
  const s = back.state.spirit;
  assert.deepEqual([s.out, s.side, s.x, s.y, s.rose, s.by, s.seq], [true, "top", 6, 0, 5, 8, 1]);
  assert.deepEqual(reachOf(back), [idx(5, 0), idx(6, 0), idx(7, 0)]);
  assert.equal(s.strikeAt, 7);
});
