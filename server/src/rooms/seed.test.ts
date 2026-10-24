import { test } from "node:test";
import assert from "node:assert/strict";
import { at, notices, onTurn, playerOf, put, startedRoom } from "./room.testkit";
import { effect, turns } from "./river.testkit";
import { boardIndex, DRIFTWOOD, stoneCode } from "../rules/goRules";

// rules/seed.ts, loaded per test so each fails on its own until it exists.
interface SeedRules {
  SEED_ROUNDS: number;
  seedStep(until: number, turnCount: number, seats: number): number;
}
const rules = (): SeedRules => require("../rules/seed");
const seedStep = (until: number, turnCount: number, seats: number) => rules().seedStep(until, turnCount, seats);

// The Seedling's seed grows in three steps (ideas.md §11.5): a seed in its first
// round, which anyone may trample with a stone; then a sprout and a sapling, on
// which only its planter may play; then it grows into the planter's stone.

/** Plants a seed on (x, y) for whoever is on turn, and returns their client and the seed. */
function plant(room: any, clients: any[], x: number, y: number) {
  const client = onTurn(room, clients);
  playerOf(room, client).powerups.push("seedling");
  room.handleUsePowerup(client, { id: "seedling", target: { x, y } });
  const seed = Array.from(room.state.effects).find((e: any) => e.kind === "seed" && e.x === x && e.y === y);
  assert.ok(seed, "planted");
  return { client, seed: seed as any };
}

const seedAt = (room: any, x: number, y: number) =>
  Array.from(room.state.effects).find((e: any) => e.kind === "seed" && e.x === x && e.y === y) as any;
const step = (room: any, seed: any) => seedStep(seed.until, room.state.turnCount, room.state.players.length);

/** Plays turns until `client` is on turn again (a pass or a stone on an inside point). */
function untilTurnOf(room: any, clients: any[], client: any) {
  do turns(room, clients, 1);
  while (onTurn(room, clients) !== client);
}

test("seedStep: 3 rounds, a seed, a sprout, then a sapling, by the rounds it has left", () => {
  assert.equal(rules().SEED_ROUNDS, 3);
  const L = 4;
  assert.deepEqual([12, 9, 8, 5, 4, 1].map((left) => seedStep(100 + left, 100, L)), [1, 1, 2, 2, 3, 3]);
  assert.equal(seedStep(101, 100, 4), 3, "a seed waiting out a ko is a sapling");
});

test("a seed takes 3 rounds to grow, through seed, sprout and sapling, into its planter's stone", () => {
  const { room, clients } = startedRoom();
  const { client, seed } = plant(room, clients, 3, 3);
  const color = playerOf(room, client).color;
  const planted = room.state.turnCount - 1; // the planting took the turn
  assert.equal(seed.until, planted + 3 * 4);
  assert.equal(step(room, seed), 1);
  untilTurnOf(room, clients, client);
  assert.equal(step(room, seed), 2, "a sprout once its planter is back on turn");
  turns(room, clients, 4);
  assert.equal(step(room, seed), 3, "a sapling the round after");
  assert.equal(at(room, 3, 3), 0);
  turns(room, clients, 4);
  assert.equal(at(room, 3, 3), stoneCode(color, "base"), "grown into the planter's stone");
  assert.equal(seedAt(room, 3, 3), undefined);
});

test("in its first round a rival's stone tramples the seed: the stone stands, the seed is gone", () => {
  const { room, clients } = startedRoom();
  const { client } = plant(room, clients, 3, 3);
  const rival = onTurn(room, clients);
  assert.notEqual(rival, client);
  room.handleMove(rival, { x: 3, y: 3, axis: "base" });
  assert.equal(at(room, 3, 3), stoneCode(playerOf(room, rival).color, "base"));
  assert.equal(seedAt(room, 3, 3), undefined, "trampled at once");
  assert.match(room.state.lastEvent, /trampl/i);
});

test("from its second round only its planter may play there: a rival's stone is refused", () => {
  const { room, clients } = startedRoom();
  const { client } = plant(room, clients, 3, 3);
  untilTurnOf(room, clients, client);
  turns(room, clients, 1); // the planter plays elsewhere: a rival is on turn, the sprout stands
  const rival = onTurn(room, clients);
  const turn = room.state.turnCount;
  room.handleMove(rival, { x: 3, y: 3, axis: "base" });
  assert.equal(at(room, 3, 3), 0);
  assert.equal(room.state.turnCount, turn, "the turn stays");
  assert.match(notices(rival).at(-1) ?? "", /seed/i);
  assert.ok(seedAt(room, 3, 3), "the sprout is still there");
});

test("the planter may play on their own sprouting seed: the stone stands, the seed is gone", () => {
  const { room, clients } = startedRoom();
  const { client } = plant(room, clients, 3, 3);
  untilTurnOf(room, clients, client);
  room.handleMove(client, { x: 3, y: 3, axis: "pattern" });
  assert.equal(at(room, 3, 3), stoneCode(playerOf(room, client).color, "pattern"));
  assert.equal(seedAt(room, 3, 3), undefined);
});

test("a sprouting seed is safe from rivals' items: driftwood, a lily pad and the stones items place", () => {
  const { room, clients } = startedRoom();
  const { client } = plant(room, clients, 3, 3);
  untilTurnOf(room, clients, client);
  turns(room, clients, 1);
  const rival = onTurn(room, clients);
  const rivalIndex = room.state.turnIndex;
  for (const id of ["driftwood", "lily_pad"]) {
    playerOf(room, rival).powerups.push(id);
    room.handleUsePowerup(rival, { id, target: { x: 3, y: 3 } });
    assert.ok(Array.from(playerOf(room, rival).powerups).includes(id), `${id} refused and kept`);
  }
  assert.equal(at(room, 3, 3), 0);
  assert.equal(room.placeStoneFor(rivalIndex, 3, 3, stoneCode(playerOf(room, rival).color, "base")), null, "Ferry, Skiff, Echo Chime, a Kata landing");
  assert.ok(seedAt(room, 3, 3));
});

test("a Firework clears a seed in its first round, but not a sprout", () => {
  const { room, clients } = startedRoom();
  const { client } = plant(room, clients, 3, 3);
  untilTurnOf(room, clients, client);
  turns(room, clients, 1);
  plant(room, clients, 5, 5); // a rival's fresh seed
  const bomber = onTurn(room, clients);
  put(room, 4, 3, stoneCode(playerOf(room, bomber).color, "base"));
  playerOf(room, bomber).powerups.push("bomb");
  room.handleUsePowerup(bomber, { id: "bomb", target: { x: 4, y: 4 } });
  assert.equal(at(room, 4, 3), 0, "the firework went off");
  assert.equal(seedAt(room, 5, 5), undefined, "the fresh seed is burnt");
  assert.ok(seedAt(room, 3, 3), "the sprout is not");
});

test("lightning never strikes a sprouting seed", () => {
  const { room, clients } = startedRoom();
  const { client } = plant(room, clients, 3, 3);
  untilTurnOf(room, clients, client);
  const size = room.state.size;
  const sprout = boardIndex(size, 3, 3);
  for (let i = 0; i < size * size; i++) if (i !== sprout) effect(room, "fire", i % size, Math.floor(i / size), 0);
  room.state.storm.calm = 30; // the next roll breaks a storm, if anything may be struck
  room.rollForStorm();
  const fires = Array.from(room.state.effects).filter((e: any) => e.kind === "fire" && e.x === 3 && e.y === 3);
  assert.equal(fires.length, 0, "the only unburnt point is the sprout, and it is spared");
  assert.equal(room.state.storm.strikes, 0);
});

test("a seed under a fog when it is due waits a turn, as for a ko", () => {
  const { room, clients } = startedRoom();
  plant(room, clients, 3, 3);
  effect(room, "fog", 3, 3, 0);
  turns(room, clients, 12);
  assert.equal(at(room, 3, 3), 0, "not grown under the fog");
  const seed = seedAt(room, 3, 3);
  assert.ok(seed, "still in the ground");
  assert.equal(seed.until, room.state.turnCount + 1);
});

test("bots read a rival's sprouting seed as reserved, as they read a rival's lily pad", () => {
  const { room, clients } = startedRoom();
  const { client } = plant(room, clients, 3, 3);
  const planter = playerOf(room, client).color;
  const idx = boardIndex(room.state.size, 3, 3);
  const rivalIndex = room.state.turnIndex;
  assert.equal(room.botView(rivalIndex).lilyOwnerAt(idx), 0, "a fresh seed reserves nothing");
  untilTurnOf(room, clients, client);
  turns(room, clients, 1);
  assert.equal(room.botView(room.state.turnIndex).lilyOwnerAt(idx), planter);
});

test("Seedling says how it grows: 3 rounds, trampled only in the first", () => {
  const { getPowerup } = require("../powerups/definitions");
  const d = getPowerup("seedling").description;
  assert.match(d, /3 rounds/);
  assert.match(d, /first round/i);
  assert.match(d, /only you/i);
  assert.equal(DRIFTWOOD, 9);
});
