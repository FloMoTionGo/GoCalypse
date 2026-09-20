import fs from "fs";
import path from "path";
import { ArraySchema, Schema } from "@colyseus/schema";
import { BoardEffect, GoState, MarketItem, PlayerState } from "./GoState";

/**
 * A game in progress, on disk, so it outlives a restart of the server (a deploy,
 * or fly.io stopping an idle machine). One JSON file per room, rewritten
 * whenever the state changes and deleted when the game ends.
 *
 * `keys` maps a seat (player color) to the secret its player holds. Sockets get
 * new session ids after a restart, so the secret is how a returning player is
 * recognised. It lives here and in the room's memory only -- never in GoState,
 * which every client can read.
 */
export interface Snapshot {
  room: string; // registered room name: "go_custom" | "go_debug"
  keys: Record<string, string>;
  state: Record<string, any>; // GoState.toJSON()
}

const ROOMS_DIR = path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "rooms");

export function saveSnapshot(roomId: string, json: string) {
  fs.mkdirSync(ROOMS_DIR, { recursive: true });
  const file = path.join(ROOMS_DIR, `${roomId}.json`);
  fs.writeFileSync(`${file}.tmp`, json);
  fs.renameSync(`${file}.tmp`, file); // never leaves a half-written snapshot
}

export function deleteSnapshot(roomId: string) {
  fs.rmSync(path.join(ROOMS_DIR, `${roomId}.json`), { force: true });
}

/** Every snapshot on disk, with the file id to delete once it has been restored. */
export function loadSnapshots(): { roomId: string; snapshot: Snapshot }[] {
  if (!fs.existsSync(ROOMS_DIR)) return [];
  const found: { roomId: string; snapshot: Snapshot }[] = [];
  for (const name of fs.readdirSync(ROOMS_DIR)) {
    if (!name.endsWith(".json")) continue;
    try {
      const snapshot = JSON.parse(fs.readFileSync(path.join(ROOMS_DIR, name), "utf8")) as Snapshot;
      found.push({ roomId: name.slice(0, -".json".length), snapshot });
    } catch (err) {
      console.error(`Skipping unreadable snapshot ${name}:`, err);
    }
  }
  return found;
}

// A restore is handed to the new room through a token only the server knows, so
// a client's create options can never smuggle a state of its own into a room.
const pending = new Map<string, Snapshot>();

export function queueRestore(snapshot: Snapshot): string {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  pending.set(token, snapshot);
  return token;
}

export function takeRestore(token: unknown): Snapshot | undefined {
  if (typeof token !== "string") return undefined;
  const snapshot = pending.get(token);
  pending.delete(token);
  return snapshot;
}

/** Copies plain JSON (from toJSON) back onto a schema. Arrays here hold primitives only. */
function fill(target: Schema, json: Record<string, any>) {
  for (const [key, value] of Object.entries(json)) {
    const current = (target as any)[key];
    if (current instanceof ArraySchema) {
      current.clear();
      for (const item of value) current.push(item);
    } else if (current instanceof Schema) {
      fill(current, value);
    } else {
      (target as any)[key] = value;
    }
  }
}

function refill<T extends Schema>(list: ArraySchema<T>, items: Record<string, any>[], make: () => T) {
  list.clear();
  for (const item of items) {
    const entry = make();
    fill(entry, item);
    list.push(entry);
  }
}

/** Rebuilds a freshly made GoState from a snapshot of an earlier one. */
export function restoreState(state: GoState, json: Record<string, any>) {
  const { players, market, effects, ...rest } = json;
  fill(state, rest);
  refill(state.players, players, () => new PlayerState());
  refill(state.market, market, () => new MarketItem());
  refill(state.effects, effects, () => new BoardEffect());
}
