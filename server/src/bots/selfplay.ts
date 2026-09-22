// A whole match between four bots, with no room, no socket and no clock.
//
// This is the engine both the tests and the weight tuner run on (tools/tune).
// It drives the same `chooseAction` the room drives, counts passes the way
// GoRoom.applyPass counts them, and scores the finished board with
// rules/endgame.ts, so a result here means what it means in a real game.
//
// What it leaves out is the Night Market. Bots only have planners for seven of
// the eighteen items (bots/items.ts), and the ones they do have need the room's
// effect bookkeeping -- wards, lily pads, driftwood timers -- to behave. So a
// match here is stones only: it models the board play the Style weights
// actually govern, and says nothing about shopping. `itemBias` and `shopping`
// are not exercised, and must not be tuned from these results.

import { applyCaptures, boardIndex, isSuicide, stoneCode } from "../rules/goRules";
import { finalResults, PlayerResult, Prisoners, territoryScore } from "../rules/endgame";
import { chooseAction } from "./index";
import { Rng } from "./rng";
import { BotView } from "./scoring";
import { Style } from "./styles";

export interface MatchResult {
  results: PlayerResult[]; // one per seat, in seat order (seat i holds combo i + 1)
  turns: number; // turns taken, passes included
  stones: number; // stones actually placed
  board: number[];
  finished: boolean; // false only if the turn cap was hit first
}

export interface MatchOptions {
  size?: number;
  /** Safety net, not a rule: a finished game ends on four passes long before this. */
  turnCap?: number;
}

const SEATS = 4;

/**
 * Plays one match out and counts the board. `styles[i]` takes seat i, which
 * holds combo i + 1, and the seed names the match exactly: the same seed and
 * the same styles replay move for move, on any machine.
 */
export function playMatch(seed: number, styles: Style[], options: MatchOptions = {}): MatchResult {
  const size = options.size ?? 13;
  const turnCap = options.turnCap ?? 8 * size * size;
  const board = new Array(size * size).fill(0);
  const rng = new Rng(seed);
  const took: Prisoners[] = styles.map(() => ({ base: 0, pattern: 0 }));

  // Positional superko, the same rule rules/ko.ts enforces in the room.
  const seen = new Set<string>();
  let passes = 0;
  let last: { x: number; y: number } | null = null;
  let stones = 0;
  let moves = new Array(SEATS).fill(0);
  let turns = 0;
  let finished = false;

  for (; turns < turnCap; turns++) {
    const seat = turns % SEATS;
    const color = seat + 1;
    const view: BotView = {
      board,
      size,
      color,
      lastMove: last,
      fireflies: 0,
      moves: moves[seat],
      seats: SEATS,
      passes,
      prisoners: took[seat],
      powerups: [],
      bought: [],
      shopAfter: Number.MAX_SAFE_INTEGER, // the market never opens here
      market: [],
      satchelLimit: 5,
      powerfulLimit: 1,
      isWarded: () => false,
      lilyOwnerAt: () => 0,
      isBurning: () => false,
      repeats: (next) => seen.has(next.join(",")),
    };

    const action = chooseAction(view, styles[seat], rng);
    if (action.kind !== "move") {
      // Only a pass can come back: there is no satchel to use an item from.
      passes += 1;
      if (passes >= SEATS) {
        finished = true;
        turns += 1;
        break;
      }
      continue;
    }

    const idx = boardIndex(size, action.x, action.y);
    if (board[idx] !== 0) throw new Error(`bot played on an occupied point at turn ${turns}`);
    const code = stoneCode(color, action.axis);
    board[idx] = code;
    const captured = applyCaptures(board, size, action.x, action.y, code);
    if (captured.length === 0 && isSuicide(board, size, action.x, action.y)) {
      throw new Error(`bot played a suicide at turn ${turns}`);
    }
    for (const c of captured) took[seat][c.view] += 1;

    seen.add(board.join(","));
    last = { x: action.x, y: action.y };
    moves[seat] += 1;
    passes = 0;
    stones += 1;
  }

  const results = finalResults(
    territoryScore(board, size),
    styles.map((_, seat) => seat + 1),
    took
  );
  return { results, turns, stones, board, finished };
}
