// Which points of the board get played, from the games saved for replays
// (history/store.ts): every time a stone landed on an empty point counts once.
// The haiku go on the least played ones (rules/haiku.ts pickHaikuPoints).
//
// A board's eight rotations and mirrors are folded together, so a few games
// already say a lot; until HEAT_MIN_GAMES games of a size are saved, the prior
// (rules/haiku.ts priorHeat) stands in for them.

import { priorHeat } from "../rules/haiku";
import type { HistoryStore } from "./store";

export const HEAT_MIN_GAMES = 20;

const isStone = (code: number) => code >= 1 && code <= 13 && code !== 9; // not empty, not driftwood

/** The game's stones by point: how often a stone landed there on an empty point. */
export function recordHeat(record: { size: number; frames: { d: number[] }[] }): number[] {
  const n = record.size * record.size;
  const board = new Array(n).fill(0), heat = new Array(n).fill(0);
  for (const frame of record.frames) {
    const d = frame.d || [];
    for (let k = 0; k + 1 < d.length; k += 2) {
      const [i, code] = [d[k], d[k + 1]];
      if (i < 0 || i >= n) continue;
      if (board[i] === 0 && isStone(code)) heat[i] += 1;
      board[i] = code;
    }
  }
  return heat;
}

/** `heat` summed over the board's eight symmetries: every point gets its whole orbit's count. */
export function symmetrize(heat: number[], size: number): number[] {
  const last = size - 1, out = new Array(size * size).fill(0);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = heat[y * size + x];
      if (!v) continue;
      const images = new Set<number>();
      for (const [a, b] of [[x, y], [y, x]]) {
        for (const [px, py] of [[a, b], [last - a, b], [a, last - b], [last - a, last - b]]) images.add(py * size + px);
      }
      // A point on a mirror line is its own image: it counts once per distinct point, not twice.
      for (const i of images) out[i] += v;
    }
  }
  return out;
}

/** The saved games' heat, per board size. */
export class Heatmap {
  private sizes = new Map<number, { games: number; heat: number[] }>();

  add(record: { size: number; frames: { d: number[] }[] }) {
    const size = record.size;
    const entry = this.sizes.get(size) ?? { games: 0, heat: new Array(size * size).fill(0) };
    const add = recordHeat(record);
    for (let i = 0; i < add.length; i++) entry.heat[i] += add[i];
    entry.games += 1;
    this.sizes.set(size, entry);
  }

  games(size: number): number {
    return this.sizes.get(size)?.games ?? 0;
  }

  /** How played each point of a `size` board is: the saved games, folded, once there are enough; else the prior. */
  heatFor(size: number): number[] {
    const entry = this.sizes.get(size);
    if (!entry || entry.games < HEAT_MIN_GAMES) return priorHeat(size);
    return symmetrize(entry.heat, size);
  }
}

let shared: Heatmap | null = null;

/** The server's heatmap, read from the saved games the first time it is asked for; GoRoom adds each game it saves. */
export function heatmap(store?: HistoryStore): Heatmap {
  if (shared) return shared;
  shared = new Heatmap();
  if (store) {
    for (const summary of store.list({ limit: Number.MAX_SAFE_INTEGER }).games) {
      const record = store.get(summary.id);
      if (record && record.outcome === "finished") shared.add(record);
    }
  }
  return shared;
}
