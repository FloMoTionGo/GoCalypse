// Custom capture rules for a 4-player free-for-all Go variant.
// Hand-rolled (not a general Go rules library) since colors, captures, and
// board mutation all need to interact with the powerup system.
//
// Each player's stone has two identity axes — a base tone (black/white) and
// a pattern (dots/stripes):
//   1 = black+dots   2 = white+dots   3 = black+stripes   4 = white+stripes
//
// The two axes run as two INDEPENDENT, simultaneous team splits over the
// same board, each exactly like a normal 2-color Go game:
//   - base view:    black (1,3) vs white (2,4) — pattern is irrelevant here.
//   - pattern view: dots (1,2) vs stripes (3,4) — base is irrelevant here.
// A stone's group, liberties and capture eligibility are computed per view
// (grouping by that view's value only), and a stone dies if EITHER view's
// rules would capture it — e.g. a black+dots stone merges with an adjacent
// black+stripes stone for base-view liberties (both black), but the same
// two stones are in separate groups for pattern-view liberties (dots vs
// stripes). Since any two distinct colors differ in at least one axis,
// every pair of distinct players is a rival on at least one view — there's
// no more "fully allied" pair of colors, unlike a same-color match.

export interface Point {
  x: number;
  y: number;
}

export type StoneView = "base" | "pattern";
const VIEWS: StoneView[] = ["base", "pattern"];

const STONE_BASE: (string | null)[] = [null, "black", "white", "black", "white"];
const STONE_PATTERN: (string | null)[] = [null, "dots", "dots", "stripes", "stripes"];

function viewValue(view: StoneView, color: number): string | null {
  return view === "base" ? STONE_BASE[color] : STONE_PATTERN[color];
}

/** Whether two (non-empty) stone colors are on the same side for this one view. */
function sameView(view: StoneView, a: number, b: number): boolean {
  if (a === 0 || b === 0) return false;
  return viewValue(view, a) === viewValue(view, b);
}

function index(size: number, x: number, y: number): number {
  return y * size + x;
}

function inBounds(size: number, x: number, y: number): boolean {
  return x >= 0 && x < size && y >= 0 && y < size;
}

function neighbors(size: number, x: number, y: number): Point[] {
  return [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 },
  ].filter((p) => inBounds(size, p.x, p.y));
}

/**
 * Flood-fills the group containing (x, y) under a single view (base or
 * pattern) and reports its liberties. Grouping is anchored to the color at
 * (x, y): a neighbor joins the group if it matches that anchor's value for
 * this view, regardless of its value on the other view.
 */
export function findGroup(
  board: ArrayLike<number>,
  size: number,
  x: number,
  y: number,
  view: StoneView
): { group: Point[]; liberties: number } {
  const anchorColor = board[index(size, x, y)];
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
      const nColor = board[nIdx];
      if (nColor === 0) {
        liberties += 1;
      } else if (sameView(view, nColor, anchorColor) && !seen.has(nIdx)) {
        stack.push(n);
      }
    }
  }

  return { group, liberties };
}

/**
 * After a stone of `placedColor` lands on (x, y), remove any adjacent rival
 * groups left with zero liberties, checking BOTH views: a rival-in-base
 * neighbor (opposite black/white, any pattern) is checked against its
 * base-view group, and a rival-in-pattern neighbor (opposite dots/stripes,
 * any base) is checked against its pattern-view group. A neighbor that
 * matches the mover on a given view is skipped for that view — it merges
 * into the mover's own group on that view instead of being a capture target.
 * Returns the list of captured points, tagged with the color that was removed.
 */
export function applyCaptures(
  board: number[],
  size: number,
  x: number,
  y: number,
  placedColor: number
): { point: Point; color: number }[] {
  const captured: { point: Point; color: number }[] = [];

  for (const view of VIEWS) {
    const checked = new Set<number>();

    for (const n of neighbors(size, x, y)) {
      const nIdx = index(size, n.x, n.y);
      const nColor = board[nIdx];
      if (nColor === 0 || sameView(view, nColor, placedColor) || checked.has(nIdx)) continue;

      const { group, liberties } = findGroup(board, size, n.x, n.y, view);
      group.forEach((p) => checked.add(index(size, p.x, p.y)));

      if (liberties === 0) {
        for (const p of group) {
          const pIdx = index(size, p.x, p.y);
          captured.push({ point: p, color: board[pIdx] }); // group can span colors that share this view
          board[pIdx] = 0;
        }
      }
    }
  }

  return captured;
}

/**
 * True if the stone already sitting at (x, y) has zero liberties on EITHER
 * view. Call this after the stone is placed and captures have been applied
 * — a move that captured something (opening up new liberties) will
 * correctly no longer read as suicide.
 */
export function isSuicide(board: ArrayLike<number>, size: number, x: number, y: number): boolean {
  return VIEWS.some((view) => findGroup(board, size, x, y, view).liberties === 0);
}

export function isOnBoard(size: number, x: number, y: number): boolean {
  return inBounds(size, x, y);
}

export function boardIndex(size: number, x: number, y: number): number {
  return index(size, x, y);
}
