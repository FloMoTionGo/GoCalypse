import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRoom, onTurn, playerOf } from "./room.testkit";
import { openRoom } from "./river.testkit";
import { getPowerup, MARKET_TIER_SLOTS } from "../powerups/definitions";

// The Bait (powerups/definitions.ts): always on sale, and it doesn't use up the
// turn. What it does to a river creature, luring it to an edge point, is in
// lure.test.ts.

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

test("bait: the Bait can be bought from the start of the market, as any stall", () => {
  const { room, clients } = openRoom();
  const client = onTurn(room, clients);
  playerOf(room, client).fireflies = 100;
  room.handleBuy(client, { id: "bait" });
  assert.equal(holds(room, client), 1);
  assert.equal(playerOf(room, client).fireflies, 70);
});
