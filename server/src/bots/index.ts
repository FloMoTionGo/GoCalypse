import { StoneView } from "../rules/goRules";
import { planItem } from "./items";
import { Rng } from "./rng";
import { BotView, rankMoves } from "./scoring";
import { Style } from "./styles";

export { Rng } from "./rng";
export { chooseBuy } from "./items";
export { rankMoves, scoreMove, chooseMove } from "./scoring";
export type { BotView, Candidate, MarketRow } from "./scoring";
export type { Style } from "./styles";
export { heron, moth, oldToad, randomStyle, tanuki, temperamentFor } from "./styles";

/**
 * One turn's worth of intent. "pass" is what a bot returns when the board
 * offers it nothing legal -- there is no pass move in the rules yet
 * (ideas.md D-G5), so the room turns it into a skipped seat rather than a
 * stalled table.
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
  const move = ranked.length > 0 ? rng.pick(ranked.slice(0, Math.max(1, style.variation))) : null;
  const item = planItem(view, style, ranked);

  if (item && (!move || item.score + style.itemBias > move.score)) {
    return { kind: "powerup", id: item.id, target: item.target };
  }
  if (move) return { kind: "move", x: move.x, y: move.y, axis: move.axis };
  return { kind: "pass" };
}
