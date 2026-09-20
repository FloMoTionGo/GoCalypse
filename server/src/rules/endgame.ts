// End-of-game scoring: normal Go area scoring, run once per front, then folded
// into one score per player.
//
// The game ends when all four players pass in a row. Nothing is removed first
// (there is nobody to agree what is dead), so the board is scored as it stands.
//
// On each front, a point counts for a side when
//   - a stone of that side stands on it, or
//   - it is empty and the empty region around it touches only that side's stones.
// A stone that is a wall on the front (its owner committed it to the other
// front, or it is driftwood) is invisible there: it scores for no one and does
// not spoil a region for anyone, exactly like the edge of the board.
//
// That gives four totals -- black, white, dots, stripes. Every player belongs to
// one side on each front, so each has two totals of their own. The lower of the
// two is their final score; the higher only breaks a tie.

import { boardIndex, neighbors, StoneView, stoneCode, viewValue } from "./goRules";

export type Side = "black" | "white" | "dots" | "stripes";
export type AreaScore = Record<Side, number>;

export interface PlayerResult {
  color: number; // 1..4
  base: number; // area of this player's base side (black or white)
  pattern: number; // area of this player's pattern side (dots or stripes)
  score: number; // the lower of the two: the final score
  tiebreak: number; // the higher of the two
  place: number; // 1 = first; players level on score and tiebreak share a place
}

function scoreFront(board: ArrayLike<number>, size: number, view: StoneView, totals: AreaScore): void {
  const seen = new Set<number>();

  for (let start = 0; start < size * size; start++) {
    const code = board[start];
    if (code !== 0) {
      const side = viewValue(view, code) as Side | null;
      if (side) totals[side] += 1;
      continue;
    }
    if (seen.has(start)) continue;

    // Flood the empty region and note which sides border it.
    let region = 0;
    const borders = new Set<Side>();
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const idx = stack.pop()!;
      region += 1;
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
    if (borders.size === 1) totals[borders.values().next().value as Side] += region;
  }
}

/** Area totals for all four sides, counted on the board as it stands. */
export function areaScore(board: ArrayLike<number>, size: number): AreaScore {
  const totals: AreaScore = { black: 0, white: 0, dots: 0, stripes: 0 };
  scoreFront(board, size, "base", totals);
  scoreFront(board, size, "pattern", totals);
  return totals;
}

/** The two sides a player (combo 1..4) belongs to. */
export function sidesOf(color: number): { base: Side; pattern: Side } {
  return {
    base: viewValue("base", stoneCode(color, "base")) as Side,
    pattern: viewValue("pattern", stoneCode(color, "pattern")) as Side,
  };
}

/** Final scores and places for the given combos, in the order they are given. */
export function finalResults(area: AreaScore, colors: number[]): PlayerResult[] {
  const results: PlayerResult[] = colors.map((color) => {
    const sides = sidesOf(color);
    const base = area[sides.base];
    const pattern = area[sides.pattern];
    return { color, base, pattern, score: Math.min(base, pattern), tiebreak: Math.max(base, pattern), place: 0 };
  });
  for (const r of results) {
    const better = results.filter(
      (o) => o.score > r.score || (o.score === r.score && o.tiebreak > r.tiebreak)
    ).length;
    r.place = 1 + better;
  }
  return results;
}
