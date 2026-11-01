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
  clients: number;
  maxClients: number;
  locked: boolean;
  private?: boolean;
  size?: unknown;
};

export type TableSummary = { size: number; waiting: number; tables: number };

const DEFAULT_SIZE = 13;

/** Public tables with a person waiting and a seat free, counted per board size, smallest board first. */
export function summarizeTables(listings: TableListing[]): TableSummary[] {
  const bySize = new Map<number, TableSummary>();
  for (const room of listings) {
    if (room.locked || room.private || room.clients <= 0 || room.clients >= room.maxClients) continue;
    const size = room.size === undefined ? DEFAULT_SIZE : room.size;
    if (typeof size !== "number" || !BOARD_SIZES.includes(size)) continue;
    const entry = bySize.get(size) ?? { size, waiting: 0, tables: 0 };
    entry.waiting += room.clients;
    entry.tables += 1;
    bySize.set(size, entry);
  }
  return Array.from(bySize.values()).sort((a, b) => a.size - b.size);
}
