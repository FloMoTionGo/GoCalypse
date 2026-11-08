import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { storeModule } from "./history.testkit";

// history/store.ts: finished games on disk, one file each, listed newest first.

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 1, 12); // 1 Sep 2026, noon UTC

function folder(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gocalypse-history-test-"));
}

/** A small saved game, ended at `endedAt`. */
function record(id: string, endedAt: number, extra: Record<string, unknown> = {}) {
  return {
    v: 1,
    id,
    room: "go_custom",
    size: 13,
    startedAt: endedAt - 600_000,
    endedAt,
    outcome: "finished",
    turns: 12,
    players: [1, 2, 3, 4].map((color) => ({ name: `P${color}`, color, bot: color > 1, place: color === 1 ? 1 : 2, finalScore: 5, tiebreak: 6, captures: 0 })),
    frames: [{ t: 0, e: "Game started", d: [], o: [], sc: [0, 0, 0, 0] }],
    ...extra,
  };
}

test("history store: a saved game comes back whole by its id, and leaves no temp file", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir);
  store.save(record("game-aaaa01", T0));
  const back = store.get("game-aaaa01");
  assert.deepEqual(back, record("game-aaaa01", T0));
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), []);
  assert.equal(store.get("game-nothere"), undefined);
});

test("history store: the list is newest first and holds summaries, not frames", () => {
  const { HistoryStore } = storeModule();
  const store = new HistoryStore(folder());
  store.save(record("game-old001", T0));
  store.save(record("game-new001", T0 + 2 * DAY));
  store.save(record("game-mid001", T0 + DAY));
  const { games, total } = store.list();
  assert.equal(total, 3);
  assert.deepEqual(games.map((g: any) => g.id), ["game-new001", "game-mid001", "game-old001"]);
  assert.equal(games[0].frames, undefined);
  assert.equal(games[0].territory, undefined);
  assert.equal(games[0].players.length, 4);
  assert.equal(games[0].turns, 12);
});

test("history store: from and to keep the games that ended in [from, to)", () => {
  const { HistoryStore } = storeModule();
  const store = new HistoryStore(folder());
  for (let d = 0; d < 5; d++) store.save(record(`game-day00${d}`, T0 + d * DAY));
  const ids = (q: any) => store.list(q).games.map((g: any) => g.id);
  assert.deepEqual(ids({ from: T0 + DAY, to: T0 + 3 * DAY }), ["game-day002", "game-day001"]);
  assert.deepEqual(ids({ from: T0 + 3 * DAY }), ["game-day004", "game-day003"]);
  assert.deepEqual(ids({ to: T0 + 1 }), ["game-day000"]);
  assert.deepEqual(ids({ from: T0 + 10 * DAY }), []);
  assert.equal(store.list({ from: T0 + DAY, to: T0 + 3 * DAY }).total, 2);
});

test("history store: limit cuts the page, total still counts every match", () => {
  const { HistoryStore } = storeModule();
  const store = new HistoryStore(folder());
  for (let i = 0; i < 7; i++) store.save(record(`game-lim00${i}`, T0 + i * 1000));
  const page = store.list({ limit: 3 });
  assert.deepEqual(page.games.map((g: any) => g.id), ["game-lim006", "game-lim005", "game-lim004"]);
  assert.equal(page.total, 7);
  assert.equal(store.list({}).games.length, 7, "50 by default");
});

test("history store: only the newest `max` games are kept; older files are deleted", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir, { max: 3 });
  for (let i = 0; i < 5; i++) store.save(record(`game-max00${i}`, T0 + i * DAY));
  assert.deepEqual(store.list().games.map((g: any) => g.id), ["game-max004", "game-max003", "game-max002"]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["game-max002.json", "game-max003.json", "game-max004.json"]);
  assert.equal(store.get("game-max000"), undefined);
});

test("history store: saving the same id again replaces that game", () => {
  const { HistoryStore } = storeModule();
  const store = new HistoryStore(folder());
  store.save(record("game-twice1", T0));
  store.save(record("game-twice1", T0 + DAY, { turns: 99 }));
  const { games, total } = store.list();
  assert.equal(total, 1);
  assert.equal(games[0].turns, 99);
});

test("history store: a second store on the same folder finds the games already there", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  new HistoryStore(dir).save(record("game-again1", T0));
  const later = new HistoryStore(dir);
  assert.deepEqual(later.list().games.map((g: any) => g.id), ["game-again1"]);
  assert.equal(later.get("game-again1").turns, 12);
});

test("history store: unreadable and foreign files are skipped, not fatal", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  new HistoryStore(dir).save(record("game-good01", T0));
  fs.writeFileSync(path.join(dir, "game-bad001.json"), "{ not json");
  fs.writeFileSync(path.join(dir, "notes.txt"), "hello");
  fs.writeFileSync(path.join(dir, "game-odd001.json"), JSON.stringify({ hello: "world" }));
  const error = console.error;
  console.error = () => {};
  try {
    const store = new HistoryStore(dir);
    assert.deepEqual(store.list().games.map((g: any) => g.id), ["game-good01"]);
    assert.equal(store.get("game-bad001"), undefined);
  } finally {
    console.error = error;
  }
});

test("history store: an id that isn't a game id never reaches the disk", () => {
  const { HistoryStore, isGameId } = storeModule();
  const dir = folder();
  fs.writeFileSync(path.join(path.dirname(dir), "outside.json"), JSON.stringify(record("outside", T0)));
  const store = new HistoryStore(dir);
  for (const bad of ["../outside", "..\\outside", "a/b", "", "x", "game id", "a".repeat(41), "game-ok.json", 5, null, undefined]) {
    assert.equal(isGameId(bad), false, String(bad));
    assert.equal(store.get(bad as any), undefined, String(bad));
  }
  assert.equal(isGameId("game-ok0001"), true);
  assert.equal(isGameId("lq3k9x2-ab12cd"), true);
  assert.throws(() => store.save(record("../escape", T0)));
});

test("history store: deleting a game removes its file and takes it out of the list", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir);
  store.save(record("game-gone001", T0));
  store.save(record("game-stay001", T0 + DAY));
  assert.equal(store.delete("game-gone001"), true);
  assert.equal(fs.existsSync(path.join(dir, "game-gone001.json")), false, "the file is gone");
  assert.equal(store.get("game-gone001"), undefined);
  assert.deepEqual(store.list().games.map((g: any) => g.id), ["game-stay001"]);
});

test("history store: deleting an unknown id changes nothing", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir);
  store.save(record("game-stay002", T0));
  assert.equal(store.delete("game-never001"), false);
  assert.equal(store.delete("../escape"), false, "and a bad id is never a path");
  assert.deepEqual(store.list().games.map((g: any) => g.id), ["game-stay002"]);
});

test("history store: the server's own store lives in DATA_DIR/history", () => {
  const { historyDir } = storeModule();
  const before = process.env.DATA_DIR;
  process.env.DATA_DIR = path.join(os.tmpdir(), "somewhere");
  try {
    assert.equal(historyDir(), path.join(os.tmpdir(), "somewhere", "history"));
  } finally {
    if (before === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = before;
  }
});

// Test noise (tasks/2026-11-01_security_fixes T11): a game nobody human played,
// or one from a debug table, is not a match. It is never saved, and purge()
// clears the ones saved before this rule.

const bots = (every: boolean) => [1, 2, 3, 4].map((color) => ({ name: `B${color}`, color, bot: every || color > 1, place: 1, finalScore: 0, tiebreak: 0, captures: 0 }));

test("history store: a game nobody human played, or from a debug table, is noise; a game with one person is a match", () => {
  const { noiseOf } = storeModule();
  assert.equal(noiseOf(record("game-match0001", T0)), undefined, "three bots and a person: a match");
  assert.equal(noiseOf(record("game-bots00001", T0, { players: bots(true) })), "bots");
  assert.equal(noiseOf(record("game-debug0001", T0, { room: "go_debug" })), "debug");
  assert.equal(noiseOf(record("game-debug0002", T0, { room: "go_debug", players: bots(true) })), "debug", "a debug table is noise whoever sat there");
  assert.equal(noiseOf(record("game-mixed0001", T0), { anyBot: true }), "bots", "asked for it, a table with any bot counts as noise");
  assert.equal(noiseOf(record("game-human0001", T0, { players: bots(false).map((p) => ({ ...p, bot: false })) }), { anyBot: true }), undefined);
});

test("history store: purge removes the noise games and lists each with its reason", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir);
  store.save(record("game-keep00001", T0));
  store.save(record("game-bots00002", T0 + DAY, { players: bots(true) }));
  store.save(record("game-debug0003", T0 + 2 * DAY, { room: "go_debug" }));
  const gone = store.purge();
  assert.deepEqual(gone.map((g: any) => [g.id, g.reason]).sort(), [["game-bots00002", "bots"], ["game-debug0003", "debug"]]);
  assert.deepEqual(store.list().games.map((g: any) => g.id), ["game-keep00001"]);
  assert.deepEqual(fs.readdirSync(dir), ["game-keep00001.json"], "the noise files are gone, the match stays");
});

test("history store: a purge dry run lists the noise and removes nothing", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir);
  store.save(record("game-keep00002", T0));
  store.save(record("game-bots00003", T0 + DAY, { players: bots(true) }));
  const would = store.purge({ dryRun: true });
  assert.deepEqual(would.map((g: any) => g.id), ["game-bots00003"]);
  assert.equal(store.list().total, 2, "both still listed");
  assert.equal(fs.readdirSync(dir).length, 2, "both still on disk");
});

test("history store: purge with anyBot also drops the games where only some seats were bots", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir);
  store.save(record("game-mixed0002", T0));
  store.save(record("game-human0002", T0 + DAY, { players: bots(false).map((p) => ({ ...p, bot: false })) }));
  assert.deepEqual(store.purge({ anyBot: true }).map((g: any) => g.id), ["game-mixed0002"]);
  assert.deepEqual(store.list().games.map((g: any) => g.id), ["game-human0002"]);
});

// The threshold: a game of fewer than 50 turns is no replay. It is never saved,
// and purgeShort() clears the ones saved before this rule.

test("history store: a replay needs 50 turns unless HISTORY_MIN_TURNS says otherwise", () => {
  const { minReplayTurns } = storeModule();
  const before = process.env.HISTORY_MIN_TURNS;
  try {
    delete process.env.HISTORY_MIN_TURNS;
    assert.equal(minReplayTurns(), 50);
    process.env.HISTORY_MIN_TURNS = "0";
    assert.equal(minReplayTurns(), 0, "0 is a threshold too: no limit");
    process.env.HISTORY_MIN_TURNS = "120";
    assert.equal(minReplayTurns(), 120);
    process.env.HISTORY_MIN_TURNS = "lots";
    assert.equal(minReplayTurns(), 50, "nonsense falls back on the default");
  } finally {
    if (before === undefined) delete process.env.HISTORY_MIN_TURNS;
    else process.env.HISTORY_MIN_TURNS = before;
  }
});

test("history store: 49 turns is too short for a replay, 50 is enough", () => {
  const { tooShort } = storeModule();
  assert.equal(tooShort({ turns: 49 }, 50), true);
  assert.equal(tooShort({ turns: 50 }, 50), false);
  assert.equal(tooShort({ turns: 0 }, 50), true);
  assert.equal(tooShort({}, 50), false, "a record that doesn't say how long it was is left alone");
});

test("history store: purgeShort forgets the games under 50 turns, keeps every other game and lists each with its turns", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir);
  store.save(record("game-short0001", T0, { turns: 49 }));
  store.save(record("game-long00001", T0 + DAY, { turns: 50 }));
  store.save(record("game-bots00004", T0 + 2 * DAY, { turns: 80, players: bots(true) }));
  assert.deepEqual(store.purgeShort(), [{ id: "game-short0001", turns: 49 }]);
  assert.deepEqual(store.list().games.map((g: any) => g.id), ["game-bots00004", "game-long00001"]);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["game-bots00004.json", "game-long00001.json"], "only the short game's file is gone, other noise is not its business");
});

test("history store: a purgeShort dry run lists the short games and removes nothing", () => {
  const { HistoryStore } = storeModule();
  const dir = folder();
  const store = new HistoryStore(dir);
  store.save(record("game-short0002", T0, { turns: 12 }));
  store.save(record("game-long00002", T0 + DAY, { turns: 200 }));
  assert.deepEqual(store.purgeShort({ dryRun: true }), [{ id: "game-short0002", turns: 12 }]);
  assert.equal(store.list().total, 2, "both still listed");
  assert.equal(fs.readdirSync(dir).length, 2, "both still on disk");
});
