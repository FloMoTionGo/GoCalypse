// The river creatures: the river crab and the river spirit. Every so many turns
// the room rolls a D6; on a 5 or 6 a creature climbs out of the river onto the
// pier, facing one of the edge points: the crab two times in three, the spirit
// one time in three, and never two of a kind at once. It stands there for 3
// rounds, its timer over its head, then acts and goes back into the water: the
// crab pinches one of the stones within its reach, picked at random; the spirit
// steals every one. Its reach is three points of the outer ring: the one it
// faces and that point's two neighbours along the ring. A Bait tossed onto an
// edge point lures it there along the frame, its timer running on as it was
// (powerups/definitions.ts). A miss changes nothing: every roll has the same
// odds (unlike the storm's, rules/storm.ts).
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

/** Steps between two edge points the shorter way round the ring, or -1 if either is off it. */
export function ringDistance(size: number, a: number, b: number): number {
  const ring = outerRing(size);
  const i = ring.indexOf(a), j = ring.indexOf(b);
  if (i === -1 || j === -1) return -1;
  const d = Math.abs(i - j);
  return Math.min(d, ring.length - d);
}

/** The side of the board both edge points lie on, if they share one. */
function sharedSide(size: number, a: number, b: number): RiverSide | null {
  const last = size - 1;
  const [ax, ay, bx, by] = [a % size, Math.floor(a / size), b % size, Math.floor(b / size)];
  if (ay === 0 && by === 0) return "top";
  if (ax === last && bx === last) return "right";
  if (ay === last && by === last) return "bottom";
  if (ax === 0 && bx === 0) return "left";
  return null;
}

/**
 * The edge points a creature walks over from the point it faces (`from`) to
 * `to`, both included, the shorter way round the ring (clockwise on a tie).
 */
export function ringPath(size: number, from: number, to: number): number[] {
  const ring = outerRing(size);
  const i = ring.indexOf(from), j = ring.indexOf(to);
  if (i === -1 || j === -1) return [];
  const n = ring.length;
  const forward = (j - i + n) % n;
  const step = forward <= n - forward ? 1 : -1;
  const path = [ring[i]];
  for (let k = i; k !== j; ) {
    k = (k + step + n) % n;
    path.push(ring[k]);
  }
  return path;
}

/**
 * Where a creature lured from the point it faces (`from`) to edge point `idx`
 * stands: in front of `idx`, on the side it walked in along -- which matters
 * only at a corner. Null when `idx` is not an edge point.
 */
export function spotFacing(size: number, idx: number, from: number): RiverSpot | null {
  const path = ringPath(size, from, idx);
  if (path.length === 0) return null;
  const x = idx % size, y = Math.floor(idx / size);
  const walkedAlong = path.length >= 2 ? sharedSide(size, path[path.length - 2], idx) : null;
  const side = walkedAlong ?? riverSpots(size).find((s) => s.x === x && s.y === y)!.side;
  return { side, x, y };
}

/** Of the creatures out, each with the edge point it faces (`at`), the nearer one along the ring to `idx`; the crab on a tie. */
export function nearerCreature<T extends { kind: CreatureKind; at: number }>(size: number, idx: number, creatures: T[]): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const kind of CREATURE_KINDS) {
    for (const c of creatures) {
      if (c.kind !== kind) continue;
      const d = ringDistance(size, c.at, idx);
      if (d >= 0 && d < bestDistance) {
        best = c;
        bestDistance = d;
      }
    }
  }
  return best;
}
