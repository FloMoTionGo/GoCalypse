// The river crab and the river spirit over the wire: four real clients at a
// go_debug table (rich, the market open from the first turn, and the river's
// D6 rolled every 2 turns, so a creature soon comes). The die can't be scripted
// here, so turns are played until one comes up: one stone in four, else a pass,
// so the game never ends.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, startServer, until, wait } from "../lib/harness.mjs";

const { Client } = colyseus();
let server, rooms, size;
const me = (r) => Array.from(r.state.players).find((p) => p.sessionId === r.sessionId);
const onTurn = () => rooms.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);
const reachOf = (c) => [c.reach0, c.reach1, c.reach2].sort((a, b) => a - b);
const tookOf = (c) => [c.took0, c.took1, c.took2].filter((i) => i >= 0);
const onRing = (i) => {
  const x = i % size, y = (i / size) | 0;
  return x === 0 || y === 0 || x === size - 1 || y === size - 1;
};
const outNow = (r) => ["crab", "spirit"].filter((k) => r.state.river[k].out);
const rolls = new Map(); // rolledAt -> { roll, came } as the first client saw it right after the roll

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
  const river = rooms[0].state.river;
  if (river.rolledAt > 0 && !rolls.has(river.rolledAt)) rolls.set(river.rolledAt, { roll: river.roll, came: river.came });
}

before(async () => {
  server = await startServer();
  rooms = [await new Client(server.ws).create("go_debug", { name: "A", playerKey: `rv-a-${Date.now()}` })];
  for (const n of "BCD") rooms.push(await new Client(server.ws).joinById(rooms[0].roomId, { name: n, playerKey: `rv-${n}-${Date.now()}` }));
  await until(() => rooms.every((r) => r.state.status === "playing" && me(r)), 5000, "the game to start");
  size = rooms[0].state.size;
});
after(async () => {
  for (const r of rooms || []) await leaveQuietly(r);
  await server?.stop();
});

test("river creatures over the wire: every client sees a crab or a spirit come up on a 5 or 6, where it stands, its reach and its timer", async () => {
  for (let t = 0; t < 120 && outNow(rooms[0]).length === 0; t++) await playTurn();
  const kinds = outNow(rooms[0]);
  assert.ok(kinds.length > 0, "a creature came up within 120 turns");
  const every = rooms[0].state.river.every;
  for (const [at, { roll, came }] of rolls) {
    assert.equal(at % every, 0, `a roll on turn ${at}`);
    assert.ok(roll >= 1 && roll <= 6, `a D6 shows ${roll}`);
    if (roll < 5) assert.equal(came, "", `turn ${at}: a ${roll} brings nothing`);
  }
  const c0 = rooms[0].state.river[kinds[0]];
  assert.equal(c0.kind, kinds[0]);
  assert.equal(c0.by, c0.rose + 3 * rooms[0].state.players.length, "a 3-round timer");
  assert.ok(["top", "right", "bottom", "left"].includes(c0.side));
  assert.ok(reachOf(c0).every(onRing) && new Set(reachOf(c0)).size === 3, "three outer-ring points in reach");
  for (const r of rooms) {
    const c = r.state.river[kinds[0]];
    assert.deepEqual([c.seq, c.side, c.x, c.y, c.rose, c.by], [c0.seq, c0.side, c0.x, c0.y, c0.rose, c0.by]);
    assert.deepEqual(reachOf(c), reachOf(c0));
  }
});

test("river creatures over the wire: a Bait bought and tossed on an edge point lures the creature there, its timer unchanged", async () => {
  for (let t = 0; t < 120 && outNow(rooms[0]).length === 0; t++) await playTurn();
  const kind = outNow(rooms[0])[0];
  assert.ok(kind, "a creature is out");
  const r = onTurn();
  const c = r.state.river[kind];
  const ring = [];
  for (let i = 0; i < size * size; i++) if (onRing(i)) ring.push(i);
  // Two steps along the edge from the point it faces, away from any other creature's reach.
  const others = outNow(r).filter((k) => k !== kind).flatMap((k) => reachOf(r.state.river[k]));
  const face = c.y * size + c.x;
  const near = ring.filter((i) => Math.abs((i % size) - c.x) + Math.abs(((i / size) | 0) - c.y) === 2);
  const target = near.find((i) => !others.some((o) => Math.abs((o % size) - (i % size)) + Math.abs(((o / size) | 0) - ((i / size) | 0)) <= 3));
  assert.ok(target !== undefined && target !== face, "a point to lure it to");
  const { by, seq } = c;
  r.send("buy", { id: "bait" });
  await until(() => Array.from(me(r).powerups).includes("bait"), 5000, "the Bait in hand");
  const turn = r.state.turnCount;
  r.send("usePowerup", { id: "bait", target: { x: target % size, y: (target / size) | 0 } });
  await until(() => rooms.every((x) => x.state.river[kind].seq === seq + 1), 5000, `the ${kind} lured`);
  await wait(60);
  for (const x of rooms) {
    const lured = x.state.river[kind];
    assert.equal(lured.out, true, "still on the pier");
    assert.equal(lured.y * size + lured.x, target, "facing the bait point");
    assert.ok(reachOf(lured).includes(target));
    assert.equal(lured.by, by, "its timer unchanged");
    assert.equal(lured.fed, false);
  }
  assert.equal(r.state.turnCount, turn, "the Bait didn't use up the turn");
  assert.ok(!Array.from(me(r).powerups).includes("bait"), "used up");
});

test("river creatures over the wire: when its timer runs out it has gone back into the water, with stones from its reach only", async () => {
  for (let t = 0; t < 120 && outNow(rooms[0]).length === 0; t++) await playTurn();
  const kind = outNow(rooms[0])[0];
  assert.ok(kind, "another creature came up");
  const { by, seq } = rooms[0].state.river[kind];
  const reach = reachOf(rooms[0].state.river[kind]);
  while (rooms[0].state.turnCount < by) await playTurn();
  for (const r of rooms) {
    const c = r.state.river[kind];
    assert.equal(c.seq, seq);
    assert.equal(c.out, false);
    assert.equal(c.fed, false);
    const took = tookOf(c);
    assert.ok(took.every((i) => reach.includes(i)), `took ${took}`);
    if (kind === "crab") assert.ok(took.length <= 1, "a crab pinches one stone at most");
    for (const i of took) assert.equal(r.state.seen[i], 0, "a stone it took is gone for everyone");
  }
});
