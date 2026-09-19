import http from "http";
import express from "express";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GoDebugRoom, GoRoom } from "./rooms/GoRoom";

const port = Number(process.env.PORT) || 2567;
const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("go_custom", GoRoom);
// Separate matchmaking pool for web/debug.html: same rules, but everyone
// starts with enough fireflies to try every market item.
gameServer.define("go_debug", GoDebugRoom);

gameServer.listen(port);
console.log(`GoCalypse server listening on ws://0.0.0.0:${port}`);
