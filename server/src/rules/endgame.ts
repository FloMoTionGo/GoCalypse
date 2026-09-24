// End-of-game scoring: Japanese (territory) scoring, run once per front, then
// folded into one score per player.
//
// The game ends when all four players pass in a row. Nothing is removed first
// (there is nobody to agree what is dead), so the board is scored as it stands:
// capture what should go before you pass, and a stone still standing is alive.
//
// On each front, a point counts for a side only when it is EMPTY and the empty
// region around it touches only that side's stones. Stones score nothing --
// that is what makes this territory scoring rather than area scoring -- but
// they still wall regions off, so a stone is worth exactly the territory it
// surrounds. A stone that is a wall on the front (its owner committed it to the
// other front, or it is driftwood) is invisible there: it scores for no one and
// does not spoil a region for anyone, exactly like the edge of the board.
//
// On top of its side's territory, each player counts the PRISONERS it took
// itself: stones it captured on that front over the match. Territory belongs to
// a side and is therefore shared by the two seats that hold it; prisoners
// belong to the player who played the capturing move, which is the same
// accounting GoRoom already uses for fireflies, and it is why taking a group
// yourself is worth more than leaving it to the ally who shares your front.
//
// That gives each player two totals -- territory + prisoners on the base front,
// and the same on the pattern front. The lower of the two is their final score;
// the higher only breaks a tie.

import { boardIndex, neighbors, StoneView, stoneCode, viewValue } from "./goRules";

export type Side = "black" | "white" | "gray" | "transparent";
export type Territory = Record<Side, number>;

/** Wire encoding for a side, used by GoState's per-point territory maps: 0 means "no side". */
export const SIDE_CODE: Record<Side, number> = { black: 1, white: 2, gray: 3, transparent: 4 };

/** Prisoners one player took, by the front the dead group was judged on. */
export interface Prisoners {
  base: number;
  pattern: number;
}

export interface PlayerResult {
  color: number; // 1..4
  baseTerritory: number; // territory of this player's base side (black or white)
  patternTerritory: number; // territory of this player's pattern side (gray or transparent)
  basePrisoners: number; // base-front stones this player captured
  patternPrisoners: number; // pattern-front stones this player captured
  base: number; // baseTerritory + basePrisoners
  pattern: number; // patternTerritory + patternPrisoners
  score: number; // the lower of the two: the final score
  tiebreak: number; // the higher of the two
  place: number; // 1 = first; players level on score and tiebreak share a place
}

/**
 * Floods the empty region containing `start` on one front, counting its points
 * and noting which sides wall it in. A stone that is a wall on this front (its
 * owner committed it to the other one, or it is driftwood) stops the flood but
 * borders nothing, exactly like the edge of the board.
 */
function flood(
  board: ArrayLike<number>,
  size: number,
  view: StoneView,
  start: number,
  seen: Set<number>
): { points: number[]; borders: Set<Side> } {
  const points: number[] = [];
  const borders = new Set<Side>();
  const stack = [start];
  seen.add(start);
  while (stack.length > 0) {
    const idx = stack.pop()!;
    points.push(idx);
    for (const n of neighbors(size, idx % size, Math.floor(idx / size))) {
      const nIdx = boardIndex(size, n.x, n.y);
      const nCode = board[nIdx];
      if (nCode === 0) {
        if (!seen.has(nIdx)) {
          seen.add(nIdx);
          stack.push(nIdx);
        }
      } else {
        const side = viewValue(view, nCode) as Side | null;
        if (side) borders.add(side);
      }
    }
  }
  return { points, borders };
}

/**
 * The empty region this point belongs to on one front: how big it is, and which
 * sides wall it in. Exactly one side means the region counts for that side, and
 * the size is what says whether that means anything yet -- see `isSettled`.
 */
export function regionAt(
  board: ArrayLike<number>,
  size: number,
  view: StoneView,
  start: number
): { region: number; borders: Set<Side> } {
  if (board[start] !== 0) return { region: 0, borders: new Set() };
  const { points, borders } = flood(board, size, view, start, new Set());
  return { region: points.length, borders };
}

/**
 * Whether an empty region is settled territory rather than open board.
 *
 * One bordering side is not enough on its own, and this is the trap the scoring
 * change walked into: on a nearly empty board the single huge region touches
 * one lone stone and so counts, by the letter of the rule, as that side's
 * territory. Read literally, every seat then believes the game is already
 * decided on move one and passes. Real territory at the end of a game is small
 * and enclosed, so size is what tells the two apart. Two rows' worth of points
 * is the line: comfortably above the eye-space and corner territory a finished
 * board leaves behind, and far below the open board.
 *
 * It is a threshold, and it is the one judgement in the endgame that is not
 * derived from the rules. Nothing in the scoring depends on it -- only a bot's
 * decision to stop playing does.
 */
export function isSettled(size: number, region: number, borders: Set<Side>): boolean {
  return borders.size === 1 && region <= 2 * size;
}

function scoreFront(board: ArrayLike<number>, size: number, view: StoneView, totals: Territory): void {
  const seen = new Set<number>();

  for (let start = 0; start < size * size; start++) {
    // A stone scores nothing under territory scoring. It is not skipped over,
    // though: the flood still reads it as a border, so it keeps every point it
    // surrounds.
    if (board[start] !== 0 || seen.has(start)) continue;
    const { points, borders } = flood(board, size, view, start, seen);
    if (borders.size === 1) totals[borders.values().next().value as Side] += points.length;
  }
}

/** Territory for all four sides, counted on the board as it stands. */
export function territoryScore(board: ArrayLike<number>, size: number): Territory {
  const totals: Territory = { black: 0, white: 0, gray: 0, transparent: 0 };
  scoreFront(board, size, "base", totals);
  scoreFront(board, size, "pattern", totals);
  return totals;
}

/**
 * Which side owns each point on one front, as SIDE_CODE values (0 where the
 * point is a stone, dame, or open board). Same regions and the same
 * single-border rule as scoreFront -- this just keeps the "who" per point
 * instead of folding it into a total, so a client can mark the board.
 */
export function territoryOwners(board: ArrayLike<number>, size: number, view: StoneView): number[] {
  const owners = new Array<number>(size * size).fill(0);
  const seen = new Set<number>();

  for (let start = 0; start < size * size; start++) {
    if (board[start] !== 0 || seen.has(start)) continue;
    const { points, borders } = flood(board, size, view, start, seen);
    if (borders.size !== 1) continue;
    const code = SIDE_CODE[borders.values().next().value as Side];
    for (const p of points) owners[p] = code;
  }
  return owners;
}

/** The two sides a player (combo 1..4) belongs to. */
export function sidesOf(color: number): { base: Side; pattern: Side } {
  return {
    base: viewValue("base", stoneCode(color, "base")) as Side,
    pattern: viewValue("pattern", stoneCode(color, "pattern")) as Side,
  };
}

/**
 * Final scores and places for the given combos, in the order they are given.
 * `prisoners` runs alongside `colors`: one entry per player, since two players
 * can share a side and still hold different prisoners.
 */
export function finalResults(
  territory: Territory,
  colors: number[],
  prisoners: Prisoners[] = []
): PlayerResult[] {
  const results: PlayerResult[] = colors.map((color, i) => {
    const sides = sidesOf(color);
    const took = prisoners[i] ?? { base: 0, pattern: 0 };
    const baseTerritory = territory[sides.base];
    const patternTerritory = territory[sides.pattern];
    const base = baseTerritory + took.base;
    const pattern = patternTerritory + took.pattern;
    return {
      color,
      baseTerritory,
      patternTerritory,
      basePrisoners: took.base,
      patternPrisoners: took.pattern,
      base,
      pattern,
      score: Math.min(base, pattern),
      tiebreak: Math.max(base, pattern),
      place: 0,
    };
  });
  for (const r of results) {
    const better = results.filter(
      (o) => o.score > r.score || (o.score === r.score && o.tiebreak > r.tiebreak)
    ).length;
    r.place = 1 + better;
  }
  return results;
}
