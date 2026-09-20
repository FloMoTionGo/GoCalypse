import {
  axisOf,
  boardIndex,
  canPlaceNeutral,
  DRIFTWOOD,
  findGroup,
  flipStone,
  isOnBoard,
  isPlayerStone,
  neighbors,
  ownerOf,
  Point,
} from "../rules/goRules";
import { AXES, BotView, Candidate, fightsUs, pointOf, scoreMove } from "./scoring";
import { Style } from "./styles";

// The Night Market, from a bot's side of the counter.
//
// Buying is free; using takes the turn. So every item is priced in the same
// hundredths of a point as a stone move (scoring.ts) and the two compete
// directly: an item is used only when it beats the best point on the board by
// the Style's `itemBias`. Each planner returns its best target or null, and
// every one of them re-checks the rules itself -- a use that the room refuses
// keeps the item but wastes the tick, and a bot that leans on that would stall
// the table.

export interface ItemPlan {
  id: string;
  target: Point;
  score: number;
}

function better(a: ItemPlan | null, b: ItemPlan | null): ItemPlan | null {
  if (!a) return b;
  if (!b) return a;
  return b.score > a.score ? b : a;
}

function isOwnStone(view: BotView, idx: number): boolean {
  const code = view.board[idx];
  return isPlayerStone(code) && ownerOf(code) === view.color;
}

function isRivalStone(view: BotView, idx: number): boolean {
  const code = view.board[idx];
  return isPlayerStone(code) && ownerOf(code) !== view.color && !view.isWarded(idx);
}

/** The one empty point left to a group already down to its last liberty. */
function soleLiberty(view: BotView, group: Point[]): Point | null {
  for (const p of group) {
    for (const n of neighbors(view.size, p.x, p.y)) {
      if (view.board[boardIndex(view.size, n.x, n.y)] === 0) return n;
    }
  }
  return null;
}

/**
 * Lantern Ward -- a group of ours on its last liberty survives one more round.
 * Only for groups worth the turn: a single stone is cheaper to replace than to
 * save, and the ward buys a round, not a rescue (when it lapses with no
 * liberties the group comes off anyway).
 */
function planWard(view: BotView, style: Style): ItemPlan | null {
  let best: ItemPlan | null = null;
  const seen = new Set<number>();

  for (let idx = 0; idx < view.board.length; idx++) {
    if (!isOwnStone(view, idx) || seen.has(idx)) continue;
    const p = pointOf(view.size, idx);
    const axis = axisOf(view.board[idx]);
    const { group, liberties } = findGroup(view.board, view.size, p.x, p.y, axis);
    for (const g of group) seen.add(boardIndex(view.size, g.x, g.y));
    if (liberties !== 1 || group.length < 2) continue;
    best = better(best, { id: "lantern_ward", target: p, score: style.save * group.length });
  }
  return best;
}

/**
 * Gust -- one enemy stone off a group in atari. Skipped when we could simply
 * play that group's last liberty instead: a capture takes the whole group and
 * pays 5 fireflies a stone, where Gust takes one stone and the turn.
 */
function planGust(view: BotView, style: Style): ItemPlan | null {
  let best: ItemPlan | null = null;
  const seen = new Set<number>();

  for (let idx = 0; idx < view.board.length; idx++) {
    if (!isRivalStone(view, idx) || seen.has(idx)) continue;
    const p = pointOf(view.size, idx);
    const code = view.board[idx];
    const axis = axisOf(code);
    const { group, liberties } = findGroup(view.board, view.size, p.x, p.y, axis);
    for (const g of group) seen.add(boardIndex(view.size, g.x, g.y));
    if (liberties !== 1) continue; // the rules require atari

    // A liberty is a liberty whoever fills it, so the group can be taken with
    // a stone on either front. If one of those is legal for us, take it and
    // keep the item: a capture lifts the whole group and pays 5 fireflies a
    // stone, where Gust lifts one stone and costs the turn.
    const liberty = soleLiberty(view, group);
    if (liberty && AXES.some((a) => scoreMove(view, liberty.x, liberty.y, a, style) !== null)) {
      continue;
    }

    // Half value against a stone on our own side of its front: removing it
    // does the work of whichever seat is actually pressing that group.
    const worth = fightsUs(view, code) ? style.capture : Math.trunc(style.capture / 2);
    best = better(best, { id: "gust", target: p, score: worth });
  }
  return best;
}

/** How many of our own stones a removal at `idx` would pull back out of atari. */
function rescuedByRemoving(view: BotView, idx: number): number {
  const trial = view.board.slice();
  trial[idx] = 0;
  const p = pointOf(view.size, idx);
  const seen = new Set<number>();
  let rescued = 0;

  for (const n of neighbors(view.size, p.x, p.y)) {
    const nIdx = boardIndex(view.size, n.x, n.y);
    if (!isOwnStone(view, nIdx) || seen.has(nIdx)) continue;
    const axis = axisOf(view.board[nIdx]);
    const before = findGroup(view.board, view.size, n.x, n.y, axis);
    const after = findGroup(trial, view.size, n.x, n.y, axis);
    for (const g of after.group) seen.add(boardIndex(view.size, g.x, g.y));
    if (before.liberties === 1 && after.liberties > 1) rescued += after.group.length;
  }
  return rescued;
}

/** Snipe -- any one rival stone. 140 fireflies, so it wants to be the stone that frees one of ours. */
function planSnipe(view: BotView, style: Style): ItemPlan | null {
  let best: ItemPlan | null = null;

  for (let idx = 0; idx < view.board.length; idx++) {
    if (!isRivalStone(view, idx)) continue;
    const worth = fightsUs(view, view.board[idx]) ? style.capture : Math.trunc(style.capture / 2);
    const score = worth + style.save * rescuedByRemoving(view, idx);
    best = better(best, { id: "remove_stone", target: pointOf(view.size, idx), score });
  }
  return best;
}

/** Firework -- the 3x3 window with the most enemy stones and the fewest of ours. */
function planBomb(view: BotView, style: Style): ItemPlan | null {
  const { size } = view;
  let best: ItemPlan | null = null;

  for (let idx = 0; idx < view.board.length; idx++) {
    const centre = pointOf(size, idx);
    let net = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = centre.x + dx;
        const y = centre.y + dy;
        if (!isOnBoard(size, x, y)) continue;
        const cell = boardIndex(size, x, y);
        const code = view.board[cell];
        if (code === 0 || code === DRIFTWOOD || view.isWarded(cell)) continue;
        if (ownerOf(code) === view.color) net -= 1;
        else if (fightsUs(view, code)) net += 1;
      }
    }
    if (net < 3) continue; // 200 fireflies, once a match: it has to be a haul
    best = better(best, { id: "bomb", target: centre, score: style.capture * net });
  }
  return best;
}

/** Turn the Lantern -- a stone changes front, for what it takes on the new one or to step out of atari. */
function planFlip(view: BotView, style: Style): ItemPlan | null {
  let best: ItemPlan | null = null;

  for (let idx = 0; idx < view.board.length; idx++) {
    if (!isOwnStone(view, idx)) continue;
    const p = pointOf(view.size, idx);
    const oldAxis = axisOf(view.board[idx]);
    const trial = view.board.slice();
    const captured = flipStone(trial, view.size, p.x, p.y, (i) => view.isWarded(i));
    if (!captured) continue; // the rules refused the flip

    // Since the storm rules a flip no longer refuses when it strands the group
    // it leaves: it captures it. So the stones it takes have to be counted by
    // side -- the room credits every one of them to us, our own included, which
    // is exactly the trade a bot should not make.
    let score = 0;
    for (const { color } of captured) {
      score += fightsUs(view, color) ? style.capture : -style.capture;
    }
    const before = findGroup(view.board, view.size, p.x, p.y, oldAxis);
    const after = findGroup(trial, view.size, p.x, p.y, axisOf(trial[idx]));
    // Only the stone that moved escapes; whatever it left behind stays where it was.
    if (before.liberties === 1 && after.liberties > 1) score += style.save;
    if (score <= 0) continue;
    best = better(best, { id: "turn_lantern", target: p, score });
  }
  return best;
}

/** Driftwood -- a log that costs a rival group its second-to-last liberty. (It may never smother one outright.) */
function planDriftwood(view: BotView, style: Style): ItemPlan | null {
  let best: ItemPlan | null = null;

  for (let idx = 0; idx < view.board.length; idx++) {
    if (view.board[idx] !== 0 || view.lilyOwnerAt(idx) !== 0 || view.isBurning(idx)) continue;
    const p = pointOf(view.size, idx);
    if (!canPlaceNeutral(view.board, view.size, p.x, p.y)) continue;

    const trial = view.board.slice();
    trial[idx] = DRIFTWOOD;
    const seen = new Set<number>();
    let squeezed = 0;

    for (const n of neighbors(view.size, p.x, p.y)) {
      const nIdx = boardIndex(view.size, n.x, n.y);
      if (!isRivalStone(view, nIdx) || seen.has(nIdx)) continue;
      const axis = axisOf(view.board[nIdx]);
      if (!fightsUs(view, view.board[nIdx])) continue;
      const before = findGroup(view.board, view.size, n.x, n.y, axis);
      const after = findGroup(trial, view.size, n.x, n.y, axis);
      for (const g of after.group) seen.add(boardIndex(view.size, g.x, g.y));
      if (before.liberties > 1 && after.liberties === 1) squeezed += after.group.length;
    }

    if (squeezed === 0) continue;
    best = better(best, { id: "driftwood", target: p, score: style.atari * squeezed });
  }
  return best;
}

/**
 * Lily Pad -- hold the point we would rather have played next. Worth a third
 * of the point itself: it keeps it for two of our turns, it does not take it.
 */
function planLily(view: BotView, ranked: Candidate[]): ItemPlan | null {
  const next = ranked[1];
  if (!next) return null;
  const cell = boardIndex(view.size, next.x, next.y);
  if (view.lilyOwnerAt(cell) !== 0 || view.isBurning(cell)) return null;
  return { id: "lily_pad", target: { x: next.x, y: next.y }, score: Math.trunc(next.score / 3) };
}

const PLANNERS: Record<string, (view: BotView, style: Style, ranked: Candidate[]) => ItemPlan | null> = {
  lantern_ward: (view, style) => planWard(view, style),
  gust: (view, style) => planGust(view, style),
  remove_stone: (view, style) => planSnipe(view, style),
  bomb: (view, style) => planBomb(view, style),
  turn_lantern: (view, style) => planFlip(view, style),
  driftwood: (view, style) => planDriftwood(view, style),
  lily_pad: (view, _style, ranked) => planLily(view, ranked),
};

/** The best use of anything in the satchel, already scored against the board. */
export function planItem(view: BotView, style: Style, ranked: Candidate[]): ItemPlan | null {
  let best: ItemPlan | null = null;
  for (const id of new Set(view.powerups)) {
    const planner = PLANNERS[id];
    if (planner) best = better(best, planner(view, style, ranked));
  }
  return best;
}

/**
 * What to buy this turn, or null. One item a turn even though buying is free:
 * a bot that empties its purse the moment the market opens has nothing to
 * spend later, and the wire fills with purchases nobody watched.
 */
export function chooseBuy(view: BotView, style: Style): string | null {
  if (view.moves < view.shopAfter) return null;
  if (view.powerups.length >= view.satchelLimit) return null;

  const held = (id: string) => view.market.find((m) => m.id === id);
  const powerfulInHand = view.powerups.filter((id) => held(id)?.removal).length;

  for (const id of style.shopping) {
    if (view.powerups.indexOf(id) !== -1) continue; // one of each in hand is plenty
    // Only five of the seven stalls open in any match, and the shopping list
    // is written without knowing which: an item that isn't on sale is skipped,
    // not waited for.
    const row = held(id);
    if (!row) continue;
    if (row.removal && view.bought.indexOf(id) !== -1) continue; // once a match
    if (row.removal && powerfulInHand >= view.powerfulLimit) continue;
    if (view.fireflies < row.price) continue;
    return id;
  }
  return null;
}
