import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { at, DATA_DIR, makeRoom, onTurn, playerOf, put, startedRoom } from "./room.testkit";
import { queueRestore } from "../state/persist";
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

/** A rival's base stone taken at turn 0 in a storm lasting `until` turns from now; the taker's seat and the slot it belongs in. */
function takenInTheStorm(until: number) {
  const { room, clients } = startedRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  const rival = rivalOn("base", me.color);
  lastLiberty(room, stoneCode(rival, "base"));
  room.state.storm.until = room.state.turnCount + until;
  room.handleMove(client, { x: 3, y: 4, axis: "base" });
  assert.equal(me.captures[8], 1, "grey while the storm lasts");
  return { room, clients, me, real: stoneCode(rival, "base") - 1 };
}
const pass = (room: any) => room.applyPass(room.state.turnIndex);

test("captures: stones taken in the storm's grey turn to their real colour when the storm lifts", () => {
  const { room, me, real } = takenInTheStorm(3); // the move was turn 1 of the 3
  pass(room);
  assert.deepEqual([me.captures[8], me.captures[real]], [1, 0], "one turn of grey left: still grey");
  pass(room);
  assert.deepEqual([me.captures[8], me.captures[real]], [0, 1], "lifted: the real colour");
  assert.equal(total(me), me.score, "the split still adds up");
});

test("captures: a game that ends under the storm shows the real colours too", () => {
  const { room, me, real } = takenInTheStorm(100);
  for (let i = 0; i < 4; i++) pass(room);
  assert.equal(room.state.status, "finished");
  assert.deepEqual([me.captures[8], me.captures[real]], [0, 1]);
});

test("captures: the real colours of a storm's captures survive a restart", () => {
  const { room, me, real } = takenInTheStorm(3);
  room.dirty = true;
  room.saveSnapshot();
  const snapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR!, "rooms", `${room.roomId}.json`), "utf8"));
  const restored: any = makeRoom({ restoreToken: queueRestore(snapshot) });
  const again = restored.state.players.find((p: any) => p.color === me.color);
  assert.equal(again.captures[8], 1, "still grey after the restart");
  pass(restored);
  pass(restored);
  assert.deepEqual([again.captures[8], again.captures[real]], [0, 1]);
  restored.onDispose();
});

test("captures: the real colours wait on the server, out of the state every client is sent", () => {
  const { room, real } = takenInTheStorm(3);
  assert.equal(room.stormCaptures.length, 1, "held back for when the storm lifts");
  assert.equal(room.stormCaptures[0].slot, real);
  assert.equal(JSON.stringify(room.state.toJSON()).includes("stormCaptures"), false);
});
