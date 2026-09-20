import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isRollTurn,
  isStormRoll,
  pickStrikes,
  rollDie,
  STORM_EVERY_TURNS,
  STORM_MAX_STRIKES,
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

test("only a six brings a storm, and every face can come up", () => {
  const faces = new Set<number>();
  for (let k = 0; k < 600; k++) faces.add(rollDie());
  assert.deepEqual(Array.from(faces).sort(), [1, 2, 3, 4, 5, 6]);
  assert.equal(isStormRoll(6), true);
  for (const face of [1, 2, 3, 4, 5]) assert.equal(isStormRoll(face), false);
  assert.equal(rollDie(() => 0), 1);
  assert.equal(rollDie(() => 0.999), 6);
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
