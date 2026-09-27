import { test } from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";

// Snapshots from these rooms must not land in the server's own data folder.
process.env.DATA_DIR = path.join(os.tmpdir(), `gocalypse-test-${process.pid}`);

import { GoState } from "../state/GoState";
import { restoreState } from "../state/persist";
import { boardIndex, DRIFTWOOD, stoneCode } from "../rules/goRules";
import {
  CARD_BASE,
  CARD_CENTRE,
  CARD_PATTERN,
  cardLandings,
  LANDING_ORDER,
  nextStoneCost,
  STONE_CARD,
} from "../rules/stoneCard";
import { BOT_CARD_STONES, chooseCardUpgrade, planCard } from "../bots/card";
import { Rng } from "../bots/rng";
import { BotView } from "../bots/scoring";
import { heron, magpie, reed } from "../bots/styles";
import { GoDebugRoom, GoRoom } from "./GoRoom";

// A real room with four seated clients and no server: Colyseus only needs its
// matchmaking listing stubbed for lock(). The private apply* methods are the
// ones the message handlers call, so they are driven directly.
function table(debug = false) {
  const room: any = debug ? new GoDebugRoom() : new GoRoom();
  room.listing = { updateOne: async () => {} };
  room.onCreate({});
  for (const id of ["a", "b", "c", "d"]) room.onJoin({ sessionId: id, send() {} }, { name: id });
  const size: number = room.state.size;
  return {
    room,
    size,
    state: room.state,
    /** Index (into players) of the seat on turn, and of the one after it. */
    onTurn: (): number => room.state.turnIndex,
    offTurn: (): number => (room.state.turnIndex + 1) % 4,
    put(x: number, y: number, code: number) {
      room.state.board[boardIndex(size, x, y)] = code;
    },
    at: (x: number, y: number): number => room.state.board[boardIndex(size, x, y)],
    close() {
      room.clock.clear();
      room.onDispose();
    },
  };
}

test("the first stone on the card is free, then 100 and 25 more for each after, 9 in all", () => {
  const card = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const costs: number[] = [];
  for (const cell of [4, 0, 1, 2, 3, 5, 6, 7, 8]) {
    costs.push(nextStoneCost(card)!);
    card[cell] = CARD_BASE;
  }
  assert.deepEqual(costs, [0, 100, 125, 150, 175, 200, 225, 250, 275]);
  assert.equal(nextStoneCost(card), null);
});

test("stones land centre first, then the ring clockwise from the top-left, never rotated", () => {
  assert.deepEqual(LANDING_ORDER, [4, 0, 1, 2, 5, 8, 7, 6, 3]);
  const full = [1, 2, 1, 2, 1, 2, 1, 2, 1];
  const at = cardLandings(full, { x: 5, y: 5 }, 3, 13).map((s) => [s.x, s.y, s.code]);
  assert.deepEqual(at, [
    [5, 5, stoneCode(3, "base")],
    [4, 4, stoneCode(3, "base")],
    [5, 4, stoneCode(3, "pattern")],
    [6, 4, stoneCode(3, "base")],
    [6, 5, stoneCode(3, "pattern")],
    [6, 6, stoneCode(3, "base")],
    [5, 6, stoneCode(3, "pattern")],
    [4, 6, stoneCode(3, "base")],
    [4, 5, stoneCode(3, "pattern")],
  ]);
  // In a corner, what falls off the board is left out.
  assert.equal(cardLandings(full, { x: 0, y: 0 }, 3, 13).length, 4);
});

test("every seat is dealt an empty Stone Card, in its hand", () => {
  const t = table();
  for (const p of t.state.players) {
    assert.deepEqual(Array.from(p.powerups), [STONE_CARD]);
    assert.deepEqual(Array.from(p.card), [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
  t.close();
});

test("a stone goes on any empty point, at any time, on or off turn: the first free, then for fireflies", () => {
  const t = table();
  const off = t.state.players[t.offTurn()];
  off.fireflies = 230;
  assert.equal(t.room.applyUpgradeCard(t.offTurn(), { cell: 0, axis: "pattern" }), null);
  assert.equal(off.fireflies, 230, "the first stone is free");
  assert.equal(off.card[0], CARD_PATTERN);
  assert.equal(t.room.applyUpgradeCard(t.offTurn(), { cell: CARD_CENTRE }), null);
  assert.equal(off.fireflies, 130);
  assert.equal(off.card[CARD_CENTRE], CARD_BASE);
  assert.equal(t.room.applyUpgradeCard(t.offTurn(), { cell: 8 }), null);
  assert.equal(off.fireflies, 5);
  assert.match(t.room.applyUpgradeCard(t.offTurn(), { cell: 1 }), /costs 150/);
  assert.equal(off.fireflies, 5);
  t.close();
});

test("a stone can't go on a point that already has one, or off the card", () => {
  const t = table();
  const me = t.state.players[0];
  me.fireflies = 1000;
  assert.equal(t.room.applyUpgradeCard(0, { cell: 2 }), null);
  assert.equal(t.room.applyUpgradeCard(0, { cell: 2 }), "");
  assert.equal(t.room.applyUpgradeCard(0, { cell: 9 }), "");
  assert.equal(t.room.applyUpgradeCard(0, { cell: -1 }), "");
  assert.equal(me.fireflies, 1000);
  t.close();
});

test("a stone on the card switches front for free, and comes off again for no refund", () => {
  const t = table();
  const me = t.state.players[0];
  me.fireflies = 100;
  t.room.applyUpgradeCard(0, { cell: 4 }); // free
  t.room.applyUpgradeCard(0, { cell: 0 }); // 100
  assert.equal(me.fireflies, 0);
  assert.equal(t.room.applyFlipCardStone(0, { cell: 0 }), null);
  assert.equal(me.card[0], CARD_PATTERN);
  assert.equal(t.room.applyFlipCardStone(0, { cell: 0 }), null);
  assert.equal(me.card[0], CARD_BASE);
  assert.equal(t.room.applyFlipCardStone(0, { cell: 1 }), "", "nothing to switch on an empty point");
  assert.equal(t.room.applyRemoveCardStone(0, { cell: 0 }), null);
  assert.equal(me.card[0], 0);
  assert.equal(me.fireflies, 0, "no refund");
  assert.equal(t.room.applyRemoveCardStone(0, { cell: 0 }), "");
  // The next stone costs what the one taken off did, never less.
  me.fireflies = 100;
  assert.equal(t.room.applyUpgradeCard(0, { cell: 8 }), null);
  assert.equal(me.fireflies, 0);
  // Off the whole card, the first stone is free again.
  t.room.applyRemoveCardStone(0, { cell: 4 });
  t.room.applyRemoveCardStone(0, { cell: 8 });
  assert.equal(t.room.applyUpgradeCard(0, { cell: 3 }), null);
  assert.equal(me.fireflies, 0);
  t.close();
});

test("with an axis, a stone switches to that front and comes off only from its own front", () => {
  const t = table();
  const me = t.state.players[0];
  t.room.applyUpgradeCard(0, { cell: 4, axis: "base" });
  // Right click on the solid stone: to the pattern front; sent twice, it stays there.
  assert.equal(t.room.applyFlipCardStone(0, { cell: 4, axis: "pattern" }), null);
  assert.equal(me.card[4], CARD_PATTERN);
  assert.equal(t.room.applyFlipCardStone(0, { cell: 4, axis: "pattern" }), "");
  assert.equal(me.card[4], CARD_PATTERN);
  // A left-click removal doesn't take a pattern stone off; a right-click one does.
  assert.equal(t.room.applyRemoveCardStone(0, { cell: 4, axis: "base" }), "");
  assert.equal(me.card[4], CARD_PATTERN);
  assert.equal(t.room.applyRemoveCardStone(0, { cell: 4, axis: "pattern" }), null);
  assert.equal(me.card[4], 0);
  t.close();
});

test("an empty card can't be played", () => {
  const t = table();
  const seat = t.onTurn();
  assert.match(t.room.applyUsePowerup(seat, { id: STONE_CARD, target: { x: 6, y: 6 } }), /empty/);
  assert.deepEqual(Array.from(t.state.players[seat].powerups), [STONE_CARD]);
  assert.equal(t.onTurn(), seat);
  t.close();
});

test("playing the card lands its stones on empty points only and leaves the rest alone", () => {
  const t = table();
  const seat = t.onTurn();
  const me = t.state.players[seat];
  const rival = t.state.players[t.offTurn()];
  me.card.clear();
  for (const c of [1, 2, 0, 0, 1, 0, 0, 0, 2]) me.card.push(c); // top-left, top, centre, bottom-right
  t.put(6, 5, stoneCode(rival.color, "base")); // under the card's top cell
  t.put(7, 7, DRIFTWOOD); // under its bottom-right

  assert.equal(t.room.applyUsePowerup(seat, { id: STONE_CARD, target: { x: 6, y: 6 } }), null);
  assert.equal(t.at(6, 6), stoneCode(me.color, "base"));
  assert.equal(t.at(5, 5), stoneCode(me.color, "base"));
  assert.equal(t.at(6, 5), stoneCode(rival.color, "base"), "the rival stone is neither replaced nor taken");
  assert.equal(t.at(7, 7), DRIFTWOOD);
  assert.deepEqual(Array.from(me.powerups), []);
  assert.equal(me.card.length, 0);
  assert.notEqual(t.onTurn(), seat, "playing the card takes the turn");
  assert.equal(t.state.action.id, STONE_CARD);
  t.close();
});

test("the card lands off the edge only as far as the board goes", () => {
  const t = table();
  const seat = t.onTurn();
  const me = t.state.players[seat];
  me.card.clear();
  for (const c of [1, 1, 1, 1, 1, 1, 1, 1, 1]) me.card.push(c);
  assert.equal(t.room.applyUsePowerup(seat, { id: STONE_CARD, target: { x: 0, y: 0 } }), null);
  const mine = Array.from(t.state.board as number[]).filter((c) => c === stoneCode(me.color, "base")).length;
  assert.equal(mine, 4);
  t.close();
});

test("a card that would land nothing is refused, and kept, and the turn stays", () => {
  const t = table();
  const seat = t.onTurn();
  t.state.players[seat].card[CARD_CENTRE] = CARD_BASE;
  t.put(4, 4, stoneCode(t.state.players[t.offTurn()].color, "base"));
  assert.match(t.room.applyUsePowerup(seat, { id: STONE_CARD, target: { x: 4, y: 4 } }), /None of the card/);
  assert.deepEqual(Array.from(t.state.players[seat].powerups), [STONE_CARD]);
  assert.equal(t.onTurn(), seat);
  t.close();
});

test("the card's stones capture, and the captures are paid", () => {
  const t = table();
  const seat = t.onTurn();
  const me = t.state.players[seat];
  const rival = t.state.players.find((p: any) => p.color !== me.color && (p.color % 2) !== (me.color % 2));
  // A lone rival stone on the base front with three of our base stones around it.
  const rc = stoneCode(rival.color, "base");
  const mc = stoneCode(me.color, "base");
  t.put(5, 5, rc);
  t.put(4, 5, mc);
  t.put(6, 5, mc);
  t.put(5, 4, mc);
  const before = me.fireflies;
  // Centre on (5, 7): its top cell lands on (5, 6), the rival stone's last liberty.
  me.card.clear();
  for (const c of [0, 1, 0, 0, 1, 0, 0, 0, 0]) me.card.push(c);
  assert.equal(t.room.applyUsePowerup(seat, { id: STONE_CARD, target: { x: 5, y: 7 } }), null);
  assert.equal(t.at(5, 5), 0);
  assert.equal(me.basePrisoners, 1);
  assert.equal(me.fireflies, before + 5);
  t.close();
});

test("the card takes one of the hand's places", () => {
  const t = table(true); // debug room: rich, and the market is open at once
  const seat = t.onTurn();
  const me = t.state.players[seat];
  me.powerups.push("x1", "x2", "x3", "x4"); // stand-ins: the hand is now full
  const stall = t.state.market[0];
  assert.match(t.room.applyBuy(seat, stall.id), /hand only holds 5/);
  t.close();
});

// ---- bots -------------------------------------------------------------------------

function botView(over: Partial<BotView> = {}): BotView {
  return {
    board: new Array(81).fill(0),
    size: 9,
    color: 1,
    lastMove: null,
    fireflies: 0,
    moves: 20,
    seats: 4,
    passes: 0,
    prisoners: { base: 0, pattern: 0 },
    powerups: [STONE_CARD],
    bought: [],
    shopAfter: 5,
    market: [],
    handLimit: 5,
    powerfulLimit: 1,
    card: [0, 0, 0, 0, CARD_BASE, 0, 0, 0, 0],
    isWarded: () => false,
    lilyOwnerAt: () => 0,
    isBurning: () => false,
    ...over,
  };
}

test("every bot takes the free first stone, then adds by its purse habits: eager, careful, or never", () => {
  const rng = new Rng(7);
  const empty = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const style of [magpie(), heron(), reed()]) {
    assert.notEqual(chooseCardUpgrade(botView({ card: empty, fireflies: 0 }), style, rng), null, style.name);
  }
  assert.equal(chooseCardUpgrade(botView({ fireflies: 99 }), magpie(), rng), null);
  assert.notEqual(chooseCardUpgrade(botView({ fireflies: 100 }), magpie(), rng), null);
  // Atsumi is careful (itemBias < 0): it keeps as much again as the stone costs.
  assert.equal(chooseCardUpgrade(botView({ fireflies: 150 }), heron(), rng), null);
  assert.notEqual(chooseCardUpgrade(botView({ fireflies: 200 }), heron(), rng), null);
  // Honte never shops, so it never pays for a stone.
  assert.equal(chooseCardUpgrade(botView({ fireflies: 5000 }), reed(), rng), null);
});

test("a bot only ever adds its main (base) stone", () => {
  const t = table(true);
  const me = t.state.players[t.onTurn()];
  me.bot = true; // the others stay people: a table of nothing but bots closes itself
  t.room.botStyles.set(me.sessionId, magpie());
  for (const stall of t.state.market) stall.left = 0; // nothing to buy: the purse goes to the card
  me.fireflies = 230; // the free stone, then 100 + 125: three, so the card can still grow and is kept
  t.room.runBotTurn();
  const stones = Array.from(me.card as number[]).filter((c) => c !== 0);
  assert.equal(stones.length, 3);
  assert.ok(stones.every((c) => c === CARD_BASE));
  t.close();
});

test("a bot stops adding at 5 stones of 9", () => {
  assert.equal(BOT_CARD_STONES, 5);
  const rng = new Rng(3);
  const four = botView({ card: [1, 0, 1, 0, 1, 0, 0, 1, 0], fireflies: 5000 });
  assert.notEqual(chooseCardUpgrade(four, magpie(), rng), null);
  const five = botView({ card: [1, 0, 1, 0, 1, 0, 1, 1, 0], fireflies: 5000 });
  assert.equal(chooseCardUpgrade(five, magpie(), rng), null);
});

test("a bot keeps a card below 5 stones, and plays one with 5 where it pays", () => {
  const growing = botView({ card: [1, 0, 0, 0, 1, 0, 0, 0, 0] });
  assert.equal(planCard(growing, magpie()), null);
  const five = botView({ card: [1, 0, 1, 0, 1, 0, 1, 0, 1] });
  const plan = planCard(five, magpie());
  assert.ok(plan);
  // Five stones on an empty board: it goes where all five land.
  assert.ok(plan.target.x >= 1 && plan.target.x <= 7 && plan.target.y >= 1 && plan.target.y <= 7);
  // Once the table starts passing, even a growing card is played.
  assert.ok(planCard({ ...growing, passes: 1 }, magpie()));
});

// ---- snapshots ----------------------------------------------------------------------

test("a saved game with a field that no longer exists still restores", () => {
  const state = new GoState();
  state.handLimit = 5;
  restoreState(state, { retiredLimit: 7, size: 13, players: [], market: [], effects: [] });
  assert.equal(state.handLimit, 5);
  assert.equal((state as any).retiredLimit, undefined);
});
