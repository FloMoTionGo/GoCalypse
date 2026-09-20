import { Client, Delayed, Room } from "colyseus";
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
import { getPowerup, marketStock } from "../powerups/definitions";
import { EffectKind, PowerupContext } from "../powerups/types";
import {
  BotAction,
  BotView,
  chooseAction,
  chooseBuy,
  randomStyle,
  Rng,
  Style,
  temperamentFor,
} from "../bots";
import {
  FIRE_ROUNDS,
  isRollTurn,
  isStormRoll,
  pickStrikes,
  rollDie,
  STORM_EVERY_TURNS,
} from "../rules/storm";

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
const SATCHEL_LIMIT = 5; // items a player may hold at once
const POWERFUL_LIMIT = 1; // removal items a player may hold at once
const DEBUG_STORM_EVERY_TURNS = 6; // debug rooms roll far more often, so storms can be watched
// Bots fill a room that never finds four players, and take over a seat whose
// player is gone for good (ideas.md D-G8).
const BOT_FILL_AFTER_MS = 20_000;
const BOT_THINK_MIN_MS = 700;
const BOT_THINK_SPREAD_MS = 700;

export class GoRoom extends Room<GoState> {
  maxClients = MAX_PLAYERS;
  // Not taken from create options on purpose: Colyseus merges client-supplied
  // options into those, so a client could grant itself fireflies (or weather).
  protected startingFireflies = 0;
  protected stormEvery = STORM_EVERY_TURNS;
  private botTimer?: Delayed;
  private fillTimer?: Delayed;
  private botStyles = new Map<string, Style>();
  // Seeded per room, so two tables never play out the same. Tests drive the
  // bot functions directly with a seed of their own.
  private rng = new Rng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);

  onCreate() {
    const state = new GoState();
    state.size = BOARD_SIZE;
    state.shopAfter = SHOP_AFTER_MOVES;
    state.satchelLimit = SATCHEL_LIMIT;
    state.powerfulLimit = POWERFUL_LIMIT;
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      state.board.push(0);
    }
    // Five stalls, only one of them selling something powerful (drawn per match).
    for (const def of marketStock()) {
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
      this.startGame();
    } else if (!this.fillTimer) {
      // Nobody should sit at an empty table all evening: if the room is still
      // short when this fires, lantern keepers take the free seats.
      this.fillTimer = this.clock.setTimeout(() => this.fillWithBots(), BOT_FILL_AFTER_MS);
    }
  }

  private startGame() {
    this.fillTimer?.clear();
    this.fillTimer = undefined;
    this.state.status = "playing";
    this.state.turnIndex = this.turnOrder()[0];
    // Stop matchmaking from offering this room to fresh joinOrCreate
    // calls once it's in progress. Without this, maxClients only counts
    // real connected sockets -- if a player later disconnects for good,
    // a total stranger's joinOrCreate could land in their now-empty seat
    // mid-game. Reconnection (allowReconnection) bypasses the lock, so a
    // player who actually dropped can still get their own seat back.
    this.lock();
    this.scheduleBotTurn();
  }

  /** Fills the free seats and starts, unless everyone has left by the time it fires. */
  private fillWithBots() {
    this.fillTimer = undefined;
    if (this.state.status !== "waiting" || this.state.players.length === 0) return;
    while (this.state.players.length < MAX_PLAYERS) this.addBot();
    this.startGame();
  }

  private addBot() {
    const taken = new Set(this.state.players.map((p) => p.color));
    const free = [1, 2, 3, 4].filter((c) => !taken.has(c));
    if (free.length === 0) return;

    const style = temperamentFor(this.state.players.length);
    const bot = new PlayerState();
    bot.color = free[this.rng.below(free.length)];
    // Not a session id any socket can hold, so the client's "(you)" test
    // (main.js: player.sessionId === room.sessionId) can never match a bot.
    bot.sessionId = `bot:${bot.color}`;
    bot.bot = true;
    bot.name = style.name;
    bot.fireflies = this.startingFireflies;
    this.botStyles.set(bot.sessionId, style);
    this.state.players.push(bot);
    this.state.lastEvent = `${bot.name} takes a seat`;
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
      // Player did not return within the grace period. A lantern keeper plays
      // the seat rather than leaving the table stalled on someone who will
      // never move again (ideas.md D-G8). They stay marked disconnected, so the
      // client still shows the seat as theirs.
      const style = temperamentFor(playerIndex);
      player.bot = true;
      this.botStyles.set(player.sessionId, style);
      this.state.lastEvent = `${player.name} drifted off; ${style.name} plays the seat`;
      this.scheduleBotTurn();
    }
  }

  onDispose() {
    this.botTimer?.clear();
    this.fillTimer?.clear();
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

  /** Removal ("powerful") items sitting in a player's satchel right now. */
  private powerfulHeld(player: PlayerState): number {
    return player.powerups.filter((id) => getPowerup(id)?.removal).length;
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

  private isBurning(idx: number): boolean {
    return this.effectAt("fire", idx) !== undefined;
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

  /**
   * Runs at every turn change: drifts expired driftwood away, burns out the
   * lightning fires (taking whatever stood in them with them) and lets expired
   * wards lapse.
   */
  private expireEffects() {
    const { board, size, turnCount } = this.state;
    const lapsedWards: number[] = [];
    for (let i = this.state.effects.length - 1; i >= 0; i--) {
      const e = this.state.effects[i];
      if (e.until > turnCount) continue;
      const idx = boardIndex(size, e.x, e.y);
      if (e.kind === "drift" && board[idx] === DRIFTWOOD) board[idx] = 0;
      // The fire goes out and the stone it was eating is gone with it. Its
      // owner gets the same consolation as for a stone removed by an item.
      if (e.kind === "fire" && board[idx] !== 0) this.removePieces([idx], 0);
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
    if (isRollTurn(this.state.turnCount, this.stormEvery)) this.rollForStorm();
    this.scheduleBotTurn();
  }

  // ---- weather ---------------------------------------------------------------

  /**
   * Every `stormEvery` turns a die is rolled out of sight. On a 6 the sky
   * opens: lightning hits up to STORM_MAX_STRIKES random points, and each one
   * catches fire for FIRE_ROUNDS rounds. A stone standing there burns with it
   * and is gone when the fire dies; until then nobody may play on that point.
   * Warded points and points already alight are never struck.
   */
  private rollForStorm() {
    const state = this.state;
    if (state.status !== "playing") return;

    const roll = rollDie();
    state.storm.roll = roll;
    state.storm.rolledAt = state.turnCount;
    if (!isStormRoll(roll)) return;

    const size = state.size;
    const candidates: number[] = [];
    for (let idx = 0; idx < size * size; idx++) {
      if (!this.isWarded(idx) && !this.isBurning(idx)) candidates.push(idx);
    }
    if (candidates.length === 0) return;

    const struck = pickStrikes(candidates);
    let stonesHit = 0;
    for (const idx of struck) {
      const x = idx % size;
      const y = Math.floor(idx / size);
      if (state.board[idx] !== 0) stonesHit += 1;
      this.addEffect("fire", x, y, 0, FIRE_ROUNDS);
    }
    state.storm.strikes = struck.length;
    state.storm.strike0 = struck[0] ?? -1;
    state.storm.strike1 = struck[1] ?? -1;
    state.storm.strike2 = struck[2] ?? -1;
    state.storm.until = state.turnCount + FIRE_ROUNDS * state.players.length;
    state.storm.seq += 1;
    state.lastEvent =
      `A thunderstorm breaks: ${struck.length} lightning strike${struck.length === 1 ? "" : "s"}` +
      `${stonesHit ? `, ${stonesHit} stone${stonesHit === 1 ? "" : "s"} alight` : ""}. ` +
      `The fires burn for ${FIRE_ROUNDS} rounds.`;
  }

  // ---- bots ------------------------------------------------------------------

  /** Everything a bot may see, flattened off the synced state. */
  private botView(playerIndex: number): BotView {
    const player = this.state.players[playerIndex];
    const action = this.state.action;
    return {
      board: this.state.board.toArray(),
      size: this.state.size,
      color: player.color,
      lastMove: action.seq > 0 && action.x >= 0 ? { x: action.x, y: action.y } : null,
      fireflies: player.fireflies,
      moves: player.moves,
      powerups: Array.from(player.powerups),
      bought: Array.from(player.bought),
      shopAfter: this.state.shopAfter,
      market: Array.from(this.state.market).map((m) => ({
        id: m.id,
        price: m.price,
        removal: m.removal,
      })),
      satchelLimit: SATCHEL_LIMIT,
      powerfulLimit: POWERFUL_LIMIT,
      isWarded: (idx) => this.isWarded(idx),
      lilyOwnerAt: (idx) => this.lilyOwnerAt(idx),
      isBurning: (idx) => this.isBurning(idx),
    };
  }

  /**
   * Hands the turn over if the seat on turn is a bot's. The pause before it
   * plays is not decoration: without it four bots resolve a whole round inside
   * one tick and the client's animations (diffTurn) get stampeded.
   */
  private scheduleBotTurn() {
    this.botTimer?.clear();
    this.botTimer = undefined;
    if (this.state.status !== "playing") return;

    const player = this.state.players[this.state.turnIndex];
    if (!player || !player.bot) return;

    // A table of nothing but bots would play on for ever and keep the machine
    // awake -- fly.io only scales to zero while it is idle. Nobody left to
    // watch, so the room closes.
    if (!this.state.players.some((p) => !p.bot)) {
      void this.disconnect();
      return;
    }

    const delay = BOT_THINK_MIN_MS + this.rng.below(BOT_THINK_SPREAD_MS);
    this.botTimer = this.clock.setTimeout(() => this.runBotTurn(), delay);
  }

  private runBotTurn() {
    this.botTimer = undefined;
    if (this.state.status !== "playing") return;

    const playerIndex = this.state.turnIndex;
    const player = this.state.players[playerIndex];
    if (!player || !player.bot) return;

    const style = this.botStyles.get(player.sessionId) ?? temperamentFor(playerIndex);

    // Buying never takes the turn, so it happens first and the action is then
    // chosen from a satchel that already holds what was bought.
    const buy = chooseBuy(this.botView(playerIndex), style);
    if (buy) this.applyBuy(playerIndex, buy);

    const wanted = chooseAction(this.botView(playerIndex), style, this.rng);
    if (this.takeBotAction(playerIndex, wanted) === null) return;

    // The rules had the last word and refused it. Any legal point at all keeps
    // the table moving; a board with nothing legal left on it skips the seat,
    // which is the closest thing to a pass the rules have (ideas.md D-G5).
    const drifter = chooseAction(this.botView(playerIndex), randomStyle(), this.rng);
    if (drifter.kind !== "pass" && this.takeBotAction(playerIndex, drifter) === null) return;

    this.state.lastEvent = `${player.name} sits this one out`;
    this.advanceTurn();
  }

  /** Puts a bot's action through the same path a client's message takes. Null when it was taken. */
  private takeBotAction(playerIndex: number, action: BotAction): string | null {
    if (action.kind === "move") {
      return this.applyMove(playerIndex, { x: action.x, y: action.y, axis: action.axis });
    }
    if (action.kind === "powerup") {
      return this.applyUsePowerup(playerIndex, { id: action.id, target: action.target });
    }
    return "pass";
  }

  // ---- messages --------------------------------------------------------------
  //
  // Each message handler resolves the seat from the socket and then hands off
  // to an `apply*` addressed by seat alone, so a bot takes its turn through
  // exactly the code a client does. The apply side returns null when the action
  // was taken, and otherwise why it was refused -- an empty string for the
  // silent refusals a client is never told about.

  private handleMove(client: Client, message: MoveMessage) {
    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1) return;
    const refused = this.applyMove(playerIndex, message);
    if (refused) this.notice(client, refused);
  }

  private applyMove(playerIndex: number, message: MoveMessage): string | null {
    if (!message || typeof message !== "object") return "";
    if (this.state.status !== "playing") return "";
    if (playerIndex !== this.state.turnIndex) return "";

    const { x, y } = message;
    const axis: StoneView = message.axis === "pattern" ? "pattern" : "base";
    const size = this.state.size;
    if (!isOnBoard(size, x, y)) return "";

    const board = this.state.board;
    const idx = boardIndex(size, x, y);
    if (board[idx] !== 0) return "";

    const player = this.state.players[playerIndex];
    if (this.isBurning(idx)) return "That point is still burning after the storm.";
    const lily = this.lilyOwnerAt(idx);
    if (lily && lily !== player.color) return "That point is reserved by someone's lily pad.";

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
      return "No liberties there -- that stone would be captured at once.";
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
    return null;
  }

  private handleBuy(client: Client, message: BuyMessage) {
    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1) return;
    const refused = this.applyBuy(playerIndex, message?.id);
    if (refused) this.notice(client, refused);
  }

  private applyBuy(playerIndex: number, id: string | undefined): string | null {
    if (typeof id !== "string") return "";
    if (this.state.status !== "playing") return "";
    const player = this.state.players[playerIndex];

    const definition = getPowerup(id);
    // Only what this match's market actually stocks: the registry still holds
    // all seven items, but five are on sale (see marketStock).
    if (!definition || !this.state.market.some((m) => m.id === definition.id)) return "";

    if (player.moves < this.state.shopAfter) {
      return `The Night Market opens after ${this.state.shopAfter} moves.`;
    }
    if (definition.removal && player.bought.indexOf(definition.id) !== -1) {
      return `${definition.name} can only be bought once per match.`;
    }
    if (player.powerups.length >= SATCHEL_LIMIT) {
      return `Your satchel only holds ${SATCHEL_LIMIT} items. Use something first.`;
    }
    if (definition.removal && this.powerfulHeld(player) >= POWERFUL_LIMIT) {
      return `You can only carry ${POWERFUL_LIMIT} powerful item at a time.`;
    }
    if (player.fireflies < definition.price) {
      return `Not enough fireflies for ${definition.name}.`;
    }

    player.fireflies -= definition.price;
    player.powerups.push(definition.id);
    if (definition.removal) player.bought.push(definition.id);
    this.state.lastEvent = `${player.name} bought ${definition.name}`;
    return null;
  }

  private handleUsePowerup(client: Client, message: UsePowerupMessage) {
    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1) return;
    const refused = this.applyUsePowerup(playerIndex, message);
    if (refused) this.notice(client, refused);
  }

  private applyUsePowerup(playerIndex: number, message: UsePowerupMessage): string | null {
    if (!message || typeof message.id !== "string") return "";
    if (this.state.status !== "playing") return "";
    if (playerIndex !== this.state.turnIndex) return "";

    const player = this.state.players[playerIndex];
    const inventoryIndex = player.powerups.findIndex((id) => id === message?.id);
    if (inventoryIndex === -1) return "";

    const definition = getPowerup(message.id);
    if (!definition) return "";

    const t = message.target;
    const target = t && typeof t.x === "number" && typeof t.y === "number" ? { x: t.x, y: t.y } : undefined;
    const ctx: PowerupContext = {
      state: this.state,
      size: this.state.size,
      playerIndex,
      target,
      isWarded: (idx) => this.isWarded(idx),
      lilyOwnerAt: (idx) => this.lilyOwnerAt(idx),
      isBurning: (idx) => this.isBurning(idx),
      addEffect: (kind, x, y, owner, rounds) => this.addEffect(kind, x, y, owner, rounds),
      removePieces: (indices, byColor) => this.removePieces(indices, byColor),
      creditCaptures: (count) => {
        player.score += count;
        player.fireflies += FIREFLIES_PER_CAPTURE * count;
      },
    };

    if (!definition.apply(ctx)) {
      return `${definition.name} can't be used there.`;
    }

    player.powerups.splice(inventoryIndex, 1);
    this.recordAction("powerup", definition.id, target!.x, target!.y, player.color);
    this.state.lastEvent = `${player.name} used ${definition.name}`;
    this.advanceTurn();
    return null;
  }
}

/**
 * Same rules in a separate matchmaking pool (web/debug.html): everyone starts
 * rich enough to try the whole market, and the sky is rolled far more often so
 * a thunderstorm can actually be watched in a test session.
 */
export class GoDebugRoom extends GoRoom {
  protected startingFireflies = 600;
  protected stormEvery = DEBUG_STORM_EVERY_TURNS;
}
