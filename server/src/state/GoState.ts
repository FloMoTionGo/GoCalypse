import { Schema, type, ArraySchema } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("number") color: number = 0; // 1-4, assigned on join
  @type("boolean") connected: boolean = true;
  @type("number") score: number = 0; // stones captured
  @type("number") fireflies: number = 0; // market currency, earned this match
  @type("number") moves: number = 0; // stones placed; the market opens after GoState.shopAfter
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
  @type("string") kind: string = ""; // "ward" | "lily" | "drift"
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") owner: number = 0; // player color, 0 = nobody
  @type("number") until: number = 0;
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
  @type("string") lastEvent: string = ""; // human-readable log of the last action, for client toasts
  @type("number") shopAfter: number = 5; // a player's market opens after this many placed stones
  @type([MarketItem]) market = new ArraySchema<MarketItem>();
  @type([BoardEffect]) effects = new ArraySchema<BoardEffect>();
  @type(LastAction) action = new LastAction();
}
