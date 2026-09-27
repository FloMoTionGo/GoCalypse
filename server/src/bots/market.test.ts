import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseBuy } from "./index";
import { BotView, MarketRow } from "./scoring";
import { magpie } from "./styles";
import { stallRefusal } from "../powerups/definitions";

// Stalls are shared by the table (powerups/definitions.ts stallCopies / fairShare):
// a bot must skip what is sold out or what it has already had its share of.

function shopper(market: MarketRow[], bought: string[] = []): BotView {
  return {
    board: new Array(25).fill(0),
    size: 5,
    color: 1,
    lastMove: null,
    fireflies: 500,
    moves: 9,
    seats: 4,
    passes: 0,
    prisoners: { base: 0, pattern: 0 },
    powerups: [],
    bought,
    shopAfter: 5,
    market,
    handLimit: 5,
    powerfulLimit: 1,
    isWarded: () => false,
    lilyOwnerAt: () => 0,
    isBurning: () => false,
  };
}

const ward = (left: number): MarketRow => ({ id: "lantern_ward", price: 60, removal: false, left, share: 1 });
const lily = (left: number): MarketRow => ({ id: "lily_pad", price: 40, removal: false, left, share: 2 });

test("a bot buys the first thing on its list while the stall has copies", () => {
  assert.equal(chooseBuy(shopper([ward(3), lily(6)]), magpie()), "lantern_ward");
});

test("a bot skips a sold-out stall for the next thing on its list", () => {
  assert.equal(chooseBuy(shopper([ward(0), lily(6)]), magpie()), "lily_pad");
  assert.equal(chooseBuy(shopper([ward(0), lily(0)]), magpie()), null);
});

test("a bot stops at its share, even while the stall still has copies", () => {
  assert.equal(chooseBuy(shopper([ward(2), lily(6)], ["lantern_ward"]), magpie()), "lily_pad");
  assert.equal(chooseBuy(shopper([lily(5)], ["lily_pad"]), magpie()), "lily_pad"); // 1 of its 2
  assert.equal(chooseBuy(shopper([lily(4)], ["lily_pad", "lily_pad"]), magpie()), null);
});

test("a row without stock or share limits is always on sale", () => {
  const free: MarketRow = { id: "lantern_ward", price: 60, removal: false };
  assert.equal(chooseBuy(shopper([free], ["lantern_ward", "lantern_ward"]), magpie()), "lantern_ward");
});

test("a bot never picks a buy the room's stall check refuses", () => {
  // Every combination of stock left and copies owned: chooseBuy may only
  // return the item when stallRefusal (what GoRoom.applyBuy asks) lets it through.
  for (let left = 0; left <= 3; left++) {
    for (let share = 1; share <= 2; share++) {
      for (let mine = 0; mine <= 3; mine++) {
        const row: MarketRow = { id: "lantern_ward", price: 60, removal: false, left, share };
        const pick = chooseBuy(shopper([row], new Array(mine).fill("lantern_ward")), magpie());
        const refused = stallRefusal({ name: "Lantern Ward", left, share }, mine);
        assert.equal(pick === "lantern_ward", refused === null, `left ${left}, share ${share}, mine ${mine}`);
      }
    }
  }
});

test("the single powerful copy goes once, and then no bot can buy it", () => {
  const gust = (left: number): MarketRow => ({ id: "gust", price: 180, removal: true, left, share: 1 });
  assert.equal(chooseBuy(shopper([gust(1)]), magpie()), "gust");
  assert.equal(chooseBuy(shopper([gust(0)]), magpie()), null);
});
