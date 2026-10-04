// GoCalypse replays, the part without a page: a saved game (the server's
// history/recorder.ts format, v1) turned into boards to show, the date filter of
// the Replays list, and the replay's play head. Plain script, no dependencies:
// `window.GoReplay` in the browser, `module.exports` in Node (tests/web).
// replayView.js puts it on screen.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GoReplay = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ORDINALS = ["1st", "2nd", "3rd", "4th"];
  const pad2 = (n) => String(n).padStart(2, "0");

  /**
   * One step per frame: the whole board after it, the timed board pieces in the
   * shape pixelScene draws them, the last stone played (kept until the next one,
   * as the live board does), the event line, the turn and the captures.
   */
  function decode(record) {
    const board = new Array(record.size * record.size).fill(0);
    let lastMove = null;
    return record.frames.map((f) => {
      for (let k = 0; k + 1 < f.d.length; k += 2) board[f.d[k]] = f.d[k + 1];
      if (f.a && f.a[0] === "move") lastMove = { x: f.a[2], y: f.a[3] };
      return {
        board: board.slice(),
        overlays: (f.o || []).map(([kind, x, y, owner, until, axis]) => ({ kind, x, y, owner, until, axis })),
        lastMove,
        event: f.e,
        turnCount: f.t,
        captures: (f.sc || []).slice(),
      };
    });
  }

  // ---- the date filter -------------------------------------------------------------

  /** "YYYY-MM-DD" (an <input type=date> value) -> that local day's midnight, in ms. */
  function dayStart(value) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  function dayAfter(value) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d + 1).getTime();
  }

  /** The local day of a time, as an <input type=date> value. */
  function toDateInput(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  /**
   * Whole local days from `fromDate` to `toDate` (either may be ""): from the
   * first day's midnight up to, not including, the midnight after the last. A
   * From after the To is read the other way round.
   */
  function dayRange(fromDate, toDate) {
    let a = fromDate || "";
    let b = toDate || "";
    if (a && b && a > b) [a, b] = [b, a];
    const range = {};
    if (a) range.from = dayStart(a);
    if (b) range.to = dayAfter(b);
    return range;
  }

  /** The date fields for a preset: "today", "week" (7 days), "month" (30 days) or "all". */
  function presetRange(name, now = Date.now()) {
    if (name === "all") return { from: "", to: "" };
    const days = { today: 1, week: 7, month: 30 }[name] || 1;
    const d = new Date(now);
    const first = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (days - 1));
    return { from: toDateInput(first.getTime()), to: toDateInput(now) };
  }

  /** The query string for GET /history. */
  function listQuery(range, limit) {
    const q = [];
    if (range.from !== undefined) q.push(`from=${range.from}`);
    if (range.to !== undefined) q.push(`to=${range.to}`);
    q.push(`limit=${limit}`);
    return `?${q.join("&")}`;
  }

  /** The game server's HTTP address, from the WebSocket one in the Server field. */
  function httpBase(wsUrl) {
    return wsUrl.trim().replace(/^ws/, "http").replace(/\/+$/, "");
  }

  // ---- words ----------------------------------------------------------------------

  /** "1 Sep 2026, 20:05", the same on every machine (local time). */
  function formatWhen(ms) {
    const d = new Date(ms);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }

  /** Players by place for a scored game (ties share it), else as they sat. */
  function standings(players) {
    const scored = players.some((p) => p.place > 0);
    if (!scored) return players.map((p) => ({ name: p.name, place: "" }));
    return players
      .slice()
      .sort((a, b) => a.place - b.place || a.color - b.color)
      .map((p) => ({ name: p.name, place: ORDINALS[p.place - 1] || `${p.place}th` }));
  }

  /** The words for one game in the list: when, who, and how it went. */
  function describeGame(game) {
    const players = standings(game.players)
      .map((p) => (p.place ? `${p.name} ${p.place}` : p.name))
      .join(" · ");
    const detail = [`${game.turns} turn${game.turns === 1 ? "" : "s"}`, game.outcome];
    if (game.room === "go_debug") detail.push("debug");
    return { when: formatWhen(game.endedAt), players, detail: detail.join(" · ") };
  }

  // ---- the play head --------------------------------------------------------------

  /** Where a replay of `count` steps stands: step, seek, and play at `speed` steps a second. */
  function createPlayer(count) {
    const last = Math.max(0, count - 1);
    let carry = 0; // ms played since the last step
    const p = {
      index: 0,
      playing: false,
      speed: 2,
      seek(i) {
        p.index = Math.max(0, Math.min(last, Math.round(i)));
        carry = 0;
        if (p.atEnd()) p.playing = false;
      },
      step(delta) {
        p.seek(p.index + delta);
      },
      atEnd() {
        return p.index >= last;
      },
      play() {
        if (p.atEnd()) p.index = 0;
        carry = 0;
        p.playing = last > 0;
      },
      pause() {
        p.playing = false;
      },
      toggle() {
        if (p.playing) p.pause();
        else p.play();
      },
      /** Moves the play head on by `ms` of playing; true when the step changed. */
      tick(ms) {
        if (!p.playing) return false;
        carry += ms;
        const every = 1000 / p.speed;
        const steps = Math.floor(carry / every);
        if (steps === 0) return false;
        carry -= steps * every;
        p.index = Math.min(last, p.index + steps);
        if (p.atEnd()) p.playing = false;
        return true;
      },
    };
    return p;
  }

  return { decode, dayRange, presetRange, toDateInput, listQuery, httpBase, formatWhen, standings, describeGame, createPlayer };
});
