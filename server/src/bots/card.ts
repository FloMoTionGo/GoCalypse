import { applyCaptures, boardIndex, Point } from "../rules/goRules";
import { CARD_CELLS, CARD_CENTRE, CARD_EMPTY, cardLandings, nextUpgradeCost, STONE_CARD, upgradesDone } from "../rules/stoneCard";
import { Rng } from "./rng";
import { BotView, pointOf, scoreMove } from "./scoring";
import { Style } from "./styles";

// The Stone Card, from a bot's side of the table (rules/stoneCard.ts).
//
// Adding stones goes by the purse habits a Style already has: a bot that never
// shops never adds one either, a careful one (itemBias below zero) keeps as
// much again as the stone costs, and the rest add one whenever they can pay.
// A bot only ever adds its main (base) stone, on a random empty cell, and
// stops at BOT_CARD_STONES: a solid 3x3 block is a clump, not a shape.
//
// Playing it waits until the card is as good as it will get -- those five
// stones, or held by a bot that adds nothing -- or until the table starts
// passing, and then it has to beat the move the bot would otherwise make.

/** Stones on a bot's card, the centre included, before it stops adding and plays it: 5 of the 9. */
export const BOT_CARD_STONES = 5;

export interface CardPlan {
  target: Point;
  score: number;
}

function cardInHand(view: BotView): number[] | null {
  const card = view.card;
  return card && card.length === CARD_CELLS && view.powerups.includes(STONE_CARD) ? card : null;
}

/** Fireflies this bot keeps back beside a stone's price; null when it never adds one. */
function reserveFor(style: Style, cost: number): number | null {
  if (style.shopping.length === 0) return null;
  return style.itemBias < 0 ? cost : 0;
}

/** The card cell to add the bot's next stone to, or null to leave the card as it is. */
export function chooseCardUpgrade(view: BotView, style: Style, rng: Rng): number | null {
  const card = cardInHand(view);
  if (!card) return null;
  const cost = nextUpgradeCost(card);
  if (cost === null || upgradesDone(card) + 1 >= BOT_CARD_STONES) return null;
  const reserve = reserveFor(style, cost);
  if (reserve === null || view.fireflies < cost + reserve) return null;
  const empty: number[] = [];
  for (let i = 0; i < CARD_CELLS; i++) if (i !== CARD_CENTRE && card[i] === CARD_EMPTY) empty.push(i);
  return empty.length ? empty[rng.below(empty.length)] : null;
}

function cardReady(view: BotView, style: Style, card: number[]): boolean {
  if (upgradesDone(card) + 1 >= BOT_CARD_STONES) return true; // as many stones as a bot wants on it
  if (reserveFor(style, 0) === null) return true; // never grows: it is what it is
  return view.passes > 0; // the table is winding down: play what there is
}

/**
 * The best centre for the card, scored as its stones landing one after the
 * other, each judged like a move on the board the ones before it left. Null
 * while the bot would rather keep the card, or when no stone would land.
 */
export function planCard(view: BotView, style: Style): CardPlan | null {
  const card = cardInHand(view);
  if (!card || !cardReady(view, style, card)) return null;
  const { size } = view;
  let best: CardPlan | null = null;

  for (let idx = 0; idx < view.board.length; idx++) {
    const centre = pointOf(size, idx);
    const board = view.board.slice();
    // The card's stones are never twins, whatever wick is lit.
    const trial: BotView = { ...view, board, twin: false };
    let score = 0;
    let landed = 0;
    for (const s of cardLandings(card, centre, view.color, size)) {
      const value = scoreMove(trial, s.x, s.y, s.code > 4 ? "pattern" : "base", style);
      if (value === null) continue;
      board[boardIndex(size, s.x, s.y)] = s.code;
      applyCaptures(board, size, s.x, s.y, s.code, (i) => view.isWarded(i));
      score += value;
      landed += 1;
    }
    if (landed === 0 || view.repeats?.(board)) continue;
    if (!best || score > best.score) best = { target: centre, score };
  }
  return best;
}
