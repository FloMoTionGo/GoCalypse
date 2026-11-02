import { test } from "node:test";
import assert from "node:assert/strict";
import { at, onTurn, playerOf, put, startedRoom, stock } from "./room.testkit";
import { stoneCode } from "../rules/goRules";

// A stone an item carries across the board (Ferry, Skiff, the 川 haiku) is named
// in the event line, from its old point to the new, with what it captured on
// landing. Without it, a stone that vanishes here and appears there reads as a
// kill: in room 8PvdrurpM a player watched "a grey stone killed by a grey stone"
// that was Ko's 川 haiku ferrying Ko's own stone from (9, 7) to (9, 6).

function richRoom() {
  const { room, clients } = startedRoom({ debug: true }); // 1200 fireflies, market open from the start
  stock(room, ["ferry", "skiff", "driftwood", "mist", "kite", "bomb"]);
  return { room, clients };
}

/** The base code of a stone that fights the mover's black/white on the base front. */
function rivalBase(color: number): number {
  return color % 2 === 1 ? 2 : 1;
}

test("a Ferry's event names the stone's crossing, from its old point to the new, and what it captured", () => {
  const { room, clients } = richRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  const mine = stoneCode(me.color, "base");
  // A rival stone on (6, 6) with (5, 6) as its last liberty; my stone steps there from (4, 6).
  put(room, 6, 6, rivalBase(me.color));
  put(room, 6, 5, mine);
  put(room, 6, 7, mine);
  put(room, 7, 6, mine);
  put(room, 4, 6, mine);
  room.handleBuy(client, { id: "ferry" });
  room.handleUsePowerup(client, { id: "ferry", target: { x: 4, y: 6 }, target2: { x: 5, y: 6 } });
  assert.equal(at(room, 4, 6), 0, "the stone left");
  assert.equal(at(room, 5, 6), mine, "and landed");
  assert.equal(at(room, 6, 6), 0, "taking the rival");
  assert.equal(room.state.lastEvent, `${me.name} used Ferry, moving a stone from (4, 6) to (5, 6), captured 1`);
});

test("a Skiff's event names the glide, and says nothing of captures when there were none", () => {
  const { room, clients } = richRoom();
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  put(room, 2, 2, stoneCode(me.color, "pattern"));
  room.handleBuy(client, { id: "skiff" });
  room.handleUsePowerup(client, { id: "skiff", target: { x: 2, y: 2 }, target2: { x: 2, y: 9 } });
  assert.equal(at(room, 2, 9), stoneCode(me.color, "pattern"));
  assert.equal(room.state.lastEvent, `${me.name} used Skiff, moving a stone from (2, 2) to (2, 9)`);
});

test("the 川 haiku's crossing is in the event at every level, and the free level 3 glide still records the action", () => {
  for (const level of [1, 2, 3]) {
    const { room, clients } = startedRoom();
    const client = onTurn(room, clients);
    const player = playerOf(room, client);
    while (player.haikuLines.length < 3) player.haikuLines.push(0);
    player.haikuLines[1] = level; // moon, river, tree
    player.powerups.push("haiku_river");
    put(room, 5, 6, stoneCode(player.color, "base"));
    const to = level === 1 ? { x: 6, y: 6 } : { x: 10, y: 6 };
    const seq = room.state.action.seq;
    room.handleUsePowerup(client, { id: "haiku_river", target: { x: 5, y: 6 }, target2: to });
    assert.equal(at(room, to.x, to.y), stoneCode(player.color, "base"), `level ${level}: landed`);
    assert.equal(
      room.state.lastEvent,
      `${player.name} used the 川 haiku (level ${level}), moving a stone from (5, 6) to (${to.x}, ${to.y})`,
      `level ${level}: the event`
    );
    assert.equal(room.state.action.seq, seq + 1, `level ${level}: the crossing is an action the clients can animate`);
    assert.deepEqual(
      [room.state.action.kind, room.state.action.id, room.state.action.x, room.state.action.y],
      ["powerup", "haiku_river", to.x, to.y],
      `level ${level}: the action lands where the stone did`
    );
  }
});
