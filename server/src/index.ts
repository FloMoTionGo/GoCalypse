import http from "http";
import express from "express";
import { matchMaker, Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { findRoomForKey, GoDebugRoom, GoRoom } from "./rooms/GoRoom";
import { deleteSnapshot, loadSnapshots, queueRestore } from "./state/persist";

const port = Number(process.env.PORT) || 2567;
const app = express();
app.use(express.json());

// The web client is served from elsewhere, so /rejoin needs CORS headers.
app.use((req, res, next) => {
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

// A player whose connection dropped (or whose server restarted) asks for the seat
// its tab's secret belongs to. The answer is a seat reservation, which the
// client redeems with consumeSeatReservation -- the same as after matchmaking,
// but it works on a locked room, so nobody else can walk in.
app.post("/rejoin", async (req, res) => {
  const key = typeof req.body?.playerKey === "string" ? req.body.playerKey.slice(0, 64) : "";
  const room = key ? findRoomForKey(key) : undefined;
  if (!room) return res.status(404).json({ error: "no game to rejoin" });
  try {
    const listing = await matchMaker.getRoomById(room.roomId);
    res.json(await matchMaker.reserveSeatFor(listing, { playerKey: key }));
  } catch (err) {
    res.status(409).json({ error: String((err as Error)?.message || err) });
  }
});

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("go_custom", GoRoom);
// Separate matchmaking pool for web/debug.html: same rules, but everyone
// starts with enough fireflies to try every market item.
gameServer.define("go_debug", GoDebugRoom);

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
