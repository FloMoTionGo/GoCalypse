// Shared set-up for the room tests: a real GoRoom driven without a server.
// Import this before anything that loads state/persist.ts, so the snapshots
// the rooms write land in a temp folder and not in the server's own data.
import os from "os";
import path from "path";

process.env.DATA_DIR = process.env.DATA_DIR || path.join(os.tmpdir(), `gocalypse-test-${process.pid}`);

import { MarketItem } from "../state/GoState";
import { fairShare, getPowerup, stallCopies } from "../powerups/definitions";
import { boardIndex } from "../rules/goRules";
import { GoDebugRoom, GoRoom } from "./GoRoom";

export const DATA_DIR = process.env.DATA_DIR;

/** A socket as far as the room can tell: records what it is sent. */
export interface FakeClient {
  sessionId: string;
  sent: [string, unknown][];
  send(type: string, message?: unknown): void;
  view?: any;
}

export function fakeClient(sessionId: string): FakeClient {
  const client: FakeClient = {
    sessionId,
    sent: [],
    send(type, message) {
      client.sent.push([type, message]);
    },
  };
  return client;
}

/** The notices a client was sent, newest last. */
export function notices(client: FakeClient): string[] {
  return client.sent.filter(([type]) => type === "notice").map(([, text]) => String(text));
}

let rooms = 0;

/**
 * A room as onCreate leaves it, with no matchmaker behind it: the clock never
 * ticks (bot turns are run by hand with room.runBotTurn()) and disconnect()
 * only counts its calls.
 */
export function makeRoom(opts: { debug?: boolean; restoreToken?: string; roomName?: string } = {}): any {
  const room: any = new (opts.debug ? GoDebugRoom : GoRoom)();
  room.roomId = `test-${process.pid}-${++rooms}`;
  room.roomName = opts.roomName ?? (opts.debug ? "go_debug" : "go_custom");
  room.listing = { updateOne: async () => {} };
  room.disconnects = 0;
  room.disconnect = async () => {
    room.disconnects += 1;
  };
  room.onCreate(opts.restoreToken ? { restoreToken: opts.restoreToken } : {});
  return room;
}

/** Seats humans named after their session ids; four of them start the game. */
export function seatHumans(room: any, ids: string[] = ["a", "b", "c", "d"], keys: Record<string, string> = {}): FakeClient[] {
  return ids.map((id) => {
    const client = fakeClient(id);
    room.onJoin(client, { name: id, playerKey: keys[id] });
    return client;
  });
}

/** A four-human game under way, and its clients in join order. */
export function startedRoom(opts: { debug?: boolean } = {}): { room: any; clients: FakeClient[] } {
  const room = makeRoom(opts);
  const clients = seatHumans(room);
  return { room, clients };
}

/** The client whose seat is on turn. */
export function onTurn(room: any, clients: FakeClient[]): FakeClient {
  const sessionId = room.state.players[room.state.turnIndex].sessionId;
  return clients.find((c) => c.sessionId === sessionId)!;
}

export function playerOf(room: any, client: FakeClient): any {
  return room.state.players.find((p: any) => p.sessionId === client.sessionId);
}

export function at(room: any, x: number, y: number): number {
  return room.state.board[boardIndex(room.state.size, x, y)];
}

export function put(room: any, x: number, y: number, code: number) {
  room.state.board[boardIndex(room.state.size, x, y)] = code;
}

/** Sends a move for whoever is on turn, through the client message path. */
export function move(room: any, clients: FakeClient[], x: number, y: number, axis: "base" | "pattern" = "base"): FakeClient {
  const client = onTurn(room, clients);
  room.handleMove(client, { x, y, axis });
  return client;
}

/** Everyone on turn passes, `times` times in a row. */
export function passAround(room: any, clients: FakeClient[], times: number) {
  for (let i = 0; i < times; i++) room.handlePass(onTurn(room, clients));
}

/** Replaces the match's random stalls with these items, each stocked as onCreate would. */
export function stock(room: any, ids: string[]) {
  room.state.market.clear();
  for (const id of ids) {
    const def = getPowerup(id)!;
    const item = new MarketItem();
    item.id = def.id;
    item.name = def.name;
    item.description = def.description;
    item.price = def.price;
    item.removal = def.removal;
    item.tier = def.tier;
    item.points = def.points ?? 1;
    item.free = !!def.free;
    item.stock = item.left = stallCopies(def.tier, 4);
    item.share = fairShare(item.stock, 4);
    room.state.market.push(item);
  }
}
