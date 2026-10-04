import { test } from "node:test";
import assert from "node:assert/strict";
import { BoardEffect, GoState, PlayerState } from "../state/GoState";
import { recorderModule, storeModule } from "./history.testkit";

// history/recorder.ts: what a game's record holds, frame by frame, without a room.

/** A small game under way: a 5x5 board and four seats, joined out of colour order. */
function game(): GoState {
  const state = new GoState();
  state.size = 5;
  for (let i = 0; i < 25; i++) state.board.push(0);
  [3, 1, 4, 2].forEach((color) => {
    const p = new PlayerState();
    p.name = `P${color}`;
    p.color = color;
    p.sessionId = `session-${color}`;
    p.bot = color === 4;
    state.players.push(p);
  });
  state.status = "playing";
  state.lastEvent = "Game started";
  return state;
}

/** A stone and its action, as GoRoom.applyMove leaves them. */
function play(state: GoState, x: number, y: number, color: number, event = `P${color} played (${x}, ${y})`) {
  state.board[y * state.size + x] = color;
  state.action.seq += 1;
  state.action.kind = "move";
  state.action.id = "";
  state.action.x = x;
  state.action.y = y;
  state.action.player = color;
  state.lastEvent = event;
}

test("history recorder: the first frame is the board as the game starts, at turn 0", () => {
  const { GameRecorder } = recorderModule();
  const rec = new GameRecorder({ id: "game-0001", room: "go_custom", size: 5, startedAt: 1000 });
  rec.capture(game());
  const frames = rec.save().frames;
  assert.equal(frames.length, 1);
  assert.equal(frames[0].t, 0);
  assert.equal(frames[0].e, "Game started");
  assert.deepEqual(frames[0].d, []);
  assert.equal(frames[0].a, undefined);
});

test("history recorder: a move becomes a frame holding only the cells that changed, and the action", () => {
  const { GameRecorder } = recorderModule();
  const state = game();
  const rec = new GameRecorder({ id: "game-0002", room: "go_custom", size: 5, startedAt: 1000 });
  rec.capture(state);
  play(state, 2, 1, 3);
  state.turnCount = 1;
  rec.capture(state);
  const last = rec.save().frames[1];
  assert.deepEqual(last.d, [1 * 5 + 2, 3]);
  assert.deepEqual(last.a, ["move", "", 2, 1, 3]);
  assert.equal(last.t, 1);
  assert.equal(last.e, "P3 played (2, 1)");
});

test("history recorder: a capture with nothing new is not a frame; a new event on the same board is", () => {
  const { GameRecorder } = recorderModule();
  const state = game();
  const rec = new GameRecorder({ id: "game-0003", room: "go_custom", size: 5, startedAt: 1000 });
  rec.capture(state);
  rec.capture(state);
  assert.equal(rec.save().frames.length, 1);
  state.lastEvent = "P1 passed (1 of 4 in a row)";
  state.turnCount = 1;
  rec.capture(state);
  const frames = rec.save().frames;
  assert.equal(frames.length, 2);
  assert.deepEqual(frames[1].d, []);
  assert.equal(frames[1].a, undefined, "a pass is no action");
});

test("history recorder: a stone taken off is recorded as its cell going back to 0", () => {
  const { GameRecorder, boardAt } = recorderModule();
  const state = game();
  const rec = new GameRecorder({ id: "game-0004", room: "go_custom", size: 5, startedAt: 1000 });
  rec.capture(state);
  play(state, 0, 0, 1);
  rec.capture(state);
  state.board[0] = 0;
  play(state, 1, 0, 2, "P2 played (1, 0), captured 1");
  rec.capture(state);
  const record = rec.finish(state, "finished", 2000);
  assert.deepEqual(record.frames[2].d.slice().sort((a: number, b: number) => a - b), [0, 0, 1, 2]);
  assert.equal(boardAt(record, 1)[0], 1);
  assert.equal(boardAt(record, 2)[0], 0);
  assert.equal(boardAt(record, 2)[1], 2);
});

test("history recorder: each frame carries the timed board pieces still on the board", () => {
  const { GameRecorder } = recorderModule();
  const state = game();
  const rec = new GameRecorder({ id: "game-0005", room: "go_custom", size: 5, startedAt: 1000 });
  const ward = new BoardEffect();
  Object.assign(ward, { kind: "ward", x: 3, y: 4, owner: 2, until: 8, axis: "base" });
  const gone = new BoardEffect();
  Object.assign(gone, { kind: "lily", x: 0, y: 1, owner: 1, until: 0, axis: "base" });
  state.effects.push(ward, gone);
  rec.capture(state);
  assert.deepEqual(rec.save().frames[0].o, [["ward", 3, 4, 2, 8, "base"]]);
});

test("history recorder: each frame carries every seat's captures, in colour order", () => {
  const { GameRecorder } = recorderModule();
  const state = game();
  const rec = new GameRecorder({ id: "game-0006", room: "go_custom", size: 5, startedAt: 1000 });
  state.players.find((p) => p.color === 2)!.score = 3;
  state.players.find((p) => p.color === 4)!.score = 1;
  rec.capture(state);
  assert.deepEqual(rec.save().frames[0].sc, [0, 3, 0, 1]);
});

test("history recorder: a record saved mid-game loads back and carries on where it stopped", () => {
  const { GameRecorder } = recorderModule();
  const state = game();
  const rec = new GameRecorder({ id: "game-0007", room: "go_debug", size: 5, startedAt: 1234 });
  rec.capture(state);
  play(state, 4, 4, 1);
  rec.capture(state);
  const back = GameRecorder.load(JSON.parse(JSON.stringify(rec.save())));
  assert.equal(back.id, "game-0007");
  play(state, 3, 3, 2);
  back.capture(state);
  const record = back.finish(state, "finished", 5000);
  assert.equal(record.frames.length, 3);
  assert.deepEqual(record.frames[2].d, [3 * 5 + 3, 2], "the diff is against the board before the save");
  assert.equal(record.startedAt, 1234);
  assert.equal(record.room, "go_debug");
});

test("history recorder: finish names every seat in colour order with its place and scores, and nothing secret", () => {
  const { GameRecorder } = recorderModule();
  const state = game();
  const rec = new GameRecorder({ id: "game-0008", room: "go_custom", size: 5, startedAt: 1000 });
  rec.capture(state);
  state.players.forEach((p) => {
    p.place = p.color === 2 ? 1 : 2;
    p.finalScore = p.color * 10;
    p.tiebreak = p.color * 11;
    p.score = p.color;
  });
  state.status = "finished";
  state.turnCount = 42;
  for (let i = 0; i < 25; i++) state.baseTerritoryOwner.push(i % 3);
  for (let i = 0; i < 25; i++) state.patternTerritoryOwner.push(0);
  const record = rec.finish(state, "finished", 9000);
  assert.equal(record.v, 1);
  assert.equal(record.id, "game-0008");
  assert.equal(record.outcome, "finished");
  assert.equal(record.endedAt, 9000);
  assert.equal(record.turns, 42);
  assert.equal(record.size, 5);
  assert.deepEqual(record.players.map((p: any) => p.color), [1, 2, 3, 4]);
  assert.deepEqual(record.players[1], { name: "P2", color: 2, bot: false, place: 1, finalScore: 20, tiebreak: 22, captures: 2 });
  assert.equal(record.players[3].bot, true);
  assert.equal(record.territory.base.length, 25);
  assert.doesNotMatch(JSON.stringify(record), /session-/);
});

test("history recorder: an abandoned game has no places and no territory", () => {
  const { GameRecorder } = recorderModule();
  const state = game();
  const rec = new GameRecorder({ id: "game-0009", room: "go_custom", size: 5, startedAt: 1000 });
  rec.capture(state);
  const record = rec.finish(state, "abandoned", 3000);
  assert.equal(record.outcome, "abandoned");
  assert.ok(record.players.every((p: any) => p.place === 0));
  assert.equal(record.territory, undefined);
});

test("history recorder: a new recorder gets an id of its own that the store accepts", () => {
  const { GameRecorder } = recorderModule();
  const { isGameId } = storeModule();
  const a = new GameRecorder({ room: "go_custom", size: 13 });
  const b = new GameRecorder({ room: "go_custom", size: 13 });
  assert.notEqual(a.id, b.id);
  assert.ok(isGameId(a.id), a.id);
  assert.ok(a.startedAt > 0);
});
