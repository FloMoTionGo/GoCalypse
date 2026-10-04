import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseBuy, chooseFree } from "./index";
import { BotView, MarketRow, rankMoves } from "./scoring";
import { magpie } from "./styles";
import { boardIndex, stoneCode } from "../rules/goRules";

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

test("bots: a bot holding a Bait feeds a creature that will take its stone before its next turn", () => {
  const style = magpie();
  const ranked = (v: BotView) => rankMoves(v, style);
  const soon = threatened(3, { powerups: ["bait"] });
  assert.deepEqual(chooseFree(soon, style, ranked(soon)), { id: "bait", target: { x: 4, y: 0 } });
  const later = threatened(9, { powerups: ["bait"] });
  assert.equal(chooseFree(later, style, ranked(later))?.id === "bait", false, "not while there are rounds to spare");
  const rival = threatened(3, { powerups: ["bait"], color: 2 });
  assert.equal(chooseFree(rival, style, ranked(rival))?.id === "bait", false, "not for a rival's stone alone");
  const warded = threatened(3, { powerups: ["bait"], isWarded: (i: number) => i === at(4, 0) });
  assert.equal(chooseFree(warded, style, ranked(warded))?.id === "bait", false, "not for a stone a ward already keeps");
});

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
