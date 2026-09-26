// The ko rule, as positional superko: a move may not leave the board looking
// the way it looked at any earlier point in the game.
//
// Plain ko (no immediate recapture) is not enough here. With four seats a
// capture can be answered two or three stones later by someone else, and the
// same board comes round again after a full turn or two, so the rule
// remembers every position rather than only the last one. Only the stones
// count -- who is to move and what is in the satchels do not.
//
// Stone colours do not count either, only which points are occupied. With four
// seats a point can be taken, captured, and retaken by the next colour round
// the table, and colour-exact keys never see that as the same position, so the
// bots would trade the same move forever.

import { boardIndex, Captured, findGroup, viewsOf } from "./goRules";

/** The board as a string, one character per point: occupied or not. */
export function positionKey(board: ArrayLike<number>): string {
  let key = "";
  for (let i = 0; i < board.length; i++) key += board[i] === 0 ? "0" : "1";
  return key;
}

export class PositionHistory {
  private seen = new Set<string>();

  record(board: ArrayLike<number>): void {
    this.seen.add(positionKey(board));
  }

  /** Whether `board` is a position that has already stood in this game. */
  repeats(board: ArrayLike<number>): boolean {
    return this.seen.has(positionKey(board));
  }
}

// ---- the ko, held for a round ------------------------------------------------
//
// Superko alone does not stop a ko fight here. The retake comes two or three
// stones after the take, and the seats in between have put stones down
// elsewhere, so the board is never quite the one that stood before and the
// same single stone is taken and retaken for as long as anyone likes. So a ko
// is also held shut for one full round: once a stone is taken in a ko, nobody
// may take it straight back until the seat that took it is on turn again --
// which gives that seat the chance to fill the ko and end it.

/** Where a ko stands: the point a retake would be played on, and the lone stone it would lift. */
export interface Ko {
  point: number;
  stone: number;
  code: number; // the stone's board code, so a different stone later on that point is not mistaken for it
}

/**
 * The ko a move has just opened, or null. That is a move that took exactly one
 * stone and is left a lone stone with a single liberty, on every front it
 * fights on: the point it just emptied, so a stone played there lifts it back.
 * `board` is the board after the move, captures applied.
 */
export function koOpenedBy(board: ArrayLike<number>, size: number, idx: number, captured: Captured[]): Ko | null {
  if (captured.length !== 1) return null;
  const x = idx % size;
  const y = Math.floor(idx / size);
  const code = board[idx];
  for (const view of viewsOf(code)) {
    const { group, liberties } = findGroup(board, size, x, y, view);
    if (group.length !== 1 || liberties !== 1) return null;
  }
  const taken = captured[0].point;
  return { point: boardIndex(size, taken.x, taken.y), stone: idx, code };
}

export class KoWatch {
  private held: (Ko & { until: number })[] = [];

  constructor(private readonly size: number) {}

  /** Notes the ko a move opened, if it opened one, and holds it until turn `until` begins. */
  open(board: ArrayLike<number>, idx: number, captured: Captured[], turn: number, until: number): void {
    this.held = this.held.filter((ko) => ko.until > turn);
    const ko = koOpenedBy(board, this.size, idx, captured);
    if (ko) this.held.push({ ...ko, until });
  }

  /** Whether a stone on `idx` that lifts `captured` would take back a ko still held on `turn`. */
  blocks(idx: number, captured: Captured[], turn: number): boolean {
    if (captured.length !== 1) return false;
    const lifted = boardIndex(this.size, captured[0].point.x, captured[0].point.y);
    return this.held.some(
      (ko) => ko.until > turn && ko.point === idx && ko.stone === lifted && ko.code === captured[0].color
    );
  }
}
