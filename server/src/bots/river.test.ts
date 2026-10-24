import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseBuy, chooseFree } from "./index";
import { BotView, MarketRow, rankMoves } from "./scoring";
import { magpie } from "./styles";
import { boardIndex, stoneCode } from "../rules/goRules";
import { creatureReach } from "../rules/river";

// The river creatures from a bot's seat: the room shows each one that is out as
// { kind, reach, turnsLeft } (BotView.creatures), and the bot answers with a Bait
// when one is about to take its stone, and keeps new stones out of their reach.

const N = 9;
const at = (x: number, y: number) => boardIndex(N, x, y);
const baitRow: MarketRow = { id: "bait", price: 30, removal: false, left: 6, share: 2 };

function view(extra: Partial<BotView> & { creatures?: unknown } = {}): BotView {
  return Object.assign(
    {
      board: new Array(N * N).fill(0),
      size: N,
      color: 1,
      lastMove: null,
      fireflies: 500,
      moves: 9,
      seats: 4,
      passes: 0,
      prisoners: { base: 0, pattern: 0 },
      powerups: [],
      bought: [],
      shopAfter: 5,
      market: [baitRow],
      handLimit: 5,
      powerfulLimit: 1,
      isWarded: () => false,
      lilyOwnerAt: () => 0,
      isBurning: () => false,
    },
    extra
  ) as BotView;
}

/** A board with one of our stones on the top edge at (4, 0), in a crab's reach. */
function threatened(turnsLeft: number, extra: Partial<BotView> = {}) {
  const board = new Array(N * N).fill(0);
  board[at(4, 0)] = stoneCode(1, "base");
  board[at(4, 4)] = stoneCode(2, "base");
  return view({
    board,
    creatures: [{ kind: "crab", reach: [at(3, 0), at(4, 0), at(5, 0)], turnsLeft }],
    ...extra,
  } as Partial<BotView>);
}

test("bots: a bot buys a Bait when a creature has its stone in reach, and not otherwise", () => {
  const style = magpie();
  assert.equal(chooseBuy(threatened(9), style), "bait");
  assert.notEqual(chooseBuy(threatened(9, { powerups: ["bait"] }), style), "bait", "one in hand is enough");
  assert.notEqual(chooseBuy(view(), style), "bait", "nothing out: its usual list");
  assert.notEqual(chooseBuy(threatened(9, { fireflies: 10 }), style), "bait", "too poor");
  assert.notEqual(chooseBuy(threatened(9, { market: [{ ...baitRow, left: 0 }] }), style), "bait", "sold out");
});

test("bots: a point in a creature's reach ranks below the same point with none out", () => {
  const style = magpie();
  const board = new Array(N * N).fill(0);
  board[at(4, 4)] = stoneCode(2, "base");
  const calm = rankMoves(view({ board }), style);
  const watched = rankMoves(view({ board, creatures: [{ kind: "spirit", reach: [at(3, 0), at(4, 0), at(5, 0)], turnsLeft: 12 }] } as Partial<BotView>), style);
  const score = (list: { x: number; y: number; axis: string; score: number }[], x: number, y: number) =>
    list.find((c) => c.x === x && c.y === y && c.axis === "base")?.score ?? -Infinity;
  assert.ok(score(watched, 4, 0) < score(calm, 4, 0), "the reached point is worth less");
  assert.equal(score(watched, 4, 6), score(calm, 4, 6), "a point out of reach is worth the same");
});

// The Bait lures (ideas.md §11.7): the room shows where each creature stands as
// `at`, its facing point, and a bot lures a creature away from its stones to an
// edge point whose reach holds no stone of anyone else's (D-Q3: never offensive).

/** Our stone at (4, 0) in the reach of a crab facing it, `turnsLeft` before it acts. */
function lureView(turnsLeft: number, extra: Partial<BotView> = {}) {
  const board = new Array(N * N).fill(0);
  board[at(4, 0)] = stoneCode(1, "base");
  board[at(4, 4)] = stoneCode(2, "base");
  return view({
    board,
    creatures: [{ kind: "crab", at: at(4, 0), reach: [at(3, 0), at(4, 0), at(5, 0)], turnsLeft }],
    ...extra,
  } as Partial<BotView>);
}

test("bots: a bot holding a Bait lures a creature about to take its stone to an edge point clear of every stone", () => {
  const style = magpie();
  const free = (v: BotView) => chooseFree(v, style, rankMoves(v, style));
  const soon = lureView(3, { powerups: ["bait"] });
  const use = free(soon) as { id: string; target: { x: number; y: number } } | null;
  assert.equal(use?.id, "bait");
  const reach = creatureReach(N, use!.target.x, use!.target.y);
  assert.equal(reach.length, 3, "an edge point");
  assert.ok(reach.every((i) => soon.board[i] === 0), `nobody's stone in its new reach: ${JSON.stringify(use!.target)}`);
  assert.equal(free(lureView(9, { powerups: ["bait"] }))?.id === "bait", false, "not while there are rounds to spare");
  assert.equal(free(lureView(3, { powerups: ["bait"], color: 2 }))?.id === "bait", false, "not for a rival's stone alone");
  assert.equal(free(lureView(3, { powerups: ["bait"], isWarded: (i: number) => i === at(4, 0) }))?.id === "bait", false, "not for a stone a ward keeps");
});

test("bots: a bot never lures a creature onto a rival's stone, even when that is the only way to save its own", () => {
  const style = magpie();
  const v = lureView(3, { powerups: ["bait"] });
  // Rival stones all round the ring, but for (8, 3)..(8, 5) on the right side.
  for (let k = 0; k < N; k++) {
    for (const i of [at(k, 8), at(0, k), at(8, k), at(k, 0)]) {
      if (v.board[i] === 0 && ![at(8, 3), at(8, 4), at(8, 5)].includes(i)) v.board[i] = stoneCode(2, "pattern");
    }
  }
  const use = chooseFree(v, style, rankMoves(v, style)) as { id: string; target: { x: number; y: number } } | null;
  assert.equal(use?.id, "bait");
  assert.deepEqual(use!.target, { x: 8, y: 4 }, "the one point whose reach holds no rival's stone");
  for (const i of [at(8, 3), at(8, 5)]) v.board[i] = stoneCode(2, "pattern");
  const none = chooseFree(v, style, rankMoves(v, style));
  assert.equal(none?.id === "bait", false, "no clean point left: it keeps the Bait");
});
