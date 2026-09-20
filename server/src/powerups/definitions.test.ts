import { test } from "node:test";
import assert from "node:assert/strict";
import { allPowerups, getPowerup, MARKET_SLOTS, MARKET_TIER_SLOTS, marketStock } from "./definitions";

const NEW_TIER_1 = ["firefly_jar", "seedling", "mist"];
const NEW_TIER_2 = ["twin_wick", "ferry", "kite"];
const NEW_TIER_3 = ["river_current", "echo_chime", "stepping_stones"];

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

test("removal items are all tier 3", () => {
  for (const p of allPowerups()) if (p.removal) assert.equal(p.tier, 3, p.id);
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

test("nothing is stocked twice, and at most one removal item is ever on sale", () => {
  for (let k = 0; k < 100; k++) {
    const stock = marketStock();
    assert.equal(new Set(stock.map((p) => p.id)).size, stock.length);
    assert.ok(stock.filter((p) => p.removal).length <= 1);
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
  for (let k = 0; k < 500; k++) for (const p of marketStock()) seen.add(p.id);
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
