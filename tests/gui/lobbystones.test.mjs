// The lobby board's stones (tasks/2026-11-11_lobby_hover_stones), in a real browser: seven
// rows (a free one under Start gives the board a tengen), a random two-look stone at every
// point, never the same beside or above it, the game's hover stone over an empty point and
// nothing at all over a placed one. Tests in this file share one page, and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Stoner", nowelcome: "1" }));
  await b.waitFor("!!window.GoLobbyIsland", 10000, "the lobby board");
});
after(async () => rig?.close());

/** The canvas around a point, as a short hash: whatever is drawn there right now. */
const snap = (col, row) => b.ev(`(() => {
  const I = window.GoLobbyIsland, p = I.point(${col}, ${row}), ctx = document.getElementById("lobby-board").getContext("2d");
  const d = ctx.getImageData(p.x - 12, p.y - 16, 25, 21).data; // stops inside the kaya: the frame below it is lit by the stone lantern, and flickers
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
  return (h >>> 0).toString(16);
})()`);
/** How many opaque pixels of the point's own stone the canvas draws differently (0: the stone is there as it is). */
const wrongPixels = (col, row) => b.ev(`(() => {
  const I = window.GoLobbyIsland, p = I.point(${col}, ${row}), ctx = document.getElementById("lobby-board").getContext("2d");
  const spr = G.stoneSprite(I.stoneAt(${col}, ${row})), x0 = p.x - ((spr.w - 1) >> 1), y0 = p.y - ((spr.h - 1) >> 1);
  const d = ctx.getImageData(x0, y0, spr.w, spr.h).data;
  let wrong = 0;
  for (let i = 0; i < spr.px.length; i++) {
    if (spr.px[i] === G.TRANSPARENT) continue;
    const [r, g, bl] = G.PALETTE_RGB[spr.px[i]];
    if (d[i * 4] !== r || d[i * 4 + 1] !== g || d[i * 4 + 2] !== bl) wrong++;
  }
  return wrong;
})()`);
/** Polls until `ok(await read())` holds (a slow machine draws its frames late); returns the last read. */
const settle = async (read, ok, label, ms = 8000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) assert.fail(`${label}: still ${JSON.stringify(v)}`);
    await wait(150);
  }
};
const away = async () => {
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 2, y: 2 });
  await wait(350);
};
const over = async (col, row) => {
  const p = await rig.lobbyPoint(col, row);
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await wait(350);
};

test("lobby stones: the lobby board has seven rows, a free Extra row under Start, and a tengen at its centre", async () => {
  const I = await b.ev("(({ rows, cols, startRow, freeRow, tengen }) => ({ rows, cols, startRow, freeRow, tengen }))(window.GoLobbyIsland)");
  assert.equal(I.rows, 7);
  assert.equal(I.startRow, 5);
  assert.equal(I.freeRow, 6);
  assert.equal(I.cols, 6, "one column for each of the six bots");
  assert.deepEqual(I.tengen, { col: 3, row: 3 }, "six columns have no centre one: a spare seventh is drawn along and cropped, so the tengen is column 4");
  assert.equal(await b.ev(`document.querySelector('.board-label[data-row="6"]').textContent`), "Extra");
});

test("lobby stones: every point wears one of the 16 two-look stones, and none matches the point beside it or above it", async () => {
  const grid = await b.ev(`(() => {
    const I = window.GoLobbyIsland;
    return Array.from({ length: I.rows }, (_, r) => Array.from({ length: I.cols }, (_, c) => I.stoneAt(c, r)));
  })()`);
  const codes = await b.ev("G.LOBBY_STONE_CODES");
  assert.equal(grid.length, 7);
  for (let r = 0; r < 7; r++) for (let c = 0; c < grid[r].length; c++) {
    assert.ok(codes.includes(grid[r][c]), `(${c}, ${r}) is one of the 16`);
    if (c > 0) assert.notEqual(grid[r][c], grid[r][c - 1], `(${c}, ${r}) beside (${c - 1}, ${r})`);
    if (r > 0) assert.notEqual(grid[r][c], grid[r - 1][c], `(${c}, ${r}) under (${c}, ${r - 1})`);
  }
});

test("lobby stones: a black stone seats a bot and is drawn as that point's own stone, and the pick count follows", async () => {
  await rig.clickLobby(0, 0);
  assert.equal(await b.ev("pickedTotal()"), 1);
  await settle(() => wrongPixels(0, 0), (n) => n === 0, "the stone on the canvas is the point's stone");
  assert.equal(await wrongPixels(0, 0), 0, "the stone on the canvas is the point's stone");
});

test("lobby stones: hovering an already placed stone changes nothing: no ghost, no lift, no glow", async () => {
  await away();
  const alone = await snap(0, 0);
  await over(0, 0);
  const hovered = await snap(0, 0);
  await wait(700); // past a whole bob step
  const later = await snap(0, 0);
  assert.equal(hovered, alone, "the same pixels with the pointer on it");
  assert.equal(later, alone, "and still the same later");
  assert.equal(await wrongPixels(0, 0), 0);
});

test("lobby stones: hovering an empty point lifts its own stone and bobs it, as in the game", async () => {
  await away();
  const alone = await snap(1, 1);
  await over(1, 1);
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    seen.add(await snap(1, 1));
    await wait(150);
  }
  assert.ok(!seen.has(alone), "the stone is up over the point");
  assert.ok(seen.size >= 3, `it moves over two seconds (${seen.size} different frames)`);
  await away();
  assert.equal(await snap(1, 1), alone, "and is gone when the pointer leaves");
});

test("lobby stones: a white stone takes a placed bot off again", async () => {
  await rig.clickLobby(0, 0, "right");
  assert.equal(await b.ev("pickedTotal()"), 0);
});

test("lobby stones: the free Extra row takes stones for fun, changes no pick, and a white stone takes one off", async () => {
  await away();
  const empty = await snap(1, 6);
  await rig.clickLobby(1, 6);
  assert.equal(await b.ev("pickedTotal()"), 0, "no bot seated");
  await settle(() => wrongPixels(1, 6), (n) => n === 0, "the point's stone is there");
  assert.equal(await wrongPixels(1, 6), 0, "the point's stone is there");
  await rig.clickLobby(1, 6, "right");
  await away();
  await settle(() => snap(1, 6), (h) => h === empty, "and gone again once it has floated off");
  assert.equal(await snap(1, 6), empty, "and gone again");
});

test("lobby stones: the keyboard reaches the free row, and the caption says it is a free point", async () => {
  await b.ev("document.getElementById('lobby-board').focus(); true");
  for (let i = 0; i < 6; i++) await b.key("ArrowDown");
  assert.match(await b.ev("document.getElementById('lobby-caption').textContent"), /free/i);
  rig.assertClean("the lobby board");
});
