import {
  applyCaptures,
  axisOf,
  boardIndex,
  Captured,
  findGroup,
  isOnBoard,
  isPlayerStone,
  neighbors,
  sameView,
  stoneCode,
  StoneView,
} from "../rules/goRules";
import { isSettled, Prisoners, regionAt, sidesOf, territoryScore } from "../rules/endgame";
import { koOpenedBy } from "../rules/ko";
import { Rng } from "./rng";
import { Style } from "./styles";

/** A market row, flattened off the synced state so the scorer stays pure. */
export interface MarketRow {
  id: string;
  price: number;
  removal: boolean;
  /** Copies still for sale to the table, and the most one player may buy. Absent means no limit. */
  left?: number;
  share?: number;
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
  /** Seats at this table, and how many of them have passed in a row already. */
  seats: number;
  passes: number;
  /** Stones this bot has captured so far, by front: they count at the end. */
  prisoners: Prisoners;
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
  /** Whether a stone on `idx` lifting `captured` would take back a ko held for the round. Absent means none is. */
  retakesKo?(idx: number, captured: Captured[]): boolean;
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

/**
 * Every neighbour already on our side of this front: filling it gains nothing
 * and usually costs a liberty. Unless one of them is down to its last liberty
 * -- then the point is no eye but the one move that saves it. That is exactly
 * what a ko looks like to the stone that just took it, and a bot that never
 * fills there leaves every ko it wins open for the other side to take back.
 */
function isOwnEye(view: BotView, x: number, y: number, code: number, axis: StoneView): boolean {
  for (const n of neighbors(view.size, x, y)) {
    const c = view.board[boardIndex(view.size, n.x, n.y)];
    if (c === 0 || !sameView(axis, c, code)) return false;
  }
  for (const n of neighbors(view.size, x, y)) {
    if (findGroup(view.board, view.size, n.x, n.y, axis).liberties === 1) return false;
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
  if (view.retakesKo?.(idx, captured)) return null; // and a ko is held for a round

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
  } else if (captured.length === 0 || !holdsKo(after, size, idx, captured, axis)) {
    // One liberty left, and nothing taken for it -- or a take the other side
    // simply takes back. With three other seats a stone in atari rarely lives
    // to see its owner's next turn, so a capture that leaves one there is a
    // trade rather than a gain, and a table of bots trading like that keeps the
    // same few points changing hands all night. The exception is a ko the rules
    // hold for a round (rules/ko.ts) that this stone can fill when its turn
    // comes back. Scaled by what is being given away, so a lone stone thrown in
    // is a smaller mistake than a whole group.
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
 * Whether a take that leaves its stone on one liberty is a ko this side keeps:
 * one the rules hold shut for a round, on a point the stone's own side can fill
 * once its turn comes back and come out with room to breathe. `board` is the
 * board after the take.
 */
function holdsKo(board: number[], size: number, idx: number, captured: Captured[], axis: StoneView): boolean {
  const ko = koOpenedBy(board, size, idx, captured);
  if (!ko) return false;
  const filled = board.slice();
  filled[ko.point] = board[idx];
  const { x, y } = pointOf(size, ko.point);
  return findGroup(filled, size, x, y, axis).liberties >= 2;
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

// What a move must take or save to be worth a turn on its own: captures and
// rescues only. Atari and cuts are threats, and a threat that gains no area is
// how a table ends up playing stones for the fireflies alone.
const TACTICAL: Style = {
  name: "tactical",
  capture: 1,
  save: 1,
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
  prefers: "base",
  itemBias: 0,
  shopping: [],
  variation: 1,
  judgement: false,
};

/**
 * The bot's two fronts, by the axis a stone is played on. Each is what the
 * final count would give it there: its side's territory plus the prisoners it
 * took on that front. Prisoners are not a constant that cancels out of the
 * comparison below -- they decide WHICH front is the lower one, and the lower
 * front is the score.
 */
function frontsOf(
  view: BotView,
  board: number[],
  axis: StoneView,
  took: Prisoners
): { mine: number; other: number } {
  const territory = territoryScore(board, view.size);
  const sides = sidesOf(view.color);
  const base = territory[sides.base] + took.base;
  const pattern = territory[sides.pattern] + took.pattern;
  return axis === "base" ? { mine: base, other: pattern } : { mine: pattern, other: base };
}

// Not cached, deliberately. Judging a turn counts the board before the move
// once per candidate and gets the same answer every time, so a WeakMap keyed on
// the board array looks like free speed. It is not: a caller is free to hand the
// same array back after playing on it -- selfplay.ts keeps one board for a whole
// match and mutates it -- and the cache then answers with the position as it was
// several moves ago. Tried, and it quietly changed how the bots played before it
// changed how fast they played.

/**
 * Whether a bot with judgement would rather pass than play this move. This is
 * the whole endgame: under territory scoring a stone is worth nothing but the
 * ground it surrounds, so a bot that keeps playing after the board is settled
 * hands away a point a turn, and one that stops too early leaves the dame
 * unfilled and its dead stones standing.
 *
 * A move is worth a turn when any of these holds:
 *
 *  1. it takes or saves stones (the TACTICAL probe) -- prisoners count, and a
 *     group left standing is a group that counts against nobody;
 *  2. it raises the bot's score, the lower of its two fronts, each of them that
 *     side's territory plus the prisoners this bot took there;
 *  3. the point is still open ground -- the empty region it sits in is walled in
 *     by no one, or contested between two sides -- and playing it does not cost
 *     the bot anything.
 *
 * Rule 3 is what makes a bot play the game out: every dame, every contested
 * point, right to the end. It stops firing exactly when the region a point
 * belongs to is walled in by a single side, because then the point is settled
 * territory and there is nothing there left to win -- the bot's own, which it
 * would only be filling in, or somebody else's, where a stone is a gift.
 *
 * A stone is a wall on the front it did not pick, so it can also take a point
 * off the bot's OTHER front. Spending a turn to end up behind is never worth it,
 * whatever else the move does.
 */
export function isPointless(view: BotView, move: Candidate): boolean {
  if (move.score <= 0) return true;
  const tactical = scoreMove(view, move.x, move.y, move.axis, TACTICAL);
  if (tactical === null || tactical > 0) return false; // takes or saves: always worth it

  // Nothing is captured past this point: TACTICAL pays for a capture, so any
  // move that takes a stone has already returned above. That is why the same
  // prisoner count is used on both sides of the comparison -- this move cannot
  // add to it, and the two fronts move only with the ground.
  const after = view.board.slice();
  const code = stoneCode(view.color, move.axis);
  after[boardIndex(view.size, move.x, move.y)] = code;
  applyCaptures(after, view.size, move.x, move.y, code, (i) => view.isWarded(i));
  const before = frontsOf(view, view.board, move.axis, view.prisoners);
  const now = frontsOf(view, after, move.axis, view.prisoners);
  const was = Math.min(before.mine, before.other);
  const is = Math.min(now.mine, now.other);
  if (is > was) return false; // the score rises: always worth the turn
  if (is < was) return true; // and ending up behind never is

  // The score holds, so it comes down to the ground this point sits on. Open or
  // contested ground is reason enough to play: that is how the dame get filled
  // and how a bot keeps going to the very end. Settled territory is not:
  //
  //  - ours, and a stone there only eats into what we had already won. The
  //    score above cannot always see that -- it is the LOWER front, and the
  //    front being spent may be the higher one -- so it is caught here;
  //  - somebody else's, and a stone there is a gift rather than a reduction,
  //    because it is surrounded before it lands. Under this count it hands them
  //    a prisoner as well.
  const { region, borders } = regionAt(
    view.board,
    view.size,
    move.axis,
    boardIndex(view.size, move.x, move.y)
  );
  return isSettled(view.size, region, borders);
}

