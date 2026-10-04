// web/replay.js in plain Node: turning a saved game into boards to show, the
// date filter, and the replay's play head. Fed the fixture games, so none of it
// needs a server (the server side is tested in server/src/history/).
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { WEB } from "../lib/paths.mjs";
import { at, boardAfter, fixtureGames } from "../lib/historyFixtures.mjs";

const require = createRequire(import.meta.url);
/** Loaded per test, so each one shows red on its own while web/replay.js is missing. */
const R = () => require(path.join(WEB, "replay.js"));

const [sep01, sep15, oct01] = fixtureGames();
const summary = ({ frames, territory, ...rest }) => rest;

test("replay: decode gives one step per frame, each with the whole board after it", () => {
  const steps = R().decode(sep01);
  assert.equal(steps.length, sep01.frames.length);
  steps.forEach((s, i) => assert.deepEqual(s.board, boardAfter(sep01, i), `step ${i}`));
  assert.ok(steps[0].board.every((c) => c === 0));
  assert.equal(steps[2].board[1 * 13 + 1], 2);
  assert.equal(steps[5].board[0], 0, "the captured stone is gone");
});

test("replay: each step has its event, turn and every seat's captures", () => {
  const steps = R().decode(sep01);
  assert.equal(steps[0].event, "Game started");
  assert.equal(steps[3].event, "P3 played (2, 2)");
  assert.equal(steps[3].turnCount, 3);
  assert.deepEqual(steps[5].captures, [0, 1, 0, 0]);
});

test("replay: the last stone played stays marked until the next one, as on the live board", () => {
  const steps = R().decode(sep01);
  assert.equal(steps[0].lastMove, null);
  assert.deepEqual(steps[4].lastMove, { x: 3, y: 3 });
  assert.deepEqual(steps[5].lastMove, { x: 0, y: 1 });
  assert.deepEqual(steps[6].lastMove, { x: 0, y: 1 }, "a frame with no stone keeps the last one");
});

test("replay: overlays come out in the shape the pixel scene draws", () => {
  const steps = R().decode(sep01);
  assert.deepEqual(steps[4].overlays, []);
  assert.deepEqual(steps[5].overlays, [{ kind: "ward", x: 5, y: 5, owner: 2, until: 9, axis: "base" }]);
});

test("replay: a record with no frames decodes to no steps, and the boards are not shared", () => {
  assert.deepEqual(R().decode({ ...sep01, frames: [] }), []);
  const steps = R().decode(sep01);
  steps[1].board[0] = 99;
  assert.equal(steps[2].board[0], 1);
});

test("replay: dayRange covers whole local days, from the first day's midnight to the midnight after the last", () => {
  const { dayRange } = R();
  assert.deepEqual(dayRange("2026-09-01", "2026-09-15"), { from: at(2026, 9, 1, 0), to: at(2026, 9, 16, 0) });
  assert.deepEqual(dayRange("2026-09-15", "2026-09-15"), { from: at(2026, 9, 15, 0), to: at(2026, 9, 16, 0) });
  assert.deepEqual(dayRange("", "2026-09-01"), { to: at(2026, 9, 2, 0) });
  assert.deepEqual(dayRange("2026-09-01", ""), { from: at(2026, 9, 1, 0) });
  assert.deepEqual(dayRange("", ""), {});
});

test("replay: dayRange swaps a From after the To rather than finding nothing", () => {
  assert.deepEqual(R().dayRange("2026-09-15", "2026-09-01"), { from: at(2026, 9, 1, 0), to: at(2026, 9, 16, 0) });
});

test("replay: the presets fill the date fields: today, the last 7 days, the last 30 days, and all", () => {
  const { presetRange } = R();
  const now = at(2026, 10, 3, 21, 30);
  assert.deepEqual(presetRange("today", now), { from: "2026-10-03", to: "2026-10-03" });
  assert.deepEqual(presetRange("week", now), { from: "2026-09-27", to: "2026-10-03" });
  assert.deepEqual(presetRange("month", now), { from: "2026-09-04", to: "2026-10-03" });
  assert.deepEqual(presetRange("all", now), { from: "", to: "" });
});

test("replay: toDateInput is the local day of a time, as an <input type=date> wants it", () => {
  assert.equal(R().toDateInput(at(2026, 9, 1, 0, 0)), "2026-09-01");
  assert.equal(R().toDateInput(at(2026, 12, 31, 23, 59)), "2026-12-31");
});

test("replay: listQuery asks for only the bounds that are set", () => {
  const { listQuery } = R();
  assert.equal(listQuery({}, 100), "?limit=100");
  assert.equal(listQuery({ from: 5, to: 9 }, 50), "?from=5&to=9&limit=50");
  assert.equal(listQuery({ to: 9 }, 50), "?to=9&limit=50");
});

test("replay: httpBase turns the game server's WebSocket address into its HTTP one", () => {
  const { httpBase } = R();
  assert.equal(httpBase("wss://gocalypse.fly.dev"), "https://gocalypse.fly.dev");
  assert.equal(httpBase("ws://127.0.0.1:2567/"), "http://127.0.0.1:2567");
  assert.equal(httpBase("  ws://localhost:2567  "), "http://localhost:2567");
});

test("replay: formatWhen writes a time the same way on every machine", () => {
  assert.equal(R().formatWhen(at(2026, 9, 1, 20, 5)), "1 Sep 2026, 20:05");
  assert.equal(R().formatWhen(at(2026, 12, 24, 9, 0)), "24 Dec 2026, 09:00");
});

test("replay: describeGame lists a finished game's players by place, an abandoned one's as they sat", () => {
  const { describeGame } = R();
  const done = describeGame(summary(sep01));
  assert.equal(done.when, "1 Sep 2026, 20:05");
  assert.equal(done.players, "Alice 1st · Honte 2nd · Moyo 3rd · Ko 4th");
  assert.equal(done.detail, "6 turns · finished");
  const left = describeGame(summary(sep15));
  assert.equal(left.players, "Bram · Honte · Honte 2 · Tesuji");
  assert.equal(left.detail, "6 turns · abandoned");
});

test("replay: describeGame shares a place between players level on it, and tags a debug room", () => {
  const d = R().describeGame(summary(oct01));
  assert.equal(d.players, "Moyo 1st · Cleo 2nd · Shark 3rd · Ko 3rd");
  assert.equal(d.detail, "6 turns · finished · debug");
});

test("replay: the play head steps and seeks within the game, never past either end", () => {
  const p = R().createPlayer(7);
  assert.equal(p.index, 0);
  p.step(1);
  p.step(1);
  assert.equal(p.index, 2);
  p.step(-5);
  assert.equal(p.index, 0);
  p.seek(99);
  assert.equal(p.index, 6);
  p.seek(3);
  assert.equal(p.index, 3);
  assert.equal(p.atEnd(), false);
  p.seek(6);
  assert.equal(p.atEnd(), true);
});

test("replay: playing moves on `speed` steps a second, and stops at the last step", () => {
  const p = R().createPlayer(5);
  p.speed = 2;
  p.play();
  assert.equal(p.playing, true);
  p.tick(400);
  assert.equal(p.index, 0, "not yet half a second");
  p.tick(200);
  assert.equal(p.index, 1);
  p.tick(5000);
  assert.equal(p.index, 4);
  assert.equal(p.playing, false, "stops at the end");
});

test("replay: play from the last step starts again from the first; pause holds the step", () => {
  const p = R().createPlayer(3);
  p.seek(2);
  p.toggle();
  assert.equal(p.index, 0);
  assert.equal(p.playing, true);
  p.toggle();
  assert.equal(p.playing, false);
  p.tick(5000);
  assert.equal(p.index, 0, "paused: no steps");
});

test("replay: the step index stays put with no game, and a 1-step game has nothing to play", () => {
  const one = R().createPlayer(1);
  one.play();
  one.tick(1000);
  assert.equal(one.index, 0);
  assert.equal(one.playing, false);
  const none = R().createPlayer(0);
  none.step(1);
  assert.equal(none.index, 0);
});
