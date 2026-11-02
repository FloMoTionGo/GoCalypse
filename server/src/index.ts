import http from "http";
import path from "path";
import express from "express";
import { matchMaker, Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { findRoomForKey, GoDebugRoom, GoRoom } from "./rooms/GoRoom";
import { listTables, startedTables, summarizeTables } from "./rooms/tables";
import { deleteSnapshot, loadSnapshots, queueRestore } from "./state/persist";
import { historyRoutes } from "./history/routes";
import { historyStore } from "./history/store";
import { dropPrivileges, system } from "./util/privileges";
import { addressLimits, TokenBucket } from "./util/limits";
import { clientIp } from "./util/net";

// Before any file or port is opened: in the container (RUN_AS=node, the
// Dockerfile) the server makes the data volume the node user's and becomes
// that user (util/privileges.ts). Locally and in the tests nothing happens.
const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
if (dropPrivileges({ user: process.env.RUN_AS, dataDir }, system) === "dropped") {
  console.log(`Running as ${process.env.RUN_AS}; data in ${dataDir}`);
}

const port = Number(process.env.PORT) || 2567;
const app = express();
app.disable("x-powered-by"); // no need to name the framework on every response
app.use(express.json());

// The web client is served from elsewhere, so /rejoin and /history need CORS
// headers; nosniff keeps a browser from reading any answer as something else.
app.use((req, res, next) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

/** The address a request comes from, Fly's own header first (util/net.ts). */
function addressOf(req: express.Request): string {
  return clientIp(req.headers["x-real-ip"] ?? req.headers["x-forwarded-for"] ?? req.socket.remoteAddress, req.headers);
}

// /rejoin: ten calls a minute per address. The client knocks every 1.5 s for
// 15 s after a drop and never more; anything faster is nobody's seat.
const REJOIN_PER_MINUTE = 10;
const rejoinBuckets = new Map<string, TokenBucket>();
function rejoinAllowed(ip: string): boolean {
  let bucket = rejoinBuckets.get(ip);
  if (!bucket) {
    if (rejoinBuckets.size >= 10_000) rejoinBuckets.clear(); // never more than this many addresses in memory
    rejoinBuckets.set(ip, (bucket = new TokenBucket(REJOIN_PER_MINUTE / 60, REJOIN_PER_MINUTE)));
  }
  return bucket.take();
}

// The pid lets the test harness tell its own server from another one that took the port first.
app.get("/healthz", (_req, res) => res.status(200).set("X-Pid", String(process.pid)).send("ok"));

// Who is waiting right now (rooms/tables.ts): public go_custom tables with a person
// at them and a seat free, counted per board size for the presence line, and one
// by one with their seats for the lobby islands; plus the tables that just started.
app.get("/tables", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const rooms = await matchMaker.query({ name: "go_custom", locked: false });
    res.json({ tables: summarizeTables(rooms), rooms: listTables(rooms), started: startedTables.list() });
  } catch (err) {
    console.error("/tables: could not list the rooms:", err);
    res.status(503).json({ error: "The server can't say who is waiting right now." });
  }
});

// Finished games, for the home screen's Replays (history/routes.ts).
app.use(historyRoutes(historyStore));

// A player whose connection dropped (or whose server restarted) asks for the seat
// its tab's secret belongs to. The answer is a seat reservation, which the
// client redeems with consumeSeatReservation -- the same as after matchmaking,
// but it works on a locked room, so nobody else can walk in.
app.post("/rejoin", async (req, res) => {
  res.set("Cache-Control", "no-store"); // a seat reservation is for this one call
  const ip = addressOf(req);
  if (!rejoinAllowed(ip)) return res.status(429).set("Retry-After", "6").json({ error: "Too many tries: wait a few seconds." });
  const key = typeof req.body?.playerKey === "string" ? req.body.playerKey.slice(0, 64) : "";
  const room = key ? findRoomForKey(key) : undefined;
  if (!room) return res.status(404).json({ error: "no game to rejoin" });
  // The same address caps as a matchmake call (GoRoom.onAuth); the address rides
  // along as the seat's auth data, so the room counts the socket.
  const refused = addressLimits().reserve(ip, false);
  if (refused) return res.status(429).set("Retry-After", "15").json({ error: refused });
  try {
    const listing = await matchMaker.getRoomById(room.roomId);
    res.json(await matchMaker.reserveSeatFor(listing, { playerKey: key }, { ip }));
  } catch (err) {
    console.error(`/rejoin: could not reserve a seat in ${room.roomId}:`, err); // the detail stays in the log
    res.status(409).json({ error: "That seat can't be handed back right now. Try again in a moment." });
  }
});

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

// Quick join finds only a waiting table of the board size asked for (13, 19 or 25).
gameServer.define("go_custom", GoRoom).filterBy(["size"]);
// Separate matchmaking pool for web/debug.html: same rules, but everyone
// starts with enough fireflies to try every market item. Local servers and
// staging have it (DEBUG_ROOMS=on in fly.staging.toml); production does not,
// so nobody plays a 1200-firefly table into the public replays.
const debugRooms = process.env.DEBUG_ROOMS === "on" || process.env.NODE_ENV !== "production";
if (debugRooms) gameServer.define("go_debug", GoDebugRoom).filterBy(["size"]);
console.log(`Debug tables (go_debug): ${debugRooms ? "on" : "off"}`);

/** Games that were under way when the server last stopped come back as rooms of their own. */
async function restoreGames() {
  for (const { roomId, snapshot } of loadSnapshots()) {
    try {
      await matchMaker.createRoom(snapshot.room, { restoreToken: queueRestore(snapshot) });
      deleteSnapshot(roomId); // the new room has already written its own
      console.log(`Restored game ${roomId} (${snapshot.room})`);
    } catch (err) {
      console.error(`Could not restore game ${roomId}:`, err);
    }
  }
}

gameServer.listen(port).then(restoreGames);
console.log(`GoCalypse server listening on ws://0.0.0.0:${port}`);
