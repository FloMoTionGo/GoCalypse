import { GoState } from "../state/GoState";

export type EffectKind = "ward" | "lily" | "drift" | "fire" | "seed" | "mist" | "fog";

export interface PowerupContext {
  state: GoState;
  size: number;
  playerIndex: number; // index into state.players of whoever is using the powerup
  target?: { x: number; y: number };
  /** Second point for items that take two (Ferry: where the stone goes). */
  target2?: { x: number; y: number };
  /** Cell is inside an active Lantern Ward: can't be captured or removed. */
  isWarded(idx: number): boolean;
  /** Owner color of an active Lily Pad on this cell, or 0. */
  lilyOwnerAt(idx: number): number;
  /** Cell is burning after a lightning strike: nothing may be placed on it. */
  isBurning(idx: number): boolean;
  /** Adds a timed board marker lasting `rounds` full rounds from now. */
  addEffect(kind: EffectKind, x: number, y: number, owner: number, rounds: number): void;
  /**
   * Clears these cells (stones or driftwood). Owners of removed player stones
   * other than `byColor` get consolation fireflies. Returns how many were removed.
   */
  removePieces(indices: number[], byColor: number): number;
  /** Credits captures made by this powerup to the user (score + fireflies). */
  creditCaptures(count: number): void;
  /**
   * Puts a stone with this board code on an empty point as if it had been
   * played: captures are made and credited to the user, and it is refused
   * (null, board untouched) if the point is burning or reserved by someone
   * else's lily pad, or the stone would have no liberties. Returns the number
   * of captures. It does not touch the turn or the ko history.
   */
  placeStone(x: number, y: number, code: number): number | null;
  /** Tells the user something only they should see (Kite). */
  reveal(text: string): void;
}

export interface PowerupDefinition {
  id: string;
  name: string;
  description: string;
  tier: 1 | 2 | 3; // the market stocks 3 / 2 / 1 items of tiers 1 / 2 / 3 per match
  price: number; // fireflies at the Night Market
  removal: boolean; // removes stones: priced high and limited to one purchase per match
  /** Board points the use needs: 0 (nothing), 1 (the default) or 2 (Ferry). */
  points?: 0 | 1 | 2;
  /** True when using it does not take the turn (the player still moves afterwards). */
  free?: boolean;
  /** Return false to reject the use (e.g. invalid target) without consuming it. */
  apply(ctx: PowerupContext): boolean;
}
