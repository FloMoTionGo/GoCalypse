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
