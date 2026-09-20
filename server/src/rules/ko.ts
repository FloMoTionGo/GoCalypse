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
