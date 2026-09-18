import { GoState } from "../state/GoState";

export interface PowerupContext {
  state: GoState;
  size: number;
  playerIndex: number; // index into state.players of whoever is using the powerup
  target?: { x: number; y: number };
  broadcast: (event: string, payload: unknown) => void;
}

export interface PowerupDefinition {
  id: string;
  name: string;
  description: string;
  /** Return false to reject the use (e.g. invalid target) without consuming it. */
  apply(ctx: PowerupContext): boolean;
}
