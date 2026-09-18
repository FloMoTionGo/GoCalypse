import { boardIndex, isOnBoard } from "../rules/goRules";
import { PowerupContext, PowerupDefinition } from "./types";

// Example powerups. Add new ones here and register them below — the room
// and client don't need to know about specific powerups, only the registry.

const bomb: PowerupDefinition = {
  id: "bomb",
  name: "Bomb",
  description: "Clears every stone in a 3x3 area around the target cell.",
  apply(ctx: PowerupContext): boolean {
    const { state, size, target, broadcast } = ctx;
    if (!target || !isOnBoard(size, target.x, target.y)) return false;

    let cleared = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = target.x + dx;
        const y = target.y + dy;
        if (!isOnBoard(size, x, y)) continue;
        const idx = boardIndex(size, x, y);
        if (state.board[idx] !== 0) {
          state.board[idx] = 0;
          cleared += 1;
        }
      }
    }

    broadcast("powerup:bomb", { target, cleared });
    return true;
  },
};

const removeStone: PowerupDefinition = {
  id: "remove_stone",
  name: "Snipe",
  description: "Removes a single enemy stone from the board.",
  apply(ctx: PowerupContext): boolean {
    const { state, size, target, playerIndex, broadcast } = ctx;
    if (!target || !isOnBoard(size, target.x, target.y)) return false;

    const idx = boardIndex(size, target.x, target.y);
    const stone = state.board[idx];
    const ownColor = state.players[playerIndex].color;
    // No color is fully "allied" anymore (every distinct pair rivals on at
    // least one view) -- only exact self-stones are protected.
    if (stone === 0 || stone === ownColor) return false;

    state.board[idx] = 0;
    broadcast("powerup:remove_stone", { target, removedColor: stone });
    return true;
  },
};

const REGISTRY = new Map<string, PowerupDefinition>(
  [bomb, removeStone].map((p) => [p.id, p])
);

export function getPowerup(id: string): PowerupDefinition | undefined {
  return REGISTRY.get(id);
}

export function allPowerupIds(): string[] {
  return Array.from(REGISTRY.keys());
}
