import { test } from "node:test";
import assert from "node:assert/strict";
import { Rng } from "../bots/rng";

// Haiku points (ideas.md §11.11): the lines of three short Go haiku lie on the
// board's least played points; a stone on one collects that line, and each
// haiku's power levels up with the lines collected. The haiku and where they go
// are pure rules (rules/haiku.ts); history/heatmap.ts says which points are played least.
// Loaded per test so each fails on its own until the modules exist.

type Id = "moon" | "river" | "tree";
interface Haiku { id: Id; kanji: string; name: string; lines: string[]; powers: string[] }
interface Spot { haiku: Id; line: number; x: number; y: number }
interface HaikuRules {
  HAIKU: Haiku[];
  HAIKU_LATE_FIREFLIES: number;
  haikuCount(size: number): number;
  haikuCardId(id: Id): string;
  isHaikuCard(card: string): boolean;
  priorHeat(size: number): number[];
  pickHaikuPoints(heat: number[], size: number, random: () => number, count?: number): Spot[];
}
interface HeatRules {
  HEAT_MIN_GAMES: number;
  recordHeat(record: { size: number; frames: { d: number[] }[] }): number[];
  Heatmap: new () => { add(record: { size: number; frames: { d: number[] }[] }): void; heatFor(size: number): number[]; games(size: number): number };
}
const haiku = (): HaikuRules => require("./haiku");
const heat = (): HeatRules => require("../history/heatmap");
const seeded = (seed: number) => {
  const rng = new Rng(seed);
  return () => rng.next() / 2 ** 32;
};
const quadrant = (s: Spot, size: number) => (s.x < size / 2 ? 0 : 1) + (s.y < size / 2 ? 0 : 2);

test("haiku: three of them, moon, river and tree, each three lines with its kanji and three powers", () => {
  const { HAIKU } = haiku();
  assert.deepEqual(HAIKU.map((h) => [h.id, h.kanji]), [["moon", "月"], ["river", "川"], ["tree", "木"]]);
  assert.deepEqual(HAIKU[0].lines, ["Autumn moon rises", "over the stones on the pier", "none of them shall fall"]);
  assert.deepEqual(HAIKU[1].lines, ["The river carries", "one stone to a quiet shore", "the ferry comes home"]);
  assert.deepEqual(HAIKU[2].lines, ["Small sprout by the edge", "the stones have left it alone", "one day it stands tall"]);
  for (const h of HAIKU) assert.equal(h.powers.length, 3, `${h.id}: a power for each level`);
});

test("haiku: three haiku on every board for now, their cards named haiku_<id>, a late line worth 10 fireflies", () => {
  const { haikuCount, haikuCardId, isHaikuCard, HAIKU_LATE_FIREFLIES } = haiku();
  assert.deepEqual([13, 19, 25].map(haikuCount), [3, 3, 3], "4 and 6 on the big boards once there are more haiku");
  assert.equal(haikuCardId("moon"), "haiku_moon");
  assert.deepEqual(["haiku_moon", "haiku_tree", "seedling", "stone_card"].map(isHaikuCard), [true, true, false, false]);
  assert.equal(HAIKU_LATE_FIREFLIES, 10);
});

test("haiku: the pick is the same for the same seed, and another seed gives another", () => {
  const { pickHaikuPoints, priorHeat } = haiku();
  const prior = priorHeat(13);
  assert.deepEqual(pickHaikuPoints(prior, 13, seeded(7)), pickHaikuPoints(prior, 13, seeded(7)));
  assert.notDeepEqual(pickHaikuPoints(prior, 13, seeded(7)), pickHaikuPoints(prior, 13, seeded(8)));
});

test("haiku: 9 points on 13x13, never on the first line, at least 3 apart, each haiku's lines in three quadrants", () => {
  const { pickHaikuPoints, priorHeat } = haiku();
  for (const size of [13, 19, 25]) {
    for (let seed = 1; seed <= 20; seed++) {
      const spots = pickHaikuPoints(priorHeat(size), size, seeded(seed));
      assert.equal(spots.length, 9, `${size}: 3 haiku x 3 lines`);
      for (const s of spots) assert.ok(s.x >= 1 && s.y >= 1 && s.x <= size - 2 && s.y <= size - 2, `${size}: (${s.x}, ${s.y}) off the first line`);
      for (const a of spots) for (const b of spots) {
        if (a !== b) assert.ok(Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)) >= 3, `${size}: (${a.x}, ${a.y}) and (${b.x}, ${b.y}) too close`);
      }
      for (const id of ["moon", "river", "tree"] as Id[]) {
        const lines = spots.filter((s) => s.haiku === id);
        assert.deepEqual(lines.map((s) => s.line).sort(), [1, 2, 3]);
        assert.equal(new Set(lines.map((s) => quadrant(s, size))).size, 3, `${size}: ${id} spread over three quadrants`);
      }
    }
  }
});

test("haiku: the points come from the least played quarter: with the prior, away from the star points and the centre", () => {
  const { pickHaikuPoints, priorHeat } = haiku();
  const size = 13, prior = priorHeat(size);
  const inner: number[] = [];
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) inner.push(prior[y * size + x]);
  const quarter = inner.slice().sort((a, b) => a - b)[Math.floor(inner.length / 4)];
  assert.ok(prior[3 * size + 3] > quarter && prior[6 * size + 6] > quarter, "the star points and the centre are popular");
  for (const s of pickHaikuPoints(prior, size, seeded(3))) assert.ok(prior[s.y * size + s.x] <= quarter, `(${s.x}, ${s.y})`);
});

test("heatmap: a game's stones count where they landed, folded over the board's 8 symmetries; the prior stands until 20 games", () => {
  const { recordHeat, Heatmap, HEAT_MIN_GAMES } = heat();
  const size = 13, at = (x: number, y: number) => y * size + x;
  const record = { size, frames: [{ d: [] as number[] }, { d: [at(2, 4), 1] }, { d: [at(2, 4), 0] }, { d: [at(2, 4), 5, at(10, 10), 2] }] };
  const counts = recordHeat(record);
  assert.equal(counts[at(2, 4)], 2, "placed twice (a capture emptied it between)");
  assert.equal(counts[at(10, 10)], 1);
  assert.equal(counts.reduce((a, b) => a + b, 0), 3);
  assert.equal(HEAT_MIN_GAMES, 20);
  const map = new Heatmap();
  map.add(record);
  assert.equal(map.games(size), 1);
  assert.deepEqual(map.heatFor(size), haiku().priorHeat(size), "too few games: the prior");
  for (let i = 1; i < HEAT_MIN_GAMES; i++) map.add(record);
  const h = map.heatFor(size);
  const mirrors = [[2, 4], [4, 2], [10, 4], [4, 10], [2, 8], [8, 2], [10, 8], [8, 10]];
  for (const [x, y] of mirrors) assert.equal(h[at(x, y)], h[at(2, 4)], `(${x}, ${y}) mirrors (2, 4)`);
  assert.ok(h[at(2, 4)] > h[at(5, 5)]);
  assert.equal(map.heatFor(19).length, 361, "another size keeps its own");
});
