// Saved games for the replay tests, in the format server/src/history/recorder.ts
// writes (v1). The frontend tiers are tested against these, so they don't need a
// game to be played first; seedHistory() puts them where a server will find them.
import fs from "node:fs";
import path from "node:path";

const SIZE = 13;

/** Local time, as the date filter in the browser reads it. */
export const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

function players(names, places) {
  return names.map((name, i) => ({
    name,
    color: i + 1,
    bot: i > 0,
    place: places ? places[i] : 0,
    finalScore: places ? 20 - places[i] * 3 : 0,
    tiebreak: places ? 25 - places[i] * 3 : 0,
    captures: i,
  }));
}

/**
 * Frames that put a stone of each colour in turn on the diagonal, take the
 * first one off again in the fifth, and end on a last event.
 */
function frames(last) {
  const out = [{ t: 0, e: "Game started", d: [], o: [], sc: [0, 0, 0, 0] }];
  for (let i = 0; i < 4; i++) {
    const color = i + 1;
    out.push({ t: i + 1, e: `P${color} played (${i}, ${i})`, a: ["move", "", i, i, color], d: [i * SIZE + i, color], o: [], sc: [0, 0, 0, 0] });
  }
  out.push({
    t: 5,
    e: "P2 played (0, 1), captured 1",
    a: ["move", "", 0, 1, 2],
    d: [0, 0, 1 * SIZE + 0, 2],
    o: [["ward", 5, 5, 2, 9, "base"]],
    sc: [0, 1, 0, 0],
  });
  out.push({ t: 6, e: last, d: [], o: [["ward", 5, 5, 2, 9, "base"]], sc: [0, 1, 0, 0] });
  return out;
}

/** The board after frame `i` of a record (the same sum boardAt makes on the server). */
export function boardAfter(record, i) {
  const board = new Array(record.size * record.size).fill(0);
  for (let f = 0; f <= i; f++) {
    const d = record.frames[f].d;
    for (let k = 0; k + 1 < d.length; k += 2) board[d[k]] = d[k + 1];
  }
  return board;
}

/** Three games: 1 Sep (finished), 15 Sep (abandoned), 1 Oct (a debug room). */
export function fixtureGames() {
  return [
    {
      v: 1, id: "fx-game-sep01", room: "go_custom", size: SIZE,
      startedAt: at(2026, 9, 1, 19, 40), endedAt: at(2026, 9, 1, 20, 5), outcome: "finished", turns: 6,
      players: players(["Alice", "Honte", "Moyo", "Ko"], [1, 2, 3, 4]),
      frames: frames("Game over: Alice wins with 17."),
      territory: { base: new Array(SIZE * SIZE).fill(0), pattern: new Array(SIZE * SIZE).fill(0) },
    },
    {
      v: 1, id: "fx-game-sep15", room: "go_custom", size: SIZE,
      startedAt: at(2026, 9, 15, 9, 50), endedAt: at(2026, 9, 15, 10, 0), outcome: "abandoned", turns: 6,
      players: players(["Bram", "Honte", "Honte 2", "Tesuji"], null),
      frames: frames("Bram left; Drifter plays the seat"),
    },
    {
      v: 1, id: "fx-game-oct01", room: "go_debug", size: SIZE,
      startedAt: at(2026, 10, 1, 18, 0), endedAt: at(2026, 10, 1, 18, 30), outcome: "finished", turns: 6,
      players: players(["Cleo", "Moyo", "Shark", "Ko"], [2, 1, 3, 3]),
      frames: frames("Game over: Moyo wins with 17."),
      territory: { base: new Array(SIZE * SIZE).fill(0), pattern: new Array(SIZE * SIZE).fill(0) },
    },
  ];
}

/** Writes saved games where a server started on `dataDir` keeps its history. */
export function seedHistory(dataDir, games = fixtureGames()) {
  const dir = path.join(dataDir, "history");
  fs.mkdirSync(dir, { recursive: true });
  for (const g of games) fs.writeFileSync(path.join(dir, `${g.id}.json`), JSON.stringify(g));
  return games;
}
