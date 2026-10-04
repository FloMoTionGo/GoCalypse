import { test } from "node:test";
import assert from "node:assert/strict";
import { boardIndex } from "./goRules";

import * as rules from "./spirit";

const spirit = () => rules;

/** A random() that hands out these values in turn. */
function script(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const onEdge = (size: number, idx: number) => {
  const x = idx % size, y = Math.floor(idx / size);
  return x === 0 || y === 0 || x === size - 1 || y === size - 1;
};

test("spirit: the outer ring of a 13x13 board is its 48 edge points, clockwise, each once", () => {
  const { outerRing } = spirit();
  const ring = outerRing(13);
  assert.equal(ring.length, 48);
  assert.equal(new Set(ring).size, 48);
  assert.ok(ring.every((i) => onEdge(13, i)));
  assert.deepEqual(ring.slice(0, 3), [0, 1, 2], "starts at the top-left corner, heading right");
  assert.equal(ring[12], 12, "the top-right corner");
  assert.equal(ring[13], 25, "then down the right side");
});

test("spirit: it can rise in front of every edge point on all four sides: 52 spots on 13x13", () => {
  const { spiritSpots } = spirit();
  const spots = spiritSpots(13);
  assert.equal(spots.length, 52);
  for (const side of ["top", "right", "bottom", "left"]) {
    const mine = spots.filter((s) => s.side === side);
    assert.equal(mine.length, 13, side);
    for (const s of mine) {
      if (side === "top") assert.equal(s.y, 0);
      if (side === "bottom") assert.equal(s.y, 12);
      if (side === "left") assert.equal(s.x, 0);
      if (side === "right") assert.equal(s.x, 12);
    }
  }
});

test("spirit: it reaches three outer-ring points, the one it faces and its two neighbours along the ring", () => {
  const { spiritReach, spiritSpots } = spirit();
  const i = (x: number, y: number) => boardIndex(13, x, y);
  assert.deepEqual(spiritReach(13, 6, 0).sort((a, b) => a - b), [i(5, 0), i(6, 0), i(7, 0)]);
  assert.deepEqual(spiritReach(13, 12, 4).sort((a, b) => a - b), [i(12, 3), i(12, 4), i(12, 5)]);
  // At a corner the ring turns: facing (0, 0) it reaches along both sides.
  assert.deepEqual(spiritReach(13, 0, 0).sort((a, b) => a - b), [i(0, 0), i(1, 0), i(0, 1)].sort((a, b) => a - b));
  for (const spot of spiritSpots(13)) {
    const reach = spiritReach(13, spot.x, spot.y);
    assert.equal(new Set(reach).size, 3, `${spot.side} ${spot.x},${spot.y}`);
    assert.ok(reach.every((r) => onEdge(13, r)));
    assert.ok(reach.includes(i(spot.x, spot.y)), "the point it faces");
  }
});

test("spirit: its D6 is rolled every 5 turns, never on turn 0", () => {
  const { isRollTurn, SPIRIT_EVERY_TURNS } = spirit();
  assert.equal(SPIRIT_EVERY_TURNS, 5);
  assert.equal(isRollTurn(0), false);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 10, 11, 15].filter((t) => isRollTurn(t)), [5, 10, 15]);
  assert.equal(isRollTurn(5, 0), false, "every 0: never");
});

test("spirit: the D6 shows 1 to 6 and the spirit rises on a 4, 5 or 6 only", () => {
  const { rollSpiritDie, SPIRIT_DIE_FACES, spiritRisesOn } = spirit();
  assert.equal(SPIRIT_DIE_FACES, 6);
  assert.equal(rollSpiritDie(() => 0), 1);
  assert.equal(rollSpiritDie(() => 0.999999), 6);
  const seen = new Set<number>();
  for (let k = 0; k < 6; k++) seen.add(rollSpiritDie(() => k / 6));
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([1, 2, 3, 4, 5, 6].filter(spiritRisesOn), [4, 5, 6]);
});

test("spirit: a spot is drawn from all 52, and it acts 1 to 3 turns after rising", () => {
  const { pickSpot, SPIRIT_MAX_WAIT, spiritSpots, strikeDelay } = spirit();
  assert.deepEqual(pickSpot(13, () => 0), spiritSpots(13)[0]);
  assert.deepEqual(pickSpot(13, () => 0.999999), spiritSpots(13)[51]);
  assert.equal(SPIRIT_MAX_WAIT, 3);
  assert.equal(strikeDelay(() => 0), 1);
  assert.equal(strikeDelay(() => 0.5), 2);
  assert.equal(strikeDelay(() => 0.999999), 3);
});

test("spirit: it picks one of the stones within reach at random, and none when there are none", () => {
  const { pickVictim } = spirit();
  assert.equal(pickVictim([], Math.random), -1);
  assert.equal(pickVictim([7], () => 0.9), 7);
  assert.equal(pickVictim([3, 4, 5], () => 0), 3);
  assert.equal(pickVictim([3, 4, 5], () => 0.5), 4);
  assert.equal(pickVictim([3, 4, 5], script(0.99)), 5);
});
