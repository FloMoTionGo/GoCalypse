import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allPowerups,
  copiesBought,
  fairShare,
  getPowerup,
  MARKET_SLOTS,
  MARKET_TIER_SLOTS,
  marketStock,
  stallCopies,
  stallRefusal,
  tonightsStalls,
} from "./definitions";

const NEW_TIER_1 = ["firefly_jar", "seedling", "mist"];
const NEW_TIER_2 = ["twin_wick", "ferry", "kite"];
const NEW_TIER_3 = ["echo_chime", "stepping_stones"];

test("the new items are registered in the tiers they were asked for", () => {
  for (const id of NEW_TIER_1) assert.equal(getPowerup(id)?.tier, 1, id);
  for (const id of NEW_TIER_2) assert.equal(getPowerup(id)?.tier, 2, id);
  for (const id of NEW_TIER_3) assert.equal(getPowerup(id)?.tier, 3, id);
});

test("every item has a tier, a unique id and a price that fits its tier", () => {
  const ids = new Set<string>();
  const band: Record<number, [number, number]> = { 1: [25, 40], 2: [45, 80], 3: [130, 400] };
  for (const p of allPowerups()) {
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    const [lo, hi] = band[p.tier];
    assert.ok(p.price >= lo && p.price <= hi, `${p.id} costs ${p.price}, outside tier ${p.tier} (${lo}-${hi})`);
  }
});

test("the market stocks 3 tier 1, 2 tier 2 and 1 tier 3 item", () => {
  for (let k = 0; k < 100; k++) {
    const stock = marketStock();
    assert.equal(stock.length, MARKET_SLOTS);
    for (const tier of [1, 2, 3] as const) {
      assert.equal(stock.filter((p) => p.tier === tier).length, MARKET_TIER_SLOTS[tier], `tier ${tier}`);
    }
  }
});

test("stock keeps registry order: tier first, then cheap to dear", () => {
  const all = allPowerups();
  for (let k = 0; k < 30; k++) {
    const order = marketStock().map((p) => all.indexOf(p));
    assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  }
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i - 1].tier < all[i].tier || (all[i - 1].tier === all[i].tier && all[i - 1].price <= all[i].price));
  }
});

test("every item can turn up in a market, so the draw is not stuck on a few", () => {
  const seen = new Set<string>();
  for (let k = 0; k < 500; k++) for (const p of tonightsStalls()) seen.add(p.id); // the drawn stalls and the Bait's
  assert.deepEqual(Array.from(seen).sort(), allPowerups().map((p) => p.id).sort());
});

test("a seeded draw is repeatable, and a different seed can give a different stall", () => {
  const seeded = (seed: number) => {
    let s = seed;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000);
  };
  const a = marketStock(seeded(1)).map((p) => p.id);
  assert.deepEqual(marketStock(seeded(1)).map((p) => p.id), a);
  const others = new Set<string>();
  for (let seed = 2; seed < 30; seed++) others.add(marketStock(seeded(seed)).map((p) => p.id).join());
  assert.ok(others.size > 1);
});

test("stalls hold 6 / 3 / 1 copies for a table of 4, and each player may buy 2 / 1 / 1", () => {
  assert.deepEqual([1, 2, 3].map((t) => stallCopies(t as 1 | 2 | 3, 4)), [6, 3, 1]);
  assert.deepEqual([6, 3, 1].map((c) => fairShare(c, 4)), [2, 1, 1]);
});

test("stall copies follow the number of seats, and tier 3 always has just one", () => {
  for (let seats = 2; seats <= 6; seats++) {
    assert.equal(stallCopies(3, seats), 1);
    assert.equal(stallCopies(2, seats), seats - 1, `tier 2 at ${seats}`);
    assert.ok(stallCopies(1, seats) > stallCopies(2, seats), `tier 1 is the most plentiful at ${seats}`);
    // A fair share never lets one player empty a stall of more than one copy.
    for (const tier of [1, 2] as const) {
      const copies = stallCopies(tier, seats);
      if (copies > 1) assert.ok(fairShare(copies, seats) < copies, `tier ${tier} at ${seats}`);
    }
  }
});

test("copies bought are counted per item", () => {
  assert.equal(copiesBought(["fog", "mist", "fog"], "fog"), 2);
  assert.equal(copiesBought(["fog"], "mist"), 0);
  assert.equal(copiesBought([], "fog"), 0);
});

test("a stall refuses when it is sold out or the player has had their share", () => {
  const stall = { name: "Fog", left: 6, share: 2 };
  assert.equal(stallRefusal(stall, 0), null);
  assert.equal(stallRefusal(stall, 1), null);
  assert.match(stallRefusal(stall, 2)!, /share of Fog \(2 to a player\)/);
  assert.match(stallRefusal({ ...stall, left: 0 }, 0)!, /sold out/);
  assert.match(stallRefusal({ name: "Echo Chime", left: 1, share: 1 }, 1)!, /one to a player/);
});

test("item descriptions leave the turn to the card's turn icon: none says whether it uses up the turn", () => {
  for (const p of allPowerups()) {
    assert.doesNotMatch(p.description, /use[sd]? up (your|the) turn/i, p.id);
  }
});

// ---- the cozy rule (2026-11-08): nothing at the Night Market removes another player's stones ----

const GONE = ["gust", "remove_stone", "bomb", "river_current"]; // Gust, Snipe, Firework, River Current

test("the tier 3 stalls are Echo Chime and Stepping Stones: nothing at the Night Market removes another player's stones", () => {
  assert.deepEqual(allPowerups().filter((p) => p.tier === 3).map((p) => p.id), ["echo_chime", "stepping_stones"]);
  for (const id of GONE) assert.equal(getPowerup(id), undefined, `${id} is still for sale`);
});

test("nothing is stocked twice, and the tier 3 stall is Echo Chime or Stepping Stones", () => {
  for (let k = 0; k < 100; k++) {
    const stock = marketStock();
    assert.equal(new Set(stock.map((p) => p.id)).size, stock.length);
    const dear = stock.filter((p) => p.tier === 3).map((p) => p.id);
    assert.equal(dear.length, 1);
    assert.ok(["echo_chime", "stepping_stones"].includes(dear[0]), dear[0]);
  }
});
