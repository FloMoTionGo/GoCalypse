import { Schema, type, ArraySchema } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("number") color: number = 0; // 1-4, assigned on join
  @type("boolean") connected: boolean = true;
  @type("boolean") bot: boolean = false; // a seat played by the server, not a socket
  @type("boolean") passed: boolean = false; // passed in the current run of passes (reset by any stone or item)
  @type("number") jar: number = 0; // turns of double capture fireflies left (Firefly Jar)
  @type("boolean") mist: boolean = false; // the next stone is played in a mist (Mist)
  @type("boolean") twin: boolean = false; // the next stone fights on both fronts (Twin Wick)
  @type("number") extra: number = 0; // 1 while the next stone is a free extra one (Stepping Stones)
  @type("number") score: number = 0; // stones captured
  // Prisoners: stones this player captured, split by the front the dead group
  // was judged on. Counted all match (not just at the end) and added to that
  // front total when the board is scored (rules/endgame.ts).
  @type("number") basePrisoners: number = 0;
  @type("number") patternPrisoners: number = 0;
  @type("number") fireflies: number = 0; // market currency, earned this match
  @type("number") moves: number = 0; // stones placed; the market opens after GoState.shopAfter
  // Filled in once when the game ends (rules/endgame.ts); all 0 until then.
  @type("number") baseTerritory: number = 0; // territory of this player's base side (black or white)
  @type("number") patternTerritory: number = 0; // territory of this player's pattern side (gray or transparent)
  @type("number") finalScore: number = 0; // the lower of (territory + prisoners) on each front
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
  @type("number") tier: number = 1; // 1 cozy, 2 tactical, 3 powerful
  @type("number") points: number = 1; // board points the use needs: 0, 1 or 2
  @type("boolean") free: boolean = false; // using it does not take the turn
}

/** A timed marker on a board cell. Ends when GoState.turnCount reaches `until`. */
export class BoardEffect extends Schema {
  @type("string") kind: string = ""; // "ward" | "lily" | "drift" | "fire"
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") owner: number = 0; // player color, 0 = nobody
  @type("number") until: number = 0;
  @type("string") axis: string = "base"; // seeds only: which stone view grows ("base" | "pattern")
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
  @type("number") roll: number = 0; // the last D20 roll (0 before the first one)
  @type("number") rolledAt: number = 0; // turnCount of that roll
  @type("number") every: number = 20; // a roll is made every this many turns
  @type("number") calm: number = 0; // calm rolls since the last storm; each adds 1 to the next roll
  @type("number") chance: number = 5; // percent chance that the next roll breaks a storm
  @type("string") level: string = "unlikely"; // that chance in words: unlikely | likely | very likely
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
  // Filled in once when the game ends (rules/endgame.ts territoryOwners), one entry
  // per board point: 0 (none/stone/dame), else the SIDE_CODE of the side that
  // settled it on that front (base: black 1 / white 2; pattern: gray 3 / transparent 4).
  // Empty (length 0) until then.
  @type(["number"]) baseTerritoryOwner = new ArraySchema<number>();
  @type(["number"]) patternTerritoryOwner = new ArraySchema<number>();
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
