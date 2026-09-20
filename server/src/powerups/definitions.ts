import {
  boardIndex,
  canPlaceNeutral,
  DRIFTWOOD,
  findGroup,
  flipStone,
  isOnBoard,
  isPlayerStone,
  ownerOf,
  stoneCode,
  viewsOf,
} from "../rules/goRules";
import { PowerupContext, PowerupDefinition } from "./types";

// Prices by tier. Fireflies come at 3 a stone and 5 a capture, so a tier 1 item
// is a handful of moves' savings and a tier 3 item a serious detour.
//   tier 1 (cozy):        25-40
//   tier 2 (tactical):    45-80
//   tier 3 (powerful):    130-400

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
  tier: 1,
  name: "Driftwood",
  description: "Drop a log on an empty point: a wall on both fronts that no one owns or can capture. Floats away after 3 rounds.",
  price: 30,
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
  tier: 1,
  name: "Lily Pad",
  description: "Reserve an empty point for 3 rounds: only you may place a stone there.",
  price: 40,
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
  tier: 2,
  name: "Lantern Ward",
  description: "Light a lantern over one of your groups: it can't be captured or removed until your next turn.",
  price: 60,
  removal: false,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1) return false;
    const code = ctx.state.board[idx];
    if (!isPlayerStone(code) || ownerOf(code) !== ownColor(ctx)) return false;
    // A twin stone belongs to two groups, one per front: both are warded.
    for (const view of viewsOf(code)) {
      const { group } = findGroup(ctx.state.board.toArray(), ctx.size, ctx.target!.x, ctx.target!.y, view);
      for (const p of group) ctx.addEffect("ward", p.x, p.y, ownColor(ctx), 1);
    }
    return true;
  },
};

const turnLantern: PowerupDefinition = {
  id: "turn_lantern",
  tier: 2,
  name: "Turn the Lantern",
  description: "Flip one of your stones to your other front (black/white <-> gray/transparent). Captures count on the new front.",
  price: 80,
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
  tier: 3,
  name: "Gust",
  description: "Blow away one enemy stone whose group is in atari (down to its last liberty). Once per match.",
  price: 180,
  removal: true,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1 || !isRemovableEnemy(ctx, idx)) return false;
    const code = ctx.state.board[idx];
    const inAtari = viewsOf(code).some(
      (view) => findGroup(ctx.state.board.toArray(), ctx.size, ctx.target!.x, ctx.target!.y, view).liberties === 1
    );
    if (!inAtari) return false;
    ctx.removePieces([idx], ownColor(ctx));
    return true;
  },
};

const removeStone: PowerupDefinition = {
  id: "remove_stone",
  tier: 3,
  name: "Snipe",
  description: "Remove any single enemy stone. Once per match.",
  price: 280,
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
  tier: 3,
  name: "Firework",
  description: "Burst a 3x3 area clear -- your own stones and driftwood too. Warded stones are spared. Once per match.",
  price: 400,
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

// ---- tier 1 ---------------------------------------------------------------------

/** Turns a Firefly Jar stays lit: the rest of the turn it is opened in, and the next three. */
export const JAR_TURNS = 4;

const fireflyJar: PowerupDefinition = {
  id: "firefly_jar",
  tier: 1,
  name: "Firefly Jar",
  description: "Your captures earn double fireflies for the rest of this turn and your next 3. Doesn't use up your turn.",
  price: 25,
  removal: false,
  points: 0,
  free: true,
  apply(ctx) {
    const me = ctx.state.players[ctx.playerIndex];
    if (me.jar > 0) return false; // already lit
    me.jar = JAR_TURNS;
    return true;
  },
};

const seedling: PowerupDefinition = {
  id: "seedling",
  tier: 1,
  name: "Seedling",
  description:
    "Plant a seed on an empty point. After 2 rounds, if the point is still empty and the stone would have a liberty, it grows into your stone.",
  price: 30,
  removal: false,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1 || ctx.state.board[idx] !== 0 || ctx.isBurning(idx)) return false;
    const owner = ctx.lilyOwnerAt(idx);
    if (owner && owner !== ownColor(ctx)) return false;
    const { x, y } = ctx.target!;
    if (ctx.state.effects.some((e) => e.kind === "seed" && e.x === x && e.y === y)) return false;
    ctx.addEffect("seed", x, y, ownColor(ctx), 2);
    return true;
  },
};

const mist: PowerupDefinition = {
  id: "mist",
  tier: 1,
  name: "Mist",
  description:
    "Your next stone is hidden in a mist until the end of the round: the others can't see which front it fights on. Doesn't use up your turn.",
  price: 30,
  removal: false,
  points: 0,
  free: true,
  apply(ctx) {
    const me = ctx.state.players[ctx.playerIndex];
    if (me.mist) return false;
    me.mist = true;
    return true;
  },
};

/** Rounds a Fog lies over the board. */
const FOG_ROUNDS = 2;

const fog: PowerupDefinition = {
  id: "fog",
  tier: 1,
  name: "Fog",
  description:
    "Roll a fog over a 3x3 area for 2 rounds: stones inside can't be captured or removed, and the other players can't see them. No stone can be placed inside it.",
  price: 35,
  removal: false,
  apply(ctx) {
    if (targetIndex(ctx) === -1) return false;
    const { x, y } = ctx.target!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (isOnBoard(ctx.size, x + dx, y + dy)) ctx.addEffect("fog", x + dx, y + dy, ownColor(ctx), FOG_ROUNDS);
      }
    }
    return true;
  },
};

// ---- tier 2 ---------------------------------------------------------------------

const kite: PowerupDefinition = {
  id: "kite",
  tier: 2,
  name: "Kite",
  description:
    "Fly a kite over an enemy stone: only you see what its player is holding and how many fireflies they have. Doesn't use up your turn.",
  price: 45,
  removal: false,
  free: true,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1) return false;
    const code = ctx.state.board[idx];
    if (!isPlayerStone(code) || ownerOf(code) === ownColor(ctx)) return false;
    const rival = ctx.state.players.find((p) => p.color === ownerOf(code));
    if (!rival) return false;
    const items = Array.from(rival.powerups).map((id) => getPowerup(id)?.name ?? id);
    ctx.reveal(`${rival.name}: ${items.length ? items.join(", ") : "an empty satchel"} - ${rival.fireflies} fireflies`);
    return true;
  },
};

const ferry: PowerupDefinition = {
  id: "ferry",
  tier: 2,
  name: "Ferry",
  description: "Move one of your stones one step to an empty point beside it. Captures are judged as if you had played it there.",
  price: 50,
  removal: false,
  points: 2,
  apply(ctx) {
    const from = targetIndex(ctx);
    const { target, target2, size } = ctx;
    if (from === -1 || !target2 || !isOnBoard(size, target2.x, target2.y)) return false;
    const code = ctx.state.board[from];
    if (!isPlayerStone(code) || ownerOf(code) !== ownColor(ctx) || ctx.isWarded(from)) return false;
    if (Math.abs(target!.x - target2.x) + Math.abs(target!.y - target2.y) !== 1) return false;
    ctx.state.board[from] = 0;
    if (ctx.placeStone(target2.x, target2.y, code) === null) {
      ctx.state.board[from] = code; // refused: the stone stays where it was
      return false;
    }
    return true;
  },
};

const skiff: PowerupDefinition = {
  id: "skiff",
  tier: 2,
  name: "Skiff",
  description:
    "Send one of your stones gliding along its row or column to an empty point, as far as the way is clear. Captures are judged as if you had played it there.",
  price: 65,
  removal: false,
  points: 2,
  apply(ctx) {
    const from = targetIndex(ctx);
    const { target, target2, size } = ctx;
    if (from === -1 || !target2 || !isOnBoard(size, target2.x, target2.y)) return false;
    const code = ctx.state.board[from];
    if (!isPlayerStone(code) || ownerOf(code) !== ownColor(ctx) || ctx.isWarded(from)) return false;
    const dx = Math.sign(target2.x - target!.x);
    const dy = Math.sign(target2.y - target!.y);
    if ((dx === 0) === (dy === 0)) return false; // neither the same row nor the same column, or no move at all
    // Every point on the way, and the landing point, must be empty.
    for (let x = target!.x + dx, y = target!.y + dy; ; x += dx, y += dy) {
      if (ctx.state.board[boardIndex(size, x, y)] !== 0) return false;
      if (x === target2.x && y === target2.y) break;
    }
    ctx.state.board[from] = 0;
    if (ctx.placeStone(target2.x, target2.y, code) === null) {
      ctx.state.board[from] = code; // refused: the stone stays where it was
      return false;
    }
    return true;
  },
};

const twinWick: PowerupDefinition = {
  id: "twin_wick",
  tier: 2,
  name: "Twin Wick",
  description:
    "Your next stone fights on both fronts at once: it joins and captures on both, but is lost if either of its groups runs out of liberties. Doesn't use up your turn.",
  price: 70,
  removal: false,
  points: 0,
  free: true,
  apply(ctx) {
    const me = ctx.state.players[ctx.playerIndex];
    if (me.twin) return false;
    me.twin = true;
    return true;
  },
};

// ---- tier 3 ---------------------------------------------------------------------

const riverCurrent: PowerupDefinition = {
  id: "river_current",
  tier: 3,
  name: "River Current",
  description: "Wash away one enemy stone on the edge of the board. Once per match.",
  price: 130,
  removal: true,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1 || !isRemovableEnemy(ctx, idx)) return false;
    const { x, y } = ctx.target!;
    if (x !== 0 && y !== 0 && x !== ctx.size - 1 && y !== ctx.size - 1) return false;
    ctx.removePieces([idx], ownColor(ctx));
    return true;
  },
};

const echoChime: PowerupDefinition = {
  id: "echo_chime",
  tier: 3,
  name: "Echo Chime",
  description:
    "Place a stone on an empty point, and the chime places another for you on the opposite side of the centre point, if that point is free and legal.",
  price: 160,
  removal: false,
  apply(ctx) {
    const idx = targetIndex(ctx);
    if (idx === -1) return false;
    const { x, y } = ctx.target!;
    const code = stoneCode(ownColor(ctx), "base");
    if (ctx.placeStone(x, y, code) === null) return false;
    const mx = ctx.size - 1 - x;
    const my = ctx.size - 1 - y;
    if (mx !== x || my !== y) ctx.placeStone(mx, my, code); // the echo is a bonus: it may simply not sound
    return true;
  },
};

const steppingStones: PowerupDefinition = {
  id: "stepping_stones",
  tier: 3,
  name: "Stepping Stones",
  description: "Place two stones this turn: your next move doesn't end your turn. Doesn't use up your turn.",
  price: 200,
  removal: false,
  points: 0,
  free: true,
  apply(ctx) {
    const me = ctx.state.players[ctx.playerIndex];
    if (me.extra > 0) return false;
    me.extra = 1;
    return true;
  },
};

// Cheap to dear within each tier, tier 1 first: the order the stall reads in.
const REGISTRY = new Map<string, PowerupDefinition>(
  [
    fireflyJar, seedling, mist, fog, driftwood, lilyPad, // tier 1
    kite, ferry, skiff, lanternWard, twinWick, turnLantern, // tier 2
    riverCurrent, echoChime, gust, steppingStones, removeStone, bomb, // tier 3
  ]
    .sort((a, b) => a.tier - b.tier || a.price - b.price)
    .map((p) => [p.id, p])
);

/** How many items of each tier the Night Market stocks in one match. */
export const MARKET_TIER_SLOTS: Record<1 | 2 | 3, number> = { 1: 3, 2: 2, 3: 1 };
export const MARKET_SLOTS = MARKET_TIER_SLOTS[1] + MARKET_TIER_SLOTS[2] + MARKET_TIER_SLOTS[3];

export function getPowerup(id: string): PowerupDefinition | undefined {
  return REGISTRY.get(id);
}

export function allPowerups(): PowerupDefinition[] {
  return Array.from(REGISTRY.values());
}

/**
 * The stock for one match: 3 items of tier 1, 2 of tier 2 and 1 of tier 3,
 * drawn fresh per match. There is one market per room, so every player and bot
 * at the table shops from the same stall. Kept in registry order (tier, then
 * price), so it always reads cheap to dear. Only tier 3 holds removal
 * ("powerful") items, so at most one is ever on sale.
 */
export function marketStock(random: () => number = Math.random): PowerupDefinition[] {
  const all = allPowerups();
  const stock: PowerupDefinition[] = [];
  for (const tier of [1, 2, 3] as const) {
    const pool = all.filter((p) => p.tier === tier);
    const slots = Math.min(MARKET_TIER_SLOTS[tier], pool.length);
    // Partial Fisher-Yates: the first `slots` entries are the draw.
    for (let i = 0; i < slots; i++) {
      const j = i + (Math.floor(random() * (pool.length - i)) % (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      stock.push(pool[i]);
    }
  }
  return stock.sort((a, b) => all.indexOf(a) - all.indexOf(b));
}
