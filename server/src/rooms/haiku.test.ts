import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { at, DATA_DIR, makeRoom, notices, onTurn, playerOf, put, startedRoom, stock } from "./room.testkit";
import { queueRestore } from "../state/persist";
import { boardIndex, DRIFTWOOD, stoneCode } from "../rules/goRules";
import { seedStep } from "../rules/seed";

// Haiku points at the table (ideas.md §11.11): every match starts with three
// haiku of three lines on the board; a stone landing on a line's point, by any
// means, collects it for good; the haiku's card comes to the hand at level 1 and
// each further line levels it up; played once, at the level it has reached.

const ids = ["moon", "river", "tree"];
const lineOf = (room: any, id: string, line: number) => Array.from(room.state.haiku).find((p: any) => p.haiku === id && p.line === line) as any;
const levelOf = (player: any, id: string) => Number(player.haikuLines[ids.indexOf(id)] ?? 0);

/** Clears the board round a haiku point and plays a stone there for whoever is on turn. */
function collect(room: any, clients: any[], id: string, line: number) {
  const p = lineOf(room, id, line);
  const client = onTurn(room, clients);
  room.handleMove(client, { x: p.x, y: p.y, axis: "base" });
  return { client, player: playerOf(room, client), p };
}

/** The player on turn holds `id`'s card at `level` (lines collected straight onto their seat). */
function holding(room: any, clients: any[], id: string, level: number) {
  const client = onTurn(room, clients);
  const player = playerOf(room, client);
  while (player.haikuLines.length < ids.length) player.haikuLines.push(0);
  player.haikuLines[ids.indexOf(id)] = level;
  player.powerups.push(`haiku_${id}`);
  return { client, player };
}

test("haiku: a match starts with 3 haiku of 3 lines on the board, none collected yet", () => {
  const { room } = startedRoom();
  const points = Array.from(room.state.haiku) as any[];
  assert.equal(points.length, 9);
  assert.deepEqual(ids.map((id) => points.filter((p) => p.haiku === id).map((p) => p.line).sort()), [[1, 2, 3], [1, 2, 3], [1, 2, 3]]);
  for (const p of points) {
    assert.equal(p.by, 0);
    assert.equal(at(room, p.x, p.y), 0, "on an empty point");
  }
  for (const pl of room.state.players) assert.deepEqual(Array.from(pl.haikuLines), [0, 0, 0]);
});

test("haiku: a stone on a haiku point collects its line, and the haiku's card comes to the hand at level 1", () => {
  const { room, clients } = startedRoom();
  const { player, p } = collect(room, clients, "river", 2);
  assert.equal(p.by, player.color);
  assert.equal(levelOf(player, "river"), 1);
  assert.ok(Array.from(player.powerups).includes("haiku_river"));
  assert.match(room.state.lastEvent, /川/);
});

test("haiku: a stone that lands by an item collects the line too: a Kata landing, a Skiff, a seed growing", () => {
  const { room } = startedRoom();
  const p = lineOf(room, "moon", 1);
  const seat = room.state.turnIndex;
  const player = room.state.players[seat];
  assert.notEqual(room.placeStoneFor(seat, p.x, p.y, stoneCode(player.color, "pattern")), null);
  assert.equal(p.by, player.color);
  assert.equal(levelOf(player, "moon"), 1);
});

test("haiku: a line once collected stays collected, its stone captured or not; nobody else can take it", () => {
  const { room, clients } = startedRoom();
  const { player, p } = collect(room, clients, "tree", 1);
  put(room, p.x, p.y, 0); // the stone is gone
  const rival = onTurn(room, clients);
  room.handleMove(rival, { x: p.x, y: p.y, axis: "base" });
  assert.equal(p.by, player.color);
  assert.equal(levelOf(player, "tree"), 1);
  assert.equal(levelOf(playerOf(room, rival), "tree"), 0);
});

test("haiku: more lines of one haiku level its card up, one card all the same", () => {
  const { room, clients } = startedRoom();
  const first = collect(room, clients, "moon", 1);
  while (onTurn(room, clients) !== first.client) room.handlePass(onTurn(room, clients));
  room.state.passes = 0;
  collect(room, clients, "moon", 3);
  assert.equal(levelOf(first.player, "moon"), 2);
  assert.equal(Array.from(first.player.powerups).filter((id) => id === "haiku_moon").length, 1);
});

test("haiku: 月 wards one stone at level 1, its whole group at level 2, and the group for 2 rounds at level 3", () => {
  for (const level of [1, 2, 3]) {
    const { room, clients } = startedRoom();
    const { client, player } = holding(room, clients, "moon", level);
    const turn = room.state.turnCount, seats = room.state.players.length;
    put(room, 6, 1, stoneCode(player.color, "base"));
    put(room, 7, 1, stoneCode(player.color, "base"));
    room.handleUsePowerup(client, { id: "haiku_moon", target: { x: 6, y: 1 } });
    const wards = (Array.from(room.state.effects) as any[]).filter((e) => e.kind === "ward");
    assert.deepEqual(wards.map((w) => `${w.x},${w.y}`).sort(), level === 1 ? ["6,1"] : ["6,1", "7,1"], `level ${level}`);
    assert.ok(wards.every((w) => w.until === turn + (level === 3 ? 2 : 1) * seats), `level ${level}: rounds`);
    assert.ok(!Array.from(player.powerups).includes("haiku_moon"), "played: gone");
  }
});

test("haiku: 川 is a Ferry step at level 1, a Skiff glide at level 2, and a glide that keeps the turn at level 3", () => {
  for (const level of [1, 2, 3]) {
    const { room, clients } = startedRoom();
    const { client, player } = holding(room, clients, "river", level);
    put(room, 5, 6, stoneCode(player.color, "base"));
    const to = level === 1 ? { x: 6, y: 6 } : { x: 10, y: 6 };
    const turn = room.state.turnCount;
    if (level === 1) {
      room.handleUsePowerup(client, { id: "haiku_river", target: { x: 5, y: 6 }, target2: { x: 10, y: 6 } });
      assert.equal(at(room, 10, 6), 0, "a Ferry only steps");
    }
    room.handleUsePowerup(client, { id: "haiku_river", target: { x: 5, y: 6 }, target2: to });
    assert.equal(at(room, to.x, to.y), stoneCode(player.color, "base"), `level ${level}`);
    assert.equal(at(room, 5, 6), 0);
    assert.equal(room.state.turnCount, level === 3 ? turn : turn + 1, `level ${level}: the turn`);
  }
});

test("haiku: 木 plants a seed at level 1, a seed already sprouting at level 2, and two sprouting seeds at level 3", () => {
  for (const level of [1, 2, 3]) {
    const { room, clients } = startedRoom();
    const { client } = holding(room, clients, "tree", level);
    room.handleUsePowerup(client, { id: "haiku_tree", target: { x: 2, y: 2 }, target2: { x: 9, y: 9 } });
    const seeds = (Array.from(room.state.effects) as any[]).filter((e) => e.kind === "seed");
    assert.equal(seeds.length, level === 3 ? 2 : 1, `level ${level}`);
    for (const s of seeds) assert.equal(seedStep(s.until, room.state.turnCount, room.state.players.length), level === 1 ? 1 : 2, `level ${level}: its step`);
  }
});

test("haiku: a card is played once; a line of that haiku found afterwards pays 10 fireflies instead", () => {
  const { room, clients } = startedRoom();
  const { client, player } = holding(room, clients, "tree", 1);
  room.handleUsePowerup(client, { id: "haiku_tree", target: { x: 2, y: 2 } });
  assert.ok(!Array.from(player.powerups).includes("haiku_tree"));
  assert.ok(Array.from(player.haikuPlayed).includes("tree"));
  while (onTurn(room, clients) !== client) room.handlePass(onTurn(room, clients));
  room.state.passes = 0;
  const before = player.fireflies;
  collect(room, clients, "tree", 2);
  assert.ok(!Array.from(player.powerups).includes("haiku_tree"), "no second card");
  assert.equal(player.fireflies - before, 3 + 10, "a stone's 3 and the line's 10");
});

test("haiku: haiku cards don't count toward the hand's 5", () => {
  const { room, clients } = startedRoom();
  room.state.shopAfter = 0;
  stock(room, ["seedling"]);
  const client = onTurn(room, clients);
  const player = playerOf(room, client);
  player.fireflies = 1000;
  player.powerups.push("stone_card", "fog", "mist", "kite", "haiku_moon", "haiku_tree");
  room.handleBuy(client, { id: "seedling" });
  assert.ok(Array.from(player.powerups).includes("seedling"), notices(client).at(-1));
});

test("haiku: a restored snapshot keeps the points, who collected them, and the levels", () => {
  const { room, clients } = startedRoom();
  const { player } = collect(room, clients, "moon", 2);
  room.saveSnapshot();
  const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR!, "rooms", `${room.roomId}.json`), "utf8"));
  const back = makeRoom({ restoreToken: queueRestore(snap) });
  const pts = (r: any) => (Array.from(r.state.haiku) as any[]).map((p) => [p.haiku, p.line, p.x, p.y, p.by]);
  assert.deepEqual(pts(back), pts(room));
  const again = (back.state.players as any[]).find((p) => p.color === player.color);
  assert.deepEqual(Array.from(again.haikuLines), Array.from(player.haikuLines));
});

test("haiku: Driftwood is refused on a haiku point", () => {
  const { room, clients } = startedRoom();
  const p = lineOf(room, "river", 3);
  const client = onTurn(room, clients);
  playerOf(room, client).powerups.push("driftwood");
  room.handleUsePowerup(client, { id: "driftwood", target: { x: p.x, y: p.y } });
  assert.notEqual(at(room, p.x, p.y), DRIFTWOOD);
  assert.ok(Array.from(playerOf(room, client).powerups).includes("driftwood"), "kept");
});

test("haiku: bots see the haiku points still to collect, and their own levels", () => {
  const { room } = startedRoom();
  const view = room.botView(room.state.turnIndex);
  assert.equal(view.haiku.length, 9);
  const p = lineOf(room, "moon", 1);
  assert.ok(view.haiku.some((h: any) => h.idx === boardIndex(room.state.size, p.x, p.y) && h.haiku === "moon"));
  assert.deepEqual(view.haikuLevels, { moon: 0, river: 0, tree: 0 });
});
