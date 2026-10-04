import type { GoState } from "../state/GoState";

/**
 * A game's record, for replays: one frame per thing that happened on the board
 * (a stone, an item, a pass, a seed growing, a storm), each holding only the
 * cells that changed since the frame before. GoRoom keeps one recorder per game
 * and hands the record to history/store.ts when the game is over.
 *
 * Frames hold the true board, fog and mist included. That is only safe because
 * a record is never served before its game has ended (findings B5); until then
 * it lives in the room and in the room's server-side snapshot.
 */

/** A timed board piece: [kind, x, y, owner, until, axis] (BoardEffect, flattened). */
export type Overlay = [string, number, number, number, number, string];

export interface Frame {
  t: number; // turnCount when the frame was taken
  e: string; // GoState.lastEvent
  a?: [string, string, number, number, number]; // a new action: kind, item id, x, y, player colour
  d: number[]; // cells that changed: [index, code, index, code, ...]
  o: Overlay[]; // timed board pieces still on the board
  sc: number[]; // stones captured so far, per seat in colour order
}

export interface PlayerRecord {
  name: string;
  color: number;
  bot: boolean;
  place: number; // 0 for a game that never finished
  finalScore: number;
  tiebreak: number;
  captures: number;
}

export type Outcome = "finished" | "abandoned";

/** What the list of games shows: everything but the frames and the territory. */
export interface GameSummary {
  v: 1;
  id: string;
  room: string; // "go_custom" | "go_debug"
  size: number;
  startedAt: number;
  endedAt: number;
  outcome: Outcome;
  turns: number;
  players: PlayerRecord[];
}

export interface GameRecord extends GameSummary {
  frames: Frame[];
  territory?: { base: number[]; pattern: number[] }; // GoState.*TerritoryOwner, finished games only
}

/** A recorder mid-game, as it rides in the room's snapshot (state/persist.ts). */
export interface RecorderSave {
  id: string;
  room: string;
  size: number;
  startedAt: number;
  frames: Frame[];
  seq?: number; // GoState.action.seq at the last frame, so a restored room doesn't record that action twice
}

const GAME_STARTED = "Game started";

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const byColor = (state: GoState) => Array.from(state.players).sort((a, b) => a.color - b.color);

/** The board after frame `i`: the diffs of frames 0..i laid over an empty board. */
export function boardAt(record: { size: number; frames: Frame[] }, i: number): number[] {
  const board = new Array<number>(record.size * record.size).fill(0);
  for (let f = 0; f <= i && f < record.frames.length; f++) {
    const d = record.frames[f].d;
    for (let k = 0; k + 1 < d.length; k += 2) board[d[k]] = d[k + 1];
  }
  return board;
}

export class GameRecorder {
  readonly id: string;
  readonly room: string;
  readonly size: number;
  readonly startedAt: number;
  private frames: Frame[] = [];
  private board: number[]; // the board as of the last frame
  private lastEvent: string | null = null;
  private lastSeq: number | null = null;

  constructor(opts: { id?: string; room: string; size: number; startedAt?: number }) {
    this.id = opts.id ?? newId();
    this.room = opts.room;
    this.size = opts.size;
    this.startedAt = opts.startedAt ?? Date.now();
    this.board = new Array<number>(this.size * this.size).fill(0);
  }

  /** A recorder carried over a restart, picking up after its last frame. */
  static load(saved: RecorderSave): GameRecorder {
    const rec = new GameRecorder(saved);
    rec.frames = saved.frames.slice();
    rec.board = boardAt(saved, saved.frames.length - 1);
    const last = rec.frames[rec.frames.length - 1];
    if (last) rec.lastEvent = last.e;
    rec.lastSeq = saved.seq ?? null;
    return rec;
  }

  save(): RecorderSave {
    const saved: RecorderSave = { id: this.id, room: this.room, size: this.size, startedAt: this.startedAt, frames: this.frames };
    if (this.lastSeq !== null) saved.seq = this.lastSeq;
    return saved;
  }

  /**
   * Takes a frame when the board, the event line or the action changed since the
   * last one; otherwise does nothing, so it can be called at every point where
   * something might have happened.
   */
  capture(state: GoState) {
    const d: number[] = [];
    for (let i = 0; i < this.board.length; i++) {
      const code = state.board[i] ?? 0;
      if (code !== this.board[i]) d.push(i, code);
    }
    const action = state.action;
    const acted = action.seq > 0 && action.seq !== this.lastSeq;
    if (this.frames.length > 0 && d.length === 0 && !acted && state.lastEvent === this.lastEvent) return;

    const frame: Frame = {
      t: state.turnCount,
      e: this.frames.length === 0 ? GAME_STARTED : state.lastEvent, // not the last seat's "... joined"
      d,
      o: Array.from(state.effects)
        .filter((e) => e.until > state.turnCount)
        .map((e): Overlay => [e.kind, e.x, e.y, e.owner, e.until, e.axis]),
      sc: byColor(state).map((p) => p.score),
    };
    if (acted) frame.a = [action.kind, action.id, action.x, action.y, action.player];
    this.frames.push(frame);
    for (let k = 0; k < d.length; k += 2) this.board[d[k]] = d[k + 1];
    this.lastEvent = state.lastEvent;
    this.lastSeq = action.seq;
  }

  /** The finished record: every seat by colour, with places and territory if the game was scored. */
  finish(state: GoState, outcome: Outcome, endedAt = Date.now()): GameRecord {
    const scored = outcome === "finished";
    const record: GameRecord = {
      v: 1,
      id: this.id,
      room: this.room,
      size: this.size,
      startedAt: this.startedAt,
      endedAt,
      outcome,
      turns: state.turnCount,
      players: byColor(state).map((p) => ({
        name: p.name,
        color: p.color,
        bot: p.bot,
        place: scored ? p.place : 0,
        finalScore: scored ? p.finalScore : 0,
        tiebreak: scored ? p.tiebreak : 0,
        captures: p.score,
      })),
      frames: this.frames,
    };
    if (scored) {
      record.territory = { base: Array.from(state.baseTerritoryOwner), pattern: Array.from(state.patternTerritoryOwner) };
    }
    return record;
  }
}
