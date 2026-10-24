import { Captured } from "../rules/goRules";
import { GoState } from "../state/GoState";

export type EffectKind = "ward" | "lily" | "drift" | "fire" | "seed" | "mist" | "fog";

export interface PowerupContext {
  state: GoState;
  size: number;
  playerIndex: number; // index into state.players of whoever is using the powerup
  target?: { x: number; y: number };
  /** Second point for items that take two (Ferry: where the stone goes). */
  target2?: { x: number; y: number };
  /** Which stone view the use asks for (Seedling: what the seed grows into). Default "base". */
  axis?: "base" | "pattern";
  /** Cell is inside an active Lantern Ward: can't be captured or removed. */
  isWarded(idx: number): boolean;
  /** Whom this cell is kept for: the owner of a Lily Pad, or of a seed past its first round; else 0. */
  lilyOwnerAt(idx: number): number;
  /** Cell is burning after a lightning strike: nothing may be placed on it. */
  isBurning(idx: number): boolean;
  /** Adds a timed board marker lasting `rounds` full rounds from now. */
  addEffect(kind: EffectKind, x: number, y: number, owner: number, rounds: number, axis?: "base" | "pattern"): void;
  /**
   * Clears these cells (stones or driftwood). Owners of removed player stones
   * other than `byColor` get consolation fireflies. Returns how many were removed.
   */
  removePieces(indices: number[], byColor: number): number;
  /**
   * Credits captures made by this powerup to the user: score, fireflies, and a
   * prisoner on each dead group's own front (rules/endgame.ts).
   */
  creditCaptures(captured: Captured[]): void;
  /**
   * Puts a stone with this board code on an empty point as if it had been
   * played: captures are made and credited to the user, and it is refused
   * (null, board untouched) if the point is burning or reserved by someone
   * else's lily pad or seed, the stone would have no liberties, or it breaks a ko rule
   * a move would (repeats a position, or takes back a held ko). Returns the
   * number of captures. It does not touch the turn or open a ko.
   */
  placeStone(x: number, y: number, code: number): number | null;
  /** Tells the user something only they should see (Kite). */
  reveal(text: string): void;
  /**
   * Lures a river creature to this edge point with a Bait (rules/river.ts): the
   * nearer one walks over to face it, its timer unchanged. False when it may
   * not: nothing is out, the point is off the ring or already faced, or the new
   * reach holds another player's stone the creature could take.
   */
  lureCreature?(idx: number): boolean;
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
  /** On sale in every match, beside the stalls drawn for it (the Bait). */
  always?: boolean;
  /** Return false to reject the use (e.g. invalid target) without consuming it. */
  apply(ctx: PowerupContext): boolean;
}
