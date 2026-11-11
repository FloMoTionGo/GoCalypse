// The lobby board's stones (tasks/2026-11-11_lobby_hover_stones): every point of the setup
// board wears one of the 16 two-look combinations (4 looks x 4 looks, reverse orders and
// plain stones included), grown from the tengen outwards, and the hover stone moves the way
// the game's hover stone does. sprites.js, lobbyStones.js and pixelScene.js in plain Node.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { WEB, loadWeb } from "../lib/paths.mjs";

const require = createRequire(import.meta.url);
const { G, P } = loadWeb();
const stones = () => require(path.join(WEB, "lobbyStones.js"));
const LOOKS = ["black", "white", "gray", "transparent"];
const { K, C, A } = G.INDEX;

/** A small seeded generator, so a failing run can be repeated. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shares = (a, b) => G.lobbyStoneLooks(a).some((look) => G.lobbyStoneLooks(b).includes(look));

test("lobby stones: the 16 two-look combinations each have their own code, and a sprite in every shape", () => {
  const codes = new Set();
  for (const l of LOOKS) for (const r of LOOKS) {
    const code = G.lobbyStoneCode(l, r);
    assert.ok(code >= 100, `${l} | ${r} is a client-only code, clear of the board's 1..14`);
    assert.deepEqual(G.lobbyStoneLooks(code), [l, r]);
    codes.add(code);
    for (const shape of Object.keys(G.TEMPLATES)) {
      const spr = G.pieceSprite(code, shape);
      assert.ok(spr && spr.w > 0 && spr.px.length === spr.w * spr.h, `${l} | ${r} in ${shape}`);
    }
  }
  assert.equal(codes.size, 16);
  assert.equal(G.LOBBY_STONE_CODES.length, 16);
});

test("lobby stones: a combination of one look twice is that plain stone, and reverse orders are different stones", () => {
  for (const l of LOOKS) assert.deepEqual(Array.from(G.stoneSprite(G.lobbyStoneCode(l, l)).px), Array.from(G.STONES[l].normal.px), `${l} | ${l}`);
  for (const l of LOOKS) for (const r of LOOKS) {
    if (l === r) continue;
    const a = G.stoneSprite(G.lobbyStoneCode(l, r)), b = G.stoneSprite(G.lobbyStoneCode(r, l));
    assert.notDeepEqual(Array.from(a.px), Array.from(b.px), `${l} | ${r} is not ${r} | ${l}`);
  }
});

test("lobby stones: a stone whose left half is see-through still shows its right half", () => {
  const spr = G.stoneSprite(G.lobbyStoneCode("transparent", "black"));
  const plain = G.STONES.black.normal;
  const mid = (spr.w - 1) >> 1;
  let black = 0;
  for (let y = 0; y < spr.h; y++) for (let x = mid + 1; x < spr.w; x++) if (spr.px[y * spr.w + x] === K && plain.px[y * spr.w + x] === K) black++;
  assert.ok(black > 20, `${black} ink pixels in the right half`);
});

test("lobby stones: every combination lands and floats off through the scene's effects, in the palette", () => {
  for (const code of G.LOBBY_STONE_CODES) {
    for (const make of [P.placeEffect, P.captureEffect]) {
      const effect = make(0, 0, code, 0);
      let drew = false;
      for (let t = 0; t < 2; t += 0.05) {
        const surf = new G.Surface(40, 40);
        surf.fill(A);
        P.drawEffect(surf, effect, t, 20, 20, false);
        assert.ok(surf.px.every((c) => c < G.PALETTE.length), `${code} stays in the palette`);
        if (surf.px.some((c) => c !== A)) drew = true;
      }
      assert.ok(drew, `${effect.kind} of ${code} draws something`);
    }
  }
});

test("lobby stones: a board with no centre row gets a spare one, so a 5 x 6 board grows from a tengen and is cropped back", () => {
  const grown = stones().growStones({ cols: 5, rows: 6, random: mulberry32(1) });
  assert.equal(grown.grid.length, 6);
  assert.ok(grown.grid.every((row) => row.length === 5));
  assert.deepEqual(grown.tengen, { col: 2, row: 3 });
  assert.ok(grown.grid.flat().every((c) => G.LOBBY_STONE_CODES.includes(c)));
});

test("lobby stones: a 5 x 7 board has its tengen at column 3, row 4 already", () => {
  const grown = stones().growStones({ cols: 5, rows: 7, random: mulberry32(2) });
  assert.equal(grown.grid.length, 7);
  assert.deepEqual(grown.tengen, { col: 2, row: 3 });
});

test("lobby stones: no two stones side by side or above each other match, over 600 boards, while diagonal ones do", () => {
  const rand = mulberry32(3);
  let diagonal = 0;
  for (let i = 0; i < 600; i++) {
    const { grid } = stones().growStones({ cols: 5, rows: 7, random: rand });
    for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
      if (c > 0) assert.notEqual(grid[r][c], grid[r][c - 1], `board ${i}: (${c}, ${r}) beside (${c - 1}, ${r})`);
      if (r > 0) assert.notEqual(grid[r][c], grid[r - 1][c], `board ${i}: (${c}, ${r}) under (${c}, ${r - 1})`);
      if (r > 0 && c > 0 && grid[r][c] === grid[r - 1][c - 1]) diagonal++;
    }
  }
  assert.ok(diagonal > 0, "a diagonal match is allowed, and shows up");
});

test("lobby stones: the tengen's stone is drawn with equal chance out of the 16", () => {
  const rand = mulberry32(4), count = new Map();
  const N = 16000;
  for (let i = 0; i < N; i++) {
    const { grid, tengen } = stones().growStones({ cols: 5, rows: 7, random: rand });
    const code = grid[tengen.row][tengen.col];
    count.set(code, (count.get(code) || 0) + 1);
  }
  assert.equal(count.size, 16, "all 16 turn up");
  for (const [code, n] of count) assert.ok(Math.abs(n / N - 1 / 16) < 0.012, `${G.lobbyStoneLooks(code).join(" | ")}: ${(n / N).toFixed(3)}`);
});

test("lobby stones: a stone sharing a colour with its source weighs 1.5 against 1, and a taken stone is out", () => {
  const source = G.lobbyStoneCode("black", "gray");
  const taken = new Set([G.lobbyStoneCode("white", "white"), source]);
  const weights = stones().stoneWeights(source, taken);
  assert.equal(weights.length, 14, "two stones are out");
  for (const { code, weight } of weights) {
    assert.ok(!taken.has(code));
    assert.equal(weight, shares(code, source) ? 1.5 : 1, G.lobbyStoneLooks(code).join(" | "));
  }
  assert.ok(stones().stoneWeights(0, new Set()).every(({ weight }) => weight === 1), "no source: equal chance");
  assert.equal(stones().SHARE_BOOST, 1.5);
});

test("lobby stones: the stones beside the tengen share a colour with it more often than a coin flip of the 15 others would", () => {
  const rand = mulberry32(5);
  let pairs = 0, shared = 0;
  for (let i = 0; i < 8000; i++) {
    const { grid, tengen } = stones().growStones({ cols: 5, rows: 7, random: rand });
    const from = grid[tengen.row][tengen.col];
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      pairs++;
      if (shares(grid[tengen.row + dr][tengen.col + dc], from)) shared++;
    }
  }
  const others = G.LOBBY_STONE_CODES.flatMap((a) => G.LOBBY_STONE_CODES.filter((b) => b !== a).map((b) => [a, b]));
  const base = others.filter(([a, b]) => shares(a, b)).length / others.length; // no boost: 0.65
  const rate = shared / pairs;
  assert.ok(rate > base + 0.05, `${rate.toFixed(3)} of the neighbours share a colour, ${base.toFixed(3)} without the boost`);
});

test("hover stone: it floats 2 px up and bobs by one with the clock, with a shadow under it and a glow on the up beat", () => {
  const top = (surf) => { for (let y = 0; y < surf.h; y++) for (let x = 0; x < surf.w; x++) if (surf.px[y * surf.w + x] !== A && surf.px[y * surf.w + x] !== K) return y; return -1; };
  const draw = (time, still) => {
    const surf = new G.Surface(40, 40);
    surf.fill(A);
    P.drawHoverStone(surf, G.stoneSprite(2), 20, 24, time, still);
    return surf;
  };
  const rest = draw(0, false), up = draw(Math.PI / 2 / 3.2, false), down = draw((3 * Math.PI) / 2 / 3.2, false), still = draw(Math.PI / 2 / 3.2, true);
  assert.equal(top(up), top(rest) - 1, "the up beat lifts it a pixel higher");
  assert.equal(top(down), top(rest) + 1, "the down beat sinks it a pixel");
  assert.equal(top(still), top(rest), "reduced motion keeps it still");
  const count = (surf, colour) => surf.px.filter((c) => c === colour).length;
  assert.ok(count(up, C) !== count(still, C) || count(up, K) !== count(still, K), "the glow outlines the stone on the up beat only");
  assert.ok(count(rest, K) > 0, "a shadow or outline in ink under it");
});
