import { isOnBoard, Point, stoneCode, StoneView } from "./goRules";

// The Stone Card: every player is dealt one at the start, a 3x3 go board with
// one of their stones in the middle. It sits in the hand like an item, but it
// is never sold. Its owner may add stones to it for fireflies at any time, and
// playing it takes a turn: all its stones land on the board at once, around a
// centre point the player picks, in the card's own orientation (no rotation).
//
// PlayerState.card holds the 3x3 grid row by row (index = (dy + 1) * 3 + dx + 1),
// each cell one of CARD_EMPTY / CARD_BASE / CARD_PATTERN: which of the owner's
// two fronts that stone fights on. An empty array means no card: played already,
// or a game saved before the card existed.

export const STONE_CARD = "stone_card";
export const STONE_CARD_NAME = "Stone Card";
export const CARD_CELLS = 9;
export const CARD_CENTRE = 4;
export const CARD_EMPTY = 0;
export const CARD_BASE = 1;
export const CARD_PATTERN = 2;
/** Stones that can be added: every cell but the centre, which the card starts with. */
export const CARD_UPGRADES = CARD_CELLS - 1;

const FIRST_UPGRADE_COST = 100;
const UPGRADE_COST_STEP = 25;

/** A fresh card: its centre stone on `axis`, the rest empty. */
export function newCard(axis: StoneView = "base"): number[] {
  const card = new Array(CARD_CELLS).fill(CARD_EMPTY);
  card[CARD_CENTRE] = cellFor(axis);
  return card;
}

export function cellFor(axis: StoneView): number {
  return axis === "pattern" ? CARD_PATTERN : CARD_BASE;
}

/** Stones added to the card so far (the centre one is not an upgrade). */
export function upgradesDone(card: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < card.length; i++) if (i !== CARD_CENTRE && card[i] !== CARD_EMPTY) n++;
  return n;
}

/** Fireflies the next stone costs: 100, 125, 150 ... 275. Null once the card is full. */
export function nextUpgradeCost(card: ArrayLike<number>): number | null {
  const done = upgradesDone(card);
  return done >= CARD_UPGRADES ? null : FIRST_UPGRADE_COST + UPGRADE_COST_STEP * done;
}

/**
 * The order the stones land in: the centre, then the ring around it clockwise
 * from its top-left corner. Card indices.
 */
export const LANDING_ORDER = [CARD_CENTRE, 0, 1, 2, 5, 8, 7, 6, 3];

/**
 * Where each of the card's stones would land for a centre point, in landing
 * order, with the board code it lands as. Cells that fall off the board are
 * left out; whether the point is free is for the caller to judge.
 */
export function cardLandings(card: ArrayLike<number>, centre: Point, player: number, size: number): { x: number; y: number; code: number }[] {
  const out: { x: number; y: number; code: number }[] = [];
  for (const cell of LANDING_ORDER) {
    const kind = card[cell];
    if (kind !== CARD_BASE && kind !== CARD_PATTERN) continue;
    const x = centre.x + (cell % 3) - 1;
    const y = centre.y + Math.floor(cell / 3) - 1;
    if (!isOnBoard(size, x, y)) continue;
    out.push({ x, y, code: stoneCode(player, kind === CARD_PATTERN ? "pattern" : "base") });
  }
  return out;
}
