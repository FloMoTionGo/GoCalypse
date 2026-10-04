import { test } from "node:test";
import assert from "node:assert/strict";
import { at, makeRoom, notices, onTurn, playerOf, put } from "./room.testkit";
import { CRAB, DIE, openRoom, reachOf, risen, script, SPIRIT, SPOT, tookOf, turns, until } from "./river.testkit";
import { getPowerup, MARKET_TIER_SLOTS } from "../powerups/definitions";
import { stoneCode } from "../rules/goRules";

// The Bait (powerups/definitions.ts): always on sale, it doesn't use up the
// turn, and fed to a river creature through one of the points it reaches it
// sends that creature back into the water before its timer runs out, empty-handed.

/** Puts a Bait in the hand of whoever is on turn, and returns their client. */
function baitInHand(room: any, clients: any[]) {
  const client = onTurn(room, clients);
  playerOf(room, client).powerups.push("bait");
  return client;
}

const holds = (room: any, client: any) => Array.from(playerOf(room, client).powerups).filter((id) => id === "bait").length;

test("bait: always on sale at the Night Market, beside the six drawn stalls", () => {
  const def = getPowerup("bait")!;
  assert.ok(def, "the Bait is an item");
  assert.deepEqual([def.tier, def.price, def.removal, !!def.free, def.points ?? 1], [1, 30, false, true, 1]);
  for (let k = 0; k < 20; k++) {
    const room = makeRoom();
    const market = Array.from(room.state.market) as any[];
    const bait = market.filter((m) => m.id === "bait");
    assert.equal(bait.length, 1, "one Bait stall in every match");
    assert.deepEqual([bait[0].price, bait[0].tier, bait[0].free, bait[0].points], [30, 1, true, 1]);
    assert.deepEqual([bait[0].stock, bait[0].share], [6, 2], "a tier 1 stall: 6 copies, 2 to a player");
    const drawn = market.filter((m) => m.id !== "bait");
    assert.equal(drawn.length, 6);
    for (const tier of [1, 2, 3] as const) {
      assert.equal(drawn.filter((m) => m.tier === tier).length, MARKET_TIER_SLOTS[tier], `tier ${tier} as before`);
    }
    const order = market.map((m) => [m.tier, m.price]);
    assert.deepEqual(order, order.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), "still cheap to dear, tier by tier");
  }
});

test("bait: fed to a creature through a point in its reach, it goes back into the water and takes nothing", () => {
  for (const kind of [CRAB, SPIRIT]) {
    const { room, clients } = risen(kind);
    put(room, 5, 0, stoneCode(1, "base"));
    put(room, 6, 0, stoneCode(2, "base"));
    put(room, 7, 0, stoneCode(3, "base"));
    until(room, clients, 9);
    const client = baitInHand(room, clients);
    room.handleUsePowerup(client, { id: "bait", target: { x: 7, y: 0 } });
    const c = kind === CRAB ? room.state.river.crab : room.state.river.spirit;
    const name = kind === CRAB ? "crab" : "spirit";
    assert.equal(c.out, false, `the ${name} went back into the water`);
    assert.equal(c.fed, true);
    assert.deepEqual(tookOf(c), []);
    assert.equal(holds(room, client), 0, "the Bait is used up");
    assert.match(room.state.lastEvent, /bait/i);
    assert.match(room.state.lastEvent, new RegExp(name, "i"));
    until(room, clients, 18);
    assert.deepEqual([at(room, 5, 0), at(room, 6, 0), at(room, 7, 0)], [1, 2, 3].map((c) => stoneCode(c, "base")), "nothing taken when its timer would have run out");
  }
});

test("bait: using it doesn't use up the turn", () => {
  const { room, clients } = risen(CRAB);
  const client = baitInHand(room, clients);
  const [turn, seat, passes] = [room.state.turnCount, room.state.turnIndex, room.state.passes];
  room.handleUsePowerup(client, { id: "bait", target: { x: 6, y: 0 } });
  assert.equal(room.state.river.crab.out, false);
  assert.deepEqual([room.state.turnCount, room.state.turnIndex, room.state.passes], [turn, seat, passes], "the same seat is still on turn");
  room.handleMove(client, { x: 6, y: 6, axis: "base" });
  assert.equal(at(room, 6, 6), stoneCode(playerOf(room, client).color, "base"), "and plays its stone");
});

test("bait: refused and kept with no creature out, or on a point outside every reach", () => {
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(1));
  turns(room, clients, 5);
  let client = baitInHand(room, clients);
  room.handleUsePowerup(client, { id: "bait", target: { x: 6, y: 0 } });
  assert.equal(holds(room, client), 1, "kept: nothing is out");
  assert.match(notices(client).at(-1) ?? "", /Bait/);

  const up = risen(CRAB);
  client = baitInHand(up.room, up.clients);
  for (const target of [{ x: 6, y: 6 }, { x: 8, y: 0 }, { x: 4, y: 0 }]) {
    up.room.handleUsePowerup(client, { id: "bait", target });
    assert.equal(holds(up.room, client), 1, `kept: (${target.x}, ${target.y}) is out of the crab's reach`);
    assert.equal(up.room.state.river.crab.out, true);
  }
  up.room.handleUsePowerup(client, { id: "bait" });
  assert.equal(holds(up.room, client), 1, "kept: no point given");
});

test("bait: with both out, it drives off only the one whose reach holds the point", () => {
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(5), CRAB, SPOT(6), DIE(6), SPIRIT, 0, DIE(1));
  turns(room, clients, 10);
  const { crab, spirit } = room.state.river;
  assert.deepEqual([crab.out, spirit.out], [true, true]);
  const client = baitInHand(room, clients);
  const p = reachOf(spirit)[0];
  room.handleUsePowerup(client, { id: "bait", target: { x: p % 13, y: Math.floor(p / 13) } });
  assert.deepEqual([crab.out, spirit.out, spirit.fed, crab.fed], [true, false, true, false]);
});

test("bait: anyone may feed a creature, whoever's stones are in its reach", () => {
  const { room, clients } = risen(SPIRIT);
  const client = baitInHand(room, clients);
  const rival = (playerOf(room, client).color % 4) + 1;
  put(room, 6, 0, stoneCode(rival, "base"));
  room.handleUsePowerup(client, { id: "bait", target: { x: 6, y: 0 } });
  assert.equal(room.state.river.spirit.out, false, "a rival's stone saved");

  const empty = risen(CRAB);
  const feeder = baitInHand(empty.room, empty.clients);
  empty.room.handleUsePowerup(feeder, { id: "bait", target: { x: 5, y: 0 } });
  assert.equal(empty.room.state.river.crab.out, false, "and with no stone in reach at all");
});

test("bait: the Bait can be bought from the start of the market, as any stall", () => {
  const { room, clients } = openRoom();
  const client = onTurn(room, clients);
  playerOf(room, client).fireflies = 100;
  room.handleBuy(client, { id: "bait" });
  assert.equal(holds(room, client), 1);
  assert.equal(playerOf(room, client).fireflies, 70);
});
