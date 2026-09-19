import { GoState } from "../state/GoState";

export type EffectKind = "ward" | "lily" | "drift";

export interface PowerupContext {
  state: GoState;
  size: number;
  playerIndex: number; // index into state.players of whoever is using the powerup
  target?: { x: number; y: number };
  /** Cell is inside an active Lantern Ward: can't be captured or removed. */
  isWarded(idx: number): boolean;
  /** Owner color of an active Lily Pad on this cell, or 0. */
  lilyOwnerAt(idx: number): number;
  /** Adds a timed board marker lasting `rounds` full rounds from now. */
  addEffect(kind: EffectKind, x: number, y: number, owner: number, rounds: number): void;
  /**
   * Clears these cells (stones or driftwood). Owners of removed player stones
   * other than `byColor` get consolation fireflies. Returns how many were removed.
   */
  removePieces(indices: number[], byColor: number): number;
  /** Credits captures made by this powerup to the user (score + fireflies). */
  creditCaptures(count: number): void;
}

export interface PowerupDefinition {
  id: string;
  name: string;
  description: string;
  price: number; // fireflies at the Night Market
  removal: boolean; // removes stones: priced high and limited to one purchase per match
  /** Return false to reject the use (e.g. invalid target) without consuming it. */
  apply(ctx: PowerupContext): boolean;
}
