import { test } from "node:test";
import assert from "node:assert/strict";
import { allPowerups, getPowerup } from "../powerups/definitions";
import { boardIndex, stoneCode } from "../rules/goRules";
import { chooseFree, planItem } from "./items";
import { BotView, rankMoves, scoreMove } from "./scoring";
import { magpie, reed, tanuki } from "./styles";

// Every item in the Night Market is something a bot can buy and use. Seat 1
// is black+gray; seat 2 is white on the base front, so it fights seat 1 there.

function view(size: number, over: Partial<BotView> = {}): BotView {
  return {
    board: new Array(size * size).fill(0),
    size,
    color: 1,
    lastMove: null,
    fireflies: 0,
    moves: 20,
    seats: 4,
    passes: 0,
    prisoners: { base: 0, pattern: 0 },
    powerups: [],
    bought: [],
    shopAfter: 5,
    market: [],
    handLimit: 5,
    powerfulLimit: 1,
    isWarded: () => false,
    lilyOwnerAt: () => 0,
    isBurning: () => false,
    ...over,
  };
}

function put(v: BotView, x: number, y: number, color: number) {
  v.board[boardIndex(v.size, x, y)] = stoneCode(color, "base");
}

const FREE = ["firefly_jar", "mist", "kite", "twin_wick", "stepping_stones", "bait"];

test("the shark's shopping list is the whole market", () => {
  const list = magpie().shopping;
  for (const item of allPowerups()) assert.ok(list.includes(item.id), `${item.id} is never bought`);
});

test("every item a bot buys is one it has a use for", () => {
  // Free items go through chooseFree, the rest through planItem; the free ones
  // are exactly the ones the rules say cost no turn.
  for (const id of FREE) assert.equal(getPowerup(id)?.free, true, id);
  for (const item of allPowerups()) if (!FREE.includes(item.id)) assert.ok(!item.free, item.id);
});

test("Ferry steps a stone out of atari", () => {
  const v = view(5, { powerups: ["ferry"] });
  put(v, 2, 2, 1);
  put(v, 1, 2, 2);
  put(v, 3, 2, 2);
  put(v, 2, 1, 2); // (2, 3) is its last liberty
  const plan = planItem(v, tanuki(), rankMoves(v, tanuki()));
  assert.deepEqual(plan && { id: plan.id, target: plan.target, target2: plan.target2 }, {
    id: "ferry",
    target: { x: 2, y: 2 },
    target2: { x: 2, y: 3 },
  });
});

test("Skiff glides a stone to a capture along a clear row", () => {
  const v = view(7, { powerups: ["skiff"] });
  put(v, 0, 3, 1); // ours, far off on the left edge
  put(v, 5, 3, 2); // a rival stone with one liberty left, at (4, 3)
  put(v, 6, 3, 1);
  put(v, 5, 2, 1);
  put(v, 5, 4, 1);
  const plan = planItem(v, tanuki(), rankMoves(v, tanuki()));
  assert.equal(plan?.id, "skiff");
  assert.deepEqual(plan?.target2, { x: 4, y: 3 });
});

test("River Current only washes away stones on the edge", () => {
  const v = view(5, { powerups: ["river_current"] });
  put(v, 2, 2, 2); // in the middle: out of reach
  assert.equal(planItem(v, tanuki(), rankMoves(v, tanuki())), null);
  put(v, 0, 3, 2);
  assert.deepEqual(planItem(v, tanuki(), rankMoves(v, tanuki()))?.target, { x: 0, y: 3 });
});

test("Fog goes over a group of ours in atari", () => {
  const v = view(5, { powerups: ["fog"] });
  put(v, 1, 1, 1);
  put(v, 2, 1, 1);
  put(v, 0, 1, 2);
  put(v, 3, 1, 2);
  put(v, 1, 0, 2);
  put(v, 2, 0, 2);
  put(v, 1, 2, 2); // last liberty: (2, 2)
  const plan = planItem(v, tanuki(), rankMoves(v, tanuki()));
  assert.equal(plan?.id, "fog");
});

test("Seedling plants on a point the bot wants but won't play this turn", () => {
  const v = view(7, { powerups: ["seedling"] });
  const ranked = rankMoves(v, tanuki());
  const plan = planItem(v, tanuki(), ranked);
  assert.equal(plan?.id, "seedling");
  assert.notDeepEqual(plan?.target, { x: ranked[0].x, y: ranked[0].y });
  assert.ok(plan?.axis === "base" || plan?.axis === "pattern");
});

test("Echo Chime is worth two stones when the mirror point is open", () => {
  const v = view(9, { powerups: ["echo_chime"] });
  const ranked = rankMoves(v, tanuki());
  const plan = planItem(v, tanuki(), ranked);
  assert.equal(plan?.id, "echo_chime");
  const first = ranked.find((m) => m.x === plan!.target.x && m.y === plan!.target.y && m.axis === "base");
  assert.ok(first && plan!.score > first.score);
});

test("free items are used before a stone, and only while unlit", () => {
  const v = view(7, { powerups: ["stepping_stones", "mist"] });
  const style = tanuki();
  assert.equal(chooseFree(v, style, rankMoves(v, style))?.id, "stepping_stones");
  v.extra = 1;
  assert.equal(chooseFree(v, style, rankMoves(v, style))?.id, "mist");
  v.mist = true;
  assert.equal(chooseFree(v, style, rankMoves(v, style)), null);
});

test("a Firefly Jar is opened when a capture is in reach, not before", () => {
  const v = view(5, { powerups: ["firefly_jar"] });
  const style = tanuki();
  assert.equal(chooseFree(v, style, rankMoves(v, style)), null);
  put(v, 2, 2, 2);
  put(v, 1, 2, 1);
  put(v, 3, 2, 1);
  put(v, 2, 1, 1); // (2, 3) takes it
  assert.equal(chooseFree(v, style, rankMoves(v, style))?.id, "firefly_jar");
});

test("Kite is flown at a rival stone", () => {
  const v = view(5, { powerups: ["kite"] });
  put(v, 4, 4, 2);
  assert.deepEqual(chooseFree(v, tanuki(), rankMoves(v, tanuki())), { id: "kite", target: { x: 4, y: 4 } });
});

test("a bot that never shops never uses a free item", () => {
  const v = view(5, { powerups: ["stepping_stones"] });
  assert.equal(chooseFree(v, reed(), rankMoves(v, reed())), null);
});

test("a lit Twin Wick is judged as a twin: no point that starves either front", () => {
  const v = view(5, { twin: true });
  // At (0, 0) a base stone joins ours at (1, 0) and breathes through it. A twin
  // does too on the base front, but on the pattern front both neighbours are
  // walls, so that half of it has no liberty at all.
  put(v, 1, 0, 1);
  put(v, 0, 1, 2);
  const plain = scoreMove({ ...v, twin: false }, 0, 0, "base", tanuki());
  const twin = scoreMove(v, 0, 0, "base", tanuki());
  assert.notEqual(plain, null);
  assert.equal(twin, null);
});

test("no bot plays into fog", () => {
  const v = view(5, { isFogged: (idx) => idx === boardIndex(5, 2, 2) });
  assert.equal(scoreMove(v, 2, 2, "base", tanuki()), null);
  assert.ok(rankMoves(v, tanuki()).every((m) => !(m.x === 2 && m.y === 2)));
});

// Haiku cards (ideas.md §11.11): a bot plays one as the item its level stands
// for, and reads a haiku point still to collect as worth a stone more.

test("a haiku card is played as the item its level stands for: 川 at level 1 a Ferry, at level 2 a Skiff", () => {
  const ferry = view(5, { powerups: ["haiku_river"], haikuLevels: { river: 1 } } as Partial<BotView>);
  put(ferry, 2, 2, 1);
  put(ferry, 1, 2, 2);
  put(ferry, 3, 2, 2);
  put(ferry, 2, 1, 2);
  const step = planItem(ferry, tanuki(), rankMoves(ferry, tanuki()));
  assert.deepEqual(step && { id: step.id, target: step.target, target2: step.target2 }, { id: "haiku_river", target: { x: 2, y: 2 }, target2: { x: 2, y: 3 } });

  const skiff = view(7, { powerups: ["haiku_river"], haikuLevels: { river: 2 } } as Partial<BotView>);
  put(skiff, 0, 3, 1);
  put(skiff, 5, 3, 2);
  put(skiff, 6, 3, 1);
  put(skiff, 5, 2, 1);
  put(skiff, 5, 4, 1);
  const glide = planItem(skiff, tanuki(), rankMoves(skiff, tanuki()));
  assert.equal(glide?.id, "haiku_river");
  assert.deepEqual(glide?.target2, { x: 4, y: 3 });
});

test("a haiku point still to collect is worth more to a bot than the same point without one", () => {
  const plain = view(9);
  put(plain, 4, 4, 2);
  const marked = view(9, { haiku: [{ idx: boardIndex(9, 2, 6), haiku: "moon", line: 1 }], haikuLevels: { moon: 0 } } as Partial<BotView>);
  put(marked, 4, 4, 2);
  const style = tanuki();
  assert.ok(scoreMove(marked, 2, 6, "base", style)! > scoreMove(plain, 2, 6, "base", style)!);
  assert.equal(scoreMove(marked, 6, 2, "base", style), scoreMove(plain, 6, 2, "base", style), "another point is worth the same");
});
