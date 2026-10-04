// The river spirit over the wire: four real clients at a go_custom table. The
// D6 can't be scripted here, so turns are played (one stone, then three passes,
// so the game never ends) until it rises; at 1 in 2 per roll that is soon.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, startServer, until, wait } from "../lib/harness.mjs";

const { Client } = colyseus();
let server, rooms, size;
const me = (r) => Array.from(r.state.players).find((p) => p.sessionId === r.sessionId);
const onTurn = () => rooms.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);
const reachOf = (r) => [r.state.spirit.reach0, r.state.spirit.reach1, r.state.spirit.reach2].sort((a, b) => a - b);
const onRing = (i) => {
  const x = i % size, y = (i / size) | 0;
  return x === 0 || y === 0 || x === size - 1 || y === size - 1;
};
const rolls = new Map(); // rolledAt -> { roll, out } as the first client saw it right after the roll

/** One turn for whoever is on turn: every fourth a stone on a free inside point, else a pass. */
async function playTurn() {
  const r = onTurn();
  const before = r.state.turnCount;
  if (before % 4 === 0) {
    const free = Array.from(r.state.seen)
      .map((c, i) => (c || onRing(i) ? -1 : i))
      .filter((i) => i >= 0);
    const i = free[Math.floor(Math.random() * free.length)];
    r.send("move", { x: i % size, y: (i / size) | 0, axis: "base" });
  } else {
    r.send("pass");
  }
  await until(() => rooms[0].state.turnCount > before, 5000, `turn ${before + 1}`);
  await wait(60); // let every client take the same patch
  const s = rooms[0].state.spirit;
  if (s.rolledAt > 0 && !rolls.has(s.rolledAt)) rolls.set(s.rolledAt, { roll: s.roll, out: s.out });
}

before(async () => {
  server = await startServer();
  rooms = [await new Client(server.ws).create("go_custom", { name: "A", playerKey: `sp-a-${Date.now()}` })];
  for (const n of "BCD") rooms.push(await new Client(server.ws).joinById(rooms[0].roomId, { name: n, playerKey: `sp-${n}-${Date.now()}` }));
  await until(() => rooms.every((r) => r.state.status === "playing" && me(r)), 5000, "the game to start");
  size = rooms[0].state.size;
});
after(async () => {
  for (const r of rooms || []) await leaveQuietly(r);
  await server?.stop();
});

test("river spirit over the wire: every client sees it rise on a 4-6, where it is and what it can reach, never when it acts", async () => {
  for (let t = 0; t < 120 && !rooms[0].state.spirit.out; t++) await playTurn();
  const s0 = rooms[0].state.spirit;
  assert.equal(s0.out, true, "the spirit rose within 120 turns");
  for (const [at, { roll, out }] of rolls) {
    assert.equal(at % 5, 0, `a roll on turn ${at}`);
    assert.ok(roll >= 1 && roll <= 6, `a D6 shows ${roll}`);
    assert.equal(out, roll >= 4, `turn ${at}: a ${roll} ${roll >= 4 ? "brings it up" : "keeps it under"}`);
  }
  assert.equal(s0.rose, s0.rolledAt);
  assert.equal(s0.by, s0.rose + 3);
  assert.ok(["top", "right", "bottom", "left"].includes(s0.side));
  assert.ok(reachOf(rooms[0]).every(onRing) && new Set(reachOf(rooms[0])).size === 3, "three outer-ring points in reach");
  for (const r of rooms) {
    const s = r.state.spirit;
    assert.deepEqual([s.seq, s.side, s.x, s.y, s.by], [s0.seq, s0.side, s0.x, s0.y, s0.by]);
    assert.deepEqual(reachOf(r), reachOf(rooms[0]));
    assert.equal(s.strikeAt, undefined, "when it acts is kept from every client");
  }
});

test("river spirit over the wire: by the third turn after rising it has sunk back, with at most a stone from its reach", async () => {
  const by = rooms[0].state.spirit.by;
  const reach = reachOf(rooms[0]);
  while (rooms[0].state.turnCount < by) await playTurn();
  for (const r of rooms) {
    const s = r.state.spirit;
    assert.equal(s.out, false);
    assert.equal(s.strikeAt, undefined);
    assert.ok(s.took === -1 || reach.includes(s.took), `took ${s.took}`);
    if (s.took >= 0) assert.equal(r.state.seen[s.took], 0, "the stone it took is gone for everyone");
  }
});
