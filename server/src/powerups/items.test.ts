import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardEffect, GoState, PlayerState } from "../state/GoState";
import {
  applyCaptures,
  boardIndex,
  DRIFTWOOD,
  flipStone,
  isSuicide,
  isTwin,
  ownerOf,
  stoneCode,
  twinCode,
  viewValue,
} from "../rules/goRules";
import { getPowerup } from "./definitions";
import { EffectKind, PowerupContext } from "./types";

const SIZE = 9;

interface Harness {
  state: GoState;
  ctx: (id: string, target?: { x: number; y: number }, target2?: { x: number; y: number }) => PowerupContext;
  put(x: number, y: number, code: number): void;
  at(x: number, y: number): number;
  revealed: string[];
  credited: number[];
}

/** A tiny table: 4 seated players (colors 1-4), an empty board, and a context like the room builds. */
function table(): Harness {
  const state = new GoState();
  state.size = SIZE;
  for (let i = 0; i < SIZE * SIZE; i++) state.board.push(0);
  for (let color = 1; color <= 4; color++) {
    const p = new PlayerState();
    p.color = color;
    p.name = `P${color}`;
    p.sessionId = `s${color}`;
    state.players.push(p);
  }
  const revealed: string[] = [];
  const credited: number[] = [];
  const at = (x: number, y: number) => state.board[boardIndex(SIZE, x, y)];
  const put = (x: number, y: number, code: number) => {
    state.board[boardIndex(SIZE, x, y)] = code;
  };
  const ctx = (id: string, target?: { x: number; y: number }, target2?: { x: number; y: number }): PowerupContext => {
    const def = getPowerup(id)!;
    const points = def.points ?? 1;
    return {
      state,
      size: SIZE,
      playerIndex: 0, // player 1 uses everything
      target: points >= 1 ? target : undefined,
      target2: points >= 2 ? target2 : undefined,
      isWarded: () => false,
      lilyOwnerAt: () => 0,
      isBurning: () => false,
      addEffect: (kind: EffectKind, x, y, owner, rounds) => {
        const e = new BoardEffect();
        e.kind = kind;
        e.x = x;
        e.y = y;
        e.owner = owner;
        e.until = state.turnCount + rounds * state.players.length;
        state.effects.push(e);
      },
      removePieces: (indices) => {
        for (const i of indices) state.board[i] = 0;
        return indices.length;
      },
      creditCaptures: (n) => credited.push(n),
      placeStone: (x, y, code) => {
        if (at(x, y) !== 0) return null;
        const raw = state.board.toArray();
        raw[boardIndex(SIZE, x, y)] = code;
        const captured = applyCaptures(raw, SIZE, x, y, code);
        if (captured.length === 0 && isSuicide(raw, SIZE, x, y)) return null;
        for (let i = 0; i < raw.length; i++) state.board[i] = raw[i];
        credited.push(captured.length);
        return captured.length;
      },
      reveal: (text) => revealed.push(text),
    };
  };
  return { state, ctx, put, at, revealed, credited };
}

const use = (t: Harness, id: string, target?: { x: number; y: number }, target2?: { x: number; y: number }) =>
  getPowerup(id)!.apply(t.ctx(id, target, target2));

// ---- twin stones (Twin Wick) ------------------------------------------------------

test("a twin stone belongs to its player and shows both of that player's sides", () => {
  for (let color = 1; color <= 4; color++) {
    const code = twinCode(color);
    assert.ok(isTwin(code));
    assert.equal(ownerOf(code), color);
    assert.equal(viewValue("base", code), viewValue("base", stoneCode(color, "base")));
    assert.equal(viewValue("pattern", code), viewValue("pattern", stoneCode(color, "pattern")));
  }
  assert.ok(!isTwin(DRIFTWOOD)); // driftwood is 9, right next to the twin range
});

test("filling a twin stone's last liberty captures it, whoever's stone does the filling", () => {
  const board = new Array(SIZE * SIZE).fill(0);
  board[0] = twinCode(1); // in the corner: liberties at (1,0) and (0,1)
  board[1] = stoneCode(2, "base");
  board[SIZE] = stoneCode(3, "pattern"); // a stone on the pattern front still takes a liberty away
  const captured = applyCaptures(board, SIZE, 0, 1, stoneCode(3, "pattern"));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].color, twinCode(1));
  assert.equal(board[0], 0);
});

test("a twin stone is lost when either group is smothered, though the other still breathes", () => {
  // Twin (0,0) joins black (0,1) on the base front and gray (1,0) on the pattern front.
  // The base group {twin, (0,1)} has (1,1) and (0,2) as its only exits; the gray stone has (2,0) free.
  const board = new Array(SIZE * SIZE).fill(0);
  board[0] = twinCode(1);
  board[boardIndex(SIZE, 1, 0)] = stoneCode(2, "pattern");
  board[boardIndex(SIZE, 0, 1)] = stoneCode(3, "base");
  board[boardIndex(SIZE, 1, 1)] = stoneCode(2, "base");
  board[boardIndex(SIZE, 0, 2)] = stoneCode(2, "base"); // the smothering move
  const captured = applyCaptures(board, SIZE, 0, 2, stoneCode(2, "base"));
  assert.deepEqual(captured.map((c) => c.color).sort(), [twinCode(1), stoneCode(3, "base")].sort());
  assert.equal(board[0], 0, "the twin is gone");
  assert.equal(board[boardIndex(SIZE, 1, 0)], stoneCode(2, "pattern"), "the gray stone next to it lives");
});

test("a twin stone with no liberties on one front is a suicide", () => {
  const board = new Array(SIZE * SIZE).fill(0);
  board[0] = twinCode(1);
  board[boardIndex(SIZE, 1, 0)] = stoneCode(2, "pattern");
  board[boardIndex(SIZE, 0, 1)] = stoneCode(3, "base");
  board[boardIndex(SIZE, 1, 1)] = stoneCode(2, "base");
  board[boardIndex(SIZE, 0, 2)] = stoneCode(2, "base");
  assert.ok(isSuicide(board, SIZE, 0, 0));
});

test("a twin stone can't be turned over", () => {
  const board = new Array(SIZE * SIZE).fill(0);
  board[boardIndex(SIZE, 4, 4)] = twinCode(1);
  assert.equal(flipStone(board, SIZE, 4, 4), null);
});

// ---- tier 1 -----------------------------------------------------------------------

test("Firefly Jar lights the jar once, and is refused while it is lit", () => {
  const t = table();
  assert.equal(use(t, "firefly_jar"), true);
  assert.equal(t.state.players[0].jar, 4);
  assert.equal(use(t, "firefly_jar"), false);
  assert.ok(getPowerup("firefly_jar")!.free, "the jar does not take the turn");
});

test("Mist marks the next stone once", () => {
  const t = table();
  assert.equal(use(t, "mist"), true);
  assert.equal(t.state.players[0].mist, true);
  assert.equal(use(t, "mist"), false);
});

test("Seedling plants on an empty point for 2 rounds, and not on a stone or a second time", () => {
  const t = table();
  assert.equal(use(t, "seedling", { x: 3, y: 3 }), true);
  const seed = Array.from(t.state.effects).find((e) => e.kind === "seed")!;
  assert.equal(seed.until, 2 * 4);
  assert.equal(seed.owner, 1);
  assert.equal(use(t, "seedling", { x: 3, y: 3 }), false, "already planted");
  t.put(5, 5, stoneCode(2, "base"));
  assert.equal(use(t, "seedling", { x: 5, y: 5 }), false, "occupied");
  assert.equal(use(t, "seedling", { x: -1, y: 0 }), false, "off the board");
});

// ---- tier 2 -----------------------------------------------------------------------

test("Kite shows an enemy player's satchel and fireflies to the user only", () => {
  const t = table();
  t.put(2, 2, stoneCode(3, "base"));
  t.state.players[2].fireflies = 42;
  t.state.players[2].powerups.push("mist", "gust");
  assert.equal(use(t, "kite", { x: 2, y: 2 }), true);
  assert.equal(t.revealed.length, 1);
  assert.match(t.revealed[0], /P3/);
  assert.match(t.revealed[0], /Mist, Gust/);
  assert.match(t.revealed[0], /42 fireflies/);
});

test("Kite needs an enemy stone", () => {
  const t = table();
  t.put(2, 2, stoneCode(1, "base"));
  assert.equal(use(t, "kite", { x: 2, y: 2 }), false, "own stone");
  assert.equal(use(t, "kite", { x: 4, y: 4 }), false, "empty");
  t.put(6, 6, DRIFTWOOD);
  assert.equal(use(t, "kite", { x: 6, y: 6 }), false, "driftwood");
});

test("Ferry moves your own stone one step to an empty point", () => {
  const t = table();
  const mine = stoneCode(1, "pattern");
  t.put(4, 4, mine);
  assert.equal(use(t, "ferry", { x: 4, y: 4 }, { x: 4, y: 5 }), true);
  assert.equal(t.at(4, 4), 0);
  assert.equal(t.at(4, 5), mine, "the stone keeps its front");
});

test("Ferry refuses anything but one orthogonal step to an empty point, and keeps the stone", () => {
  const t = table();
  const mine = stoneCode(1, "base");
  t.put(4, 4, mine);
  t.put(4, 5, stoneCode(2, "base"));
  assert.equal(use(t, "ferry", { x: 4, y: 4 }, { x: 5, y: 5 }), false, "diagonal");
  assert.equal(use(t, "ferry", { x: 4, y: 4 }, { x: 4, y: 6 }), false, "two steps");
  assert.equal(use(t, "ferry", { x: 4, y: 4 }, { x: 4, y: 5 }), false, "occupied");
  assert.equal(use(t, "ferry", { x: 4, y: 4 }), false, "no destination");
  t.put(0, 0, stoneCode(2, "base"));
  assert.equal(use(t, "ferry", { x: 0, y: 0 }, { x: 1, y: 0 }), false, "not your stone");
  assert.equal(t.at(4, 4), mine);
});

test("Ferry refuses a step that leaves the stone without liberties", () => {
  const t = table();
  const mine = stoneCode(1, "base");
  t.put(1, 1, mine);
  // The corner (0,0) has two liberties, (1,0) and (0,1); take (0,1) and (1,0) is the only exit.
  t.put(0, 1, stoneCode(2, "base"));
  t.put(1, 0, stoneCode(4, "base")); // occupied, so the ferry to (0,1)... is blocked, try (1,0) instead
  assert.equal(use(t, "ferry", { x: 1, y: 1 }, { x: 1, y: 0 }), false);
  assert.equal(t.at(1, 1), mine, "the stone stays");
});

test("Twin Wick arms the next stone once", () => {
  const t = table();
  assert.equal(use(t, "twin_wick"), true);
  assert.equal(t.state.players[0].twin, true);
  assert.equal(use(t, "twin_wick"), false);
});

// ---- tier 3 -----------------------------------------------------------------------

test("River Current only washes away an enemy stone on the edge", () => {
  const t = table();
  t.put(0, 4, stoneCode(2, "base")); // left edge
  t.put(4, 8, stoneCode(3, "pattern")); // bottom edge
  t.put(4, 4, stoneCode(2, "base")); // the middle
  t.put(8, 8, stoneCode(1, "base")); // an edge stone of the user's own
  assert.equal(use(t, "river_current", { x: 4, y: 4 }), false, "not on the edge");
  assert.equal(use(t, "river_current", { x: 8, y: 8 }), false, "own stone");
  assert.equal(use(t, "river_current", { x: 5, y: 8 }), false, "empty");
  assert.equal(use(t, "river_current", { x: 0, y: 4 }), true);
  assert.equal(use(t, "river_current", { x: 4, y: 8 }), true);
  assert.equal(t.at(0, 4), 0);
  assert.equal(t.at(4, 4), stoneCode(2, "base"));
  assert.ok(getPowerup("river_current")!.removal);
});

test("Echo Chime places a stone and its mirror across the centre", () => {
  const t = table();
  assert.equal(use(t, "echo_chime", { x: 1, y: 2 }), true);
  assert.equal(t.at(1, 2), stoneCode(1, "base"));
  assert.equal(t.at(SIZE - 2, SIZE - 3), stoneCode(1, "base"));
});

test("Echo Chime on the centre point places just the one stone", () => {
  const t = table();
  assert.equal(use(t, "echo_chime", { x: 4, y: 4 }), true);
  assert.equal(t.at(4, 4), stoneCode(1, "base"));
  assert.equal(t.state.board.toArray().filter((c) => c !== 0).length, 1);
});

test("Echo Chime still works when the mirror point is taken, and refuses an occupied target", () => {
  const t = table();
  t.put(SIZE - 2, SIZE - 3, stoneCode(2, "base"));
  assert.equal(use(t, "echo_chime", { x: 1, y: 2 }), true);
  assert.equal(t.at(1, 2), stoneCode(1, "base"));
  assert.equal(t.at(SIZE - 2, SIZE - 3), stoneCode(2, "base"), "the echo did not overwrite");
  assert.equal(use(t, "echo_chime", { x: 1, y: 2 }), false, "occupied");
});

test("Stepping Stones grants one extra stone, once", () => {
  const t = table();
  assert.equal(use(t, "stepping_stones"), true);
  assert.equal(t.state.players[0].extra, 1);
  assert.equal(use(t, "stepping_stones"), false);
  assert.ok(getPowerup("stepping_stones")!.free);
  assert.ok(!getPowerup("stepping_stones")!.removal, "upgraded to tier 3 for its power, but it is not a removal item");
});
