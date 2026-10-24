import { test } from "node:test";
import assert from "node:assert/strict";
import { at, notices, onTurn, playerOf, put } from "./room.testkit";
import { CRAB, DIE, effect, idx, openRoom, reachOf, risen, script, SPIRIT, SPOT, tookOf, turns, until } from "./river.testkit";
import { getPowerup } from "../powerups/definitions";
import { stoneCode } from "../rules/goRules";

// The Bait lures a river creature (ideas.md §11.7): tossed onto an edge point,
// it draws the creature along the frame to face that point, with its timer
// running on as it was; when it runs out, it takes what is in its new reach.
// Only ever defensive (D-Q3): a lure that would bring it onto another player's
// stone is refused. It still doesn't take the turn.

function baitInHand(room: any, clients: any[]) {
  const client = onTurn(room, clients);
  playerOf(room, client).powerups.push("bait");
  return client;
}
const holds = (room: any, client: any) => Array.from(playerOf(room, client).powerups).filter((id) => id === "bait").length;
const lure = (room: any, client: any, x: number, y: number) => room.handleUsePowerup(client, { id: "bait", target: { x, y } });
const sorted = (a: number[]) => a.slice().sort((p, q) => p - q);

test("lure: tossed on an edge point, the creature walks over to face it, and reaches that point and its two ring neighbours", () => {
  for (const kind of [CRAB, SPIRIT]) {
    const { room, clients } = risen(kind);
    const name = kind === CRAB ? "crab" : "spirit";
    const c = room.state.river[name];
    const seq = c.seq;
    const client = baitInHand(room, clients);
    lure(room, client, 12, 4);
    assert.equal(holds(room, client), 0, "the Bait is used up");
    assert.deepEqual([c.out, c.side, c.x, c.y], [true, "right", 12, 4], `the ${name} faces (12, 4) now`);
    assert.deepEqual(reachOf(c), sorted([idx(12, 3), idx(12, 4), idx(12, 5)]));
    assert.deepEqual([c.fromSide, c.fromX, c.fromY], ["top", 6, 0], "where it walked from, for the walk");
    assert.equal(c.seq, seq + 1);
    assert.equal(c.fed, false);
    assert.match(room.state.lastEvent, new RegExp(name));
    assert.match(room.state.lastEvent, /\(12, 4\)/);
  }
});

test("lure: the timer runs on as it was, and when it runs out the creature takes from its new reach only", () => {
  const { room, clients } = risen(SPIRIT);
  const spirit = room.state.river.spirit;
  const client = baitInHand(room, clients);
  const mine = playerOf(room, client).color;
  for (const x of [5, 6, 7]) put(room, x, 0, stoneCode(mine, "base"));
  put(room, 12, 4, stoneCode(mine, "base")); // the lurer's own stone: their own risk
  const by = spirit.by;
  lure(room, client, 12, 4);
  assert.equal(spirit.by, by, "the timer is unchanged");
  until(room, clients, by);
  assert.equal(spirit.out, false);
  assert.deepEqual(tookOf(spirit), [idx(12, 4)]);
  assert.deepEqual([at(room, 5, 0), at(room, 6, 0), at(room, 7, 0)], [mine, mine, mine].map((c) => stoneCode(c, "base")), "the old reach is safe");
});

test("lure: refused and kept off the ring, with no creature out, on the point it already faces, and with no point", () => {
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(1));
  turns(room, clients, 5);
  let client = baitInHand(room, clients);
  lure(room, client, 6, 0);
  assert.equal(holds(room, client), 1, "kept: nothing is out");
  assert.match(notices(client).at(-1) ?? "", /Bait/);

  const up = risen(CRAB);
  client = baitInHand(up.room, up.clients);
  for (const [x, y] of [[6, 6], [6, 0], [-1, 0]]) {
    lure(up.room, client, x, y);
    assert.equal(holds(up.room, client), 1, `kept: (${x}, ${y})`);
    assert.deepEqual([up.room.state.river.crab.x, up.room.state.river.crab.y], [6, 0]);
  }
  up.room.handleUsePowerup(client, { id: "bait" });
  assert.equal(holds(up.room, client), 1, "kept: no point given");
});

test("lure: never onto a rival's stone: a lure whose new reach holds another player's stone is refused and kept", () => {
  const { room, clients } = risen(CRAB);
  const crab = room.state.river.crab;
  const client = baitInHand(room, clients);
  const rival = (playerOf(room, client).color % 4) + 1;
  put(room, 12, 5, stoneCode(rival, "pattern"));
  lure(room, client, 12, 4);
  assert.equal(holds(room, client), 1, "kept");
  assert.deepEqual([crab.x, crab.y], [6, 0], "the crab stays where it was");
  lure(room, client, 12, 8);
  assert.deepEqual([crab.x, crab.y], [12, 8], "clear of the rival's stone, it goes");
});

test("lure: a rival's stone the creature couldn't take, under a ward or a fog, doesn't stop it", () => {
  for (const shield of ["ward", "fog"]) {
    const { room, clients } = risen(CRAB);
    const client = baitInHand(room, clients);
    const rival = (playerOf(room, client).color % 4) + 1;
    put(room, 12, 5, stoneCode(rival, "base"));
    effect(room, shield, 12, 5, rival);
    lure(room, client, 12, 4);
    assert.deepEqual([room.state.river.crab.x, room.state.river.crab.y], [12, 4], shield);
  }
});

test("lure: anyone may lure a creature away from anyone's stones", () => {
  const { room, clients } = risen(CRAB, 0.5);
  const client = baitInHand(room, clients);
  const rival = (playerOf(room, client).color % 4) + 1;
  put(room, 6, 0, stoneCode(rival, "base"));
  lure(room, client, 12, 4);
  until(room, clients, room.state.river.crab.by);
  assert.equal(at(room, 6, 0), stoneCode(rival, "base"), "the rival's stone is saved");
});

test("lure: with both out, the nearer creature along the ring takes the bait; on a tie, the crab", () => {
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(5), CRAB, SPOT(6), DIE(6), SPIRIT, 0, DIE(1));
  turns(room, clients, 10);
  const { crab, spirit } = room.state.river;
  assert.deepEqual([crab.out, crab.x, crab.y, spirit.out, spirit.x, spirit.y], [true, 6, 0, true, 0, 0]);
  const client = baitInHand(room, clients);
  playerOf(room, client).powerups.push("bait");
  lure(room, client, 0, 4); // 4 steps from the spirit, 10 from the crab
  assert.deepEqual([spirit.side, spirit.x, spirit.y, crab.x, crab.y], ["left", 0, 4, 6, 0]);
  lure(room, client, 1, 0); // 5 steps from either
  assert.deepEqual([crab.side, crab.x, crab.y, spirit.x, spirit.y], ["top", 1, 0, 0, 4]);
});

test("lure: using it still doesn't take the turn", () => {
  const { room, clients } = risen(CRAB);
  const client = baitInHand(room, clients);
  const [turn, seat, passes] = [room.state.turnCount, room.state.turnIndex, room.state.passes];
  lure(room, client, 12, 4);
  assert.equal(room.state.river.crab.x, 12);
  assert.deepEqual([room.state.turnCount, room.state.turnIndex, room.state.passes], [turn, seat, passes]);
  room.handleMove(client, { x: 6, y: 6, axis: "base" });
  assert.equal(at(room, 6, 6), stoneCode(playerOf(room, client).color, "base"), "and plays its stone");
});

test("lure: the Bait says it lures: an edge point, the creature walks over and takes from there", () => {
  const d = getPowerup("bait")!.description;
  assert.match(d, /edge point/);
  assert.match(d, /walks/);
  assert.doesNotMatch(d, /goes back into the water at once/);
});
