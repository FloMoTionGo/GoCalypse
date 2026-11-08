import { boardIndex, isPlayerStone, neighbors, StoneView, viewsOf, viewValue } from "./goRules";

// Which stones are dead when a Chinese or Japanese table ends. Nobody is asked:
// four players can't easily agree, so the server decides, by looking at the
// board and nothing else. No dice: the same board always gives the same answer.
//
// The textbook test for life (Benson's) assumes walls are permanent. Here a stone
// of the other front is a wall that can itself be captured, so instead each front
// is read on its own, and a group goes only when all of these hold:
//
//   1. it has too few eyes: fewer than two empty regions that only its own side
//      touches, and none of them BIG_EYE or larger, which is room for two;
//   2. taken away, what is left is one empty region that only the other side
//      touches, and no wider than a settled one (2 * size, as endgame.isSettled);
//   3. the other side around it lives in that board.
//
// Anything else stands, so a mistake leaves a stone on the board rather than
// taking a living one off. A twin stone fights on both fronts and goes only if it
// is dead on both.

const BIG_EYE = 6; // an empty region this large can be split into two eyes
const AXES: StoneView[] = ["base", "pattern"];

interface Region {
  points: number[];
  borders: Set<string>;
  groups: Set<number>; // the groups (index into Front.groups) it touches
}

interface Group {
  side: string;
  points: number[];
  regions: Set<number>; // the regions (index into Front.regions) it touches
}

interface Front {
  groups: Group[];
  regions: Region[];
  regionAt: Map<number, number>;
}

/** The side a code shows on this front, or null where it is empty or a wall here. */
const sideOf = (code: number, view: StoneView): string | null => (isPlayerStone(code) ? viewValue(view, code) : null);

/**
 * One front as groups and empty regions. A group here is every chain of a side
 * joined through the empty regions they share: what lives or dies together. A
 * stone of the other front walls a region in, and borders nobody.
 */
function readFront(board: ArrayLike<number>, size: number, view: StoneView): Front {
  const regions: Region[] = [];
  const regionAt = new Map<number, number>();
  const chainAt = new Int32Array(board.length).fill(-1);
  const chains: { side: string; points: number[] }[] = [];

  for (let start = 0; start < board.length; start++) {
    const side = sideOf(board[start], view);
    if (board[start] === 0 && !regionAt.has(start)) {
      const id = regions.length;
      const region: Region = { points: [], borders: new Set(), groups: new Set() };
      regions.push(region);
      regionAt.set(start, id);
      for (const stack = [start]; stack.length; ) {
        const at = stack.pop()!;
        region.points.push(at);
        for (const n of neighbors(size, at % size, Math.floor(at / size))) {
          const next = boardIndex(size, n.x, n.y);
          if (board[next] === 0) {
            if (!regionAt.has(next)) {
              regionAt.set(next, id);
              stack.push(next);
            }
          } else {
            const border = sideOf(board[next], view);
            if (border) region.borders.add(border);
          }
        }
      }
    } else if (side && chainAt[start] === -1) {
      const id = chains.length;
      const chain = { side, points: [] as number[] };
      chains.push(chain);
      chainAt[start] = id;
      for (const stack = [start]; stack.length; ) {
        const at = stack.pop()!;
        chain.points.push(at);
        for (const n of neighbors(size, at % size, Math.floor(at / size))) {
          const next = boardIndex(size, n.x, n.y);
          if (chainAt[next] === -1 && sideOf(board[next], view) === side) {
            chainAt[next] = id;
            stack.push(next);
          }
        }
      }
    }
  }

  // Chains of a side that touch the same empty region are one group.
  const parent = chains.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const touching = regions.map(() => new Set<number>());
  chains.forEach((chain, c) => {
    for (const at of chain.points) {
      for (const n of neighbors(size, at % size, Math.floor(at / size))) {
        const r = regionAt.get(boardIndex(size, n.x, n.y));
        if (r !== undefined) touching[r].add(c);
      }
    }
  });
  for (const set of touching) {
    const bySide = new Map<string, number>();
    for (const c of set) {
      const first = bySide.get(chains[c].side);
      if (first === undefined) bySide.set(chains[c].side, c);
      else parent[find(c)] = find(first);
    }
  }

  const groupOf = new Map<number, number>();
  const groups: Group[] = [];
  chains.forEach((chain, c) => {
    const root = find(c);
    if (!groupOf.has(root)) {
      groupOf.set(root, groups.length);
      groups.push({ side: chain.side, points: [], regions: new Set() });
    }
    groups[groupOf.get(root)!].points.push(...chain.points);
  });
  touching.forEach((set, r) => {
    for (const c of set) {
      const g = groupOf.get(find(c))!;
      groups[g].regions.add(r);
      regions[r].groups.add(g);
    }
  });
  return { groups, regions, regionAt };
}

/** Two eyes, or one region with room for two. */
function lives(group: Group, front: Front): boolean {
  let eyes = 0;
  for (const r of group.regions) {
    const region = front.regions[r];
    if (region.borders.size !== 1 || !region.borders.has(group.side)) continue;
    if (region.points.length >= BIG_EYE) return true;
    eyes += 1;
  }
  return eyes >= 2;
}

/** Whether `group` is dead on this front: the three tests at the top of this file. */
function isDead(board: ArrayLike<number>, size: number, view: StoneView, front: Front, group: Group): boolean {
  if (lives(group, front)) return false;

  const without = Array.from(board);
  for (const at of group.points) without[at] = 0;
  const after = readFront(without, size, view);
  const ground = after.regions[after.regionAt.get(group.points[0])!];
  if (ground.borders.size !== 1 || ground.borders.has(group.side)) return false;
  if (ground.points.length > 2 * size) return false;
  return Array.from(ground.groups).every((g) => lives(after.groups[g], after));
}

/** The points of every dead stone, in board order. `board` is left as it is. */
export function deadStones(board: ArrayLike<number>, size: number): number[] {
  const deadOn: Record<StoneView, Set<number>> = { base: new Set(), pattern: new Set() };
  for (const view of AXES) {
    const front = readFront(board, size, view);
    for (const group of front.groups) {
      if (isDead(board, size, view, front, group)) for (const at of group.points) deadOn[view].add(at);
    }
  }
  const dead: number[] = [];
  for (let at = 0; at < board.length; at++) {
    if (isPlayerStone(board[at]) && viewsOf(board[at]).every((view) => deadOn[view].has(at))) dead.push(at);
  }
  return dead;
}
