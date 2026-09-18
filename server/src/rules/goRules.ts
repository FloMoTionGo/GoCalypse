// Custom capture rules for a 4-player free-for-all Go variant.
// Hand-rolled (not a general Go rules library) since colors, captures, and
// board mutation all need to interact with the powerup system.
//
// Each player's stone has two identity axes — a base tone (black/white) and
// a pattern (dots/stripes) — and stones ally for group/liberty purposes if
// they share EITHER axis:
//   1 = black+dots   2 = white+dots   3 = black+stripes   4 = white+stripes
// So 1-2 (share dots), 1-3 (share black), 2-4 (share white) and 3-4 (share
// stripes) all merge into the same group; only the diagonal opposites,
// 1-4 and 2-3, are true enemies for capture purposes.

export interface Point {
  x: number;
  y: number;
}

const STONE_BASE: (string | null)[] = [null, "black", "white", "black", "white"];
const STONE_PATTERN: (string | null)[] = [null, "dots", "dots", "stripes", "stripes"];

/** Whether two (non-empty) stone colors are on the same "side" for liberties/capture. */
export function isAllied(a: number, b: number): boolean {
  if (a === 0 || b === 0) return false;
  if (a === b) return true;
  return STONE_BASE[a] === STONE_BASE[b] || STONE_PATTERN[a] === STONE_PATTERN[b];
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
 * Flood-fills the allied group containing (x, y) and reports its liberties.
 * "Allied" is anchored to the color at (x, y): a neighbor joins the group if
 * it's allied with that anchor color (see `isAllied`), not merely with
 * whatever neighboring stone led to it — this keeps the group well-defined
 * instead of transitively chaining through the whole alliance cycle.
 */
export function findGroup(
  board: ArrayLike<number>,
  size: number,
  x: number,
  y: number
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
      } else if (isAllied(nColor, anchorColor) && !seen.has(nIdx)) {
        stack.push(n);
      }
    }
  }

  return { group, liberties };
}

/**
 * After a stone of `placedColor` lands on (x, y), remove any adjacent enemy
 * groups left with zero liberties, then check the placed group itself
 * (suicide is disallowed by the caller before this runs). Allied neighbors
 * (see `isAllied`) are skipped — they merge into the mover's own group
 * rather than being examined as a capture target.
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
  const checked = new Set<number>();

  for (const n of neighbors(size, x, y)) {
    const nIdx = index(size, n.x, n.y);
    const nColor = board[nIdx];
    if (nColor === 0 || isAllied(nColor, placedColor) || checked.has(nIdx)) continue;

    const { group, liberties } = findGroup(board, size, n.x, n.y);
    group.forEach((p) => checked.add(index(size, p.x, p.y)));

    if (liberties === 0) {
      for (const p of group) {
        const pIdx = index(size, p.x, p.y);
        captured.push({ point: p, color: board[pIdx] }); // group can be mixed allied colors
        board[pIdx] = 0;
      }
    }
  }

  return captured;
}

/** True if placing `color` at (x, y) would leave that group with no liberties (suicide). */
export function isSuicide(
  board: number[],
  size: number,
  x: number,
  y: number,
  color: number
): boolean {
  board[index(size, x, y)] = color;
  const { liberties } = findGroup(board, size, x, y);
  board[index(size, x, y)] = 0;
  return liberties === 0;
}

export function isOnBoard(size: number, x: number, y: number): boolean {
  return inBounds(size, x, y);
}

export function boardIndex(size: number, x: number, y: number): number {
  return index(size, x, y);
}
