// Custom capture rules for a 4-player free-for-all Go variant.
// Hand-rolled (not a general Go rules library) since colors, captures, and
// board mutation all need to interact with the powerup system.

export interface Point {
  x: number;
  y: number;
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

/** Flood-fills the group containing (x, y) and reports whether it has any liberties. */
export function findGroup(
  board: ArrayLike<number>,
  size: number,
  x: number,
  y: number
): { group: Point[]; liberties: number } {
  const color = board[index(size, x, y)];
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
      } else if (nColor === color && !seen.has(nIdx)) {
        stack.push(n);
      }
    }
  }

  return { group, liberties };
}

/**
 * After a stone of `placedColor` lands on (x, y), remove any adjacent enemy
 * groups left with zero liberties, then check the placed group itself
 * (suicide is disallowed by the caller before this runs).
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
    if (nColor === 0 || nColor === placedColor || checked.has(nIdx)) continue;

    const { group, liberties } = findGroup(board, size, n.x, n.y);
    group.forEach((p) => checked.add(index(size, p.x, p.y)));

    if (liberties === 0) {
      for (const p of group) {
        board[index(size, p.x, p.y)] = 0;
        captured.push({ point: p, color: nColor });
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
