// web/errorCopy.js in plain Node (review U4): what the page says when a join,
// a seat, the connection or a replay fails. Each sentence says what happened
// and what to do next, in words: no status or close codes, no "error", no
// browser or colyseus.js text. The server's own refusals (the address caps,
// util/limits.ts) are already written for people and are shown as they are.
// The button they point at reads "Play online" or "Play with N bots" (main.js),
// so the copy says "press Play", never "press Join".
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";
import { WEB } from "../lib/paths.mjs";

const require = createRequire(import.meta.url);
/** Loaded per test, so each one shows red on its own while web/errorCopy.js is missing. */
const C = () => require(path.join(WEB, "errorCopy.js"));

/** What the page catches when the server can't be reached, per browser, and from colyseus.js. */
const unreachable = [
  Object.assign(new Error("Failed to fetch"), { name: "ServerError", code: undefined }), // colyseus.js, Chrome/Edge
  new TypeError("Failed to fetch"), // fetch, Chrome/Edge
  new TypeError("NetworkError when attempting to fetch resource."), // Firefox
  new TypeError("Load failed"), // Safari
];
const NEXT = /\b(press|try|check|refresh|wait|pick|open|leave)\b/i;
const RAW = /\b\d{3,4}\b|\b(code|error|undefined|null|fetch|answered|matchmake)\b|room "/i;

test("error copy: a join that can't reach the server says so, names a server typed in the field, and says to press Play", () => {
  for (const err of unreachable) {
    const usual = C().joinFailed(err, null);
    assert.match(usual, /^Can't reach the server\./, usual);
    assert.match(usual, /press Play/i, usual);
    const typed = C().joinFailed(err, "localhost:2567");
    assert.match(typed, /^Can't reach the server at localhost:2567\./, typed);
    assert.match(typed, /Server field/, typed);
    assert.match(typed, /press Play/i, typed);
  }
});

test("error copy: the server's own refusals are shown in its words; colyseus.js's internal ones never are", () => {
  const refusal = "You have 2 tables open already: leave one before starting another.";
  assert.equal(C().joinFailed({ name: "ServerError", code: 4215, message: refusal }, null), refusal);
  const full = C().joinFailed({ name: "ServerError", code: 4216, message: "This table is full." }, null);
  assert.match(full, /filled up/, full);
  assert.match(full, /press Play/i, full);
  for (const err of [
    { name: "MatchMakeError", code: 4212, message: 'room "CJ1K4EbPs" is locked' },
    { name: "MatchMakeError", code: 4212, message: 'room "zzzzzzzzz" not found' },
    { name: "MatchMakeError", code: 4214, message: "seat reservation expired." },
    { name: "ServerError", code: 4216, message: "Cannot read properties of undefined (reading 'x')" },
    { name: "ServerError", code: 4002, message: "" },
  ]) {
    const text = C().joinFailed(err, null);
    assert.ok(!err.message || !text.includes(err.message), `"${err.message}" must not show: ${text}`);
    assert.doesNotMatch(text, RAW, text);
    assert.match(text, /press Play/i, text);
  }
  const elsewhere = C().joinFailed({ name: "MatchMakeError", code: 4210, message: 'provided room name "go_custom" not defined' }, "example.test");
  assert.match(elsewhere, /example\.test/, elsewhere);
  assert.match(elsewhere, /Server field/, elsewhere);
  assert.doesNotMatch(elsewhere, /provided|defined/, elsewhere);
});

test("error copy: a refused seat, a dropped lobby, a restarted server, trouble at the table and a reconnect that gave up each say what to do", () => {
  const busy = C().joinFailed(Object.assign(new Error("seat"), { status: 409 }), null);
  assert.match(busy, /seat/i, busy);
  assert.match(busy, /wait a moment, then press Play/i, busy);
  const tooMany = C().joinFailed(Object.assign(new Error("seat"), { status: 429 }), null);
  assert.match(tooMany, /wait a few seconds, then press Play/i, tooMany);
  assert.match(C().serverRestarted(), /restarted/i);
  assert.match(C().serverRestarted(), /press Play/i);
  assert.match(C().lostInLobby(), /dropped/i);
  assert.match(C().lostInLobby(), /press Play/i);
  assert.match(C().tableTrouble(), /refresh the page/i);
  assert.match(C().reconnectGaveUp(), /isn't answering/i);
  assert.match(C().reconnectGaveUp(), /refresh the page/i);
});

test("error copy: Replays tell an unreachable server, a game that is gone, and a server that failed apart", () => {
  for (const err of unreachable) {
    assert.match(C().listFailed(err, null), /^Can't reach the server to list the games\./);
    assert.match(C().listFailed(err, "localhost:2567"), /^Can't reach the server at localhost:2567 to list the games\./);
    assert.match(C().gameFailed(err, null), /^Can't reach the server to load that game\./);
  }
  assert.match(C().listFailed({ status: 500 }, null), /couldn't list the games/);
  assert.match(C().gameFailed({ status: 404 }, null), /no longer on the server/);
  assert.match(C().gameFailed({ status: 500 }, null), /couldn't be loaded/);
});

test("error copy: no message shows a status or close code, the word error, or a browser's own words, and each says what to do", () => {
  const c = C();
  const all = [
    ...unreachable.flatMap((e) => [c.joinFailed(e, null), c.listFailed(e, null), c.gameFailed(e, null)]),
    ...[400, 404, 409, 429, 500, 502, 503].flatMap((status) => [
      c.joinFailed(Object.assign(new Error("x"), { status }), null),
      c.listFailed({ status }, null),
      c.gameFailed({ status }, null),
    ]),
    ...[4210, 4211, 4212, 4213, 4214, 4216, 1006, 4000].map((code) => c.joinFailed({ name: "ServerError", code, message: "internal" }, null)),
    c.lostInLobby(),
    c.serverRestarted(),
    c.tableTrouble(),
    c.reconnectGaveUp(),
  ];
  for (const text of all) {
    assert.equal(typeof text, "string");
    assert.doesNotMatch(text, RAW, text);
    assert.doesNotMatch(text, /internal|Failed|NetworkError|Load failed/, text);
    assert.match(text, NEXT, `says what to do: ${text}`);
    assert.doesNotMatch(text, /press Join/i, `the button says Play: ${text}`);
  }
});
