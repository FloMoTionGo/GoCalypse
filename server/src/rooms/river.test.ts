import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { at, DATA_DIR, makeRoom, move, onTurn, passAround, put, startedRoom } from "./room.testkit";
import { CRAB, DIE, effect, idx, openRoom, PICK, reachOf, risen, script, SPIRIT, SPOT, tookOf, turns, until } from "./river.testkit";
import { DRIFTWOOD, stoneCode } from "../rules/goRules";
import { queueRestore } from "../state/persist";

// The river crab and the river spirit in a room (see river.testkit.ts).

test("river creatures: no roll until the Night Market is open for the whole table", () => {
  const { room, clients } = startedRoom(); // the market opens after each seat's 5th move: turn 20 at 4 seats
  room.riverRandom = script(DIE(6), CRAB, SPOT(6));
  assert.equal(room.state.river.every, 5);
  turns(room, clients, 19);
  assert.equal(room.state.river.rolledAt, 0, "no roll on turns 5, 10 or 15");
  assert.equal(room.state.river.crab.out, false);
  turns(room, clients, 1);
  assert.deepEqual([room.state.river.roll, room.state.river.rolledAt, room.state.river.crab.out], [6, 20, true]);
});

test("river creatures: a D6 every 5 turns; a 1 to 4 brings nothing, with the same odds next time", () => {
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(1), DIE(2), DIE(3), DIE(4));
  turns(room, clients, 4);
  assert.equal(room.state.river.rolledAt, 0, "no roll before turn 5");
  turns(room, clients, 1);
  assert.deepEqual([room.state.river.roll, room.state.river.rolledAt], [1, 5]);
  turns(room, clients, 4);
  assert.equal(room.state.river.rolledAt, 5, "the next roll waits 5 turns");
  turns(room, clients, 1);
  assert.deepEqual([room.state.river.roll, room.state.river.rolledAt], [2, 10]);
  turns(room, clients, 10);
  // A storm's calm rolls add up; the river's don't: a 4 after three misses is still a miss.
  assert.deepEqual([room.state.river.roll, room.state.river.rolledAt], [4, 20]);
  const { crab, spirit } = room.state.river;
  assert.deepEqual([crab.out, crab.seq, spirit.out, spirit.seq], [false, 0, false, 0], "nothing came up");
});

test("river creatures: on a 5 or 6 a crab or a spirit climbs onto the pier, facing an edge point, with three points in reach and a 3-round timer", () => {
  for (const face of [5, 6]) {
    for (const [kind, draw] of [["crab", CRAB], ["spirit", SPIRIT]] as [string, number][]) {
      const { room, clients } = openRoom();
      room.riverRandom = script(DIE(face), draw, SPOT(6));
      turns(room, clients, 5);
      const river = room.state.river;
      const c = river[kind];
      const other = river[kind === "crab" ? "spirit" : "crab"];
      assert.equal(river.roll, face);
      assert.equal(river.came, kind, `a ${face} brought the ${kind}`);
      assert.equal(c.kind, kind);
      assert.equal(c.out, true, `the ${kind} is up on a ${face}`);
      assert.equal(other.out, false);
      assert.equal(c.seq, 1);
      assert.deepEqual([c.side, c.x, c.y], ["top", 6, 0]);
      assert.deepEqual(reachOf(c), [idx(5, 0), idx(6, 0), idx(7, 0)]);
      assert.equal(c.rose, 5);
      assert.equal(c.by, 17, "3 rounds of 4 seats: it acts on turn 17");
      assert.match(room.state.lastEvent, new RegExp(`river ${kind}`, "i"));
    }
  }
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(5), CRAB, SPOT(39)); // the left side's first spot: the top-left corner
  turns(room, clients, 5);
  const crab = room.state.river.crab;
  assert.deepEqual([crab.side, crab.x, crab.y], ["left", 0, 0]);
  assert.deepEqual(reachOf(crab), [idx(0, 0), idx(1, 0), idx(0, 1)].sort((a, b) => a - b));
});

test("river creatures: the crab waits out its timer, then pinches one stone in reach, picked at random", () => {
  const { room, clients } = risen(CRAB, PICK(1, 3));
  put(room, 5, 0, stoneCode(1, "base"));
  put(room, 6, 0, stoneCode(2, "pattern"));
  put(room, 7, 0, stoneCode(3, "base"));
  until(room, clients, 16);
  assert.equal(room.state.river.crab.out, true, "still waiting on turn 16");
  assert.deepEqual([at(room, 5, 0), at(room, 6, 0), at(room, 7, 0)].map(Boolean), [true, true, true]);
  turns(room, clients, 1);
  const crab = room.state.river.crab;
  const left = [idx(5, 0), idx(6, 0), idx(7, 0)].filter((i) => room.state.board[i] !== 0);
  assert.equal(left.length, 2, "exactly one stone is gone");
  assert.equal(crab.out, false, "it went back into the water");
  assert.equal(crab.fed, false);
  assert.deepEqual(tookOf(crab), [idx(6, 0)], "the middle one of three, as drawn");
  assert.equal(at(room, 6, 0), 0);
  assert.match(room.state.lastEvent, /crab/i);
});

test("river creatures: the spirit waits out its timer, then steals every stone in its reach", () => {
  const { room, clients } = risen(SPIRIT);
  put(room, 5, 0, stoneCode(1, "base"));
  put(room, 6, 0, stoneCode(2, "pattern"));
  put(room, 7, 0, stoneCode(3, "base"));
  put(room, 8, 0, stoneCode(4, "base")); // one point past its reach
  until(room, clients, 16);
  assert.equal(room.state.river.spirit.out, true);
  assert.deepEqual([at(room, 5, 0), at(room, 6, 0), at(room, 7, 0)].map(Boolean), [true, true, true]);
  turns(room, clients, 1);
  const spirit = room.state.river.spirit;
  assert.equal(spirit.out, false);
  assert.deepEqual([at(room, 5, 0), at(room, 6, 0), at(room, 7, 0)], [0, 0, 0], "all three are gone");
  assert.equal(at(room, 8, 0), stoneCode(4, "base"));
  assert.deepEqual(tookOf(spirit), [idx(5, 0), idx(6, 0), idx(7, 0)]);
  assert.match(room.state.lastEvent, /spirit/i);
});

test("river creatures: stones outside the reach are left alone, and with none in reach it leaves empty-handed", () => {
  for (const kind of [CRAB, SPIRIT]) {
    const { room, clients } = risen(kind);
    const outside: [number, number][] = [[4, 0], [8, 0], [6, 1], [12, 6], [0, 12]];
    for (const [x, y] of outside) put(room, x, y, stoneCode(2, "base"));
    until(room, clients, 17);
    const c = kind === CRAB ? room.state.river.crab : room.state.river.spirit;
    assert.equal(c.out, false);
    assert.deepEqual(tookOf(c), []);
    for (const [x, y] of outside) assert.equal(at(room, x, y), stoneCode(2, "base"), `(${x}, ${y}) untouched`);
    assert.match(room.state.lastEvent, /river (crab|spirit)/i);
  }
});

test("river creatures: a warded, fogged or misted stone, or driftwood, is safe from both", () => {
  for (const kind of [CRAB, SPIRIT]) {
    const { room, clients } = risen(kind);
    put(room, 5, 0, stoneCode(1, "base"));
    effect(room, "ward", 5, 0, 1);
    put(room, 6, 0, stoneCode(2, "base"));
    effect(room, "mist", 6, 0, 2);
    put(room, 7, 0, DRIFTWOOD);
    until(room, clients, 17);
    const c = kind === CRAB ? room.state.river.crab : room.state.river.spirit;
    assert.equal(c.out, false);
    assert.deepEqual(tookOf(c), []);
    assert.deepEqual([at(room, 5, 0), at(room, 6, 0), at(room, 7, 0)], [stoneCode(1, "base"), stoneCode(2, "base"), DRIFTWOOD]);

    const fogged = risen(kind);
    put(fogged.room, 6, 0, stoneCode(4, "pattern"));
    effect(fogged.room, "fog", 6, 0, 1);
    until(fogged.room, fogged.clients, 17);
    const f = kind === CRAB ? fogged.room.state.river.crab : fogged.room.state.river.spirit;
    assert.deepEqual(tookOf(f), []);
    assert.equal(at(fogged.room, 6, 0), stoneCode(4, "pattern"));
  }
});

test("river creatures: each stone taken pays its owner 3 fireflies, and nobody gets a prisoner", () => {
  const { room, clients } = risen(SPIRIT);
  put(room, 5, 0, stoneCode(3, "pattern"));
  put(room, 7, 0, stoneCode(3, "base"));
  put(room, 6, 0, stoneCode(2, "base"));
  until(room, clients, 16);
  assert.ok(room.state.passes <= 2, "one more pass won't end the game");
  const before = room.state.players.map((p: any) => [p.fireflies, p.score, p.basePrisoners, p.patternPrisoners]);
  room.handlePass(onTurn(room, clients)); // a pass earns nothing itself
  assert.equal(room.state.turnCount, 17);
  assert.deepEqual(tookOf(room.state.river.spirit), [idx(5, 0), idx(6, 0), idx(7, 0)]);
  const paid: Record<number, number> = { 3: 6, 2: 3 };
  room.state.players.forEach((p: any, i: number) => {
    const [ff, score, base, pattern] = before[i];
    assert.equal(p.fireflies, ff + (paid[p.color] ?? 0), `color ${p.color} fireflies`);
    assert.deepEqual([p.score, p.basePrisoners, p.patternPrisoners], [score, base, pattern], `color ${p.color} prisoners`);
  });
});

test("river creatures: at most one crab and one spirit at a time; a roll for one already out brings nothing", () => {
  const { room, clients } = openRoom();
  // Turn 5: a crab facing (6, 0). Turn 10: a 6 and the crab again, which is out: nothing.
  // Turn 15: a 6 and the spirit, at the first spot whose reach keeps clear of the crab's.
  room.riverRandom = script(DIE(5), CRAB, SPOT(6), DIE(6), CRAB, DIE(6), SPIRIT, 0);
  turns(room, clients, 10);
  const river = room.state.river;
  assert.deepEqual([river.roll, river.rolledAt, river.came], [6, 10, ""], "a 6 for the crab already out");
  assert.deepEqual([river.crab.seq, river.crab.rose, river.spirit.out], [1, 5, false]);
  turns(room, clients, 5);
  assert.deepEqual([river.came, river.spirit.out, river.spirit.rose, river.spirit.by], ["spirit", true, 15, 27]);
  assert.deepEqual([river.spirit.side, river.spirit.x, river.spirit.y], ["top", 0, 0]);
  assert.equal(river.crab.out, true, "both are up");
  const crabReach = reachOf(river.crab);
  assert.ok(reachOf(river.spirit).every((i) => !crabReach.includes(i)), "their reaches don't touch");
});

test("river creatures: their news is added to the turn's event, not put in its place", () => {
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(6), SPIRIT, SPOT(20));
  turns(room, clients, 4);
  move(room, clients, 6, 6);
  assert.equal(room.state.turnCount, 5);
  assert.equal(room.state.river.spirit.out, true);
  assert.match(room.state.lastEvent, /played \(6, 6\)/);
  assert.match(room.state.lastEvent, /river spirit climbs/i);
});

test("river creatures: a game that ends while they are out sends them back into the water", () => {
  const { room, clients } = openRoom();
  room.riverRandom = script(DIE(5), CRAB, SPOT(6));
  turns(room, clients, 4);
  move(room, clients, 6, 6); // turn 5: the crab comes up, and the passes start again from none
  assert.equal(room.state.river.crab.out, true);
  put(room, 6, 0, stoneCode(1, "base"));
  passAround(room, clients, 3);
  assert.equal(room.state.status, "playing");
  passAround(room, clients, 1);
  assert.equal(room.state.status, "finished");
  const crab = room.state.river.crab;
  assert.equal(crab.out, false);
  assert.deepEqual(tookOf(crab), []);
  assert.equal(at(room, 6, 0), stoneCode(1, "base"));
});

test("river creatures: a bot's view shows each one that is out, with its reach and the turns it has left", () => {
  const { room } = risen(CRAB);
  assert.deepEqual(room.botView(0).creatures, [{ kind: "crab", reach: [idx(5, 0), idx(6, 0), idx(7, 0)], turnsLeft: 12 }]);
  room.state.river.crab.out = false;
  assert.deepEqual(room.botView(0).creatures, []);
});

test("river creatures: they and their timers survive a snapshot restore", () => {
  const { room } = risen(SPIRIT);
  room.saveSnapshot();
  const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR!, "rooms", `${room.roomId}.json`), "utf8"));
  const back = makeRoom({ restoreToken: queueRestore(snap) });
  const s = back.state.river.spirit;
  assert.deepEqual([s.kind, s.out, s.side, s.x, s.y, s.rose, s.by, s.seq], ["spirit", true, "top", 6, 0, 5, 17, 1]);
  assert.deepEqual(reachOf(s), [idx(5, 0), idx(6, 0), idx(7, 0)]);
  assert.equal(back.state.river.crab.out, false);
  assert.equal(back.state.river.crab.kind, "crab");
});
