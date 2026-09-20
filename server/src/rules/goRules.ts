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

export interface Point {
  x: number;
  y: number;
}

export type StoneView = "base" | "pattern";

/** Optional capture shield: a group containing any protected cell can't be captured. */
export type IsProtected = (idx: number) => boolean;

export const DRIFTWOOD = 9;

const STONE_BASE: (string | null)[] = [null, "black", "white", "black", "white"];
const STONE_PATTERN: (string | null)[] = [null, "gray", "gray", "transparent", "transparent"];

export function stoneCode(player: number, axis: StoneView): number {
  return axis === "pattern" ? player + 4 : player;
}

export function isPlayerStone(code: number): boolean {
  return code >= 1 && code <= 8;
}

/** Owning player (1..4) of a player stone; 0 for empty cells and neutral pieces. */
export function ownerOf(code: number): number {
  if (!isPlayerStone(code)) return 0;
  return code > 4 ? code - 4 : code;
}

/** Only meaningful for player stones (1..8). */
export function axisOf(code: number): StoneView {
  return code > 4 ? "pattern" : "base";
}

/** The same player's stone on the other axis (1..4 <-> 5..8). */
export function flipAxisCode(code: number): number {
  return code > 4 ? code - 4 : code + 4;
}

/** This code's value on `view`, or null if it's a wall there (neutral pieces are walls on both views). */
export function viewValue(view: StoneView, code: number): string | null {
  if (!isPlayerStone(code) || axisOf(code) !== view) return null;
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
 * Returns the list of captured points, tagged with the code that was removed.
 */
export function applyCaptures(
  board: number[],
  size: number,
  x: number,
  y: number,
  placedCode: number,
  isProtected?: IsProtected
): { point: Point; color: number }[] {
  const captured: { point: Point; color: number }[] = [];
  const checked = new Set<number>();

  for (const n of neighbors(size, x, y)) {
    const nIdx = index(size, n.x, n.y);
    const nCode = board[nIdx];
    if (!isPlayerStone(nCode) || checked.has(nIdx)) continue;

    const view = axisOf(nCode); // the neighbour's front, not the mover's
    if (sameView(view, nCode, placedCode)) continue; // merged with the placed stone

    const { group, liberties } = findGroup(board, size, n.x, n.y, view);
    group.forEach((p) => checked.add(index(size, p.x, p.y)));

    const shielded = isProtected ? group.some((p) => isProtected(index(size, p.x, p.y))) : false;
    if (liberties === 0 && !shielded) {
      for (const p of group) {
        const pIdx = index(size, p.x, p.y);
        captured.push({ point: p, color: board[pIdx] });
        board[pIdx] = 0;
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
  return findGroup(board, size, x, y, axisOf(code)).liberties === 0;
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
    if (isPlayerStone(code) && findGroup(trial, size, n.x, n.y, axisOf(code)).liberties === 0) return false;
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
): { point: Point; color: number }[] | null {
  const idx = index(size, x, y);
  const oldCode = board[idx];
  if (!isPlayerStone(oldCode)) return null;

  const trial = board.slice();
  const newCode = flipAxisCode(oldCode);
  trial[idx] = newCode;
  const captured = applyCaptures(trial, size, x, y, newCode, isProtected);

  if (findGroup(trial, size, x, y, axisOf(newCode)).liberties === 0) return null;

  for (let i = 0; i < board.length; i++) board[i] = trial[i];
  return captured;
}

export function isOnBoard(size: number, x: number, y: number): boolean {
  return inBounds(size, x, y);
}

export function boardIndex(size: number, x: number, y: number): number {
  return index(size, x, y);
}
