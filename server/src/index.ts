import http from "http";
import express from "express";
import { Server } from "colyseus";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { GoRoom } from "./rooms/GoRoom";

const port = Number(process.env.PORT) || 2567;
const app = express();
app.use(express.json());

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

const httpServer = http.createServer(app);
const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

gameServer.define("go_custom", GoRoom);

gameServer.listen(port);
console.log(`GoCalypse server listening on ws://0.0.0.0:${port}`);
