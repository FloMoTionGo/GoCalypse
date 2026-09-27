import {
  applyCaptures,
  axisOf,
  boardIndex,
  canPlaceNeutral,
  DRIFTWOOD,
  findGroup,
  flipStone,
  isOnBoard,
  isPlayerStone,
  isSuicide,
  neighbors,
  ownerOf,
  Point,
  stoneCode,
  StoneView,
  twinCode,
} from "../rules/goRules";
import { AXES, BotView, Candidate, fightsUs, isPointless, pointOf, rankMoves, scoreMove } from "./scoring";
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
  /** Where the stone lands, for the items that move one (Ferry, Skiff). */
  target2?: Point;
  /** The front a Seedling grows into. */
  axis?: StoneView;
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

/**
 * Snipe -- any one rival stone, so it wants to be the stone that frees one of
 * ours. River Current is the same removal, restricted to the edge of the board.
 */
function planSnipe(view: BotView, style: Style, id = "remove_stone", edgeOnly = false): ItemPlan | null {
  let best: ItemPlan | null = null;
  const last = view.size - 1;

  for (let idx = 0; idx < view.board.length; idx++) {
    if (!isRivalStone(view, idx)) continue;
    const p = pointOf(view.size, idx);
    if (edgeOnly && p.x !== 0 && p.y !== 0 && p.x !== last && p.y !== last) continue;
    const worth = fightsUs(view, view.board[idx]) ? style.capture : Math.trunc(style.capture / 2);
    const score = worth + style.save * rescuedByRemoving(view, idx);
    best = better(best, { id, target: p, score });
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

/** A point where a stone of ours may not land: burning, fogged or under someone else's lily. */
function isBlocked(view: BotView, idx: number): boolean {
  const lily = view.lilyOwnerAt(idx);
  return view.isBurning(idx) || !!view.isFogged?.(idx) || (lily !== 0 && lily !== view.color);
}

/**
 * Seedling -- a stone that grows in two rounds' time on a point we would
 * rather have played next. Worth half the point: it is a stone, but a late
 * one, and anybody who plays there first kills it.
 */
function planSeedling(view: BotView, ranked: Candidate[]): ItemPlan | null {
  for (const next of ranked.slice(1, 6)) {
    const cell = boardIndex(view.size, next.x, next.y);
    if (isBlocked(view, cell) || view.hasSeed?.(cell)) continue;
    return { id: "seedling", target: { x: next.x, y: next.y }, axis: next.axis, score: Math.trunc(next.score / 2) };
  }
  return null;
}

/**
 * Fog -- a 3x3 window nothing inside can be captured in, or played into, for
 * two rounds. One shielded stone shields its whole group (applyCaptures), so
 * it goes where the most of ours are down to their last liberty -- and it
 * shields a rival's group in atari just the same, so those count against it.
 */
function planFog(view: BotView, style: Style): ItemPlan | null {
  const { size } = view;
  let best: ItemPlan | null = null;

  for (let idx = 0; idx < view.board.length; idx++) {
    if (view.isFogged?.(idx)) continue;
    const centre = pointOf(size, idx);
    const seen = new Set<number>();
    let saved = 0;
    let score = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = centre.x + dx;
        const y = centre.y + dy;
        if (!isOnBoard(size, x, y)) continue;
        const cell = boardIndex(size, x, y);
        const code = view.board[cell];
        if (!isPlayerStone(code) || seen.has(cell) || view.isWarded(cell)) continue;
        const { group, liberties } = findGroup(view.board, size, x, y, axisOf(code));
        for (const g of group) seen.add(boardIndex(size, g.x, g.y));
        if (liberties !== 1) continue;
        if (ownerOf(code) === view.color) {
          saved += group.length;
          score += style.save * group.length;
        } else if (fightsUs(view, code)) {
          score -= style.capture * group.length;
        }
      }
    }
    if (saved < 2 || score <= 0) continue; // like the ward: not for a lone stone
    best = better(best, { id: "fog", target: centre, score });
  }
  return best;
}

/** Where a stone at `p` may go: one step (Ferry), or anywhere along a clear run of its row or column (Skiff). */
function glideTargets(view: BotView, p: Point, slide: boolean): Point[] {
  const out: Point[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let x = p.x + dx, y = p.y + dy; isOnBoard(view.size, x, y); x += dx, y += dy) {
      if (view.board[boardIndex(view.size, x, y)] !== 0) break;
      out.push({ x, y });
      if (!slide) break;
    }
  }
  return out;
}

/**
 * Ferry and Skiff -- one of our stones moved to where it could step or glide,
 * judged as if it had been played there. Worth what it takes and whether it
 * walks out of atari, less whatever it leaves short of liberties behind it.
 */
function planGlide(view: BotView, style: Style, id: "ferry" | "skiff"): ItemPlan | null {
  const { size } = view;
  let best: ItemPlan | null = null;

  for (let from = 0; from < view.board.length; from++) {
    if (!isOwnStone(view, from) || view.isWarded(from)) continue;
    const p = pointOf(size, from);
    const code = view.board[from];
    const axis = axisOf(code);
    const before = findGroup(view.board, size, p.x, p.y, axis);

    for (const dest of glideTargets(view, p, id === "skiff")) {
      const to = boardIndex(size, dest.x, dest.y);
      if (isBlocked(view, to)) continue;
      const trial = view.board.slice();
      trial[from] = 0;
      trial[to] = code;
      const captured = applyCaptures(trial, size, dest.x, dest.y, code, (i) => view.isWarded(i));
      if (captured.length === 0 && isSuicide(trial, size, dest.x, dest.y)) continue;
      if (view.repeats?.(trial)) continue;

      let score = 0;
      for (const c of captured) score += fightsUs(view, c.color) ? style.capture : -style.capture;
      const after = findGroup(trial, size, dest.x, dest.y, axis);
      if (before.liberties === 1 && after.liberties >= 2) score += style.save;
      if (after.liberties === 1 && captured.length === 0) score -= style.selfAtari;
      // The stones it leaves: a group that had room and is now in atari is a loss.
      for (const n of neighbors(size, p.x, p.y)) {
        const nIdx = boardIndex(size, n.x, n.y);
        if (!isOwnStone(view, nIdx) || trial[nIdx] === 0) continue;
        const nAxis = axisOf(view.board[nIdx]);
        const was = findGroup(view.board, size, n.x, n.y, nAxis);
        const now = findGroup(trial, size, n.x, n.y, nAxis);
        if (was.liberties >= 2 && now.liberties === 1) score -= style.save * now.group.length;
      }
      if (score <= 0) continue;
      best = better(best, { id, target: p, target2: dest, score });
    }
  }
  return best;
}

/**
 * Echo Chime -- a stone on one of our best points and a second on its mirror
 * through the centre. The chime always rings on the base front, and it is
 * worth both stones when the echo can sound on a point worth having.
 */
function planEcho(view: BotView, style: Style, ranked: Candidate[]): ItemPlan | null {
  if (view.twin) return null; // a lit wick would make the first stone a twin; keep it for a plain move
  const { size } = view;
  const code = stoneCode(view.color, "base");
  let best: ItemPlan | null = null;
  let tried = 0;

  for (const move of ranked) {
    if (move.axis !== "base") continue;
    if (++tried > 8) break;
    const mx = size - 1 - move.x;
    const my = size - 1 - move.y;
    if (mx === move.x && my === move.y) continue;

    const board = view.board.slice();
    board[boardIndex(size, move.x, move.y)] = code;
    applyCaptures(board, size, move.x, move.y, code, (i) => view.isWarded(i));
    const echo = scoreMove({ ...view, board }, mx, my, "base", style);
    if (echo === null || echo <= 0) continue;
    best = better(best, { id: "echo_chime", target: { x: move.x, y: move.y }, score: move.score + echo });
  }
  return best;
}

const PLANNERS: Record<string, (view: BotView, style: Style, ranked: Candidate[]) => ItemPlan | null> = {
  lantern_ward: (view, style) => planWard(view, style),
  gust: (view, style) => planGust(view, style),
  remove_stone: (view, style) => planSnipe(view, style),
  bomb: (view, style) => planBomb(view, style),
  turn_lantern: (view, style) => planFlip(view, style),
  driftwood: (view, style) => planDriftwood(view, style),
  lily_pad: (view, _style, ranked) => planLily(view, ranked),
  seedling: (view, _style, ranked) => planSeedling(view, ranked),
  fog: (view, style) => planFog(view, style),
  ferry: (view, style) => planGlide(view, style, "ferry"),
  skiff: (view, style) => planGlide(view, style, "skiff"),
  river_current: (view, style) => planSnipe(view, style, "river_current", true),
  echo_chime: (view, style, ranked) => planEcho(view, style, ranked),
};

/** The best use of anything in the hand that takes the turn, already scored against the board. */
export function planItem(view: BotView, style: Style, ranked: Candidate[]): ItemPlan | null {
  let best: ItemPlan | null = null;
  for (const id of new Set(view.powerups)) {
    const planner = PLANNERS[id];
    if (planner) best = better(best, planner(view, style, ranked));
  }
  return best;
}

/** An item that costs no turn, used before the move. */
export interface FreeUse {
  id: string;
  target?: Point;
}

/** Whether one of the best few points takes a stone that fights us. */
function captureInReach(view: BotView, style: Style, ranked: Candidate[]): boolean {
  for (const move of ranked.slice(0, Math.max(1, style.variation))) {
    const code = view.twin ? twinCode(view.color) : stoneCode(view.color, move.axis);
    const board = view.board.slice();
    board[boardIndex(view.size, move.x, move.y)] = code;
    const captured = applyCaptures(board, view.size, move.x, move.y, code, (i) => view.isWarded(i));
    if (captured.some((c) => fightsUs(view, c.color))) return true;
  }
  return false;
}

/** Whether the turn ahead has a stone in it worth playing. */
function stoneAhead(view: BotView, style: Style, ranked: Candidate[]): boolean {
  const best = ranked[0];
  return !!best && (!style.judgement || !isPointless(view, best));
}

/**
 * The items that don't take the turn, one at a time: the room uses it and asks
 * again, so each rule below sees the hand and the flags as they now stand.
 * Each fires only while its effect is not lit yet, so the asking ends.
 *
 *  - Stepping Stones and Mist whenever a stone is coming: two stones for one
 *    turn is always worth it, and a hidden front costs nothing;
 *  - Firefly Jar when a capture is in reach, so the doubling pays at once;
 *  - Twin Wick when the best twin point beats the best plain one by more than
 *    half a capture: a twin is lost on either front, so it has to earn that;
 *  - Kite at once, on any rival stone. A bot reads nothing from it -- the
 *    reveal is for people -- but the hand slot is worth more than a kite.
 */
export function chooseFree(view: BotView, style: Style, ranked: Candidate[]): FreeUse | null {
  if (style.shopping.length === 0) return null; // a bot that never shops never uses anything either
  const has = (id: string) => view.powerups.indexOf(id) !== -1;
  const ahead = stoneAhead(view, style, ranked);

  if (has("stepping_stones") && !view.extra && ahead) return { id: "stepping_stones" };
  if (has("firefly_jar") && !view.jar && captureInReach(view, style, ranked)) return { id: "firefly_jar" };
  if (has("twin_wick") && !view.twin && ahead) {
    const twin = rankMoves({ ...view, twin: true }, style)[0];
    if (twin && twin.score > ranked[0].score + Math.trunc(style.capture / 2)) return { id: "twin_wick" };
  }
  if (has("mist") && !view.mist && ahead) return { id: "mist" };
  if (has("kite")) {
    for (let idx = 0; idx < view.board.length; idx++) {
      if (isRivalStone(view, idx)) return { id: "kite", target: pointOf(view.size, idx) };
    }
  }
  return null;
}

/**
 * What to buy this turn, or null. One item a turn even though buying is free:
 * a bot that empties its purse the moment the market opens has nothing to
 * spend later, and the wire fills with purchases nobody watched.
 */
export function chooseBuy(view: BotView, style: Style): string | null {
  if (view.moves < view.shopAfter) return null;
  if (view.powerups.length >= view.handLimit) return null;

  const held = (id: string) => view.market.find((m) => m.id === id);
  const powerfulInHand = view.powerups.filter((id) => held(id)?.removal).length;

  for (const id of style.shopping) {
    if (view.powerups.indexOf(id) !== -1) continue; // one of each in hand is plenty
    // Only six of the stalls open in any match, and the shopping list is
    // written without knowing which: an item that isn't on sale, is sold out
    // or already had its share from this bot is skipped, not waited for.
    const row = held(id);
    if (!row) continue;
    if (row.left !== undefined && row.left <= 0) continue;
    if (row.share !== undefined && view.bought.filter((b) => b === id).length >= row.share) continue;
    if (row.removal && powerfulInHand >= view.powerfulLimit) continue;
    if (view.fireflies < row.price) continue;
    return id;
  }
  return null;
}
