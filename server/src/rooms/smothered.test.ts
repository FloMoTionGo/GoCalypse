import { test } from "node:test";
import assert from "node:assert/strict";
import { at, onTurn, playerOf, put, startedRoom } from "./room.testkit";
import { DRIFTWOOD, stoneCode } from "../rules/goRules";

// Cross-front kills score nothing (ideas.md §11.6): a stone that takes the last
// liberty of a group on the other front still kills it, and still earns the
// capture fireflies, but no prisoners. The stones are counted as smothered.

/** A rival's stone at (3,3) on `front`, walled in by driftwood on three sides: (3,4) is its last liberty. */
function lastLiberty(room: any, rival: number, front: "base" | "pattern") {
  put(room, 3, 3, stoneCode(rival, front));
  for (const [x, y] of [[2, 3], [4, 3], [3, 2]]) put(room, x, y, DRIFTWOOD);
}

/** A seat whose side on `front` is not the mover's: black/white on base, gray/transparent on pattern. */
function rivalOn(front: "base" | "pattern", mover: number): number {
  const side = (c: number) => (front === "base" ? (c === 1 || c === 3 ? 1 : 2) : c <= 2 ? 1 : 2);
  return [1, 2, 3, 4].find((c) => c !== mover && side(c) !== side(mover))!;
}

test("a cross-front capture kills the stones and pays the fireflies, but books no prisoners: they are smothered", () => {
  const { room, clients } = startedRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  lastLiberty(room, rivalOn("pattern", me.color), "pattern");
  const fireflies = me.fireflies;
  room.handleMove(client, { x: 3, y: 4, axis: "base" });
  assert.equal(at(room, 3, 3), 0, "the stone is gone");
  assert.equal(me.basePrisoners + me.patternPrisoners, 0, "no prisoners");
  assert.equal(me.smothered, 1);
  assert.equal(me.score, 1, "still a stone captured");
  assert.ok(me.fireflies - fireflies >= 5, "the capture fireflies are paid");
  assert.match(room.state.lastEvent, /smothered 1 (gray|transparent) stone \(no points\)/);
});

test("a same-front capture books a prisoner on that front, and nothing smothered", () => {
  const { room, clients } = startedRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  lastLiberty(room, rivalOn("pattern", me.color), "pattern");
  room.handleMove(client, { x: 3, y: 4, axis: "pattern" });
  assert.equal(at(room, 3, 3), 0);
  assert.equal(me.patternPrisoners, 1);
  assert.equal(me.smothered, 0);
  assert.doesNotMatch(room.state.lastEvent, /smothered/);
});

test("an item's stone smothers just as a move does: a Turn the Lantern kill across the fronts books nothing", () => {
  const { room, clients } = startedRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  // Two of my pattern stones, (3,3) and (3,4), walled in by driftwood. (3,4) turns to the base
  // front and strands (3,3): a kill on the front the flipped stone has left.
  put(room, 3, 3, stoneCode(me.color, "pattern"));
  put(room, 3, 4, stoneCode(me.color, "pattern"));
  for (const [x, y] of [[2, 3], [4, 3], [3, 2], [2, 4], [4, 4], [3, 5]]) put(room, x, y, DRIFTWOOD);
  me.powerups.push("turn_lantern");
  room.handleUsePowerup(client, { id: "turn_lantern", target: { x: 3, y: 4 } });
  assert.equal(at(room, 3, 4), stoneCode(me.color, "base"), "turned");
  assert.equal(at(room, 3, 3), 0, "the stranded stone died");
  assert.equal(me.basePrisoners + me.patternPrisoners, 0);
  assert.equal(me.smothered, 1);
});
