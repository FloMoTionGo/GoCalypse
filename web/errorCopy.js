// GoCalypse error copy (review U4): what the page says when a join, a seat, the
// connection or a replay fails. Every sentence says what happened and what to
// do next, in words: no status or close codes, nothing a browser or colyseus.js
// wrote. The server's own refusals at the door (util/limits.ts in the server)
// are written for people already and are shown as they are. Plain script, no
// dependencies: `window.GoErrorCopy` in the browser, `module.exports` in Node
// (tests/web/errorCopy.test.mjs). main.js and replayView.js put it on screen and
// keep the details in the console. The button the copy points at reads
// "Play online" or "Play with N bots" (main.js), so it says "press Play".
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GoErrorCopy = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Codes colyseus.js hands the page (@colyseus/core ErrorCode).
  const NO_SUCH_ROOM_TYPE = 4210; // the server hosts no "go_custom" tables: another program at that address
  const ROOM_GONE = [4211, 4212, 4214]; // no table matched, the table locked or closed, the seat expired
  const REFUSED_AT_THE_DOOR = 4215; // GoRoom.onAuth: one of the address caps, in the server's words
  const REFUSED_AT_THE_TABLE = 4216; // GoRoom.onJoin threw: "This table is full." or something internal
  const TABLE_FULL = "This table is full."; // GoRoom.onJoin's own refusal

  /** "the server" for the usual one, "the server at <host>" for one typed into the Server field. */
  const server = (host) => (host ? `the server at ${host}` : "the server");
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

  /**
   * The request never got an answer: fetch's TypeError, or colyseus.js's
   * ServerError without a code, whatever words the browser chose
   * ("Failed to fetch", "NetworkError when attempting...", "Load failed").
   */
  function unreachable(err) {
    return !!err && typeof err.code !== "number" && typeof err.status !== "number";
  }

  /** Why a join didn't seat you, from what connect() caught. `host` names a typed server, or is null. */
  function joinFailed(err, host) {
    if (unreachable(err)) {
      return host
        ? `Can't reach ${server(host)}. Check the Server field at the bottom of the page, then press Play again.`
        : "Can't reach the server. Check your internet connection, then press Play again.";
    }
    // rejoin(): the server has your game but would not hand the seat back yet.
    if (typeof err.status === "number") {
      return err.status === 429
        ? "Too many tries to get your seat back at once: wait a few seconds, then press Play."
        : "Your seat in the game couldn't be handed back just now. Wait a moment, then press Play.";
    }
    const message = String(err.message || "").trim();
    if (err.code === REFUSED_AT_THE_DOOR && message) return message;
    if (err.code === REFUSED_AT_THE_TABLE && message === TABLE_FULL) {
      return "That table filled up just as you joined. Press Play to find another one.";
    }
    if (err.code === NO_SUCH_ROOM_TYPE) {
      return `${capital(server(host))} has no GoCalypse tables. Check the Server field at the bottom of the page, then press Play again.`;
    }
    if (ROOM_GONE.includes(err.code)) return "That table closed just as you joined. Press Play to find another one.";
    return "The server couldn't seat you just now. Wait a moment, then press Play again.";
  }

  /** The server came back after a restart, but a table still waiting for players doesn't survive one. */
  function serverRestarted() {
    return "The server restarted. Press Play to start a new table.";
  }

  /** The socket closed while you waited for players (a seat in a lobby is not held). */
  function lostInLobby() {
    return "The connection to the server dropped. Press Play to sit down again.";
  }

  /** room.onError once seated: the connection to the table reported trouble. */
  function tableTrouble() {
    return "The connection to the table had a problem. If the board stops changing, refresh the page to sit back down.";
  }

  /** rejoinAfterDrop() knocked ten times and nobody answered. */
  function reconnectGaveUp() {
    return "The server isn't answering. Refresh the page in a minute to try again.";
  }

  /** The Replays list could not be fetched. */
  function listFailed(err, host) {
    if (unreachable(err)) {
      return host
        ? `Can't reach ${server(host)} to list the games. Check the Server field at the bottom of the page, then open Replays again.`
        : "Can't reach the server to list the games. Check your internet connection, then open Replays again.";
    }
    return "The server couldn't list the games just now. Wait a moment, then open Replays again.";
  }

  /** One saved game could not be fetched. */
  function gameFailed(err, host) {
    if (unreachable(err)) return `Can't reach ${server(host)} to load that game. Check your internet connection, then pick it again.`;
    if (err.status === 404) return "That game is no longer on the server. Pick another one from the list.";
    return "That game couldn't be loaded just now. Wait a moment, then pick it again.";
  }

  return { joinFailed, serverRestarted, lostInLobby, tableTrouble, reconnectGaveUp, listFailed, gameFailed };
});
