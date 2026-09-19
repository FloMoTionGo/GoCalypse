import { Room, Client } from "colyseus";
import { BoardEffect, GoState, MarketItem, PlayerState } from "../state/GoState";
import { randomGuestName } from "../util/usernames";
import {
  applyCaptures,
  axisOf,
  boardIndex,
  DRIFTWOOD,
  findGroup,
  isOnBoard,
  isPlayerStone,
  isSuicide,
  ownerOf,
  stoneCode,
  StoneView,
} from "../rules/goRules";
import { allPowerups, getPowerup } from "../powerups/definitions";
import { EffectKind, PowerupContext } from "../powerups/types";

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

interface BuyMessage {
  id: string;
}

const BOARD_SIZE = 13;
const MAX_PLAYERS = 4;
const SHOP_AFTER_MOVES = 5;
const FIREFLIES_PER_MOVE = 3;
const FIREFLIES_PER_CAPTURE = 5;
const CONSOLATION_PER_STONE = 3; // paid to the owner of a stone removed by someone's item

export class GoRoom extends Room<GoState> {
  maxClients = MAX_PLAYERS;
  // Not taken from create options on purpose: Colyseus merges client-supplied
  // options into those, so a client could grant itself fireflies.
  protected startingFireflies = 0;

  onCreate() {
    const state = new GoState();
    state.size = BOARD_SIZE;
    state.shopAfter = SHOP_AFTER_MOVES;
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      state.board.push(0);
    }
    for (const def of allPowerups()) {
      const item = new MarketItem();
      item.id = def.id;
      item.name = def.name;
      item.description = def.description;
      item.price = def.price;
      item.removal = def.removal;
      state.market.push(item);
    }
    this.setState(state);

    this.onMessage("move", (client, message: MoveMessage) => this.handleMove(client, message));
    this.onMessage("usePowerup", (client, message: UsePowerupMessage) =>
      this.handleUsePowerup(client, message)
    );
    this.onMessage("buy", (client, message: BuyMessage) => this.handleBuy(client, message));
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new PlayerState();
    player.sessionId = client.sessionId;
    const name = typeof options?.name === "string" ? options.name.trim().slice(0, 24) : "";
    player.name = name || randomGuestName();
    player.fireflies = this.startingFireflies;

    // A random color/pattern combo that nobody in the room holds yet, so
    // every game deals the pairings anew and no combo is ever doubled.
    // (Turns go by combo, 1 -> 4, so this also shuffles who moves first.)
    const taken = new Set(this.state.players.map((p) => p.color));
    const free = [1, 2, 3, 4].filter((c) => !taken.has(c));
    player.color = free.length ? free[Math.floor(Math.random() * free.length)] : this.state.players.length + 1;
    this.state.players.push(player);
    this.state.lastEvent = `${player.name} joined as player ${player.color}`;

    if (this.state.players.length === MAX_PLAYERS) {
      this.state.status = "playing";
      this.state.turnIndex = this.turnOrder()[0];
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

  // Defining this makes Colyseus wrap every handler in try/catch. Without it,
  // a throw inside a message handler escapes into the WebSocket event loop
  // and takes down the whole process -- every room on the server.
  onUncaughtException(error: Error, methodName: string) {
    console.error(`GoRoom ${this.roomId}: uncaught error in ${methodName}:`, error);
  }

  private findPlayerIndex(sessionId: string): number {
    return this.state.players.findIndex((p) => p.sessionId === sessionId);
  }

  private notice(client: Client, text: string) {
    client.send("notice", text);
  }

  private recordAction(kind: string, id: string, x: number, y: number, player: number) {
    const action = this.state.action;
    action.seq += 1;
    action.kind = kind;
    action.id = id;
    action.x = x;
    action.y = y;
    action.player = player;
  }

  // ---- timed board effects ---------------------------------------------------

  private effectAt(kind: EffectKind, idx: number): BoardEffect | undefined {
    const size = this.state.size;
    for (const e of this.state.effects) {
      if (e.kind === kind && boardIndex(size, e.x, e.y) === idx && e.until > this.state.turnCount) return e;
    }
    return undefined;
  }

  private isWarded(idx: number): boolean {
    return this.effectAt("ward", idx) !== undefined;
  }

  private lilyOwnerAt(idx: number): number {
    return this.effectAt("lily", idx)?.owner ?? 0;
  }

  private addEffect(kind: EffectKind, x: number, y: number, owner: number, rounds: number) {
    const effect = new BoardEffect();
    effect.kind = kind;
    effect.x = x;
    effect.y = y;
    effect.owner = owner;
    effect.until = this.state.turnCount + rounds * this.state.players.length;
    this.state.effects.push(effect);
  }

  private removeEffectsAt(kind: EffectKind, idx: number) {
    const size = this.state.size;
    for (let i = this.state.effects.length - 1; i >= 0; i--) {
      const e = this.state.effects[i];
      if (e.kind === kind && boardIndex(size, e.x, e.y) === idx) this.state.effects.splice(i, 1);
    }
  }

  /** Runs at every turn change: drifts expired driftwood away and lets expired wards lapse. */
  private expireEffects() {
    const { board, size, turnCount } = this.state;
    const lapsedWards: number[] = [];
    for (let i = this.state.effects.length - 1; i >= 0; i--) {
      const e = this.state.effects[i];
      if (e.until > turnCount) continue;
      const idx = boardIndex(size, e.x, e.y);
      if (e.kind === "drift" && board[idx] === DRIFTWOOD) board[idx] = 0;
      if (e.kind === "ward") lapsedWards.push(idx);
      this.state.effects.splice(i, 1);
    }

    // A ward can keep a group alive with no liberties left. Once it lapses,
    // that group is taken off the board (credited to no one).
    const raw = board.toArray();
    for (const idx of lapsedWards) {
      const code = raw[idx];
      if (!isPlayerStone(code) || this.isWarded(idx)) continue;
      const { group, liberties } = findGroup(raw, size, idx % size, Math.floor(idx / size), axisOf(code));
      if (liberties > 0 || group.some((p) => this.isWarded(boardIndex(size, p.x, p.y)))) continue;
      for (const p of group) {
        const pIdx = boardIndex(size, p.x, p.y);
        raw[pIdx] = 0;
        board[pIdx] = 0;
      }
    }
  }

  /** Clears cells for a removal item; pays consolation to the owners of removed stones. */
  private removePieces(indices: number[], byColor: number): number {
    const board = this.state.board;
    let removed = 0;
    for (const idx of indices) {
      const code = board[idx];
      if (code === 0) continue;
      if (code === DRIFTWOOD) {
        this.removeEffectsAt("drift", idx);
      } else {
        const owner = ownerOf(code);
        const victim = this.state.players.find((p) => p.color === owner);
        if (victim && owner !== byColor) victim.fireflies += CONSOLATION_PER_STONE;
      }
      board[idx] = 0;
      removed += 1;
    }
    return removed;
  }

  /**
   * Player indices in turn order: by color (1 -> 2 -> 3 -> 4), so turns
   * alternate black and white whatever order people joined in. (The array
   * itself stays in join order: reordering an ArraySchema in the same patch
   * as a push corrupts client state.)
   */
  private turnOrder(): number[] {
    return this.state.players
      .map((p, i) => ({ color: p.color, i }))
      .sort((a, b) => a.color - b.color)
      .map((o) => o.i);
  }

  private advanceTurn() {
    this.state.turnCount += 1;
    const order = this.turnOrder();
    this.state.turnIndex = order[(order.indexOf(this.state.turnIndex) + 1) % order.length];
    this.expireEffects();
  }

  // ---- messages --------------------------------------------------------------

  private handleMove(client: Client, message: MoveMessage) {
    if (!message || typeof message !== "object") return;
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
    const lily = this.lilyOwnerAt(idx);
    if (lily && lily !== player.color) {
      this.notice(client, "That point is reserved by someone's lily pad.");
      return;
    }

    const code = stoneCode(player.color, axis);
    const rawBoard = board.toArray();

    board[idx] = code;
    rawBoard[idx] = code;

    const captured = applyCaptures(rawBoard, size, x, y, code, (i) => this.isWarded(i));
    captured.forEach(({ point }) => {
      board[boardIndex(size, point.x, point.y)] = 0;
    });

    if (captured.length === 0 && isSuicide(rawBoard, size, x, y)) {
      board[idx] = 0; // illegal move: revert
      this.notice(client, "No liberties there -- that stone would be captured at once.");
      return;
    }

    if (lily) this.removeEffectsAt("lily", idx);
    player.score += captured.length;
    player.moves += 1;
    player.fireflies += FIREFLIES_PER_MOVE + FIREFLIES_PER_CAPTURE * captured.length;

    this.recordAction("move", "", x, y, player.color);
    this.state.lastEvent = `${player.name} played (${x}, ${y})${
      captured.length ? `, captured ${captured.length}` : ""
    }`;
    this.advanceTurn();
  }

  private handleBuy(client: Client, message: BuyMessage) {
    if (!message || typeof message.id !== "string") return;
    if (this.state.status !== "playing") return;
    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1) return;
    const player = this.state.players[playerIndex];

    const definition = getPowerup(message?.id);
    if (!definition) return;

    if (player.moves < this.state.shopAfter) {
      this.notice(client, `The Night Market opens after ${this.state.shopAfter} moves.`);
      return;
    }
    if (definition.removal && player.bought.indexOf(definition.id) !== -1) {
      this.notice(client, `${definition.name} can only be bought once per match.`);
      return;
    }
    if (player.fireflies < definition.price) {
      this.notice(client, `Not enough fireflies for ${definition.name}.`);
      return;
    }

    player.fireflies -= definition.price;
    player.powerups.push(definition.id);
    if (definition.removal) player.bought.push(definition.id);
    this.state.lastEvent = `${player.name} bought ${definition.name}`;
  }

  private handleUsePowerup(client: Client, message: UsePowerupMessage) {
    if (!message || typeof message.id !== "string") return;
    if (this.state.status !== "playing") return;

    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1 || playerIndex !== this.state.turnIndex) return;

    const player = this.state.players[playerIndex];
    const inventoryIndex = player.powerups.findIndex((id) => id === message?.id);
    if (inventoryIndex === -1) return;

    const definition = getPowerup(message.id);
    if (!definition) return;

    const t = message.target;
    const target = t && typeof t.x === "number" && typeof t.y === "number" ? { x: t.x, y: t.y } : undefined;
    const ctx: PowerupContext = {
      state: this.state,
      size: this.state.size,
      playerIndex,
      target,
      isWarded: (idx) => this.isWarded(idx),
      lilyOwnerAt: (idx) => this.lilyOwnerAt(idx),
      addEffect: (kind, x, y, owner, rounds) => this.addEffect(kind, x, y, owner, rounds),
      removePieces: (indices, byColor) => this.removePieces(indices, byColor),
      creditCaptures: (count) => {
        player.score += count;
        player.fireflies += FIREFLIES_PER_CAPTURE * count;
      },
    };

    if (!definition.apply(ctx)) {
      this.notice(client, `${definition.name} can't be used there.`);
      return;
    }

    player.powerups.splice(inventoryIndex, 1);
    this.recordAction("powerup", definition.id, target!.x, target!.y, player.color);
    this.state.lastEvent = `${player.name} used ${definition.name}`;
    this.advanceTurn();
  }
}

/** Same rules in a separate matchmaking pool (web/debug.html): everyone starts rich enough to try the whole market. */
export class GoDebugRoom extends GoRoom {
  protected startingFireflies = 600;
}
