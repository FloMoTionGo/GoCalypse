import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRollTurn,
  isStormRoll,
  pickStrikes,
  rollDie,
  STORM_DIE_FACES,
  STORM_EVERY_TURNS,
  STORM_MAX_STRIKES,
  stormChance,
  stormLevel,
} from "./storm";

/** A stand-in for Math.random that hands out a fixed series of values. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

test("the die is rolled every 20 turns, never on the empty board", () => {
  assert.equal(isRollTurn(0), false);
  assert.equal(isRollTurn(1), false);
  assert.equal(isRollTurn(19), false);
  assert.equal(isRollTurn(STORM_EVERY_TURNS), true);
  assert.equal(isRollTurn(2 * STORM_EVERY_TURNS), true);
  assert.equal(isRollTurn(6, 6), true); // debug rooms roll faster
  assert.equal(isRollTurn(6, 20), false);
});

test("the die is a D20 and every face can come up", () => {
  const faces = new Set<number>();
  for (let k = 0; k < 4000; k++) faces.add(rollDie());
  assert.equal(faces.size, STORM_DIE_FACES);
  assert.equal(Math.min(...faces), 1);
  assert.equal(Math.max(...faces), 20);
  assert.equal(rollDie(() => 0), 1);
  assert.equal(rollDie(() => 0.999), 20);
});

test("a first roll only breaks a storm on a 20", () => {
  assert.equal(isStormRoll(20), true);
  for (let face = 1; face <= 19; face++) assert.equal(isStormRoll(face), false);
});

test("every calm roll since the last storm adds one to the next roll", () => {
  assert.equal(isStormRoll(19, 0), false);
  assert.equal(isStormRoll(19, 1), true);
  assert.equal(isStormRoll(15, 4), false);
  assert.equal(isStormRoll(15, 5), true);
  assert.equal(isStormRoll(1, 19), true); // long enough without a storm and any roll will do
});

test("the chance of a storm starts at 5% and grows by 5% per calm roll", () => {
  assert.equal(stormChance(0), 0.05);
  assert.equal(stormChance(1), 0.1);
  assert.equal(stormChance(4), 0.25);
  assert.equal(stormChance(19), 1);
  assert.equal(stormChance(40), 1);
  // Against the rule itself: count the faces that would break a storm.
  for (let calm = 0; calm < 22; calm++) {
    let hits = 0;
    for (let face = 1; face <= STORM_DIE_FACES; face++) if (isStormRoll(face, calm)) hits++;
    assert.equal(stormChance(calm), hits / STORM_DIE_FACES);
  }
});

test("the forecast reads unlikely, likely, then very likely as calm rolls pile up", () => {
  assert.deepEqual([0, 1].map(stormLevel), ["unlikely", "unlikely"]);
  assert.deepEqual([2, 3, 4].map(stormLevel), ["likely", "likely", "likely"]);
  assert.deepEqual([5, 6, 12, 19].map(stormLevel), ["very likely", "very likely", "very likely", "very likely"]);
});

test("a storm drops between 1 and STORM_MAX_STRIKES bolts, all on distinct points", () => {
  const candidates = Array.from({ length: 169 }, (_, i) => i);
  for (let k = 0; k < 200; k++) {
    const struck = pickStrikes(candidates);
    assert.ok(struck.length >= 1 && struck.length <= STORM_MAX_STRIKES);
    assert.equal(new Set(struck).size, struck.length);
    for (const idx of struck) assert.ok(candidates.includes(idx));
  }
});

test("picking strikes never mutates the candidate list it was handed", () => {
  const candidates = [4, 8, 15, 16, 23, 42];
  const before = candidates.slice();
  pickStrikes(candidates);
  assert.deepEqual(candidates, before);
});

test("fewer free points than bolts just means fewer bolts", () => {
  assert.deepEqual(pickStrikes([7], seq([0.99, 0])), [7]);
  assert.equal(pickStrikes([], seq([0.99])).length, 0);
  assert.equal(pickStrikes([1, 2], seq([0.99, 0, 0])).length, 2);
});
