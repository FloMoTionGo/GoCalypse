// Custom capture rules for a 4-player free-for-all Go variant.
// Hand-rolled (not a general Go rules library) since colors, captures, and
// board mutation all need to interact with the powerup system.
//
// Each player has a fixed identity along two axes — a base tone (black or
// white) and a pattern (gray or transparent):
//   1 = black+gray   2 = white+gray   3 = black+transparent   4 = white+transparent
//
// But a stone doesn't carry both axes at once. Each move, the player picks
// which front that particular stone fights on:
//   - left click  -> a solid stone in their BASE color (black/white),
//                    fighting only in the base-view war (black vs white).
//   - right click -> their gray or transparent stone, on the PATTERN axis,
//                    fighting only in the pattern-view war (gray vs transparent).
// A stone is neutral ("a wall") on the axis it didn't commit to: it still
// occupies the cell (so it blocks a liberty there), but it never merges
// into a group, and can never be captured, on that other axis.
//
// Board cells therefore store a CODE, not just a player id:
//   0        = empty
//   1..4     = that player's BASE-axis stone
//   5..8     = that player's PATTERN-axis stone (player id + 4)
//   9        = DRIFTWOOD: a neutral piece owned by no one, a wall on both views
//   10..13   = that player's TWIN stone (Twin Wick, player id + 9): it fights on
//              BOTH fronts at once, so it merges and captures on both -- and is
//              captured when either of its two groups runs out of liberties
//   14       = GREY_STONE: never on the true board. It is what GoState.seen shows
//              for every player stone while a storm's grey lasts, so no client
//              is told whose stone is whose (GoRoom.refreshSeen).

export interface Point {
  x: number;
  y: number;
}

export type StoneView = "base" | "pattern";

/** Optional capture shield: a group containing any protected cell can't be captured. */
export type IsProtected = (idx: number) => boolean;

export const DRIFTWOOD = 9;
/** The storm's grey: a player stone, colour unknown. Only ever in GoState.seen. */
export const GREY_STONE = 14;
/** A twin stone's code: 10..13 for player 1..4. */
export function twinCode(player: number): number {
  return player + 9;
}
export function isTwin(code: number): boolean {
  return code >= 10 && code <= 13;
}

const STONE_BASE: (string | null)[] = [null, "black", "white", "black", "white"];
const STONE_PATTERN: (string | null)[] = [null, "gray", "gray", "transparent", "transparent"];

export function stoneCode(player: number, axis: StoneView): number {
  return axis === "pattern" ? player + 4 : player;
}

export function isPlayerStone(code: number): boolean {
  return (code >= 1 && code <= 8) || isTwin(code);
}

/** Owning player (1..4) of a player stone; 0 for empty cells and neutral pieces. */
export function ownerOf(code: number): number {
  if (!isPlayerStone(code)) return 0;
  if (isTwin(code)) return code - 9;
  return code > 4 ? code - 4 : code;
}

/**
 * The one front a single-axis stone (1..8) fights on. A twin stone fights on
 * both, so callers that judge groups use `viewsOf`; this says "base" for a twin
 * only so that it never returns nonsense.
 */
export function axisOf(code: number): StoneView {
  return code > 4 && !isTwin(code) ? "pattern" : "base";
}

/** Every front this stone fights on: one for a normal stone, both for a twin. */
export function viewsOf(code: number): StoneView[] {
  return isTwin(code) ? ["base", "pattern"] : [axisOf(code)];
}

/** The same player's stone on the other axis (1..4 <-> 5..8). */
export function flipAxisCode(code: number): number {
  return code > 4 ? code - 4 : code + 4;
}

/** This code's value on `view`, or null if it's a wall there (neutral pieces are walls on both views). */
export function viewValue(view: StoneView, code: number): string | null {
  if (!isPlayerStone(code) || (!isTwin(code) && axisOf(code) !== view)) return null;
  const player = ownerOf(code);
  return view === "base" ? STONE_BASE[player] : STONE_PATTERN[player];
}

/** Whether two (non-empty) codes are on the same side for this view. Never true if either is a wall on this view. */
export function sameView(view: StoneView, a: number, b: number): boolean {
  const va = viewValue(view, a);
  const vb = viewValue(view, b);
  return va !== null && va === vb;
}

function index(size: number, x: number, y: number): number {
  return y * size + x;
}

function inBounds(size: number, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && x < size && y >= 0 && y < size;
}

export function neighbors(size: number, x: number, y: number): Point[] {
  return [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ].filter((p) => inBounds(size, p.x, p.y));
}

/**
 * Flood-fills the group containing (x, y) under a single view and reports
 * its liberties. Grouping is anchored to the code at (x, y): a neighbor
 * joins the group if it shares that anchor's value on this view. Walls
 * (stones neutral on this view) never join, but being non-empty they still
 * block -- they just don't add a liberty either.
 */
export function findGroup(
  board: ArrayLike<number>,
  size: number,
  x: number,
  y: number,
  view: StoneView
): { group: Point[]; liberties: number } {
  const anchorCode = board[index(size, x, y)];
  const seen = new Set<number>();
  const group: Point[] = [];
  let liberties = 0;
  const stack: Point[] = [{ x, y }];

  while (stack.length > 0) {
    const p = stack.pop()!;
    const idx = index(size, p.x, p.y);
    if (seen.has(idx)) continue;
    seen.add(idx);
    group.push(p);

    for (const n of neighbors(size, p.x, p.y)) {
      const nIdx = index(size, n.x, n.y);
      const nCode = board[nIdx];
      if (nCode === 0) {
        liberties += 1;
      } else if (sameView(view, nCode, anchorCode) && !seen.has(nIdx)) {
        stack.push(n);
      }
    }
  }

  return { group, liberties };
}

/** One stone lifted off the board, and the front its group was judged on. */
export interface Captured {
  point: Point;
  color: number; // the board code that was removed
  view: StoneView; // the front the dead group was judged on
}

/**
 * After a stone lands on (x, y), remove any adjacent group left with zero
 * liberties. A group is always judged on ITS OWN front -- a liberty is a
 * liberty whoever filled it, so a solid black stone can smother a gray
 * group just by occupying its last free point, even though the two never
 * fight each other. (The front a stone commits to decides who it *merges*
 * with and who can be captured *together with* it, not who can suffocate it.)
 *
 * The only neighbouring group skipped is one that merges with the stone just
 * placed: that group now contains the new stone, so it isn't a capture but a
 * suicide, which `isSuicide` decides separately. Driftwood is never a target
 * (it isn't a player stone and owns no front).
 *
 * Returns the list of captured points, each tagged with the code that was
 * removed and the front its group was judged on. The front matters for a twin
 * stone, which fights on both and can die on either: it decides which front
 * the prisoner is credited to (rules/endgame.ts).
 */
export function applyCaptures(
  board: number[],
  size: number,
  x: number,
  y: number,
  placedCode: number,
  isProtected?: IsProtected
): Captured[] {
  const captured: Captured[] = [];
  const checked = new Set<number>();

  for (const n of neighbors(size, x, y)) {
    const nIdx = index(size, n.x, n.y);
    // A twin neighbour is judged on each of its two fronts in turn; a group
    // taken on the first one may already have removed it.
    for (const view of viewsOf(board[nIdx])) {
      const nCode = board[nIdx];
      if (!isPlayerStone(nCode)) break;
      const key = nIdx + (view === "pattern" ? size * size : 0);
      if (checked.has(key)) continue;
      if (sameView(view, nCode, placedCode)) continue; // merged with the placed stone

      const { group, liberties } = findGroup(board, size, n.x, n.y, view);
      group.forEach((p) => checked.add(index(size, p.x, p.y) + (view === "pattern" ? size * size : 0)));

      const shielded = isProtected ? group.some((p) => isProtected(index(size, p.x, p.y))) : false;
      if (liberties === 0 && !shielded) {
        for (const p of group) {
          const pIdx = index(size, p.x, p.y);
          captured.push({ point: p, color: board[pIdx], view });
          board[pIdx] = 0;
        }
      }
    }
  }

  return captured;
}

/**
 * True if the stone already sitting at (x, y) has zero liberties on the one
 * view it participates in. Call this after the stone is placed and captures
 * have been applied -- a move that captured something (opening up new
 * liberties) will correctly no longer read as suicide.
 */
export function isSuicide(board: ArrayLike<number>, size: number, x: number, y: number): boolean {
  const code = board[index(size, x, y)];
  return viewsOf(code).some((view) => findGroup(board, size, x, y, view).liberties === 0);
}

/**
 * Whether a neutral piece (driftwood) may land on the empty cell (x, y): it
 * must not leave any adjacent player group with zero liberties, since
 * neutral pieces never capture anything.
 */
export function canPlaceNeutral(board: ArrayLike<number>, size: number, x: number, y: number): boolean {
  const idx = index(size, x, y);
  if (board[idx] !== 0) return false;
  const trial = Array.from(board);
  trial[idx] = DRIFTWOOD;
  for (const n of neighbors(size, x, y)) {
    const code = trial[index(size, n.x, n.y)];
    if (isPlayerStone(code) && viewsOf(code).some((v) => findGroup(trial, size, n.x, n.y, v).liberties === 0)) return false;
  }
  return true;
}

/**
 * Flips the player stone at (x, y) to its owner's other axis, as if it had
 * just been placed there on the new axis: every neighbouring group left
 * without liberties is captured, including a former group-mate the flip just
 * split off (the stone stops merging with it, and what's left has nowhere to
 * breathe). The flip is illegal (returns null, board untouched) only if
 * afterwards the flipped stone itself has no liberties.
 */
export function flipStone(
  board: number[],
  size: number,
  x: number,
  y: number,
  isProtected?: IsProtected
): Captured[] | null {
  const idx = index(size, x, y);
  const oldCode = board[idx];
  if (!isPlayerStone(oldCode) || isTwin(oldCode)) return null; // a twin has no other front to turn to

  const trial = board.slice();
  const newCode = flipAxisCode(oldCode);
  trial[idx] = newCode;
  const captured = applyCaptures(trial, size, x, y, newCode, isProtected);

  if (isSuicide(trial, size, x, y)) return null;

  for (let i = 0; i < board.length; i++) board[i] = trial[i];
  return captured;
}

export function isOnBoard(size: number, x: number, y: number): boolean {
  return inBounds(size, x, y);
}

export function boardIndex(size: number, x: number, y: number): number {
  return index(size, x, y);
}
