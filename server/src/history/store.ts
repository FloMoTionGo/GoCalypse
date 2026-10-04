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
