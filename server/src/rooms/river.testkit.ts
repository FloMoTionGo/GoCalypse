// Shared set-up for the river creature tests (river.test.ts, bait.test.ts).
//
// The river creatures (rules/river.ts): every 5 turns, once the Night Market is
// open, a D6 is rolled. On a 5 or 6 a creature climbs out of the river onto
// the pier, facing an edge point: the river crab two times in three, the river
// spirit one time in three, at most one of each. Three rounds later it acts and
// goes back into the water: the crab pinches one stone within its reach, picked
// at random; the spirit steals every one. Their dice are scripted through
// riverRandom, drawn in this order: the D6; after a 5 or 6 the kind, then the
// spot; and when the crab acts, the stone it pinches.
import assert from "node:assert/strict";
import { at, move, onTurn, startedRoom } from "./room.testkit";
import { boardIndex } from "../rules/goRules";
import { BoardEffect } from "../state/GoState";

/** A random() that hands out these values in turn, then repeats the last. */
export function script(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

export const DIE = (face: number) => (face - 0.5) / 6; // random() that rolls this face on a D6
export const CRAB = 0.1; // the kind drawn after a 5 or 6: crab below 2/3, spirit above
export const SPIRIT = 0.9;
export const SPOT = (n: number) => (n + 0.5) / 52; // the n-th of 52 spots: top 0-12, right 13-25, bottom 26-38, left 39-51
export const PICK = (k: number, of: number) => (k + 0.5) / of; // the k-th of `of` stones within the crab's reach

// Isolated points well inside the board, so the moves that pass the turns
// capture nothing and never stand within a creature's reach.
const INSIDE: [number, number][] = [];
for (let y = 2; y <= 10; y += 2) for (let x = 2; x <= 10; x += 2) INSIDE.push([x, y]);

/**
 * Plays `n` turns: a pass, or a stone on the next free inside point once two
 * seats have passed in a row, so the passes never end the game and the inside
 * points last. Passes earn nothing, moves 3 fireflies.
 */
export function turns(room: any, clients: any[], n: number) {
  for (let k = 0; k < n; k++) {
    const before = room.state.turnCount;
    if (room.state.passes >= 2) {
      const [x, y] = INSIDE.find(([px, py]) => at(room, px, py) === 0)!;
      move(room, clients, x, y);
    } else {
      room.handlePass(onTurn(room, clients));
    }
    assert.equal(room.state.turnCount, before + 1, `turn ${before + 1}`);
  }
}

/** Plays turns until turnCount reaches `turn`. */
export function until(room: any, clients: any[], turn: number) {
  turns(room, clients, turn - room.state.turnCount);
}

export function effect(room: any, kind: string, x: number, y: number, owner: number) {
  const e = new BoardEffect();
  Object.assign(e, { kind, x, y, owner, until: 1000 });
  room.state.effects.push(e);
}

export const idx = (x: number, y: number) => boardIndex(13, x, y);
export const reachOf = (c: any): number[] => [c.reach0, c.reach1, c.reach2].sort((a: number, b: number) => a - b);
export const tookOf = (c: any): number[] => [c.took0, c.took1, c.took2].filter((i: number) => i >= 0).sort((a: number, b: number) => a - b);

/** A started room with the Night Market open from the first turn. */
export function openRoom() {
  const t = startedRoom();
  t.room.state.shopAfter = 0;
  return t;
}

/**
 * A room where `kind` (CRAB or SPIRIT) comes up on turn 5 facing (6, 0) from
 * the top, to act on turn 17; the rolls on turns 10 and 15 bring nothing; then
 * the values in `more`.
 */
export function risen(kind: number, ...more: number[]) {
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(5), kind, SPOT(6), DIE(1), DIE(1), ...more);
  turns(room, clients, 5);
  return { room, clients };
}
