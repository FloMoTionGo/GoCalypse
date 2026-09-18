import { Schema, type, ArraySchema } from "@colyseus/schema";

export class PlayerState extends Schema {
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("number") color: number = 0; // 1-4, assigned on join
  @type("boolean") connected: boolean = true;
  @type("number") score: number = 0;
  @type(["string"]) powerups = new ArraySchema<string>();
}

export class GoState extends Schema {
  @type("number") size: number = 13; // board is size x size
  @type(["number"]) board = new ArraySchema<number>(); // flattened, 0 = empty, 1-4 = player color
  @type([PlayerState]) players = new ArraySchema<PlayerState>();
  @type("number") turnIndex: number = 0; // index into players (turn order)
  @type("string") status: "waiting" | "playing" | "finished" = "waiting";
  @type("number") turnCount: number = 0;
  @type("string") lastEvent: string = ""; // human-readable log of the last action, for client toasts
}
