import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "./rng";

test("the same seed gives the same sequence; another seed another", () => {
  const a = new Rng(42), b = new Rng(42), c = new Rng(43);
  const seq = (r: Rng) => Array.from({ length: 8 }, () => r.next());
  const first = seq(a);
  assert.deepEqual(seq(b), first);
  assert.notDeepEqual(seq(c), first);
});

test("a zero seed still moves (xorshift would stick at 0)", () => {
  const r = new Rng(0);
  assert.notEqual(r.next(), 0);
});

test("below(n) stays in [0, n) and reaches every value; below(0) is 0", () => {
  const r = new Rng(7);
  const hits = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const v = r.below(6);
    assert.ok(Number.isInteger(v) && v >= 0 && v < 6);
    hits.add(v);
  }
  assert.equal(hits.size, 6);
  assert.equal(r.below(0), 0);
});

test("pick returns an element of the list", () => {
  const r = new Rng(9);
  const items = ["a", "b", "c"];
  for (let i = 0; i < 50; i++) assert.ok(items.includes(r.pick(items)));
});
