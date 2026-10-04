// The river spirit. Every so many turns the room rolls a D6 out of sight; on a
// 4, 5 or 6 a spirit rises from the river at a random spot beside the board,
// facing one of the edge points. One to three turns later (the players aren't
// told which) it takes one of the stones within its reach, picked at random,
// and sinks back. Its reach is three points of the outer ring: the one it faces
// and that point's two neighbours along the ring. A miss changes nothing: every
// roll has the same 1 in 2 chance (unlike the storm's, rules/storm.ts).
//
// The decisions live here, away from room state, so they can be tested without
// a server; rooms/GoRoom.ts keeps the timers and web/pixelScene.js draws it.

import { isRollTurn as isEvery } from "./storm";

export const SPIRIT_EVERY_TURNS = 5;
export const SPIRIT_DIE_FACES = 6;
export const SPIRIT_RISES_FROM = 4; // a roll of this or more brings it up
export const SPIRIT_MAX_WAIT = 3; // it acts within this many turns of rising
export const SPIRIT_REACH = 3; // outer-ring points it can take a stone from

export type SpiritSide = "top" | "right" | "bottom" | "left";

/** Where the spirit rises: in the river on `side`, facing the edge point (x, y). */
export interface SpiritSpot {
  side: SpiritSide;
  x: number;
  y: number;
}

/** The D6 is rolled every `every` turns, as the storm's die is -- never on turn 0. */
export function isRollTurn(turnCount: number, every: number = SPIRIT_EVERY_TURNS): boolean {
  return isEvery(turnCount, every);
}

export function rollSpiritDie(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * SPIRIT_DIE_FACES);
}

export function spiritRisesOn(roll: number): boolean {
  return roll >= SPIRIT_RISES_FROM;
}

/** The board's outer ring as board indices, clockwise from the top-left corner. */
export function outerRing(size: number): number[] {
  if (size <= 1) return size === 1 ? [0] : [];
  const ring: number[] = [];
  const last = size - 1;
  for (let x = 0; x < last; x++) ring.push(x); // top, left to right
  for (let y = 0; y < last; y++) ring.push(y * size + last); // right, downwards
  for (let x = last; x > 0; x--) ring.push(last * size + x); // bottom, right to left
  for (let y = last; y > 0; y--) ring.push(y * size); // left, upwards
  return ring;
}

/** Every spot the spirit can rise at: one in front of each edge point, on each of the four sides. */
export function spiritSpots(size: number): SpiritSpot[] {
  const spots: SpiritSpot[] = [];
  const last = size - 1;
  for (let x = 0; x < size; x++) spots.push({ side: "top", x, y: 0 });
  for (let y = 0; y < size; y++) spots.push({ side: "right", x: last, y });
  for (let x = 0; x < size; x++) spots.push({ side: "bottom", x, y: last });
  for (let y = 0; y < size; y++) spots.push({ side: "left", x: 0, y });
  return spots;
}

/**
 * The outer-ring points a spirit facing edge point (x, y) can reach: that point
 * and its neighbours along the ring, which turns the corner where the board does.
 */
export function spiritReach(size: number, x: number, y: number): number[] {
  const ring = outerRing(size);
  const at = ring.indexOf(y * size + x);
  if (at === -1) return [];
  const reach = new Set<number>();
  const half = (SPIRIT_REACH - 1) >> 1;
  for (let d = -half; d <= half; d++) reach.add(ring[(at + d + ring.length) % ring.length]);
  return Array.from(reach);
}

export function pickSpot(size: number, random: () => number = Math.random): SpiritSpot {
  const spots = spiritSpots(size);
  return spots[Math.floor(random() * spots.length)];
}

/** How many turns after rising the spirit acts: 1 to SPIRIT_MAX_WAIT. */
export function strikeDelay(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * SPIRIT_MAX_WAIT);
}

/** One of `candidates` (stones the spirit may take), or -1 when there are none. */
export function pickVictim(candidates: number[], random: () => number = Math.random): number {
  if (candidates.length === 0) return -1;
  return candidates[Math.floor(random() * candidates.length)];
}
