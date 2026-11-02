// web/lobbyIslets.js in Node (lobby islands, tasks/2026-11-02_lobby_islands):
// an open lobby is an islet in the home screen's river with a 2x2 board, one
// point per seat. Its core -- the islet's picture, the slots on the river, and
// which islets rise, wait and sink -- loads as CommonJS like sprites.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { WEB, loadWeb } from "../lib/paths.mjs";

const require = createRequire(import.meta.url);
const islets = () => require(path.join(WEB, "lobbyIslets.js"));
const { G } = loadWeb();
const { K } = G.INDEX;

test("islets: the four seats sit on the corners of a 2x2 board, clockwise from the top left, its lines running to the kaya's edges", () => {
  const isle = islets().buildIslet(7, 19);
  const [tl, tr, br, bl] = isle.nodes;
  assert.equal(isle.nodes.length, 4);
  assert.ok(tl.x < tr.x && tl.y === tr.y, "P1 top left, P2 top right");
  assert.ok(br.x === tr.x && br.y > tr.y, "P3 bottom right");
  assert.ok(bl.x === tl.x && bl.y === br.y, "P4 bottom left");
  const ink = (x, y) => isle.base[y * isle.W + x] === K;
  const { x, y, w, h } = isle.kaya;
  for (let k = 0; k < w; k++) {
    assert.ok(ink(x + k, tl.y) && ink(x + k, bl.y), `the two lines across reach from edge to edge (x ${x + k})`);
  }
  for (let k = 0; k < h; k++) {
    assert.ok(ink(tl.x, y + k) && ink(tr.x, y + k), `the two lines down reach from edge to edge (y ${y + k})`);
  }
});

test("islets: an islet is drawn in the game's palette only, with see-through water round it", () => {
  const isle = islets().buildIslet(3, 13);
  const allowed = new Set([...Object.values(G.INDEX), G.TRANSPARENT]);
  for (const v of isle.base) assert.ok(allowed.has(v), `palette index ${v}`);
  assert.equal(isle.base[0], G.TRANSPARENT, "the corner is river");
  assert.notEqual(isle.base[isle.nodes[0].y * isle.W + isle.nodes[0].x], G.TRANSPARENT, "the board is solid");
});

test("islets: slots keep clear of the main island and the river's ends, nearest the island first", () => {
  const geom = { W: 1050, H: 479, islandX: 76, islandW: 372, islandH: 352, islandTop: 103, laneY: 466, fade: 20 };
  const slots = islets().layoutSlots(geom);
  const { CELL_W, CELL_H } = islets();
  assert.ok(slots.length >= 12, `${slots.length} slots, room for ten lobbies and two more rising`);
  for (const s of slots) {
    assert.ok(s.x - CELL_W / 2 >= geom.fade && s.x + CELL_W / 2 <= geom.W - geom.fade, `inside the river's ends: ${s.x}`);
    assert.ok(s.x - CELL_W / 2 >= geom.islandX + geom.islandW || s.x + CELL_W / 2 <= geom.islandX, `clear of the main island: ${s.x}`);
    assert.ok(s.y - CELL_H / 2 >= geom.islandTop && s.y + CELL_H / 2 <= geom.laneY, `under the word, over the lanterns' lane: ${s.y}`);
  }
  const cx = geom.islandX + geom.islandW / 2;
  assert.ok(Math.abs(slots[0].x - cx) < Math.abs(slots[slots.length - 1].x - cx), "the first slot is nearer the island than the last");
  assert.deepEqual(islets().layoutSlots({ ...geom, W: 480 }), [], "no water to spare: no slots");
});

test("islets: a new lobby rises, a started one sinks with lanterns, a closed one sinks quietly, and the page's first list just appears", () => {
  const L = islets().createLobbies();
  const a = { roomId: "a", size: 13, seats: ["p", null, null, null] };
  const b = { roomId: "b", size: 19, seats: [null, "bot:shark", "p", null] };
  L.sync([a], [], 0);
  assert.equal(L.get("a").phase, "idle", "there when the page opens: no rising");
  L.sync([a, b], [], 4);
  assert.equal(L.get("b").phase, "rise", "opened since: it rises");
  L.advance(10);
  assert.equal(L.get("b").phase, "idle");

  L.sync([{ ...a, seats: ["p", "p", null, null] }], [], 12); // b is gone without starting
  assert.equal(L.get("a").seats[1].code, "p", "a second person lands on seat 2");
  L.advance(13);
  assert.equal(L.get("b").phase, "sink");
  assert.equal(L.get("b").lanterns, false, "a lobby that closed sinks quietly");

  L.sync([], [{ roomId: "a", size: 13, seats: ["p", "p", "bot:pure", "p"], at: 0 }], 16);
  assert.ok(L.get("a").seats.every(Boolean), "a started lobby shows all four seats taken");
  L.advance(18);
  assert.equal(L.get("a").phase, "sink");
  assert.equal(L.get("a").lanterns, true, "its stones go off as lanterns");
  L.advance(40);
  assert.deepEqual(L.all(), [], "both gone once under");
});

test("islets: a server that sends no lobby list shows none", () => {
  const L = islets().createLobbies();
  L.sync(undefined, undefined, 0);
  assert.deepEqual(L.all(), []);
  L.sync([{ roomId: "a", size: 13, seats: ["p", null, null, null] }], [], 1);
  L.sync(null, null, 2); // the server stopped answering
  L.advance(10);
  assert.deepEqual(L.all(), [], "unknown again: the islets go");
});

// From the review of the first build (tasks/2026-11-02_lobby_islands/REVIEW.md).
test("islets: one failed poll keeps the islets, and only a server silent for 12 seconds takes them away", () => {
  const L = islets().createLobbies();
  L.sync([{ roomId: "a", size: 13, seats: ["p", null, null, null] }], [], 0);
  L.sync(null, null, 4);
  L.advance(5);
  assert.equal(L.get("a").phase, "idle", "a poll that failed says nothing about the lobby");
  L.sync([{ roomId: "a", size: 13, seats: ["p", "p", null, null] }], [], 8);
  L.sync(null, null, 21);
  L.advance(22);
  assert.equal(L.get("a").phase, "sink", "13 s without an answer: it goes");
  assert.equal(L.get("a").lanterns, false, "quietly");
});

test("islets: back on the home screen after a game, the lobbies there just appear, none rising or sinking", () => {
  const L = islets().createLobbies();
  L.sync([{ roomId: "a", size: 13, seats: ["p", null, null, null] }], [], 0);
  L.reset();
  L.sync([{ roomId: "b", size: 19, seats: ["p", null, null, null] }], [], 1200);
  L.advance(1201);
  assert.deepEqual(L.all().map((t) => [t.roomId, t.phase, t.sinkAt]), [["b", "idle", null]]);
});

test("islets: under the pointer every free seat is marked, and none of the taken ones", () => {
  const I = islets();
  const L = I.createLobbies();
  L.sync([{ roomId: "a", size: 13, seats: ["p", null, "bot:shark", null] }], [], 0);
  L.advance(1);
  const tb = L.get("a");
  const draw = (hover) => {
    const s = new G.Surface(240, 240);
    s.fill(G.TRANSPARENT);
    I.drawIslet(s, tb, 120, 120, 1, { initialOf: () => null, hover, reduced: true });
    return s.px;
  };
  const plain = draw(null), hovered = draw("a");
  const nodes = tb.isle.nodes.map((n) => ({ x: tb.x0 + n.x, y: tb.y0 + n.y }));
  const near = [0, 0, 0, 0]; // changed pixels, by the seat they are nearest
  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === hovered[i]) continue;
    const x = i % 240, y = (i / 240) | 0;
    const d = nodes.map((n) => Math.hypot(n.x - x, n.y - y));
    near[d.indexOf(Math.min(...d))]++;
  }
  assert.ok(near[1] > 0 && near[3] > 0, `both free seats are marked: ${near}`);
  assert.equal(near[0] + near[2], 0, `no taken seat is: ${near}`);
});

test("islets: a lobby at a board size this page has never heard of still shows", () => {
  const L = islets().createLobbies();
  L.sync([{ roomId: "x", size: 9, seats: ["p", null, null, null] }], [], 0);
  assert.equal(L.get("x")?.size, 9);
});
