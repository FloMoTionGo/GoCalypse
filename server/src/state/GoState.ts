import { Schema, type, ArraySchema } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("number") color: number = 0; // 1-4, assigned on join
  @type("boolean") connected: boolean = true;
  @type("boolean") bot: boolean = false; // a seat played by the server, not a socket
  @type("number") score: number = 0; // stones captured
  @type("number") fireflies: number = 0; // market currency, earned this match
  @type("number") moves: number = 0; // stones placed; the market opens after GoState.shopAfter
  // Filled in once when the game ends (rules/endgame.ts); all 0 until then.
  @type("number") baseArea: number = 0; // area of this player's base side (black or white)
  @type("number") patternArea: number = 0; // area of this player's pattern side (dots or stripes)
  @type("number") finalScore: number = 0; // the lower of the two
  @type("number") tiebreak: number = 0; // the higher of the two
  @type("number") place: number = 0; // 1 = winner; players level on both numbers share a place
  @type(["string"]) powerups = new ArraySchema<string>(); // owned, unused items (bought at the market)
  @type(["string"]) bought = new ArraySchema<string>(); // removal items already bought this match (once each)
}

/** One item the Night Market sells. Filled from the powerup registry on room creation. */
export class MarketItem extends Schema {
  @type("string") id: string = "";
  @type("string") name: string = "";
  @type("string") description: string = "";
  @type("number") price: number = 0;
  @type("boolean") removal: boolean = false; // removes stones: pricey, once per match
}

/** A timed marker on a board cell. Ends when GoState.turnCount reaches `until`. */
export class BoardEffect extends Schema {
  @type("string") kind: string = ""; // "ward" | "lily" | "drift" | "fire"
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") owner: number = 0; // player color, 0 = nobody
  @type("number") until: number = 0;
}

/**
 * The last thunderstorm. `seq` changes only when a new storm breaks, which is
 * what the client watches to start its 10-second cloudburst. The strike points
 * are three plain fields rather than an array: at most three bolts ever fall,
 * and fixed fields can't run into the ArraySchema patching quirks that bit us
 * with `players` (see state.md).
 */
export class StormState extends Schema {
  @type("number") seq: number = 0;
  @type("number") roll: number = 0; // the last die roll (1-6); 6 means a storm
  @type("number") rolledAt: number = 0; // turnCount of that roll
  @type("number") until: number = 0; // turnCount when the fires go out
  @type("number") strikes: number = 0; // how many bolts fell (0-3)
  @type("number") strike0: number = -1; // board indices, in the order they were struck
  @type("number") strike1: number = -1;
  @type("number") strike2: number = -1;
}

/** The most recent move or powerup use, so clients can pick the matching animation. */
export class LastAction extends Schema {
  @type("number") seq: number = 0;
  @type("string") kind: string = ""; // "move" | "powerup"
  @type("string") id: string = ""; // powerup id for kind "powerup"
  @type("number") x: number = -1;
  @type("number") y: number = -1;
  @type("number") player: number = 0; // color of whoever acted
}

export class GoState extends Schema {
  @type("number") size: number = 13; // board is size x size
  @type(["number"]) board = new ArraySchema<number>(); // flattened; codes documented in rules/goRules.ts
  @type([PlayerState]) players = new ArraySchema<PlayerState>();
  @type("number") turnIndex: number = 0; // index into players (turn order)
  @type("string") status: "waiting" | "playing" | "finished" = "waiting";
  @type("number") turnCount: number = 0;
  @type("number") passes: number = 0; // passes in a row; the game ends when every player has passed
  @type("string") lastEvent: string = ""; // human-readable log of the last action, for client toasts
  @type("number") shopAfter: number = 5; // a player's market opens after this many placed stones
  @type("number") satchelLimit: number = 5; // items a player may hold at once
  @type("number") powerfulLimit: number = 1; // removal items a player may hold at once
  @type([MarketItem]) market = new ArraySchema<MarketItem>();
  @type([BoardEffect]) effects = new ArraySchema<BoardEffect>();
  @type(LastAction) action = new LastAction();
  @type(StormState) storm = new StormState();
}
