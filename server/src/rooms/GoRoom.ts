import { Client, Delayed, Room } from "colyseus";
import { BoardEffect, GoState, MarketItem, PlayerState } from "../state/GoState";
import { randomGuestName } from "../util/usernames";
import { deleteSnapshot, restoreState, saveSnapshot, takeRestore } from "../state/persist";
import {
  applyCaptures,
  axisOf,
  isTwin,
  twinCode,
  viewsOf,
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
import { areaScore, finalResults } from "../rules/endgame";
import { PositionHistory } from "../rules/ko";
import { getPowerup, marketStock } from "../powerups/definitions";
import { EffectKind, PowerupContext } from "../powerups/types";
import {
  BotAction,
  BotView,
  chooseAction,
  chooseBuy,
  randomStyle,
  recruitStyle,
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
  stormChance,
  stormLevel,
} from "../rules/storm";

interface JoinOptions {
  name?: string;
  playerKey?: string; // secret the browser tab keeps, to win its seat back after a disconnect or restart
}

interface MoveMessage {
  x: number;
  y: number;
  axis?: StoneView; // left click -> "base" (default), right click -> "pattern"
}

interface UsePowerupMessage {
  id: string;
  target?: { x: number; y: number };
  target2?: { x: number; y: number }; // second point, for items that take two (Ferry)
}

interface BuyMessage {
  id: string;
}

interface AddBotsMessage {
  ids?: unknown; // recruit ids from bots/styles.ts, at most 3
}

const BOARD_SIZE = 13;
const MAX_PLAYERS = 4;
// Later seats move later, so they start with fireflies: SEAT_BONUS per place in the
// turn order (0, 5, 10, 15). Under the cheapest item's price, so no one shops on it alone.
export const SEAT_BONUS = 5;
const MAX_BOTS = 3; // bots a table may be given in all, from any mix of kinds
const SHOP_AFTER_MOVES = 5;
const FIREFLIES_PER_MOVE = 3;
const FIREFLIES_PER_CAPTURE = 5;
const CONSOLATION_PER_STONE = 3; // paid to the owner of a stone removed by someone's item
const SATCHEL_LIMIT = 5; // items a player may hold at once
const POWERFUL_LIMIT = 1; // removal items a player may hold at once
const DEBUG_STORM_EVERY_TURNS = 6; // debug rooms roll far more often, so storms can be watched
// Bots are only ever seated on request (the welcome screen's "add bots"), or to
// take over a seat whose player is gone for good (ideas.md D-G8).
const BOT_THINK_MIN_MS = 700;
const BOT_THINK_SPREAD_MS = 700;
const SAVE_EVERY_MS = 1000;
// After a restart nobody is connected. Seats not claimed back within this long
// are handed to lantern keepers, as for a player who drops mid-game.
const RESTORE_GRACE_MS = 120_000;

/** Rooms alive in this process, so /rejoin can find the one a returning player belongs to. */
const liveRooms = new Set<GoRoom>();

export function findRoomForKey(key: string): GoRoom | undefined {
  for (const room of liveRooms) if (room.seatFor(key)) return room;
  return undefined;
}

function cleanKey(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 64) : "";
}

export class GoRoom extends Room<GoState> {
  maxClients = MAX_PLAYERS;
  // Not taken from create options on purpose: Colyseus merges client-supplied
  // options into those, so a client could grant itself fireflies (or weather).
  protected startingFireflies = 0;
  protected shopAfterMoves = SHOP_AFTER_MOVES;
  protected stormEvery = STORM_EVERY_TURNS;
  private botTimer?: Delayed;
  private botStyles = new Map<string, Style>();
  private seatKeys = new Map<number, string>(); // player color -> that player's secret; see state/persist.ts
  private lastSaved = "";
  private shuttingDown = false;
  // Every board position so far, for the ko rule (rules/ko.ts).
  private positions = new PositionHistory();
  // Seeded per room, so two tables never play out the same. Tests drive the
  // bot functions directly with a seed of their own.
  private rng = new Rng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);

  onCreate(options?: { restoreToken?: string }) {
    const restored = takeRestore(options?.restoreToken);
    const state = new GoState();
    state.size = BOARD_SIZE;
    state.shopAfter = this.shopAfterMoves;
    state.satchelLimit = SATCHEL_LIMIT;
    state.powerfulLimit = POWERFUL_LIMIT;
    state.storm.every = this.stormEvery;
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
      state.board.push(0);
    }
    this.positions.record(state.board.toArray());
    // Six stalls: 3 of tier 1, 2 of tier 2 and 1 of tier 3, drawn per match and the same for everyone at the table.
    for (const def of marketStock()) {
      const item = new MarketItem();
      item.id = def.id;
      item.name = def.name;
      item.description = def.description;
      item.price = def.price;
      item.removal = def.removal;
      item.tier = def.tier;
      item.points = def.points ?? 1;
      item.free = !!def.free;
      state.market.push(item);
    }
    if (restored) {
      restoreState(state, restored.state);
      // Earlier positions are not saved, so ko only remembers from here on.
      this.positions.record(state.board.toArray());
      for (const [color, key] of Object.entries(restored.keys)) this.seatKeys.set(Number(color), key);
    }
    this.setState(state);
    this.updateForecast();
    liveRooms.add(this);
    this.clock.setInterval(() => this.saveSnapshot(), SAVE_EVERY_MS);

    this.onMessage("move", (client, message: MoveMessage) => this.handleMove(client, message));
    this.onMessage("usePowerup", (client, message: UsePowerupMessage) =>
      this.handleUsePowerup(client, message)
    );
    this.onMessage("buy", (client, message: BuyMessage) => this.handleBuy(client, message));
    this.onMessage("pass", (client) => this.handlePass(client));
    this.onMessage("addBots", (client, message: AddBotsMessage) => this.handleAddBots(client, message));

    if (restored) this.resumeRestored();
  }

  /** The seat a returning player's secret opens, if any: a human seat in a game under way. */
  seatFor(key: string): PlayerState | undefined {
    if (!key || this.state.status !== "playing") return undefined;
    return this.state.players.find((p) => !p.bot && this.seatKeys.get(p.color) === key);
  }

  /**
   * A room rebuilt from disk has no sockets yet: every human seat waits for its
   * player to come back through /rejoin. The room must not be disposed as empty
   * while it waits, and seats still unclaimed afterwards are handed to bots.
   */
  private resumeRestored() {
    for (const player of this.state.players) if (!player.bot) player.connected = false;
    this.lock();
    this.autoDispose = false;
    this.saveSnapshot();
    this.scheduleBotTurn();
    this.clock.setTimeout(() => {
      this.autoDispose = true; // disposes the room if nobody came back
      this.state.players.forEach((player, i) => {
        if (!player.bot && !player.connected) this.seatToBot(player, i);
      });
    }, RESTORE_GRACE_MS);
  }

  /** Writes the game to disk when it has changed; a finished game is no longer worth keeping. */
  private saveSnapshot() {
    if (this.shuttingDown) return;
    if (this.state.status === "finished") return deleteSnapshot(this.roomId);
    if (this.state.status !== "playing") return;
    const json = JSON.stringify({
      room: this.roomName,
      keys: Object.fromEntries(this.seatKeys),
      state: this.state.toJSON(),
    });
    if (json === this.lastSaved) return;
    try {
      saveSnapshot(this.roomId, json);
      this.lastSaved = json;
    } catch (err) {
      console.error(`GoRoom ${this.roomId}: could not save snapshot:`, err);
    }
  }

  onJoin(client: Client, options: JoinOptions) {
    const key = cleanKey(options?.playerKey);
    const seat = this.seatFor(key);
    if (seat) {
      // Back after a dropped connection or a server restart: same seat, new socket.
      seat.sessionId = client.sessionId;
      seat.connected = true;
      this.state.lastEvent = `${seat.name} is back`;
      return;
    }

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
    if (key) this.seatKeys.set(player.color, key);
    this.state.lastEvent = `${player.name} joined as player ${player.color}`;

    if (this.state.players.length === MAX_PLAYERS) this.startGame();
  }

  private startGame() {
    this.turnOrder().forEach((playerIndex, seat) => {
      this.state.players[playerIndex].fireflies += SEAT_BONUS * seat;
    });
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

  /** Seats a bot with this style in a free seat. False when the table is already full. */
  private addBot(style: Style): boolean {
    const taken = new Set(this.state.players.map((p) => p.color));
    const free = [1, 2, 3, 4].filter((c) => !taken.has(c));
    if (free.length === 0) return false;

    const bot = new PlayerState();
    bot.color = free[this.rng.below(free.length)];
    // Not a session id any socket can hold, so the client's "(you)" test
    // (main.js: player.sessionId === room.sessionId) can never match a bot.
    bot.sessionId = `bot:${bot.color}`;
    bot.bot = true;
    bot.name = this.freeName(style.name);
    bot.fireflies = this.startingFireflies;
    this.botStyles.set(bot.sessionId, style);
    this.state.players.push(bot);
    this.state.lastEvent = `${bot.name} takes a seat`;
    return true;
  }

  /** `base`, or `base 2`, `base 3`... when a seat already has that name, so two Reeds are told apart. */
  private freeName(base: string): string {
    const names = new Set(this.state.players.map((p) => p.name));
    if (!names.has(base)) return base;
    for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  }

  /**
   * "Add bots", from the home screen or the welcome screen: a seated player
   * asks for bots by recruit id while the room is still waiting for its fourth
   * player. The same id may repeat, so a table can hold up to three of one
   * kind, but never more than MAX_BOTS bots in all, however they were asked
   * for, and never more than the free seats, so it can never overfill the
   * table. Seats it leaves empty stay open for other players (or a second
   * request). Bots give the sender nothing, so there is nothing to abuse in
   * asking twice.
   */
  private handleAddBots(client: Client, message: AddBotsMessage) {
    if (this.state.status !== "waiting") return;
    if (this.findPlayerIndex(client.sessionId) === -1) return;
    const ids = Array.isArray(message?.ids) ? message.ids : [];

    const seated = this.state.players.filter((p) => p.bot).length;
    const room = Math.min(MAX_BOTS - seated, MAX_PLAYERS - this.state.players.length);
    let added = 0;
    for (const id of ids.slice(0, MAX_BOTS)) {
      if (added >= room) break;
      const style = typeof id === "string" ? recruitStyle(id) : null;
      if (style && this.addBot(style)) added += 1;
    }
    if (added > 0 && this.state.players.length === MAX_PLAYERS) this.startGame();
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
      this.seatKeys.delete(this.state.players[playerIndex].color);
      this.state.players.splice(playerIndex, 1);
      return;
    }

    const player = this.state.players[playerIndex];
    player.connected = false;

    if (this.state.status === "playing" && consented) {
      // Left on purpose: a random bot takes the seat at once (a table of nothing
      // but bots then closes in scheduleBotTurn).
      this.seatToBot(player, playerIndex, true);
      return;
    }
    if (consented) return;

    try {
      await this.allowReconnection(client, 60);
      player.connected = true;
    } catch {
      // The seat may have been won back through /rejoin on a new socket meanwhile.
      if (player.sessionId !== client.sessionId) return;
      this.seatToBot(player, playerIndex);
    }
  }

  /**
   * Player did not return within the grace period. A lantern keeper plays
   * the seat rather than leaving the table stalled on someone who will
   * never move again (ideas.md D-G8). They stay marked disconnected, so the
   * client still shows the seat as theirs.
   */
  private seatToBot(player: PlayerState, playerIndex: number, left = false) {
    const style = left ? randomStyle() : temperamentFor(playerIndex);
    player.bot = true;
    this.botStyles.set(player.sessionId, style);
    this.state.lastEvent = left
      ? `${player.name} left; ${style.name} plays the seat`
      : `${player.name} drifted off; ${style.name} plays the seat`;
    this.scheduleBotTurn();
  }

  // Saves the game one last time, then lets the shutdown go on: the disconnects
  // it causes must not overwrite the snapshot, nor onDispose delete it.
  onBeforeShutdown() {
    this.saveSnapshot();
    this.shuttingDown = true;
    super.onBeforeShutdown();
  }

  onDispose() {
    this.botTimer?.clear();
    liveRooms.delete(this);
    if (!this.shuttingDown) deleteSnapshot(this.roomId);
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
    const grownSeeds: { x: number; y: number; owner: number }[] = [];
    for (let i = this.state.effects.length - 1; i >= 0; i--) {
      const e = this.state.effects[i];
      if (e.until > turnCount) continue;
      const idx = boardIndex(size, e.x, e.y);
      if (e.kind === "drift" && board[idx] === DRIFTWOOD) board[idx] = 0;
      // The fire goes out and the stone it was eating is gone with it. Its
      // owner gets the same consolation as for a stone removed by an item.
      if (e.kind === "fire" && board[idx] !== 0) this.removePieces([idx], 0);
      if (e.kind === "ward") lapsedWards.push(idx);
      if (e.kind === "seed") grownSeeds.push({ x: e.x, y: e.y, owner: e.owner });
      this.state.effects.splice(i, 1);
    }

    // A seed that is still on an empty point grows into its planter's stone, if
    // that stone would be legal there; otherwise it withers. Placed after the
    // effects are cleared, so a lily pad or ward that lapsed in the same turn no
    // longer counts.
    for (const seed of grownSeeds) {
      const planter = this.state.players.findIndex((p) => p.color === seed.owner);
      if (planter === -1) continue;
      const grew = this.placeStoneFor(planter, seed.x, seed.y, stoneCode(seed.owner, "base"));
      if (grew !== null) this.state.lastEvent = `A seed of ${this.state.players[planter].name} grows into a stone`;
    }

    // A ward can keep a group alive with no liberties left. Once it lapses,
    // that group is taken off the board (credited to no one).
    const raw = board.toArray();
    for (const idx of lapsedWards) {
      const code = raw[idx];
      if (!isPlayerStone(code) || this.isWarded(idx)) continue;
      for (const view of viewsOf(code)) {
        if (!isPlayerStone(raw[idx])) break; // already taken with its other group
        const { group, liberties } = findGroup(raw, size, idx % size, Math.floor(idx / size), view);
        if (liberties > 0 || group.some((p) => this.isWarded(boardIndex(size, p.x, p.y)))) continue;
        for (const p of group) {
          const pIdx = boardIndex(size, p.x, p.y);
          raw[pIdx] = 0;
          board[pIdx] = 0;
        }
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
    const leaving = this.state.players[this.state.turnIndex];
    if (leaving) {
      if (leaving.jar > 0) leaving.jar -= 1;
      leaving.extra = 0; // an unused second stone is lost with the turn
    }
    this.state.turnCount += 1;
    const order = this.turnOrder();
    this.state.turnIndex = order[(order.indexOf(this.state.turnIndex) + 1) % order.length];
    this.expireEffects();
    this.positions.record(this.state.board.toArray());
    if (isRollTurn(this.state.turnCount, this.stormEvery)) this.rollForStorm();
    this.scheduleBotTurn();
  }

  // ---- weather ---------------------------------------------------------------

  /**
   * Every `stormEvery` turns a D20 is rolled out of sight, plus one for every
   * calm roll since the last storm. At 20 the sky opens: lightning hits up to
   * STORM_MAX_STRIKES random points, and each one catches fire for FIRE_ROUNDS
   * rounds. A stone standing there burns with it and is gone when the fire
   * dies; until then nobody may play on that point. Warded points and points
   * already alight are never struck.
   */
  private rollForStorm() {
    const state = this.state;
    if (state.status !== "playing") return;

    const roll = rollDie();
    state.storm.roll = roll;
    state.storm.rolledAt = state.turnCount;

    const size = state.size;
    const candidates: number[] = [];
    for (let idx = 0; idx < size * size; idx++) {
      if (!this.isWarded(idx) && !this.isBurning(idx)) candidates.push(idx);
    }
    if (!isStormRoll(roll, state.storm.calm) || candidates.length === 0) {
      state.storm.calm += 1; // calm: the next roll is likelier
      this.updateForecast();
      return;
    }
    state.storm.calm = 0;
    this.updateForecast();

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

  /** Puts the chance of the next roll breaking a storm, in numbers and in words, where clients can read it. */
  private updateForecast() {
    const storm = this.state.storm;
    storm.chance = Math.round(stormChance(storm.calm) * 100);
    storm.level = stormLevel(storm.calm);
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
      repeats: (board) => this.positions.repeats(board),
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
    // the table moving; a board with nothing legal left on it makes the seat pass.
    const drifter = chooseAction(this.botView(playerIndex), randomStyle(), this.rng);
    if (drifter.kind !== "pass" && this.takeBotAction(playerIndex, drifter) === null) return;

    this.applyPass(playerIndex);
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

    // Twin Wick: this stone fights on both fronts, whichever button was pressed.
    const code = player.twin ? twinCode(player.color) : stoneCode(player.color, axis);
    const rawBoard = board.toArray();

    rawBoard[idx] = code;

    // Judged on a copy, so a refused move never touches the synced board.
    const captured = applyCaptures(rawBoard, size, x, y, code, (i) => this.isWarded(i));

    if (captured.length === 0 && isSuicide(rawBoard, size, x, y)) {
      return "No liberties there -- that stone would be captured at once.";
    }
    if (this.positions.repeats(rawBoard)) {
      return "Ko: that would bring back a board position that has stood before.";
    }

    board[idx] = code;
    captured.forEach(({ point }) => {
      board[boardIndex(size, point.x, point.y)] = 0;
    });

    if (lily) this.removeEffectsAt("lily", idx);
    player.score += captured.length;
    player.moves += 1;
    player.fireflies += FIREFLIES_PER_MOVE + this.captureFireflies(player, captured.length);
    this.clearPasses();

    if (player.twin) player.twin = false;
    if (player.mist) {
      player.mist = false;
      this.addEffect("mist", x, y, player.color, 1);
    }

    this.recordAction("move", "", x, y, player.color);
    this.state.lastEvent = `${player.name} played (${x}, ${y})${
      captured.length ? `, captured ${captured.length}` : ""
    }`;
    if (player.extra > 0) {
      // Stepping Stones: this stone was the first of two, so the turn stays put.
      player.extra -= 1;
      this.state.lastEvent += " -- and moves again";
      this.positions.record(this.state.board.toArray());
      this.scheduleBotTurn(); // a seat taken over by a bot mid-turn still has to play its second stone
      return null;
    }
    this.advanceTurn();
    return null;
  }

  /** Fireflies for `count` captures, doubled while the player's Firefly Jar is lit. */
  private captureFireflies(player: PlayerState, count: number): number {
    return FIREFLIES_PER_CAPTURE * count * (player.jar > 0 ? 2 : 1);
  }

  /**
   * Puts a stone on an empty point for an item (Ferry, Echo Chime, a growing
   * seed): captures are made and credited, and it is refused (null, nothing
   * changed) when the point is burning, reserved by someone else's lily pad, or
   * the stone would have no liberties. It leaves the turn and the ko history
   * alone.
   */
  private placeStoneFor(playerIndex: number, x: number, y: number, code: number): number | null {
    const size = this.state.size;
    if (!isOnBoard(size, x, y)) return null;
    const idx = boardIndex(size, x, y);
    const board = this.state.board;
    if (board[idx] !== 0 || this.isBurning(idx)) return null;
    const player = this.state.players[playerIndex];
    const lily = this.lilyOwnerAt(idx);
    if (lily && lily !== player.color) return null;

    const raw = board.toArray();
    raw[idx] = code;
    const captured = applyCaptures(raw, size, x, y, code, (i) => this.isWarded(i));
    if (captured.length === 0 && isSuicide(raw, size, x, y)) return null;

    board[idx] = code;
    for (const { point } of captured) board[boardIndex(size, point.x, point.y)] = 0;
    if (lily) this.removeEffectsAt("lily", idx);
    player.score += captured.length;
    player.fireflies += this.captureFireflies(player, captured.length);
    return captured.length;
  }

  /** A stone or an item ends the run of passes: every seat may play on again. */
  private clearPasses() {
    this.state.passes = 0;
    for (const p of this.state.players) p.passed = false;
  }

  private handlePass(client: Client) {
    const playerIndex = this.findPlayerIndex(client.sessionId);
    if (playerIndex === -1) return;
    const refused = this.applyPass(playerIndex);
    if (refused) this.notice(client, refused);
  }

  /**
   * Passing takes the turn and places nothing. A stone or an item played in
   * between resets the count; once every seat has passed in a row the game ends.
   */
  private applyPass(playerIndex: number): string | null {
    if (this.state.status !== "playing") return "";
    if (playerIndex !== this.state.turnIndex) return "";

    const state = this.state;
    const player = state.players[playerIndex];
    state.passes += 1;
    player.passed = true;
    if (state.passes >= state.players.length) {
      this.finishGame();
      return null;
    }
    state.lastEvent = `${player.name} passed (${state.passes} of ${state.players.length} in a row)`;
    this.advanceTurn();
    return null;
  }

  /** Scores the board as it stands (rules/endgame.ts) and closes the game. */
  private finishGame() {
    const state = this.state;
    this.botTimer?.clear();
    this.botTimer = undefined;

    const results = finalResults(
      areaScore(state.board.toArray(), state.size),
      state.players.map((p) => p.color)
    );
    state.players.forEach((player, i) => {
      player.baseArea = results[i].base;
      player.patternArea = results[i].pattern;
      player.finalScore = results[i].score;
      player.tiebreak = results[i].tiebreak;
      player.place = results[i].place;
    });

    // Turns stop here, so a storm still in its three rounds would leave its
    // weather hanging over the final board for good.
    if (state.storm.until > state.turnCount) state.storm.until = state.turnCount;
    state.status = "finished";

    const winners = state.players.filter((p) => p.place === 1);
    state.lastEvent =
      `Game over: ${winners.map((p) => p.name).join(", ")} ` +
      `${winners.length === 1 ? "wins" : "share first place"} with ${winners[0].finalScore}.`;
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
    // every item, but only six are on sale (see marketStock).
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
    const t2 = message.target2;
    const target2 = t2 && typeof t2.x === "number" && typeof t2.y === "number" ? { x: t2.x, y: t2.y } : undefined;
    const points = definition.points ?? 1;
    if (points >= 1 && !target) return `${definition.name} needs a point on the board.`;
    if (points >= 2 && !target2) return `${definition.name} needs a second point.`;
    const ctx: PowerupContext = {
      state: this.state,
      size: this.state.size,
      playerIndex,
      target: points >= 1 ? target : undefined,
      target2: points >= 2 ? target2 : undefined,
      isWarded: (idx) => this.isWarded(idx),
      lilyOwnerAt: (idx) => this.lilyOwnerAt(idx),
      isBurning: (idx) => this.isBurning(idx),
      addEffect: (kind, x, y, owner, rounds) => this.addEffect(kind, x, y, owner, rounds),
      removePieces: (indices, byColor) => this.removePieces(indices, byColor),
      creditCaptures: (count) => {
        player.score += count;
        player.fireflies += this.captureFireflies(player, count);
      },
      placeStone: (x, y, code) => this.placeStoneFor(playerIndex, x, y, code),
      reveal: (text) => {
        if (player.bot) return;
        this.clients.getById(player.sessionId)?.send("reveal", text);
      },
    };

    if (!definition.apply(ctx)) {
      return `${definition.name} can't be used there.`;
    }

    player.powerups.splice(inventoryIndex, 1);
    if (definition.free) {
      // Costs nothing but the item: no turn, no reset of the passes, no animation.
      this.state.lastEvent = `${player.name} used ${definition.name}`;
      return null;
    }
    this.clearPasses();
    // The action's point is where something lands: the destination for a Ferry.
    const at = (definition.points ?? 1) >= 2 ? target2! : target!;
    this.recordAction("powerup", definition.id, at.x, at.y, player.color);
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
  protected startingFireflies = 1200;
  protected shopAfterMoves = 0; // the market is open from the first turn
  protected stormEvery = DEBUG_STORM_EVERY_TURNS;
}
