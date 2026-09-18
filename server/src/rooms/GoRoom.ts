import { Room, Client } from "colyseus";
import { GoState, PlayerState } from "../state/GoState";
import { randomGuestName } from "../util/usernames";
import { applyCaptures, boardIndex, isOnBoard, isSuicide, stoneCode, StoneView } from "../rules/goRules";
import { allPowerupIds, getPowerup } from "../powerups/definitions";

interface JoinOptions {
  name?: string;
}

interface MoveMessage {
  x: number;
  y: number;
  axis?: StoneView; // left click -> "base" (default), right click -> "pattern"
}

interface UsePowerupMessage {
  id: string;
  target?: { x: number; y: number };
}

const BOARD_SIZE = 13;
const MAX_PLAYERS = 4;
const STARTING_POWERUPS = allPowerupIds(); // one of each, for now

export class GoRoom extends Room<GoState> {
  maxClients = MAX_PLAYERS;

  onCreate() {
    const state = new GoState();
    state.size = BOARD_SIZE;
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      state.board.push(0);
    }
    this.setState(state);

    this.onMessage("move", (client, message: MoveMessage) => this.handleMove(client, message));
    this.onMessage("usePowerup", (client, message: UsePowerupMessage) =>
      this.handleUsePowerup(client, message)
    );
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    player.name = options?.name?.trim() || randomGuestName();
    player.color = this.state.players.length + 1;
    STARTING_POWERUPS.forEach((id) => player.powerups.push(id));

    this.state.players.push(player);
    this.state.lastEvent = `${player.name} joined as player ${player.color}`;

    if (this.state.players.length === MAX_PLAYERS) {
      this.state.status = "playing";
      this.state.turnIndex = 0;
      // Stop matchmaking from offering this room to fresh joinOrCreate
      // calls once it's in progress. Without this, maxClients only counts
      // real connected sockets -- if a player later disconnects for good,
      // a total stranger's joinOrCreate could land in their now-empty seat
      // mid-game. Reconnection (allowReconnection) bypasses the lock, so a
      // player who actually dropped can still get their own seat back.
      this.lock();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1) return;

    if (this.state.status === "waiting") {
      // Pre-game: don't hold a reconnection grace period. A disconnect here
      // (e.g. a reloaded debug tab) should free the seat immediately so a
      // fresh join can take it -- otherwise the departed session lingers for
      // the full grace window, blocking new joins (maxClients) and then
      // permanently inflating this.state.players.length once it expires,
      // which also hands out invalid colors (> 4) to later joiners.
      this.state.players.splice(playerIndex, 1);
      return;
    }

    const player = this.state.players[playerIndex];
    player.connected = false;

    if (consented) return;

    try {
      await this.allowReconnection(client, 60);
      player.connected = true;
    } catch {
      // Player did not return within the grace period; leave them marked disconnected.
    }
  }

  private findPlayerIndex(sessionId: string): number {
    return this.state.players.findIndex((p) => p.sessionId === sessionId);
  }

  private advanceTurn() {
    this.state.turnCount += 1;
    this.state.turnIndex = (this.state.turnIndex + 1) % this.state.players.length;
  }

  private handleMove(client: Client, message: MoveMessage) {
    if (this.state.status !== "playing") return;

    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1 || playerIndex !== this.state.turnIndex) return;

    const { x, y } = message;
    const axis: StoneView = message.axis === "pattern" ? "pattern" : "base";
    const size = this.state.size;
    if (!isOnBoard(size, x, y)) return;

    const board = this.state.board;
    const idx = boardIndex(size, x, y);
    if (board[idx] !== 0) return;

    const player = this.state.players[playerIndex];
    const code = stoneCode(player.color, axis);
    const rawBoard = board.toArray();

    board[idx] = code;
    rawBoard[idx] = code;

    const captured = applyCaptures(rawBoard, size, x, y, code);
    captured.forEach(({ point }) => {
      board[boardIndex(size, point.x, point.y)] = 0;
    });
    player.score += captured.length;

    if (captured.length === 0 && isSuicide(rawBoard, size, x, y)) {
      board[idx] = 0; // illegal move: revert
      return;
    }

    this.state.lastEvent = `${player.name} played (${x}, ${y})${
      captured.length ? `, captured ${captured.length}` : ""
    }`;
    this.advanceTurn();
  }

  private handleUsePowerup(client: Client, message: UsePowerupMessage) {
    if (this.state.status !== "playing") return;

    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1 || playerIndex !== this.state.turnIndex) return;

    const player = this.state.players[playerIndex];
    const inventoryIndex = player.powerups.findIndex((id) => id === message.id);
    if (inventoryIndex === -1) return;

    const definition = getPowerup(message.id);
    if (!definition) return;

    const applied = definition.apply({
      state: this.state,
      size: this.state.size,
      playerIndex,
      target: message.target,
      broadcast: (event, payload) => this.broadcast(event, payload),
    });

    if (!applied) return;

    player.powerups.splice(inventoryIndex, 1);
    this.state.lastEvent = `${player.name} used ${definition.name}`;
    this.advanceTurn();
  }
}
