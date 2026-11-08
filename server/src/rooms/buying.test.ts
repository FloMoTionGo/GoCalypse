import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRoom, move, notices, onTurn, playerOf, seatHumans, startedRoom, stock } from "./room.testkit";

// The Night Market as the room runs it (applyBuy): when it opens, what a purchase
// costs, and every reason a stall says no.

function richRoom() {
  const { room, clients } = startedRoom({ debug: true }); // 1200 fireflies, market open from the start
  stock(room, ["firefly_jar", "driftwood", "mist", "ferry", "kite", "echo_chime"]);
  return { room, clients };
}

test("a purchase moves the price from the purse to the hand and takes a copy off the stall", () => {
  const { room, clients } = richRoom();
  const client = clients[0];
  const me = playerOf(room, client);
  const before = me.fireflies;
  room.handleBuy(client, { id: "driftwood" });
  const stall = room.state.market.find((m: any) => m.id === "driftwood");
  assert.equal(me.fireflies, before - stall.price);
  assert.deepEqual(Array.from(me.powerups), ["stone_card", "driftwood"]);
  assert.deepEqual(Array.from(me.bought), ["driftwood"]);
  assert.equal(stall.left, stall.stock - 1);
  assert.deepEqual(notices(client), []);
});

test("buying needs no turn", () => {
  const { room, clients } = richRoom();
  const waiting = clients.find((c) => c !== onTurn(room, clients))!;
  room.handleBuy(waiting, { id: "mist" });
  assert.ok(playerOf(room, waiting).powerups.includes("mist"));
  assert.equal(room.state.turnCount, 0);
});

test("the market opens only after shopAfter rounds of the table", () => {
  const room = makeRoom();
  const clients = seatHumans(room);
  stock(room, ["firefly_jar", "driftwood", "mist", "ferry", "kite", "echo_chime"]);
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  me.fireflies = 500;
  room.handleBuy(client, { id: "driftwood" });
  assert.match(notices(client).at(-1)!, /opens at the start of round 6/);
  assert.equal(me.powerups.length, 1);
  room.state.turnCount = room.state.shopAfter * room.state.players.length;
  room.handleBuy(client, { id: "driftwood" });
  assert.ok(me.powerups.includes("driftwood"));
});

test("not enough fireflies is refused with the item's name", () => {
  const { room, clients } = richRoom();
  const me = playerOf(room, clients[0]);
  me.fireflies = 10;
  room.handleBuy(clients[0], { id: "ferry" });
  assert.match(notices(clients[0]).at(-1)!, /Not enough fireflies for Ferry/);
  assert.equal(me.fireflies, 10);
});

test("a hand of 5 cards takes no sixth", () => {
  const { room, clients } = richRoom();
  const me = playerOf(room, clients[0]);
  for (const id of ["firefly_jar", "firefly_jar", "driftwood", "driftwood"]) room.handleBuy(clients[0], { id });
  assert.equal(me.powerups.length, 5);
  room.handleBuy(clients[0], { id: "mist" });
  assert.match(notices(clients[0]).at(-1)!, /hand only holds 5/);
  assert.equal(me.powerups.length, 5);
});

test("nobody buys past their share of a stall", () => {
  const { room, clients } = richRoom();
  room.handleBuy(clients[0], { id: "ferry" }); // tier 2: 3 copies, 1 to a player
  room.handleBuy(clients[0], { id: "ferry" });
  assert.match(notices(clients[0]).at(-1)!, /one to a player/);
  assert.equal(playerOf(room, clients[0]).bought.length, 1);
});

test("a sold-out stall sells nothing more, to anyone", () => {
  const { room, clients } = richRoom();
  room.handleBuy(clients[0], { id: "echo_chime" }); // tier 3: a single copy
  room.handleBuy(clients[1], { id: "echo_chime" });
  assert.match(notices(clients[1]).at(-1)!, /sold out/);
  const stall = room.state.market.find((m: any) => m.id === "echo_chime");
  assert.equal(stall.left, 0);
  assert.equal(room.state.lastEvent, `a bought the last ${stall.name}`);
});

test("an item this match's market doesn't stock, or no item at all, is refused without a word", () => {
  const { room, clients } = richRoom();
  for (const message of [{ id: "skiff" }, { id: "no_such_item" }, { id: 7 }, {}, null]) {
    room.handleBuy(clients[0], message);
  }
  assert.equal(playerOf(room, clients[0]).powerups.length, 1);
  assert.deepEqual(notices(clients[0]), []);
});

test("a free item is used without taking the turn; a turn item ends it", () => {
  const { room, clients } = richRoom();
  const client = onTurn(room, clients);
  room.handleBuy(client, { id: "mist" });
  room.handleBuy(client, { id: "driftwood" });
  room.handleUsePowerup(client, { id: "mist" });
  const me = playerOf(room, client);
  assert.equal(me.mist, true);
  assert.equal(room.state.turnCount, 0, "Mist is free");
  room.handleUsePowerup(client, { id: "driftwood", target: { x: 4, y: 4 } });
  assert.equal(room.state.turnCount, 1, "Driftwood takes the turn");
  assert.ok(!me.powerups.includes("driftwood"));
  assert.equal(room.state.action.kind, "powerup");
  assert.equal(room.state.action.id, "driftwood");
});

test("an item that needs a point is refused without one, and kept", () => {
  const { room, clients } = richRoom();
  const client = onTurn(room, clients);
  room.handleBuy(client, { id: "driftwood" });
  room.handleBuy(client, { id: "ferry" });
  room.handleUsePowerup(client, { id: "driftwood" });
  assert.match(notices(client).at(-1)!, /needs a point on the board/);
  room.handleUsePowerup(client, { id: "ferry", target: { x: 1, y: 1 } });
  assert.match(notices(client).at(-1)!, /needs a second point/);
  assert.ok(playerOf(room, client).powerups.includes("driftwood"));
  assert.equal(room.state.turnCount, 0);
});

test("an item not in the hand, or used out of turn, does nothing", () => {
  const { room, clients } = richRoom();
  const client = onTurn(room, clients);
  room.handleUsePowerup(client, { id: "driftwood", target: { x: 4, y: 4 } });
  const waiting = clients.find((c) => c !== client)!;
  room.handleBuy(waiting, { id: "driftwood" });
  room.handleUsePowerup(waiting, { id: "driftwood", target: { x: 4, y: 4 } });
  assert.equal(room.state.turnCount, 0);
  assert.ok(playerOf(room, waiting).powerups.includes("driftwood"));
});

test("a stone played under a lit Mist leaves a mist on its point for a round", () => {
  const { room, clients } = richRoom();
  const client = onTurn(room, clients);
  room.handleBuy(client, { id: "mist" });
  room.handleUsePowerup(client, { id: "mist" });
  move(room, clients, 7, 7);
  const me = playerOf(room, client);
  assert.equal(me.mist, false);
  const mist = room.state.effects.find((e: any) => e.kind === "mist");
  assert.ok(mist && mist.x === 7 && mist.y === 7 && mist.owner === me.color);
  assert.equal(mist.until, 0 + 4, "one round (four turns) from the turn it was played on");
});

test("the market knows no powerful item: no stall carries a removal flag and the state no powerful-item limit", () => {
  // The removal items are gone (2026-11-08), and with them the one-powerful-item cap on the
  // hand: its five places are the only limit, whatever the tier.
  const { room } = richRoom();
  assert.equal((room.state as any).powerfulLimit, undefined);
  for (const m of Array.from(room.state.market) as any[]) assert.equal(m.removal, undefined, m.id);
});

test("the market stays shut for the whole table until round 6, whatever each seat has played", () => {
  const room = makeRoom();
  const clients = seatHumans(room);
  stock(room, ["firefly_jar", "driftwood", "mist", "ferry", "kite", "echo_chime"]);
  const client = onTurn(room, clients);
  const me = playerOf(room, client);
  me.fireflies = 500;
  me.moves = 99;
  room.state.turnCount = 19; // the last turn of round 5 at four seats
  room.handleBuy(client, { id: "driftwood" });
  assert.match(notices(client).at(-1)!, /start of round 6/);
  assert.equal(me.powerups.length, 1, "only the Kata");
});

test("the market opens for every seat at once at the start of round 6, even one that has placed no stone", () => {
  const room = makeRoom();
  const clients = seatHumans(room);
  stock(room, ["firefly_jar", "driftwood", "mist", "ferry", "kite", "echo_chime"]);
  room.state.turnCount = 20;
  ["firefly_jar", "driftwood", "mist", "ferry"].forEach((id, i) => {
    const me = playerOf(room, clients[i]);
    me.fireflies = 500;
    me.moves = 0;
    room.handleBuy(clients[i], { id });
    assert.ok(me.powerups.includes(id), `seat ${i} bought ${id}`);
  });
});

test("a bot sees how many rounds the table has finished", () => {
  const room: any = makeRoom();
  seatHumans(room);
  room.state.turnCount = 19;
  assert.equal(room.botView(0).rounds, 4);
  room.state.turnCount = 20;
  assert.equal(room.botView(0).rounds, 5);
});
