import { StoneView } from "../rules/goRules";
import { planItem } from "./items";
import { Rng } from "./rng";
import { BotView, Candidate, isPointless, rankMoves } from "./scoring";
import { Style } from "./styles";

export { Rng } from "./rng";
export { chooseBuy } from "./items";
export { rankMoves, scoreMove, chooseMove, isPointless } from "./scoring";
export type { BotView, Candidate, MarketRow } from "./scoring";
export type { Style } from "./styles";
export { heron, magpie, moth, oldToad, randomStyle, RECRUIT_IDS, recruitStyle, reed, tanuki, temperamentFor } from "./styles";

/**
 * One turn's worth of intent. "pass" is what a bot returns when the board
 * offers it nothing legal; the room turns it into a real pass, which counts
 * towards the four in a row that end the game.
 */
export type BotAction =
  | { kind: "move"; x: number; y: number; axis: StoneView }
  | { kind: "powerup"; id: string; target: { x: number; y: number } }
  | { kind: "pass" };

/**
 * A stone or an item, whichever is worth more.
 *
 * Both sides are scored on the same scale, so the comparison is a real one:
 * `itemBias` is the only thumb on it, and it says how much this bot enjoys
 * spending a turn at the market rather than on the board. The move itself is
 * drawn from the best few rather than taken outright -- that draw, and the
 * Style behind the scores, are what make four seats read as four people.
 */
export function chooseAction(view: BotView, style: Style, rng: Rng): BotAction {
  const ranked = rankMoves(view, style);
  const move = pickMove(view, style, rng, ranked);
  const item = planItem(view, style, ranked);

  if (item && (!move || item.score + style.itemBias > move.score)) {
    return { kind: "powerup", id: item.id, target: item.target };
  }
  if (move) return { kind: "move", x: move.x, y: move.y, axis: move.axis };
  return { kind: "pass" };
}

/**
 * One of the best few points, drawn at random -- but a bot with judgement
 * only draws from moves worth making. When every point left is pointless it
 * has no move at all, which chooseAction turns into a pass: better to hand
 * the turn over than to fill in its own area or throw a stone into atari.
 */
function pickMove(view: BotView, style: Style, rng: Rng, ranked: Candidate[]): Candidate | null {
  const width = Math.max(1, style.variation);
  const pool = style.judgement ? [] : ranked.slice(0, width);
  if (style.judgement) {
    for (const move of ranked) {
      if (isPointless(view, move)) continue;
      pool.push(move);
      if (pool.length >= width) break;
    }
  }
  return pool.length > 0 ? rng.pick(pool) : null;
}
