import {
  axisOf,
  boardIndex,
  canPlaceNeutral,
  DRIFTWOOD,
  findGroup,
  flipStone,
  isOnBoard,
  isPlayerStone,
  ownerOf,
} from "../rules/goRules";
import { PowerupContext, PowerupDefinition } from "./types";

// The Night Market's stock. Add a powerup by defining it here and adding it
// to REGISTRY -- the room builds the market from this list, and the client
// renders whatever the market holds (it only needs a sprite for new ids).
// Every item targets one board cell, and using one takes your turn.

function targetIndex(ctx: PowerupContext): number {
  const { target, size } = ctx;
  if (!target || !isOnBoard(size, target.x, target.y)) return -1;
  return boardIndex(size, target.x, target.y);
}

function ownColor(ctx: PowerupContext): number {
  return ctx.state.players[ctx.playerIndex].color;
}

/** A rival's stone that nothing shields: the only thing removal items may hit. */
function isRemovableEnemy(ctx: PowerupContext, idx: number): boolean {
  const code = ctx.state.board[idx];
  return isPlayerStone(code) && ownerOf(code) !== ownColor(ctx) && !ctx.isWarded(idx);
}

const driftwood: PowerupDefinition = {
  id: "driftwood",
  name: "Driftwood",
  description: "Drop a log on an empty point: a wall on both fronts that no one owns or can capture. Floats away after 3 rounds.",
  price: 15,
  removal: false,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1 || ctx.lilyOwnerAt(idx) || ctx.isBurning(idx)) return false;
    if (!canPlaceNeutral(ctx.state.board.toArray(), ctx.size, ctx.target!.x, ctx.target!.y)) return false;
    ctx.state.board[idx] = DRIFTWOOD;
    ctx.addEffect("drift", ctx.target!.x, ctx.target!.y, 0, 3);
    return true;
  },
};

const lilyPad: PowerupDefinition = {
  id: "lily_pad",
  name: "Lily Pad",
  description: "Reserve an empty point for 3 rounds: only you may place a stone there.",
  price: 20,
  removal: false,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1 || ctx.state.board[idx] !== 0 || ctx.lilyOwnerAt(idx) || ctx.isBurning(idx)) return false;
    ctx.addEffect("lily", ctx.target!.x, ctx.target!.y, ownColor(ctx), 3);
    return true;
  },
};

const lanternWard: PowerupDefinition = {
  id: "lantern_ward",
  name: "Lantern Ward",
  description: "Light a lantern over one of your groups: it can't be captured or removed until your next turn.",
  price: 30,
  removal: false,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1) return false;
    const code = ctx.state.board[idx];
    if (!isPlayerStone(code) || ownerOf(code) !== ownColor(ctx)) return false;
    const { group } = findGroup(ctx.state.board.toArray(), ctx.size, ctx.target!.x, ctx.target!.y, axisOf(code));
    for (const p of group) ctx.addEffect("ward", p.x, p.y, ownColor(ctx), 1);
    return true;
  },
};

const turnLantern: PowerupDefinition = {
  id: "turn_lantern",
  name: "Turn the Lantern",
  description: "Flip one of your stones to your other front (solid <-> grey pattern). Captures count on the new front.",
  price: 40,
  removal: false,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1) return false;
    const code = ctx.state.board[idx];
    if (!isPlayerStone(code) || ownerOf(code) !== ownColor(ctx)) return false;
    const raw = ctx.state.board.toArray();
    const captured = flipStone(raw, ctx.size, ctx.target!.x, ctx.target!.y, (i) => ctx.isWarded(i));
    if (!captured) return false;
    for (let i = 0; i < raw.length; i++) {
      if (ctx.state.board[i] !== raw[i]) ctx.state.board[i] = raw[i];
    }
    ctx.creditCaptures(captured.length);
    return true;
  },
};

const gust: PowerupDefinition = {
  id: "gust",
  name: "Gust",
  description: "Blow away one enemy stone whose group is in atari (down to its last liberty). Once per match.",
  price: 90,
  removal: true,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1 || !isRemovableEnemy(ctx, idx)) return false;
    const code = ctx.state.board[idx];
    const { liberties } = findGroup(ctx.state.board.toArray(), ctx.size, ctx.target!.x, ctx.target!.y, axisOf(code));
    if (liberties !== 1) return false;
    ctx.removePieces([idx], ownColor(ctx));
    return true;
  },
};

const removeStone: PowerupDefinition = {
  id: "remove_stone",
  name: "Snipe",
  description: "Remove any single enemy stone. Once per match.",
  price: 140,
  removal: true,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1 || !isRemovableEnemy(ctx, idx)) return false;
    ctx.removePieces([idx], ownColor(ctx));
    return true;
  },
};

const bomb: PowerupDefinition = {
  id: "bomb",
  name: "Firework",
  description: "Burst a 3x3 area clear -- your own stones and driftwood too. Warded stones are spared. Once per match.",
  price: 200,
  removal: true,
  apply(ctx) {
    if (targetIndex(ctx) === -1) return false;
    const { size, target } = ctx;
    const cells: number[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = target!.x + dx;
        const y = target!.y + dy;
        if (!isOnBoard(size, x, y)) continue;
        const idx = boardIndex(size, x, y);
        if (ctx.state.board[idx] !== 0 && !ctx.isWarded(idx)) cells.push(idx);
      }
    }
    if (cells.length === 0) return false; // nothing to burst: keep the item
    ctx.removePieces(cells, ownColor(ctx));
    return true;
  },
};

const REGISTRY = new Map<string, PowerupDefinition>(
  [driftwood, lilyPad, lanternWard, turnLantern, gust, removeStone, bomb].map((p) => [p.id, p])
);

/** How many items the Night Market stocks in one match, and how many of them may be removal items. */
export const MARKET_SLOTS = 5;
export const MARKET_REMOVAL_SLOTS = 1;

export function getPowerup(id: string): PowerupDefinition | undefined {
  return REGISTRY.get(id);
}

export function allPowerups(): PowerupDefinition[] {
  return Array.from(REGISTRY.values());
}

/**
 * The stock for one match: MARKET_SLOTS items, of which at most
 * MARKET_REMOVAL_SLOTS are removal ("powerful") items. Which powerful item
 * is on sale is drawn fresh per match, so Gust, Snipe and Firework take
 * turns rather than all three being available at once. Registry order is
 * kept, so the stall always reads cheap to dear.
 */
export function marketStock(random: () => number = Math.random): PowerupDefinition[] {
  const all = allPowerups();
  const removal = all.filter((p) => p.removal);
  const chosen = new Set(
    removal.length ? [removal[Math.floor(random() * removal.length) % removal.length].id] : []
  );
  const stock: PowerupDefinition[] = [];
  for (const p of all) {
    if (p.removal && !chosen.has(p.id)) continue;
    stock.push(p);
  }
  // Trim from the plain items if the registry ever outgrows the stall.
  while (stock.length > MARKET_SLOTS) {
    const cut = stock.map((p, i) => ({ p, i })).filter((e) => !e.p.removal).pop();
    if (!cut) break;
    stock.splice(cut.i, 1);
  }
  return stock;
}
