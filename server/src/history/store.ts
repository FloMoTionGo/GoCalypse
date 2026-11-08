import fs from "fs";
import path from "path";
import type { GameRecord, GameSummary } from "./recorder";

/**
 * Finished games on disk, for replays: one JSON file per game in
 * DATA_DIR/history, beside the snapshots of the games still under way. The
 * list is served from an index of summaries, built from the files the first
 * time it is needed and kept up to date by save().
 */

const GAME_ID = /^[A-Za-z0-9_-]{6,40}$/;
const DEFAULT_LIMIT = 50;
const DEFAULT_MAX = 500;
const DEFAULT_MIN_TURNS = 50;

/** The fewest turns (the whole table's) a game must last to be kept for replays: HISTORY_MIN_TURNS, or 50. */
export function minReplayTurns(): number {
  const raw = process.env.HISTORY_MIN_TURNS?.trim();
  const turns = raw ? Number(raw) : NaN;
  return Number.isFinite(turns) && turns >= 0 ? turns : DEFAULT_MIN_TURNS;
}

/** Whether a game ended too soon to be a replay. A record that doesn't say how long it was is left alone. */
export function tooShort(game: { turns?: number }, minTurns = minReplayTurns()): boolean {
  return typeof game.turns === "number" && game.turns < minTurns;
}

/** A game id: the only names that are ever turned into a path. */
export function isGameId(id: unknown): id is string {
  return typeof id === "string" && GAME_ID.test(id);
}

export function historyDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "history");
}

export function summaryOf(record: GameRecord): GameSummary {
  const { frames, territory, ...summary } = record;
  return summary;
}

/** A table's seats, as far as the noise rule needs them. */
export interface SeatedGame {
  room?: string; // "go_custom" | "go_debug"; a record from before rooms were written down counts as a match
  players?: { bot: boolean }[];
}

export type Noise = "bots" | "debug";

/**
 * Test noise, not a match: a game from a debug table, or one nobody human
 * played (every seat filled by the server from the start; a person who left
 * before the end still played, state/GoState.ts serverSeated). Such a game is never kept for replays
 * and teaches the haiku nothing. `anyBot` widens "bots" to a table where any
 * seat was a bot (purge --any-bot).
 */
export function noiseOf(game: SeatedGame, opts: { anyBot?: boolean } = {}): Noise | undefined {
  if (game.room !== undefined && game.room !== "go_custom") return "debug";
  const players = game.players ?? [];
  if (players.length && (opts.anyBot ? players.some((p) => p.bot) : players.every((p) => p.bot))) return "bots";
  return undefined;
}

export interface ListQuery {
  from?: number; // games that ended at or after this (ms)
  to?: number; // ... and before this
  limit?: number;
}

export class HistoryStore {
  private index: Map<string, GameSummary> | null = null;
  private readonly max: number;

  constructor(private readonly dir: string, opts: { max?: number } = {}) {
    this.max = opts.max ?? DEFAULT_MAX;
  }

  private file(id: string): string {
    return path.join(this.dir, `${id}.json`);
  }

  private read(id: string): GameRecord | undefined {
    try {
      const record = JSON.parse(fs.readFileSync(this.file(id), "utf8"));
      return record && record.id === id && Array.isArray(record.frames) && Array.isArray(record.players) ? record : undefined;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error(`Skipping unreadable game ${id}:`, err);
      return undefined;
    }
  }

  private games(): Map<string, GameSummary> {
    if (this.index) return this.index;
    this.index = new Map();
    if (!fs.existsSync(this.dir)) return this.index;
    for (const name of fs.readdirSync(this.dir)) {
      const id = name.endsWith(".json") ? name.slice(0, -".json".length) : "";
      const record = isGameId(id) ? this.read(id) : undefined;
      if (record) this.index.set(id, summaryOf(record));
    }
    return this.index;
  }

  /** Newest first. */
  private newest(): GameSummary[] {
    return Array.from(this.games().values()).sort((a, b) => b.endedAt - a.endedAt || (a.id < b.id ? 1 : -1));
  }

  save(record: GameRecord) {
    if (!isGameId(record.id)) throw new Error(`not a game id: ${JSON.stringify(record.id)}`);
    const games = this.games();
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.file(record.id);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(record));
    fs.renameSync(`${file}.tmp`, file); // never leaves a half-written game
    games.set(record.id, summaryOf(record));
    for (const old of this.newest().slice(this.max)) {
      fs.rmSync(this.file(old.id), { force: true });
      games.delete(old.id);
    }
  }

  get(id: string): GameRecord | undefined {
    return isGameId(id) && this.games().has(id) ? this.read(id) : undefined;
  }

  /** Forgets a game: its file and its place in the list. True when there was one (tools/forgetGame.ts). */
  delete(id: string): boolean {
    if (!isGameId(id) || !this.games().has(id)) return false;
    fs.rmSync(this.file(id), { force: true });
    this.games().delete(id);
    return true;
  }

  /**
   * Forgets every saved game that is test noise (noiseOf), and says which went
   * and why. A dry run only says. For the games saved before the noise rule
   * (tools/purgeHistory.ts).
   */
  purge(opts: { dryRun?: boolean; anyBot?: boolean } = {}): { id: string; reason: Noise }[] {
    const gone: { id: string; reason: Noise }[] = [];
    for (const summary of this.newest()) {
      const reason = noiseOf(summary, opts);
      if (!reason) continue;
      gone.push({ id: summary.id, reason });
      if (!opts.dryRun) this.delete(summary.id);
    }
    return gone;
  }

  /**
   * Forgets every saved game too short to be a replay (tooShort), and only
   * those, saying how long each lasted. A dry run only says. For the games
   * saved before the threshold (tools/purgeHistory.ts --short).
   */
  purgeShort(opts: { dryRun?: boolean } = {}): { id: string; turns: number }[] {
    const gone = this.newest().filter((game) => tooShort(game));
    if (!opts.dryRun) for (const game of gone) this.delete(game.id);
    return gone.map(({ id, turns }) => ({ id, turns }));
  }

  list(query: ListQuery = {}): { games: GameSummary[]; total: number } {
    const from = query.from ?? -Infinity;
    const to = query.to ?? Infinity;
    const matches = this.newest().filter((g) => g.endedAt >= from && g.endedAt < to);
    return { games: matches.slice(0, query.limit ?? DEFAULT_LIMIT), total: matches.length };
  }
}

let shared: HistoryStore | undefined;

/** The server's own store, in DATA_DIR/history, keeping the newest HISTORY_MAX games (500). */
export function historyStore(): HistoryStore {
  if (!shared) shared = new HistoryStore(historyDir(), { max: Number(process.env.HISTORY_MAX) || DEFAULT_MAX });
  return shared;
}
