import { test } from "node:test";
import assert from "node:assert/strict";
import { boardIndex } from "./goRules";

// The river creatures' rules (rules/river.ts), loaded per test so each one
// fails on its own until the module exists.
type Kind = "crab" | "spirit";
interface Spot {
  side: string;
  x: number;
  y: number;
}
interface RiverRules {
  RIVER_EVERY_TURNS: number;
  RIVER_DIE_FACES: number;
  RIVER_ROUNDS: number;
  isRollTurn(turnCount: number, every?: number): boolean;
  rollRiverDie(random: () => number): number;
  creatureRisesOn(roll: number): boolean;
  pickKind(random: () => number): Kind;
  outerRing(size: number): number[];
  riverSpots(size: number): Spot[];
  creatureReach(size: number, x: number, y: number): number[];
  freeSpots(size: number, taken: number[]): Spot[];
  pickSpot(size: number, random: () => number, taken?: number[]): Spot | null;
  timerTurns(seats: number): number;
  roundsLeft(by: number, turnCount: number, seats: number): number;
  takes(kind: Kind, candidates: number[], random: () => number): number[];
}
const river = (): RiverRules => require("./river");

const onEdge = (size: number, idx: number) => {
  const x = idx % size, y = Math.floor(idx / size);
  return x === 0 || y === 0 || x === size - 1 || y === size - 1;
};
const sorted = (a: number[]) => a.slice().sort((p, q) => p - q);

test("river: the outer ring of a 13x13 board is its 48 edge points, clockwise, each once", () => {
  const { outerRing } = river();
  const ring = outerRing(13);
  assert.equal(ring.length, 48);
  assert.equal(new Set(ring).size, 48);
  assert.ok(ring.every((i) => onEdge(13, i)));
  assert.deepEqual(ring.slice(0, 3), [0, 1, 2], "starts at the top-left corner, heading right");
  assert.equal(ring[12], 12, "the top-right corner");
  assert.equal(ring[13], 25, "then down the right side");
});

test("river: a creature can come up in front of every edge point on all four sides: 52 spots on 13x13", () => {
  const { riverSpots } = river();
  const spots = riverSpots(13);
  assert.equal(spots.length, 52);
  const sides = ["top", "right", "bottom", "left"];
  for (const s of spots) {
    assert.ok(sides.includes(s.side), s.side);
    assert.ok(onEdge(13, boardIndex(13, s.x, s.y)), `${s.side} faces (${s.x}, ${s.y}), an edge point`);
    if (s.side === "top") assert.equal(s.y, 0);
    if (s.side === "bottom") assert.equal(s.y, 12);
    if (s.side === "left") assert.equal(s.x, 0);
    if (s.side === "right") assert.equal(s.x, 12);
  }
  assert.equal(new Set(spots.map((s) => `${s.side}${s.x},${s.y}`)).size, 52, "each spot once");
  for (const side of sides) assert.equal(spots.filter((s) => s.side === side).length, 13, side);
});

test("river: a creature reaches three outer-ring points, the one it faces and its two neighbours along the ring", () => {
  const { creatureReach } = river();
  const i = (x: number, y: number) => boardIndex(13, x, y);
  assert.deepEqual(sorted(creatureReach(13, 6, 0)), [i(5, 0), i(6, 0), i(7, 0)]);
  assert.deepEqual(sorted(creatureReach(13, 12, 6)), [i(12, 5), i(12, 6), i(12, 7)]);
  assert.deepEqual(sorted(creatureReach(13, 0, 0)), sorted([i(1, 0), i(0, 0), i(0, 1)]), "it turns the corner");
  assert.deepEqual(sorted(creatureReach(13, 12, 12)), sorted([i(12, 11), i(12, 12), i(11, 12)]));
  for (let x = 0; x < 13; x++) assert.equal(new Set(creatureReach(13, x, 12)).size, 3, `three distinct points from (${x}, 12)`);
});

test("river: the D6 is rolled every 5 turns, never on turn 0, and only a 5 or 6 brings a creature", () => {
  const { RIVER_EVERY_TURNS, RIVER_DIE_FACES, isRollTurn, rollRiverDie, creatureRisesOn } = river();
  assert.equal(RIVER_EVERY_TURNS, 5);
  assert.equal(RIVER_DIE_FACES, 6);
  assert.equal(isRollTurn(0), false);
  assert.deepEqual([4, 5, 6, 10, 15, 16].map((t) => isRollTurn(t)), [false, true, false, true, true, false]);
  assert.equal(isRollTurn(4, 2), true, "a room may roll more often");
  const faces = new Set<number>();
  for (let k = 0; k < 600; k++) faces.add(rollRiverDie(() => (k + 0.5) / 600));
  assert.deepEqual(Array.from(faces).sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(rollRiverDie(() => 0), 1);
  assert.equal(rollRiverDie(() => 0.999999), 6);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(creatureRisesOn), [false, false, false, false, true, true]);
});

test("river: after a 5 or 6 the crab comes two times in three, the spirit one time in three", () => {
  const { pickKind } = river();
  let crabs = 0;
  for (let k = 0; k < 300; k++) if (pickKind(() => (k + 0.5) / 300) === "crab") crabs++;
  assert.equal(crabs, 200);
  assert.equal(pickKind(() => 0), "crab");
  assert.equal(pickKind(() => 0.999999), "spirit");
});

test("river: its timer is 3 rounds, counted in turns for the table, and shows the rounds left", () => {
  const { RIVER_ROUNDS, timerTurns, roundsLeft } = river();
  assert.equal(RIVER_ROUNDS, 3);
  assert.equal(timerTurns(4), 12, "3 rounds of 4 seats");
  assert.equal(timerTurns(2), 6);
  // Up on turn 20 at a table of 4, so it acts on turn 32.
  assert.deepEqual([20, 21, 24, 25, 28, 29, 31, 32, 40].map((t) => roundsLeft(32, t, 4)), [3, 3, 2, 2, 1, 1, 1, 0, 0]);
});

test("river: a second creature only comes up where its reach doesn't touch the first one's", () => {
  const { creatureReach, freeSpots, pickSpot, riverSpots } = river();
  assert.equal(freeSpots(13, []).length, 52, "with nothing out every spot is free");
  const taken = creatureReach(13, 6, 0);
  const free = freeSpots(13, taken);
  assert.ok(free.length > 0 && free.length < 52);
  for (const s of free) {
    const reach = creatureReach(13, s.x, s.y);
    assert.ok(reach.every((i) => !taken.includes(i)), `${s.side} (${s.x}, ${s.y}) keeps clear`);
  }
  for (const s of riverSpots(13)) {
    const clear = creatureReach(13, s.x, s.y).every((i) => !taken.includes(i));
    assert.equal(free.some((f) => f.side === s.side && f.x === s.x && f.y === s.y), clear, `${s.side} (${s.x}, ${s.y})`);
  }
  // pickSpot draws from the free ones: the first and the last of them.
  assert.deepEqual(pickSpot(13, () => 0, taken), free[0]);
  assert.deepEqual(pickSpot(13, () => 0.999999, taken), free[free.length - 1]);
  assert.deepEqual(pickSpot(13, () => (6 + 0.5) / 52), { side: "top", x: 6, y: 0 }, "with nothing taken, all 52");
});

test("river: the crab pinches one stone in reach at random, the spirit steals every one of them", () => {
  const { takes } = river();
  assert.deepEqual(takes("crab", [5, 6, 7], () => 0), [5]);
  assert.deepEqual(takes("crab", [5, 6, 7], () => 0.5), [6]);
  assert.deepEqual(takes("crab", [5, 6, 7], () => 0.99), [7]);
  assert.deepEqual(takes("crab", [], () => 0.5), []);
  assert.deepEqual(sorted(takes("spirit", [7, 5, 6], () => 0.5)), [5, 6, 7]);
  assert.deepEqual(takes("spirit", [6], () => 0.5), [6]);
  assert.deepEqual(takes("spirit", [], () => 0.5), []);
});

// ---- the Bait lures a creature (ideas.md §11.7) --------------------------------------
// Tossed onto an edge point, the Bait draws a creature along the frame to it:
// the nearer one along the ring if both are out, the crab on a tie.
interface LureRules {
  ringDistance(size: number, a: number, b: number): number;
  spotFacing(size: number, idx: number, from: number): Spot | null;
  nearerCreature<T extends { kind: Kind; at: number }>(size: number, idx: number, creatures: T[]): T | null;
}
const lure = (): LureRules => require("./river");
const P13 = (x: number, y: number) => boardIndex(13, x, y);

test("river: the distance between two edge points is the shorter way round the ring; off the ring there is none", () => {
  const { ringDistance } = lure();
  assert.equal(ringDistance(13, P13(0, 0), P13(12, 0)), 12, "along the top");
  assert.equal(ringDistance(13, P13(11, 0), P13(12, 1)), 2, "round the corner");
  assert.equal(ringDistance(13, P13(6, 0), P13(6, 12)), 24, "half way round, either way");
  assert.equal(ringDistance(13, P13(1, 0), P13(0, 1)), 2, "the short way, across the top-left corner");
  assert.equal(ringDistance(13, P13(4, 0), P13(4, 0)), 0);
  assert.equal(ringDistance(13, P13(4, 0), P13(4, 4)), -1, "an inside point is on no ring");
});

test("river: a lured creature faces its point from that point's side; at a corner, from the side it walked in along", () => {
  const { spotFacing } = lure();
  assert.deepEqual(spotFacing(13, P13(9, 0), P13(6, 0)), { side: "top", x: 9, y: 0 });
  assert.deepEqual(spotFacing(13, P13(12, 5), P13(6, 0)), { side: "right", x: 12, y: 5 });
  assert.deepEqual(spotFacing(13, P13(12, 0), P13(9, 0)), { side: "top", x: 12, y: 0 }, "walked in along the top");
  assert.deepEqual(spotFacing(13, P13(12, 0), P13(12, 4)), { side: "right", x: 12, y: 0 }, "walked up the right side");
  assert.deepEqual(spotFacing(13, P13(0, 12), P13(0, 6)), { side: "left", x: 0, y: 12 });
  assert.deepEqual(spotFacing(13, P13(0, 12), P13(5, 12)), { side: "bottom", x: 0, y: 12 });
  assert.equal(spotFacing(13, P13(5, 5), P13(6, 0)), null, "not an edge point");
});

test("river: with both creatures out, the nearer one along the ring takes the bait; on a tie, the crab", () => {
  const { nearerCreature } = lure();
  const out = [
    { kind: "crab" as Kind, at: P13(6, 0) },
    { kind: "spirit" as Kind, at: P13(6, 12) },
  ];
  assert.equal(nearerCreature(13, P13(2, 0), out)?.kind, "crab");
  assert.equal(nearerCreature(13, P13(12, 10), out)?.kind, "spirit");
  assert.equal(nearerCreature(13, P13(0, 6), out)?.kind, "crab", "12 steps from both");
  assert.equal(nearerCreature(13, P13(0, 6), [out[1]])?.kind, "spirit", "alone, it comes whatever the way");
  assert.equal(nearerCreature(13, P13(0, 6), []), null);
});
