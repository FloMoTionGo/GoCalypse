import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { DATA_DIR, makeRoom, put, seatHumans } from "./room.testkit";
import { queueRestore } from "../state/persist";
import { boardIndex, stoneCode } from "../rules/goRules";
import { playMatch } from "../bots/selfplay";
import { heron, moth, oldToad, tanuki } from "../bots/styles";

// A table's scoring mode, picked at creation (rules/endgame.ts): GoCalypse by default,
// Japanese or Chinese on request, and those two take dead groups off before counting.

const SIZE = 13;
const at = (x: number, y: number) => boardIndex(SIZE, x, y);

/** Black's corner of 16 points with one white stone inside it; four passes end the game. */
function finished(scoring?: string) {
  const room: any = makeRoom((scoring === undefined ? {} : { scoring }) as any);
  seatHumans(room);
  const black = stoneCode(1, "base");
  for (let y = 0; y < 4; y++) put(room, 4, y, black);
  for (let x = 0; x <= 4; x++) put(room, x, 4, black);
  put(room, 1, 1, stoneCode(2, "base"));
  for (let i = 0; i < 4; i++) room.applyPass(room.state.turnIndex);
  assert.equal(room.state.status, "finished");
  const seat = (color: number) => room.state.players.find((p: any) => p.color === color);
  return { room, seat };
}

test("scoring: a table is GoCalypse unless it asks otherwise, and an unknown mode is GoCalypse", () => {
  assert.equal(makeRoom().state.scoring, "gocalypse");
  assert.equal(makeRoom({ scoring: "japanese" } as any).state.scoring, "japanese");
  assert.equal(makeRoom({ scoring: "chinese" } as any).state.scoring, "chinese");
  for (const odd of ["french", 3, null, {}]) assert.equal(makeRoom({ scoring: odd } as any).state.scoring, "gocalypse", String(odd));
});

test("scoring: a game restored from its snapshot keeps its mode", () => {
  const room: any = makeRoom({ scoring: "chinese" } as any);
  seatHumans(room);
  room.dirty = true;
  room.saveSnapshot();
  const snap = JSON.parse(fs.readFileSync(path.join(DATA_DIR!, "rooms", `${room.roomId}.json`), "utf8"));
  assert.equal(makeRoom({ restoreToken: queueRestore(snap) }).state.scoring, "chinese");
});

test("scoring: a GoCalypse table leaves a dead stone standing, and it spoils the ground", () => {
  const { room, seat } = finished();
  assert.deepEqual(Array.from(room.state.deadStones), []);
  assert.equal(room.state.board[at(1, 1)], stoneCode(2, "base"));
  assert.equal(seat(1).baseTerritory, 144, "only the open side: a white stone touches the corner");
});

test("scoring: a Japanese table takes the dead stone off, and both seats round it count a prisoner", () => {
  const { room, seat } = finished("japanese");
  assert.deepEqual(Array.from(room.state.deadStones), [at(1, 1)]);
  assert.equal(seat(1).baseTerritory, 160, "the open side and the corner");
  for (const color of [1, 3]) {
    assert.equal(seat(color).basePrisoners, 1, `seat ${color}`);
    assert.equal(seat(color).baseCounted, 1, `seat ${color}`);
  }
  assert.equal(seat(2).basePrisoners, 0, "its own side books nothing");
});

test("scoring: a Chinese table takes the dead stone off, and counts ground and stones", () => {
  const { room, seat } = finished("chinese");
  assert.deepEqual(Array.from(room.state.deadStones), [at(1, 1)]);
  assert.equal(seat(1).baseTerritory, 160, "the open side and the corner");
  assert.equal(seat(1).baseCounted, 9, "black's nine stones");
  assert.equal(seat(1).basePrisoners, 0);
  assert.equal(seat(2).baseCounted, 0, "white has none left");
});

test("scoring: the dead stone stays on the board for all to see, and its point is ground on the final map", () => {
  const { room } = finished("japanese");
  assert.equal(room.state.board[at(1, 1)], stoneCode(2, "base"));
  assert.equal(room.state.baseTerritoryOwner[at(1, 1)], 1, "black's");
});

test("scoring: a bot is told the table's mode", () => {
  const room: any = makeRoom({ scoring: "japanese" } as any);
  seatHumans(room);
  assert.equal(room.botView(0).scoring, "japanese");
});

test("scoring: bots play every mode to its end", () => {
  for (const scoring of ["gocalypse", "japanese", "chinese"]) {
    const m = playMatch(3, [heron(), tanuki(), oldToad(), moth()], { size: 9, scoring } as any);
    assert.equal(m.finished, true, scoring);
  }
});
