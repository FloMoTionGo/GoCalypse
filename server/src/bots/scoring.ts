import {
  applyCaptures,
  axisOf,
  boardIndex,
  findGroup,
  isOnBoard,
  isPlayerStone,
  neighbors,
  sameView,
  stoneCode,
  StoneView,
} from "../rules/goRules";
import { areaScore, sidesOf } from "../rules/endgame";
import { Rng } from "./rng";
import { Style } from "./styles";

/** A market row, flattened off the synced state so the scorer stays pure. */
export interface MarketRow {
  id: string;
  price: number;
  removal: boolean;
}

/**
 * Everything a bot is allowed to see, as plain arrays rather than schema
 * objects. Keeping it plain is what makes the whole player testable: a test
 * hands it a board literal and a seed and asserts the move, with no room, no
 * socket and no Colyseus (see bots.test.ts).
 */
export interface BotView {
  board: number[];
  size: number;
  color: number; // this bot's combo, 1..4
  lastMove: { x: number; y: number } | null;
  fireflies: number;
  moves: number;
  powerups: string[];
  bought: string[];
  shopAfter: number;
  market: MarketRow[];
  satchelLimit: number;
  powerfulLimit: number;
  isWarded(idx: number): boolean;
  lilyOwnerAt(idx: number): number;
  isBurning(idx: number): boolean;
  /** Whether a board would repeat an earlier position (the ko rule). Absent means nothing does. */
  repeats?(board: number[]): boolean;
}

export interface Candidate {
  x: number;
  y: number;
  axis: StoneView;
  score: number;
}

export const AXES: StoneView[] = ["base", "pattern"];

// Percentages applied to the matching style weight; the index is a distance in
// points and anything further away reads off the last entry.
const LINE = [-120, 30, 100, 95, 70, 50, 35]; // 0 = the first line
const EXTENSION = [0, 25, 75, 100, 80, 45, 15]; // 0 = touching one of our own
const LOCALITY = [100, 100, 80, 55, 35, 20, 10]; // 0 = the last move itself

function table(values: number[], i: number): number {
  return values[Math.min(Math.max(i, 0), values.length - 1)];
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function pointOf(size: number, idx: number): { x: number; y: number } {
  return { x: idx % size, y: Math.floor(idx / size) };
}

/**
 * Whether this stone is on the other side of the war it is actually in. Not
 * the same question as "does someone else own it": two of the four seats share
 * each front, so a rival's stone is often our own side's in the only war it
 * takes part in. Removal items may still hit it -- the rules only check the
 * owner -- but doing so does the work of the seat we are fighting.
 */
export function fightsUs(view: BotView, code: number): boolean {
  if (!isPlayerStone(code)) return false;
  const axis = axisOf(code);
  return !sameView(axis, code, stoneCode(view.color, axis));
}

/** Chebyshev distance to the nearest stone sharing this front, or -1 if we have none there yet. */
function distanceToOwnSide(view: BotView, x: number, y: number, code: number, axis: StoneView): number {
  const { board, size } = view;
  let best = -1;
  for (let i = 0; i < board.length; i++) {
    const c = board[i];
    if (c === 0 || !sameView(axis, c, code)) continue;
    const d = chebyshev(x, y, i % size, Math.floor(i / size));
    if (best === -1 || d < best) best = d;
  }
  return best;
}

/** Every neighbour already on our side of this front: filling it gains nothing and usually costs a liberty. */
function isOwnEye(view: BotView, x: number, y: number, code: number, axis: StoneView): boolean {
  for (const n of neighbors(view.size, x, y)) {
    const c = view.board[boardIndex(view.size, n.x, n.y)];
    if (c === 0 || !sameView(axis, c, code)) return false;
  }
  return true;
}

/**
 * What this point is worth to this bot on this front, or null if the move is
 * illegal (or is one no bot should make: filling its own eye).
 *
 * The terms are GoSequencer's classic scorer written over this board, plus the
 * three variant terms styles.ts describes. Each neighbouring group is judged
 * on its own front, exactly as applyCaptures judges it: the front this stone
 * picks decides who it merges with, not who it can suffocate.
 */
export function scoreMove(
  view: BotView,
  x: number,
  y: number,
  axis: StoneView,
  style: Style
): number | null {
  const { size } = view;
  if (!isOnBoard(size, x, y)) return null;
  const idx = boardIndex(size, x, y);
  if (view.board[idx] !== 0) return null;

  const lily = view.lilyOwnerAt(idx);
  if (lily !== 0 && lily !== view.color) return null;
  if (view.isBurning(idx)) return null; // still alight after the storm

  const code = stoneCode(view.color, axis);
  if (isOwnEye(view, x, y, code, axis)) return null;

  const after = view.board.slice();
  after[idx] = code;
  const captured = applyCaptures(after, size, x, y, code, (i) => view.isWarded(i));
  const mine = findGroup(after, size, x, y, axis);
  if (captured.length === 0 && mine.liberties === 0) return null; // suicide
  if (view.repeats?.(after)) return null; // ko

  // ---- what the move took -------------------------------------------------
  // Paid in full to the mover: the room credits captures per player, so taking
  // the stones yourself is worth more than leaving them to the ally who shares
  // this front.
  let score = style.capture * captured.length;

  // ---- the neighbours it arrives among ------------------------------------
  // Each chain is looked at once, so a move touching two stones of one group
  // does not read as two groups.
  const seen = new Set<number>();
  let ownChains = 0;
  let enemyChains = 0;
  let rescued = 0;
  let touching = 0;
  let hemmed = 0;

  for (const n of neighbors(size, x, y)) {
    const nIdx = boardIndex(size, n.x, n.y);
    const nCode = view.board[nIdx];
    if (nCode === 0) continue;
    if (!isPlayerStone(nCode)) {
      hemmed += 1; // driftwood: takes a liberty and can never be taken back
      continue;
    }

    // A group is judged on its OWN front -- a liberty is a liberty whoever
    // fills it -- so a stone that committed to the other front is a target
    // too, not the harmless wall it looks like. The only group that is ours
    // is the one this stone merges into.
    const friendly = sameView(axis, nCode, code);
    if (!friendly) touching += 1;
    if (seen.has(nIdx)) continue;

    const { group, liberties } = findGroup(view.board, size, n.x, n.y, axisOf(nCode));
    for (const p of group) seen.add(boardIndex(size, p.x, p.y));
    if (friendly) {
      ownChains += 1;
      if (liberties === 1) rescued += group.length; // in atari before this move
    } else {
      enemyChains += 1;
    }
  }

  if (ownChains > 1) score += style.connect * (ownChains - 1);
  if (enemyChains > 1) score += style.cut * (enemyChains - 1);
  score += style.contact * touching;
  score -= style.hemmed * hemmed;

  // ---- the position it leaves behind --------------------------------------
  if (mine.liberties >= 2) {
    score += style.save * rescued;
  } else if (captured.length === 0) {
    // One liberty and nothing to show for it. Scaled by what is being given
    // away, so a lone stone thrown in is a smaller mistake than a whole group.
    score -= style.selfAtari * Math.min(mine.group.length, 6);
  }

  const seenAfter = new Set<number>();
  let atariStones = 0;
  for (const n of neighbors(size, x, y)) {
    const nIdx = boardIndex(size, n.x, n.y);
    const nCode = after[nIdx];
    if (!isPlayerStone(nCode) || seenAfter.has(nIdx)) continue;
    const nAxis = axisOf(nCode);
    if (sameView(nAxis, nCode, code)) continue; // merged with the stone we just played

    const { group, liberties } = findGroup(after, size, n.x, n.y, nAxis);
    for (const p of group) seenAfter.add(boardIndex(size, p.x, p.y));
    if (liberties === 1) atariStones += group.length;
  }
  score += style.atari * atariStones;

  // ---- where it is --------------------------------------------------------
  // These three are paid at a percentage, so they divide back down.
  const edge = Math.min(x, y, size - 1 - x, size - 1 - y);
  score += Math.trunc((style.line * table(LINE, edge)) / 100);

  const nearest = distanceToOwnSide(view, x, y, code, axis);
  if (nearest >= 0) score += Math.trunc((style.extension * table(EXTENSION, nearest)) / 100);

  if (view.lastMove) {
    const d = chebyshev(x, y, view.lastMove.x, view.lastMove.y);
    score += Math.trunc((style.locality * table(LOCALITY, d)) / 100);
  }

  if (axis === style.prefers) score += style.axisBias;

  return score;
}

/**
 * Every legal point on both fronts, best first. Ties break by board index and
 * then by front, so the ordering depends on the position alone and the draw
 * that follows depends only on the seed.
 */
export function rankMoves(view: BotView, style: Style): Candidate[] {
  const { size } = view;
  const scored: Candidate[] = [];

  for (let idx = 0; idx < view.board.length; idx++) {
    if (view.board[idx] !== 0) continue;
    const { x, y } = pointOf(size, idx);
    for (const axis of AXES) {
      const score = scoreMove(view, x, y, axis, style);
      if (score !== null) scored.push({ x, y, axis, score });
    }
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      boardIndex(size, a.x, a.y) - boardIndex(size, b.x, b.y) ||
      a.axis.localeCompare(b.axis)
  );
  return scored;
}

/** One of the best few points, drawn at random. How wide the draw is, is part of the Style. */
export function chooseMove(view: BotView, style: Style, rng: Rng): Candidate | null {
  const ranked = rankMoves(view, style);
  return ranked.length === 0 ? null : rng.pick(ranked.slice(0, Math.max(1, style.variation)));
}

// Only what a move takes, saves or threatens; every positional term is zero.
const TACTICAL: Style = {
  name: "tactical",
  capture: 1,
  save: 1,
  atari: 1,
  connect: 0,
  cut: 1,
  contact: 0,
  locality: 0,
  extension: 0,
  line: 0,
  selfAtari: 0,
  hemmed: 0,
  axisBias: 0,
  prefers: "base",
  itemBias: 0,
  shopping: [],
  variation: 1,
  judgement: false,
};

/** The bot's two sides added together on the board as it stands. */
function ownArea(view: BotView, board: number[]): number {
  const area = areaScore(board, view.size);
  const sides = sidesOf(view.color);
  return area[sides.base] + area[sides.pattern];
}

/**
 * Whether a bot with judgement would rather pass than play this move. A move
 * is pointless when it takes, saves, cuts and threatens nothing and does not
 * grow the bot's area (a stone filling its own territory just swaps one
 * counted point for another), or when it is a net loss to begin with. Early in
 * a game every stone grows the area, so this only bites once the board is
 * settled and what is left are the moves nobody profits from.
 */
export function isPointless(view: BotView, move: Candidate): boolean {
  if (move.score <= 0) return true;
  const tactical = scoreMove(view, move.x, move.y, move.axis, TACTICAL);
  if (tactical === null || tactical > 0) return false;
  const after = view.board.slice();
  const code = stoneCode(view.color, move.axis);
  after[boardIndex(view.size, move.x, move.y)] = code;
  applyCaptures(after, view.size, move.x, move.y, code, (i) => view.isWarded(i));
  return ownArea(view, after) <= ownArea(view, view.board);
}
