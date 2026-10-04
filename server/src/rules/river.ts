// The river creatures: the river crab and the river spirit. Every so many turns
// the room rolls a D6; on a 5 or 6 a creature climbs out of the river onto the
// pier, facing one of the edge points: the crab two times in three, the spirit
// one time in three, and never two of a kind at once. It stands there for 3
// rounds, its timer over its head, then acts and goes back into the water: the
// crab pinches one of the stones within its reach, picked at random; the spirit
// steals every one. Its reach is three points of the outer ring: the one it
// faces and that point's two neighbours along the ring. A Bait sends it back
// early, empty-handed (powerups/definitions.ts). A miss changes nothing: every
// roll has the same odds (unlike the storm's, rules/storm.ts).
//
// The decisions live here, away from room state, so they can be tested without
// a server; rooms/GoRoom.ts keeps the timers and web/pixelScene.js draws them.

import { isRollTurn as isEvery } from "./storm";

export const RIVER_EVERY_TURNS = 5;
export const RIVER_DIE_FACES = 6;
export const RIVER_RISES_FROM = 5; // a roll of this or more brings a creature
export const RIVER_CRAB_SHARE = 2 / 3; // of the creatures that come, this many are crabs
export const RIVER_ROUNDS = 3; // its timer: it acts this many rounds after it came
export const RIVER_REACH = 3; // outer-ring points it can take a stone from

export type CreatureKind = "crab" | "spirit";
export const CREATURE_KINDS: CreatureKind[] = ["crab", "spirit"];
export type RiverSide = "top" | "right" | "bottom" | "left";

/** Where a creature comes up: out of the river on `side`, facing the edge point (x, y). */
export interface RiverSpot {
  side: RiverSide;
  x: number;
  y: number;
}

/** The D6 is rolled every `every` turns, as the storm's die is -- never on turn 0. */
export function isRollTurn(turnCount: number, every: number = RIVER_EVERY_TURNS): boolean {
  return isEvery(turnCount, every);
}

export function rollRiverDie(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * RIVER_DIE_FACES);
}

export function creatureRisesOn(roll: number): boolean {
  return roll >= RIVER_RISES_FROM;
}

/** Which creature a 5 or 6 brings. */
export function pickKind(random: () => number = Math.random): CreatureKind {
  return random() < RIVER_CRAB_SHARE ? "crab" : "spirit";
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

/** Every spot a creature can come up at: one in front of each edge point, on each of the four sides. */
export function riverSpots(size: number): RiverSpot[] {
  const spots: RiverSpot[] = [];
  const last = size - 1;
  for (let x = 0; x < size; x++) spots.push({ side: "top", x, y: 0 });
  for (let y = 0; y < size; y++) spots.push({ side: "right", x: last, y });
  for (let x = 0; x < size; x++) spots.push({ side: "bottom", x, y: last });
  for (let y = 0; y < size; y++) spots.push({ side: "left", x: 0, y });
  return spots;
}

/**
 * The outer-ring points a creature facing edge point (x, y) can reach: that
 * point and its neighbours along the ring, in ring order, which turns the
 * corner where the board does.
 */
export function creatureReach(size: number, x: number, y: number): number[] {
  const ring = outerRing(size);
  const at = ring.indexOf(y * size + x);
  if (at === -1) return [];
  const reach = new Set<number>();
  const half = (RIVER_REACH - 1) >> 1;
  for (let d = -half; d <= half; d++) reach.add(ring[(at + d + ring.length) % ring.length]);
  return Array.from(reach);
}

/** The spots whose reach shares no point with `taken` (another creature's reach). */
export function freeSpots(size: number, taken: number[]): RiverSpot[] {
  return riverSpots(size).filter((s) => creatureReach(size, s.x, s.y).every((i) => !taken.includes(i)));
}

/** A spot drawn from the free ones, or null when there is none. */
export function pickSpot(size: number, random: () => number = Math.random, taken: number[] = []): RiverSpot | null {
  const spots = freeSpots(size, taken);
  if (spots.length === 0) return null;
  return spots[Math.min(spots.length - 1, Math.floor(random() * spots.length))];
}

/** How many turns its timer runs at a table of `seats`: RIVER_ROUNDS full rounds. */
export function timerTurns(seats: number): number {
  return RIVER_ROUNDS * Math.max(1, seats);
}

/** Rounds left on a timer that runs out on turn `by`, rounded up: what it shows over its head. */
export function roundsLeft(by: number, turnCount: number, seats: number): number {
  return Math.max(0, Math.ceil((by - turnCount) / Math.max(1, seats)));
}

/**
 * The stones a creature takes from `candidates` (the stones within its reach
 * it may take): the crab pinches one, picked at random; the spirit steals them all.
 */
export function takes(kind: CreatureKind, candidates: number[], random: () => number = Math.random): number[] {
  if (candidates.length === 0) return [];
  if (kind === "spirit") return candidates.slice();
  return [candidates[Math.min(candidates.length - 1, Math.floor(random() * candidates.length))]];
}
