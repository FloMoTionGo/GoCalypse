import { test } from "node:test";
import assert from "node:assert/strict";
import { at, onTurn, playerOf, put, startedRoom } from "./room.testkit";
import { DRIFTWOOD, stoneCode, twinCode } from "../rules/goRules";

// Each player's captured stones split by colour (PlayerState.captures), for the
// players panel's tip: one count per board code 1..8, then the stones taken in
// the storm's grey and those taken unseen under a Mist. Booked by what everyone
// could see when the stone was taken, so the split tells nobody whose stone the
// grey or the mist hid (findings B5). The counts add up to the score.

/** `code` at (3,3), walled in by driftwood on three sides: (3,4) is its last liberty. */
function lastLiberty(room: any, code: number) {
  put(room, 3, 3, code);
  for (const [x, y] of [[2, 3], [4, 3], [3, 2]]) put(room, x, y, DRIFTWOOD);
}

/** A seat whose side on `front` is not the mover's: black/white on base, gray/transparent on pattern. */
function rivalOn(front: "base" | "pattern", mover: number): number {
  const side = (c: number) => (front === "base" ? (c === 1 || c === 3 ? 1 : 2) : c <= 2 ? 1 : 2);
  return [1, 2, 3, 4].find((c) => c !== mover && side(c) !== side(mover))!;
}

const total = (p: any) => Array.from(p.captures as number[]).reduce((a, b) => a + b, 0);

test("captures: a captured stone is booked by its colour in the taker's split, which adds up to the score", () => {
  const { room, clients } = startedRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  assert.deepEqual(Array.from(me.captures), Array(10).fill(0), "ten counts, all 0 at the start");
  const rival = rivalOn("base", me.color);
  lastLiberty(room, stoneCode(rival, "base"));
  room.handleMove(client, { x: 3, y: 4, axis: "base" });
  assert.equal(at(room, 3, 3), 0, "taken");
  const expected = Array(10).fill(0);
  expected[stoneCode(rival, "base") - 1] = 1;
  assert.deepEqual(Array.from(me.captures), expected);
  assert.equal(total(me), me.score);
});

test("captures: a rival's pattern stone is booked as that pattern colour", () => {
  const { room, clients } = startedRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  const rival = rivalOn("pattern", me.color);
  lastLiberty(room, stoneCode(rival, "pattern"));
  room.handleMove(client, { x: 3, y: 4, axis: "pattern" });
  assert.equal(me.captures[stoneCode(rival, "pattern") - 1], 1);
  assert.equal(total(me), me.score);
});

test("captures: a twin stone is booked as its owner's stone of the front it died on", () => {
  const { room, clients } = startedRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  const rival = rivalOn("base", me.color);
  lastLiberty(room, twinCode(rival));
  room.handleMove(client, { x: 3, y: 4, axis: "base" });
  assert.equal(at(room, 3, 3), 0, "taken");
  assert.equal(me.captures[stoneCode(rival, "base") - 1], 1, "the rival's base stone");
  assert.equal(total(me), me.score);
});

test("captures: a stone taken in the storm's grey is booked as grey, and one under a Mist as unseen: the split tells nobody whose they were (B5)", () => {
  {
    const { room, clients } = startedRoom();
    const client = onTurn(room, clients);
    const me = playerOf(room, client);
    const rival = rivalOn("base", me.color);
    lastLiberty(room, stoneCode(rival, "base"));
    room.state.storm.until = room.state.turnCount + 10;
    room.handleMove(client, { x: 3, y: 4, axis: "base" });
    assert.equal(at(room, 3, 3), 0, "taken in the storm");
    assert.equal(me.captures[8], 1, "booked as grey");
    assert.equal(me.captures[stoneCode(rival, "base") - 1], 0, "not as the rival's");
  }
  {
    const { room, clients } = startedRoom();
    const client = onTurn(room, clients);
    const me = playerOf(room, client);
    const rival = rivalOn("base", me.color);
    lastLiberty(room, stoneCode(rival, "base"));
    room.addEffect("mist", 3, 3, rival, 1);
    room.handleMove(client, { x: 3, y: 4, axis: "base" });
    assert.equal(at(room, 3, 3), 0, "taken under the mist");
    assert.equal(me.captures[9], 1, "booked as unseen");
    assert.equal(me.captures[stoneCode(rival, "base") - 1], 0, "not as the rival's");
  }
});
