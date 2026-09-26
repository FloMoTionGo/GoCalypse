import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyCaptures,
  boardIndex,
  isSuicide,
  stoneCode,
  StoneView,
} from "../rules/goRules";
import { isSettled, regionAt, sidesOf, territoryScore } from "../rules/endgame";
import { chooseAction, chooseBuy } from "./index";
import { playMatch } from "./selfplay";
import { Rng } from "./rng";
import { BotView, isPointless, rankMoves, scoreMove } from "./scoring";
import { heron, magpie, moth, oldToad, randomStyle, RECRUIT_IDS, recruitStyle, reed, Style, tanuki, temperamentFor } from "./styles";

// The players are pure functions over a plain board, so everything below runs
// without a room, a socket or a clock. Seat 1 is black+gray throughout.

function view(size: number, color: number, over: Partial<BotView> = {}): BotView {
  return {
    board: new Array(size * size).fill(0),
    size,
    color,
    lastMove: null,
    fireflies: 0,
    moves: 0,
    seats: 4,
    passes: 0,
    prisoners: { base: 0, pattern: 0 },
    powerups: [],
    bought: [],
    shopAfter: 5,
    market: [],
    satchelLimit: 5,
    powerfulLimit: 1,
    isWarded: () => false,
    lilyOwnerAt: () => 0,
    isBurning: () => false,
    ...over,
  };
}

/** Plays a stone the way GoRoom does, and fails the test if the rules refuse it. */
function play(board: number[], size: number, x: number, y: number, axis: StoneView, color: number): number {
  const idx = boardIndex(size, x, y);
  assert.equal(board[idx], 0, `bot played on an occupied point (${x}, ${y})`);
  const code = stoneCode(color, axis);
  board[idx] = code;
  const captured = applyCaptures(board, size, x, y, code);
  assert.ok(
    captured.length > 0 || !isSuicide(board, size, x, y),
    `bot played a suicide at (${x}, ${y})`
  );
  return captured.length;
}

test("a seed names a sequence exactly", () => {
  const a = new Rng(12345);
  const b = new Rng(12345);
  const c = new Rng(12346);
  const first = [a.next(), a.next(), a.next()];
  assert.deepEqual(first, [b.next(), b.next(), b.next()]);
  assert.notDeepEqual(first, [c.next(), c.next(), c.next()]);
});

test("every ranked move is one the rules would accept", () => {
  const size = 7;
  const v = view(size, 1);
  // A scattering of all four seats on both fronts.
  const seeded: [number, number, number, StoneView][] = [
    [3, 3, 2, "base"],
    [3, 4, 4, "base"],
    [4, 3, 3, "pattern"],
    [2, 3, 1, "base"],
    [5, 5, 2, "pattern"],
    [1, 1, 4, "pattern"],
  ];
  for (const [x, y, color, axis] of seeded) v.board[boardIndex(size, x, y)] = stoneCode(color, axis);

  const ranked = rankMoves(v, tanuki());
  assert.ok(ranked.length > 0);
  for (const c of ranked) {
    const trial = v.board.slice();
    const idx = boardIndex(size, c.x, c.y);
    assert.equal(trial[idx], 0, "ranked an occupied point");
    const code = stoneCode(v.color, c.axis);
    trial[idx] = code;
    const captured = applyCaptures(trial, size, c.x, c.y, code);
    assert.ok(captured.length > 0 || !isSuicide(trial, size, c.x, c.y), "ranked a suicide");
  }
});

test("takes the capture in front of it", () => {
  const size = 5;
  const v = view(size, 1); // black+gray
  v.board[boardIndex(size, 2, 2)] = stoneCode(2, "base"); // a white stone, base front
  for (const [x, y] of [[1, 2], [3, 2], [2, 1]]) {
    v.board[boardIndex(size, x, y)] = stoneCode(1, "base"); // ours, down to its last liberty
  }

  const best = rankMoves(v, tanuki())[0];
  assert.deepEqual({ x: best.x, y: best.y, axis: best.axis }, { x: 2, y: 3, axis: "base" });
});

test("never fills its own eye", () => {
  const size = 5;
  const v = view(size, 1);
  for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) {
    v.board[boardIndex(size, x, y)] = stoneCode(1, "base");
  }
  const centre = rankMoves(v, heron()).filter((c) => c.x === 2 && c.y === 2);
  assert.equal(centre.length, 0);
});

test("a self-atari is worth less than a quiet point", () => {
  const size = 5;
  const v = view(size, 1);
  v.board[boardIndex(size, 0, 0)] = stoneCode(1, "base");
  for (const [x, y] of [[0, 1], [1, 1], [2, 1]]) {
    v.board[boardIndex(size, x, y)] = stoneCode(2, "base");
  }

  const selfAtari = scoreMove(v, 1, 0, "base", heron()); // leaves the pair on one liberty
  const quiet = scoreMove(v, 3, 3, "base", heron());
  assert.ok(selfAtari !== null && quiet !== null);
  assert.ok(selfAtari < quiet, `${selfAtari} should be below ${quiet}`);
});

test("a burning point is not on the board as far as a bot is concerned", () => {
  const size = 5;
  const burning = boardIndex(size, 2, 2);
  const v = view(size, 1, { isBurning: (idx) => idx === burning });
  assert.equal(scoreMove(v, 2, 2, "base", heron()), null);
  assert.equal(rankMoves(v, heron()).filter((c) => c.x === 2 && c.y === 2).length, 0);
});

test("someone else's lily pad is not on the board either", () => {
  const size = 5;
  const reserved = boardIndex(size, 2, 2);
  const mine = view(size, 1, { lilyOwnerAt: (idx) => (idx === reserved ? 3 : 0) });
  const theirs = view(size, 3, { lilyOwnerAt: (idx) => (idx === reserved ? 3 : 0) });
  assert.equal(scoreMove(mine, 2, 2, "base", heron()), null);
  assert.ok(scoreMove(theirs, 2, 2, "base", heron()) !== null); // the owner may still play it
});

// A whole match, driven by bots/selfplay.ts -- the same engine tools/tune runs
// on, so what the tuner measures is what the tests check. playMatch throws on an
// occupied point or a suicide, which makes it the cheapest fuzzer goRules will
// ever get.
const TABLE = [0, 1, 2, 3].map((seat) => temperamentFor(seat));

test("four bots play a 13x13 out to four passes", () => {
  const match = playMatch(20260920, TABLE);
  assert.ok(match.finished, "the game ended on passes, not on the turn cap");
  assert.ok(match.stones > 100, `only ${match.stones} stones went down`);
  assert.ok(match.board.some((c) => c !== 0));
});

test("a finished board leaves territory standing, not just prisoners", () => {
  // The point of the territory count: if bots fill the board in to the last
  // point there is nothing left to score, and the game is only a capture race.
  const match = playMatch(20260920, TABLE);
  const empty = match.board.filter((c) => c === 0).length;
  assert.ok(empty > 20, `only ${empty} points left empty`);
  assert.ok(
    match.results.some((r) => r.baseTerritory > 0 && r.patternTerritory > 0),
    "somebody should hold ground on both fronts"
  );
});

test("the same seed replays the same match", () => {
  assert.deepEqual(playMatch(7, TABLE).board, playMatch(7, TABLE).board);
  assert.notDeepEqual(playMatch(7, TABLE).board, playMatch(8, TABLE).board);
});

/**
 * A frozen Style, on purpose. Pinning a match played by the shipped recruits
 * would mean re-pinning it every time tools/tune moves a weight, and a pin that
 * is routinely rewritten catches nothing. These numbers belong to this test and
 * nothing else reads them, so the hash below moves only when the engine does --
 * the scorer, the pass judgement, the rules or the count.
 */
const PINNED: Style = {
  name: "pinned",
  capture: 1400,
  save: 1000,
  atari: 500,
  connect: 250,
  cut: 300,
  contact: 120,
  locality: 500,
  extension: 350,
  line: 200,
  selfAtari: 1600,
  hemmed: 100,
  axisBias: 0,
  prefers: "base",
  itemBias: -1_000_000,
  shopping: [],
  variation: 3,
  judgement: true,
};

function digest(board: number[]): string {
  let h = 0x811c9dc5;
  for (const c of board) {
    h ^= c + 1;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

test("a match by a frozen style still comes out move for move the same", () => {
  // Update this only with a note saying which change to the engine moved it,
  // and why that change was wanted.
  //
  // 2026-09-25, d8fcccc2 -> 773a7fb0: bots kept trading the same few points --
  // a take left its stone in atari, the next seat took it back, round and round.
  // Kos are now held for a round (rules/ko.ts, and selfplay.ts uses the room's
  // occupied-points superko instead of colour-exact keys), a take that leaves
  // its stone in atari pays the self-atari penalty unless it is a ko the bot can
  // fill, and a point that saves a group in atari is no longer mistaken for an eye.
  const match = playMatch(20260922, [PINNED, PINNED, PINNED, PINNED]);
  assert.equal(digest(match.board), "773a7fb0");
  assert.deepEqual([match.turns, match.stones, match.finished], [253, 248, true]);
});

test("the drifter still only offers legal points", () => {
  const size = 9;
  const v = view(size, 2);
  v.board[boardIndex(size, 4, 4)] = stoneCode(1, "base");
  const ranked = rankMoves(v, randomStyle());
  assert.equal(new Set(ranked.map((c) => c.score)).size, 1); // every point equal: a flat draw
  assert.ok(ranked.length > 0);
});

// ---- the last pass ---------------------------------------------------------------
//
// Whatever is still legal, a bot that comes to a table where everyone else has
// passed in a row passes too: one more pass ends the game, and playing on would
// leave a seat alone in a game nobody else is still in.

/** The capture fixture from above: seat 1 to play at (2, 3) and lift a white stone. */
function captureOffered(over: Partial<BotView> = {}): BotView {
  const size = 5;
  const v = view(size, 1, over);
  v.board[boardIndex(size, 2, 2)] = stoneCode(2, "base");
  for (const [x, y] of [[1, 2], [3, 2], [2, 1]]) {
    v.board[boardIndex(size, x, y)] = stoneCode(1, "base");
  }
  return v;
}

test("every bot passes once the rest of the table has passed in a row", () => {
  for (const make of [reed, tanuki, magpie, heron, moth, oldToad, randomStyle]) {
    const v = captureOffered({ passes: 3 });
    const action = chooseAction(v, make(), new Rng(4242));
    assert.equal(action.kind, "pass", `${make().name} played on after three passes`);
  }
});

test("a capture waiting in front of it does not buy a bot one more turn", () => {
  // The same board with nobody passing: the bot takes the stone, as it should.
  const playing = chooseAction(captureOffered(), tanuki(), new Rng(4242));
  assert.deepEqual(
    playing.kind === "move" ? { x: playing.x, y: playing.y } : null,
    { x: 2, y: 3 }
  );
  const ending = chooseAction(captureOffered({ passes: 3 }), tanuki(), new Rng(4242));
  assert.equal(ending.kind, "pass");
});

test("a run of passes short of the table plays on as before", () => {
  for (const passes of [0, 1, 2]) {
    const action = chooseAction(captureOffered({ passes }), tanuki(), new Rng(4242));
    assert.equal(action.kind, "move", `passed on ${passes} of 4 passes`);
  }
});

test("the count is against the seats at the table, not against four", () => {
  // A table that lost a seat ends on its own number of passes.
  assert.equal(chooseAction(captureOffered({ seats: 3, passes: 2 }), tanuki(), new Rng(1)).kind, "pass");
  assert.equal(chooseAction(captureOffered({ seats: 5, passes: 3 }), tanuki(), new Rng(1)).kind, "move");
});

// ---- the bots a player can seat from the welcome screen ---------------------------

const MARKET = [
  { id: "driftwood", price: 30, removal: false },
  { id: "lily_pad", price: 40, removal: false },
  { id: "lantern_ward", price: 60, removal: false },
  { id: "turn_lantern", price: 80, removal: false },
  { id: "gust", price: 180, removal: true },
];

/** Our two black stones in the corner, both on their last liberty at (1, 1). */
function corneredPair(over: Partial<BotView> = {}): BotView {
  const size = 5;
  const v = view(size, 1, over);
  for (const [x, y, color] of [[0, 0, 1], [1, 0, 1], [2, 0, 2], [0, 1, 2]]) {
    v.board[boardIndex(size, x, y)] = stoneCode(color, "base");
  }
  return v;
}

test("recruit ids resolve to a style, and anything else to nothing", () => {
  assert.deepEqual(RECRUIT_IDS, ["pure", "balanced", "shark"]);
  for (const id of RECRUIT_IDS) assert.ok(recruitStyle(id) !== null, id);
  for (const id of ["", "PURE", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.equal(recruitStyle(id), null, id);
  }
});

test("the recruits run from no items to every item", () => {
  const [pure, balanced, shark] = RECRUIT_IDS.map((id) => recruitStyle(id)!);
  assert.ok(pure.itemBias < balanced.itemBias && balanced.itemBias < shark.itemBias);
  assert.equal(pure.shopping.length, 0);
  assert.ok(shark.shopping.length > balanced.shopping.length);
  assert.equal(new Set([pure.name, balanced.name, shark.name]).size, 3);
});

test("the pure Go bot never buys, and never uses an item even when handed one", () => {
  const rich = { moves: 9, fireflies: 500, market: MARKET };
  assert.equal(chooseBuy(view(5, 1, rich), reed()), null);

  const v = corneredPair({ powerups: ["lantern_ward"] });
  const action = chooseAction(v, reed(), new Rng(1));
  assert.equal(action.kind, "move");
});

test("the market bot shops as soon as the market opens, and spends a turn on an item", () => {
  const rich = { moves: 5, fireflies: 500, market: MARKET };
  assert.equal(chooseBuy(view(5, 1, rich), magpie()), "lantern_ward");
  assert.equal(chooseBuy(view(5, 1, { ...rich, moves: 4 }), magpie()), null); // not open yet

  const v = corneredPair({ powerups: ["lantern_ward"] });
  const action = chooseAction(v, magpie(), new Rng(1));
  assert.equal(action.kind, "powerup");
  if (action.kind === "powerup") assert.equal(action.id, "lantern_ward");
});

test("the balanced bot would rather take the board than a ward it barely needs", () => {
  // The same cornered pair, but a stone that captures is on the board: Tanuki's
  // itemBias is small enough that the capture wins.
  const size = 5;
  const v = view(size, 1, { powerups: ["lantern_ward"] });
  v.board[boardIndex(size, 2, 2)] = stoneCode(2, "base");
  for (const [x, y] of [[1, 2], [3, 2], [2, 1]]) v.board[boardIndex(size, x, y)] = stoneCode(1, "base");
  const action = chooseAction(v, tanuki(), new Rng(1));
  assert.equal(action.kind, "move");
});

test("a bot with judgement passes when every point left is a loss", () => {
  const size = 3;
  const v = view(size, 1);
  // Driftwood everywhere but two adjacent corner points: a stone on either
  // would sit on its last liberty and take nothing for it.
  v.board = [0, 0, 9, 9, 9, 9, 9, 9, 9];
  assert.ok(rankMoves(v, heron()).length > 0, "there are legal points to be declined");
  assert.deepEqual(chooseAction(v, heron(), new Rng(7)), { kind: "pass" });
  // The fallback style has no judgement and plays any legal point.
  assert.equal(chooseAction(v, randomStyle(), new Rng(7)).kind, "move");
});

test("a move that only refills its own area is pointless, one that grows it is not", () => {
  const size = 5;
  const v = view(size, 1);
  // A black wall across row 2 with two liberties to spare: the empty points
  // above it are black area on the base front already.
  for (let x = 0; x < size; x++) v.board[boardIndex(size, x, 2)] = stoneCode(1, "base");
  for (let x = 0; x < size; x++) v.board[boardIndex(size, x, 3)] = stoneCode(1, "pattern");
  for (let x = 0; x < size; x++) v.board[boardIndex(size, x, 4)] = 9;
  const fill = rankMoves(v, heron()).find((c) => c.x === 2 && c.y === 1 && c.axis === "base");
  assert.ok(fill, "the fill is a legal point");
  assert.equal(isPointless(v, fill), true);
  const open = view(size, 1);
  const first = rankMoves(open, heron())[0];
  assert.equal(isPointless(open, first), false);
});

test("a lone stone does not own the board, whatever the count says", () => {
  // By the letter of the territory rule one black stone on an empty 7x7 walls
  // in all 48 remaining points, so black "leads" the base front and every
  // further black stone reads as giving a point back. Believed, that argument
  // makes all four seats pass on move two -- so isSettled sizes the region and
  // refuses to call the open board anybody's territory.
  const size = 7;
  const v = view(size, 1);
  v.board[boardIndex(size, 3, 3)] = stoneCode(1, "base");
  assert.equal(territoryScore(v.board, size).black, 48, "the count really does say this");

  const more = rankMoves(v, heron()).find((c) => c.x === 0 && c.y === 0 && c.axis === "base");
  assert.ok(more, "the extra stone is a legal point");
  assert.equal(isPointless(v, more), false, "there is still a whole board to play on");
  const other = rankMoves(v, heron()).find((c) => c.axis === "pattern");
  assert.ok(other);
  assert.equal(isPointless(v, other), false, "the lagging front is worth building");
});

test("a small region walled in by one side is territory, and filling it is pointless", () => {
  // The same shape, shrunk until it is real territory rather than open board:
  // a black wall across a 5x5 with driftwood behind it, leaving ten points that
  // only black borders. Ten is inside the 2 x size the endgame allows, so the
  // bot leaves them alone instead of spending its own ground.
  const size = 5;
  const v = view(size, 1);
  for (let x = 0; x < size; x++) v.board[boardIndex(size, x, 2)] = stoneCode(1, "base");
  for (let x = 0; x < size; x++) v.board[boardIndex(size, x, 3)] = stoneCode(1, "pattern");
  for (let x = 0; x < size; x++) v.board[boardIndex(size, x, 4)] = 9;

  const { region, borders } = regionAt(v.board, size, "base", boardIndex(size, 2, 1));
  assert.deepEqual([region, [...borders]], [10, ["black"]]);
  assert.equal(isSettled(size, region, borders), true);

  const fill = rankMoves(v, heron()).find((c) => c.x === 2 && c.y === 1 && c.axis === "base");
  assert.ok(fill, "the fill is a legal point");
  assert.equal(isPointless(v, fill), true);
});

test("a stone that costs the bot a point on its other front is pointless", () => {
  // A settled 5x5 found by search: player 1 sits on both fronts, and the gray
  // point (4,0) walls off a region that gray was already counting, so the stone
  // leaves the bot a point worse off without taking anything for it.
  const size = 5;
  const v = view(size, 1);
  v.board = [0, 5, 5, 1, 0, 5, 1, 5, 0, 5, 5, 5, 1, 0, 1, 1, 0, 0, 0, 5, 6, 0, 5, 2, 1];
  const score = (board: number[]) => {
    const area = territoryScore(board, size);
    const sides = sidesOf(1);
    return Math.min(area[sides.base], area[sides.pattern]);
  };
  const after = v.board.slice();
  after[boardIndex(size, 4, 0)] = stoneCode(1, "pattern");
  assert.equal(score(after), score(v.board) - 1, "the move really does cost a point");
  const drop = rankMoves(v, heron()).find((c) => c.x === 4 && c.y === 0 && c.axis === "pattern");
  assert.ok(drop, "the stone is a legal point the bot would otherwise rank");
  assert.equal(isPointless(v, drop), true);
});

test("a bot with judgement still plays on an open board", () => {
  for (const style of [heron(), tanuki(), oldToad(), moth()]) {
    const action = chooseAction(view(7, 1), style, new Rng(3));
    assert.equal(action.kind, "move", style.name);
  }
});

test("a move that would repeat a board position is not offered", () => {
  const size = 5;
  const v = view(size, 1, { repeats: () => true });
  assert.equal(rankMoves(v, heron()).length, 0);
  const only = 12; // ko applies only to the point that recreates the board
  const w = view(size, 1, { repeats: (b) => b[only] !== 0 });
  const ranked = rankMoves(w, heron());
  assert.ok(ranked.length > 0);
  assert.ok(ranked.every((c) => boardIndex(size, c.x, c.y) !== only));
});

// A ko on 5x5: black (1) takes white's (1,1) by playing (2,1). In KO_WALLED the
// points around (1,1) are white's gray stones instead -- walls on the base front
// -- so black could never fill there, and white takes the stone straight back.
const KO_OPEN = [".12..", "12.2.", ".12..", ".....", "....."];
const KO_WALLED = [".62..", "62.2.", ".62..", ".....", "....."];

function board(rows: string[]): number[] {
  return rows.join("").split("").map((c) => (c === "." ? 0 : Number(c)));
}

// Every weight but the two a take is judged on set to zero, so the score says only that.
const TAKES_ONLY: Style = {
  ...reed(),
  atari: 0,
  connect: 0,
  cut: 0,
  contact: 0,
  locality: 0,
  extension: 0,
  line: 0,
  hemmed: 0,
  axisBias: 0,
};

test("a take the next seat simply takes back is paid for like a self-atari", () => {
  const s = TAKES_ONLY;
  assert.equal(scoreMove(view(5, 1, { board: board(KO_OPEN) }), 2, 1, "base", s), s.capture);
  assert.equal(scoreMove(view(5, 1, { board: board(KO_WALLED) }), 2, 1, "base", s), s.capture - s.selfAtari);
});

test("a bot fills the ko it took instead of calling the point its own eye", () => {
  const b = board(KO_OPEN);
  play(b, 5, 2, 1, "base", 1);
  const ranked = rankMoves(view(5, 1, { board: b }), reed());
  assert.ok(ranked.some((c) => c.x === 1 && c.y === 1 && c.axis === "base"));
});

test("a ko the rules hold for the round is not offered", () => {
  const b = board(KO_OPEN);
  play(b, 5, 2, 1, "base", 1);
  const retake = boardIndex(5, 1, 1);
  const free = rankMoves(view(5, 2, { board: b }), reed());
  assert.ok(free.some((c) => boardIndex(5, c.x, c.y) === retake));
  const held = rankMoves(view(5, 2, { board: b, retakesKo: (idx) => idx === retake }), reed());
  assert.ok(held.every((c) => boardIndex(5, c.x, c.y) !== retake));
});
