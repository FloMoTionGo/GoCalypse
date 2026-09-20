import { StoneView } from "../rules/goRules";

// What one bot wants.
//
// Ported from the classic player in GoSequencer (Source/GoAI.h -- `Style` and
// `detail::scoreMove`), whose list of terms in turn comes from Leela, the Go
// engine by Gian-Carlo Pascutto (https://github.com/gcp/Leela, MIT): capture
// and saving sizes, self-atari, cutting and connecting, contact. Each is
// written again here over this variant's board. No Leela source and no Leela
// data is copied in, and its search and its neural networks are deliberately
// left out.
//
// Nothing here is trained and nothing learns while the server runs. These are
// numbers written by hand, and a move is a few hundred integer additions.

/**
 * Every weight is in hundredths of a point, so the terms add up to what a move
 * is worth and a stone move and an item use can be compared on one scale. The
 * differences between two Styles are the whole point: four seats holding four
 * Styles read as four people, not as one function run four times.
 */
export interface Style {
  name: string;
  capture: number; // per enemy stone this move lifts
  save: number; // per own stone pulled back out of atari
  atari: number; // per enemy stone left on one liberty
  connect: number; // per own chain joined beyond the first
  cut: number; // per enemy chain split beyond the first
  contact: number; // per enemy stone this one touches
  locality: number; // for staying near the last move, falling off with distance
  extension: number; // for a comfortable distance from its own side's stones
  line: number; // for the third and fourth lines, against the first
  selfAtari: number; // subtracted: one liberty left and nothing taken for it
  hemmed: number; // subtracted per neighbour that is a wall on the played front
  axisBias: number; // added when the move is on `prefers`
  prefers: StoneView; // the front this one reaches for first
  itemBias: number; // added to every item score: how readily it spends a turn at the market
  shopping: string[]; // what it buys, in order
  variation: number; // how many of the best points it draws from
  judgement: boolean; // passes rather than play a move that takes, saves and gains nothing
}

const BALANCED: Style = {
  name: "balanced",
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
  hemmed: 80,
  axisBias: 0,
  prefers: "base",
  itemBias: 0,
  shopping: ["lantern_ward", "driftwood", "gust", "remove_stone"],
  variation: 3,
  judgement: true,
};

/**
 * Three weights have no counterpart in two-player Go and are where this
 * variant actually lives:
 *
 *  - `atari` is worth less here than it is there. The player sharing your
 *    front is not you: leave a group on one liberty and your ally may take it
 *    and bank the 5 fireflies a stone, because GoRoom credits captures to
 *    whoever plays the move, not to the side that gains.
 *  - `hemmed` prices driftwood. It takes a liberty like any stone and can
 *    never be taken back off the board, so a point hemmed in by logs is worth
 *    less than one hemmed in by enemies.
 *  - `axisBias` + `prefers` decide which war a bot would rather fight, which
 *    is the most visible difference between two of them at the same table.
 */

/** Holds its stones together, takes the calm extension, fights only for something real. */
export function heron(): Style {
  return {
    ...BALANCED,
    name: "Heron",
    capture: 1200,
    save: 1100,
    atari: 300,
    connect: 350,
    cut: 150,
    contact: 40,
    locality: 300,
    extension: 500,
    line: 300,
    hemmed: 140,
    axisBias: 200,
    prefers: "base",
    itemBias: -400,
    shopping: ["lantern_ward", "lily_pad", "driftwood", "remove_stone"],
    variation: 4,
  };
}

/** Goes to the stones. Contact, cuts and ataris are worth more to it than shape is. */
export function tanuki(): Style {
  return {
    ...BALANCED,
    name: "Tanuki",
    capture: 1600,
    save: 900,
    atari: 650,
    connect: 150,
    cut: 500,
    contact: 250,
    locality: 700,
    extension: 150,
    line: 120,
    hemmed: 40,
    axisBias: 150,
    prefers: "base",
    itemBias: 300,
    shopping: ["gust", "remove_stone", "lantern_ward", "bomb"],
    variation: 2,
  };
}

/** Plays the market rather than the board: buys early, spends turns on items. */
export function oldToad(): Style {
  return {
    ...BALANCED,
    name: "Old Toad",
    capture: 1300,
    save: 1000,
    atari: 450,
    connect: 200,
    cut: 250,
    contact: 90,
    locality: 350,
    extension: 300,
    line: 220,
    hemmed: 90,
    axisBias: 0,
    prefers: "base",
    itemBias: 900,
    shopping: ["driftwood", "lily_pad", "lantern_ward", "turn_lantern", "bomb"],
    variation: 3,
  };
}

/** Fights the pattern war and builds with walls: the other three keep bumping into it. */
export function moth(): Style {
  return {
    ...BALANCED,
    name: "Moth",
    capture: 1250,
    save: 950,
    atari: 400,
    connect: 400,
    cut: 350,
    contact: 110,
    locality: 400,
    extension: 420,
    line: 260,
    hemmed: 20,
    axisBias: 700,
    prefers: "pattern",
    itemBias: 100,
    shopping: ["driftwood", "turn_lantern", "lantern_ward", "gust"],
    variation: 3,
  };
}

/** Plays the board and only the board: never buys, never uses an item. */
export function reed(): Style {
  return {
    ...BALANCED,
    name: "Reed",
    hemmed: 100,
    itemBias: -1_000_000, // no item can ever beat a stone
    shopping: [], // and nothing is ever bought, so there is nothing to use
    variation: 3,
  };
}

/**
 * Spends a turn at the market rather than on a stone whenever an item can do
 * anything at all, and shops down the whole list. The purse is what limits it:
 * fireflies are only earned by placing stones, so it still has to play the
 * board every few moves to afford the next item.
 */
export function magpie(): Style {
  return {
    ...BALANCED,
    name: "Magpie",
    capture: 1300,
    atari: 450,
    contact: 100,
    locality: 450,
    extension: 320,
    line: 220,
    itemBias: 2400,
    shopping: ["lantern_ward", "turn_lantern", "driftwood", "lily_pad", "gust", "remove_stone", "bomb"],
    variation: 3,
  };
}

const TEMPERAMENTS = [heron, tanuki, oldToad, moth];

// The bots a player can seat from the welcome screen, from no items at all to
// every item there is. The ids are the wire names web/main.js sends in
// "addBots" -- a Map, so a client-supplied id like "constructor" finds nothing.
const RECRUITS = new Map<string, () => Style>([
  ["pure", reed],
  ["balanced", tanuki],
  ["shark", magpie],
]);

export const RECRUIT_IDS = Array.from(RECRUITS.keys());

export function recruitStyle(id: string): Style | null {
  const make = RECRUITS.get(id);
  return make ? make() : null;
}

/** A temperament (and with it a name) per seat, so no two bots at a table are alike. */
export function temperamentFor(seat: number): Style {
  return TEMPERAMENTS[Math.abs(seat) % TEMPERAMENTS.length]();
}

/**
 * Tier 0, and the room's fallback: every weight zero and a draw wide enough to
 * cover the whole board, so the scorer collapses to "any legal point that is
 * not our own eye". Nothing to tune, and it can never be the reason a table
 * stalls.
 */
export function randomStyle(): Style {
  return {
    ...BALANCED,
    name: "drifter",
    capture: 0,
    save: 0,
    atari: 0,
    connect: 0,
    cut: 0,
    contact: 0,
    locality: 0,
    extension: 0,
    line: 0,
    selfAtari: 0,
    hemmed: 0,
    axisBias: 0,
    itemBias: -1_000_000, // never spends a turn at the market
    shopping: [],
    variation: Number.MAX_SAFE_INTEGER,
    judgement: false, // the fallback plays any legal point, so a stalled table always moves
  };
}
