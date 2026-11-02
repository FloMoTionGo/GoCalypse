import { BOARD_SIZES } from "./GoRoom";

/**
 * Who is waiting (GET /tables, index.ts): the home screen says "2 waiting at
 * 13x13" before anyone clicks Play, instead of leaving a first visit to find
 * out at "Waiting for players (1/4)". Built from the matchmaker's room listings:
 * `clients` counts the people (bots hold seats without sockets, and
 * countBotSeats lowers maxClients for them), `size` is the filter option the
 * table was created with (gameServer.define(...).filterBy(["size"])).
 */

export type TableListing = {
  roomId?: string;
  clients: number;
  maxClients: number;
  locked: boolean;
  private?: boolean;
  size?: unknown;
  createdAt?: unknown;
  metadata?: { seats?: unknown };
};

export type TableSummary = { size: number; waiting: number; tables: number };

/**
 * Who sits where at a waiting table, by colour (seat i is colour i + 1): "p"
 * for a person, "bot:<recruit id>" for a bot, null for a free seat. GoRoom
 * publishes it as its listing's metadata. Never a name: the home screen is public.
 */
export type Seat = "p" | `bot:${string}` | null;
export type Lobby = { roomId: string; size: number; seats: Seat[] };
export type StartedLobby = Lobby & { at: number };

const DEFAULT_SIZE = 13;
const MAX_LOBBIES = 24; // more than any river has slots for; the home screen shows the nearest
const SEAT = /^(p|bot:[a-z]{1,16})$/;

/** The table's board size, or null for one the home screen can't offer. */
function sizeOf(room: TableListing): number | null {
  const size = room.size === undefined ? DEFAULT_SIZE : room.size;
  return typeof size === "number" && BOARD_SIZES.includes(size) ? size : null;
}

/** A public table with a person waiting and a seat free. */
function open(room: TableListing): boolean {
  return !room.locked && !room.private && room.clients > 0 && room.clients < room.maxClients;
}

/** Public tables with a person waiting and a seat free, counted per board size, smallest board first. */
export function summarizeTables(listings: TableListing[]): TableSummary[] {
  const bySize = new Map<number, TableSummary>();
  for (const room of listings) {
    if (!open(room)) continue;
    const size = sizeOf(room);
    if (size === null) continue;
    const entry = bySize.get(size) ?? { size, waiting: 0, tables: 0 };
    entry.waiting += room.clients;
    entry.tables += 1;
    bySize.set(size, entry);
  }
  return Array.from(bySize.values()).sort((a, b) => a.size - b.size);
}

/** The seats a room published, or, when they are missing or malformed, its people in the first seats. */
function seatsOf(room: TableListing): Seat[] {
  const seats = room.metadata?.seats;
  if (Array.isArray(seats) && seats.length === 4 && seats.every((s) => s === null || (typeof s === "string" && SEAT.test(s)))) {
    return seats as Seat[];
  }
  return [0, 1, 2, 3].map((i) => (i < room.clients ? "p" : null));
}

const createdAt = (room: TableListing) => {
  const t = room.createdAt instanceof Date ? room.createdAt.getTime() : Date.parse(String(room.createdAt));
  return Number.isFinite(t) ? t : 0;
};

/** Every open lobby with its seats, for the home screen's islets: oldest first, at most MAX_LOBBIES. */
export function listTables(listings: TableListing[]): Lobby[] {
  return listings
    .filter((room) => open(room) && sizeOf(room) !== null && typeof room.roomId === "string")
    .sort((a, b) => createdAt(a) - createdAt(b) || String(a.roomId).localeCompare(String(b.roomId)))
    .slice(0, MAX_LOBBIES)
    .map((room) => ({ roomId: room.roomId!, size: sizeOf(room)!, seats: seatsOf(room) }));
}

/**
 * Tables whose game just started, for a few seconds: a lobby leaves the
 * listing when it locks, and also when its last person leaves. The home
 * screen polls, so this is how it tells the two apart (its islet sinks with
 * lanterns, not quietly) even when a table fills between two polls.
 */
export class StartedTables {
  static readonly KEEP_MS = 15_000;
  private entries: StartedLobby[] = [];

  record(lobby: Lobby, now = Date.now()) {
    this.entries = this.list(now).filter((e) => e.roomId !== lobby.roomId);
    this.entries.push({ roomId: lobby.roomId, size: lobby.size, seats: [...lobby.seats], at: now });
    if (this.entries.length > MAX_LOBBIES) this.entries.shift();
  }

  list(now = Date.now()): StartedLobby[] {
    return this.entries.filter((e) => now - e.at <= StartedTables.KEEP_MS);
  }
}

/** The server's one record of just-started tables (GoRoom.startGame writes, GET /tables reads). */
export const startedTables = new StartedTables();
