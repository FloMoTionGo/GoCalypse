import { test } from "node:test";
import assert from "node:assert/strict";
import { allPowerups, MARKET_REMOVAL_SLOTS, MARKET_SLOTS, marketStock } from "./definitions";

test("the market stocks exactly MARKET_SLOTS items", () => {
  for (let k = 0; k < 20; k++) {
    assert.equal(marketStock().length, MARKET_SLOTS);
  }
});

test("at most one powerful (removal) item is ever on sale", () => {
  for (let k = 0; k < 50; k++) {
    const removal = marketStock().filter((p) => p.removal);
    assert.ok(removal.length <= MARKET_REMOVAL_SLOTS, `${removal.length} removal items on sale`);
  }
});

test("every plain item is always on sale, and stock keeps registry (price) order", () => {
  const plain = allPowerups().filter((p) => !p.removal);
  for (let k = 0; k < 20; k++) {
    const stock = marketStock();
    for (const p of plain) assert.ok(stock.includes(p), `${p.id} missing from the market`);
    const order = stock.map((p) => allPowerups().indexOf(p));
    assert.deepEqual(order, order.slice().sort((a, b) => a - b));
  }
});

test("which powerful item is on sale varies between matches", () => {
  const removalIds = allPowerups().filter((p) => p.removal).map((p) => p.id);
  const seen = new Set<string>();
  for (let k = 0; k < 200; k++) {
    for (const p of marketStock()) if (p.removal) seen.add(p.id);
  }
  assert.deepEqual(Array.from(seen).sort(), removalIds.slice().sort());
});

test("a seeded draw picks the first powerful item", () => {
  const stock = marketStock(() => 0);
  const removal = stock.filter((p) => p.removal);
  assert.equal(removal.length, 1);
  assert.equal(removal[0].id, allPowerups().filter((p) => p.removal)[0].id);
});
