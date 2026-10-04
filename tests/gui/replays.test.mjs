// Replays on the home screen (web/replayView.js, web/replay.js) in a real
// browser: the list of saved games, the date filter, and the viewer. The server
// starts on a data folder seeded with the fixture games (tests/lib/
// historyFixtures.mjs), so the page is tested on its own first; the last test
// plays a game on the server and finds it in the list. Tests run in order on
// one page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, tempDir, until, wait } from "../lib/harness.mjs";
import { boardAfter, fixtureGames, seedHistory } from "../lib/historyFixtures.mjs";
import { guiRig } from "./page.mjs";

const [sep01] = fixtureGames();
let rig, b;
before(async () => {
  const dataDir = tempDir("replays");
  seedHistory(dataDir);
  rig = await guiRig({ dataDir });
  b = rig.browser;
  await b.load(rig.url({ name: "Viewer", nowelcome: "1" }));
  await b.waitFor("joinButton.disabled === false", 15000, "the page-load rejoin to answer");
});
after(async () => rig?.close());

const listed = () => b.ev(`Array.from(document.querySelectorAll("#replays-list button[data-id]")).map((el) => el.dataset.id)`);
const status = () => b.ev(`document.getElementById("replays-status").textContent`);
const index = () => b.ev("replays.player.index");
/** A cheap fingerprint of what the replay canvas shows. */
const canvasPrint = () =>
  b.ev(`(() => {
    const c = document.getElementById("replay-board"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let h = 0, colours = new Set();
    for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] * 7 + d[i + 1] * 3 + d[i + 2]) >>> 0; if (i % 64 === 0) colours.add(d[i] + "," + d[i + 1] + "," + d[i + 2]); }
    return { w: c.width, h: c.height, cssW: c.getBoundingClientRect().width, hash: h, colours: colours.size };
  })()`);

/** Sets a date field as a picked date would, and lets the page hear it. */
async function setDate(id, value) {
  await b.ev(`(() => { const el = document.getElementById("${id}"); el.value = "${value}"; el.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
}

test("replays: the home screen has a Replays button that opens the saved games, newest first", async () => {
  assert.equal(await b.ev("document.getElementById('home-replays').textContent.trim()"), "Replays");
  await rig.clickEl("#home-replays");
  await b.waitFor("document.getElementById('replays').open", 5000, "the Replays dialog");
  await b.waitFor(`document.querySelectorAll("#replays-list button[data-id]").length === 3`, 5000, "the three saved games");
  assert.deepEqual(await listed(), ["fx-game-oct01", "fx-game-sep15", "fx-game-sep01"]);
  assert.equal(await status(), "3 games");
  assert.equal(await b.ev("document.getElementById('replays-viewer').hidden"), true, "the viewer waits for a pick");
  rig.assertClean();
});

test("replays: each game in the list says when it ended, who played by place, and how it ended", async () => {
  const text = (id) => b.ev(`document.querySelector('#replays-list button[data-id="${id}"]').textContent`);
  const oct = await text("fx-game-oct01");
  assert.match(oct, /1 Oct 2026, 18:30/);
  assert.match(oct, /Moyo 1st · Cleo 2nd · Shark 3rd · Ko 3rd/);
  assert.match(oct, /6 turns · finished · debug/);
  assert.match(await text("fx-game-sep15"), /Bram · Honte · Honte 2 · Tesuji[\s\S]*abandoned/);
});

test("replays: From and To narrow the list to the games that ended on those days", async () => {
  await setDate("replays-from", "2026-09-02");
  await setDate("replays-to", "2026-09-30");
  await b.waitFor(`document.querySelectorAll("#replays-list button[data-id]").length === 1`, 5000, "the filtered list");
  assert.deepEqual(await listed(), ["fx-game-sep15"]);
  assert.equal(await status(), "1 game");
  await setDate("replays-from", "2026-09-01");
  await setDate("replays-to", "2026-09-01");
  await b.waitFor(`document.querySelector("#replays-list button[data-id]")?.dataset.id === "fx-game-sep01"`, 5000, "one day");
  assert.deepEqual(await listed(), ["fx-game-sep01"]);
});

test("replays: the presets fill the dates; Today finds none of these games, All finds them all", async () => {
  await rig.clickEl('#replays-presets button[data-preset="today"]');
  await b.waitFor(`document.querySelectorAll("#replays-list button[data-id]").length === 0`, 5000, "no games today");
  assert.equal(await status(), "No games on these days.");
  const today = await b.ev("document.getElementById('replays-from').value");
  assert.equal(today, await b.ev("document.getElementById('replays-to').value"));
  assert.equal(today, await b.ev("GoReplay.toDateInput(Date.now())"));
  await rig.clickEl('#replays-presets button[data-preset="all"]');
  await b.waitFor(`document.querySelectorAll("#replays-list button[data-id]").length === 3`, 5000, "every game again");
  assert.equal(await b.ev("document.getElementById('replays-from').value"), "");
  assert.equal(await b.ev("document.getElementById('replays-to').value"), "");
});

test("replays: picking a game opens it at its first step, the empty board, drawn on the canvas", async () => {
  await rig.clickEl('#replays-list button[data-id="fx-game-sep01"]');
  await b.waitFor("replays.record && replays.record.id === 'fx-game-sep01'", 5000, "the game to load");
  await b.waitFor("!document.getElementById('replays-viewer').hidden", 5000, "the viewer");
  assert.equal(await b.ev("document.getElementById('replays-list-pane').hidden"), true);
  assert.equal(await index(), 0);
  assert.equal(await b.ev("document.getElementById('replay-step').textContent"), "Step 1 of 7 · turn 0");
  assert.equal(await b.ev("document.getElementById('replay-event').textContent"), "Game started");
  assert.ok(await b.ev("replays.steps[0].board.every((c) => c === 0)"));
  await wait(200);
  const print = await canvasPrint();
  assert.ok(print.w > 0 && print.cssW > 0 && print.colours >= 3, JSON.stringify(print));
  rig.assertClean();
});

test("replays: the step buttons and the arrow keys move through the game, and the board follows", async () => {
  const first = (await canvasPrint()).hash;
  for (let i = 0; i < 4; i++) await rig.clickEl("#replay-fwd");
  assert.equal(await index(), 4);
  assert.deepEqual(await b.ev("replays.steps[replays.player.index].board"), boardAfter(sep01, 4));
  assert.equal(await b.ev("document.getElementById('replay-event').textContent"), "P4 played (3, 3)");
  await wait(200);
  assert.notEqual((await canvasPrint()).hash, first, "the canvas shows the stones");
  await rig.clickEl("#replay-back");
  assert.equal(await index(), 3);
  await b.key("ArrowRight");
  await b.key("ArrowRight");
  assert.equal(await index(), 5);
  assert.equal(await b.ev("document.getElementById('replay-event').textContent"), "P2 played (0, 1), captured 1");
  await b.key("ArrowLeft");
  assert.equal(await index(), 4);
  await b.key("End");
  assert.equal(await index(), 6);
  await b.key("Home");
  assert.equal(await index(), 0);
  await rig.clickEl("#replay-last");
  assert.equal(await index(), 6);
  assert.equal(await b.ev("document.getElementById('replay-fwd').disabled"), true);
  await rig.clickEl("#replay-first");
  assert.equal(await index(), 0);
  assert.equal(await b.ev("document.getElementById('replay-back').disabled"), true);
});

test("replays: the slider follows the play head and moves it", async () => {
  await rig.clickEl("#replay-fwd");
  assert.equal(await b.ev("document.getElementById('replay-slider').value"), "1");
  assert.equal(await b.ev("document.getElementById('replay-slider').max"), "6");
  await b.ev(`(() => { const s = document.getElementById("replay-slider"); s.value = "5"; s.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  assert.equal(await index(), 5);
});

test("replays: Play runs the game to its end by itself and stops there; Space pauses", async () => {
  await rig.clickEl("#replay-first");
  await b.ev(`(() => { const s = document.getElementById("replay-speed"); s.value = "8"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await rig.clickEl("#replay-play");
  assert.equal(await b.ev("replays.player.playing"), true);
  assert.equal(await b.ev("document.getElementById('replay-play').getAttribute('aria-label')"), "Pause");
  await b.waitFor("replays.player.index === 6 && !replays.player.playing", 5000, "the replay to reach the end");
  assert.equal(await b.ev("document.getElementById('replay-play').getAttribute('aria-label')"), "Play");
  await rig.clickEl("#replay-first");
  await b.ev(`(() => { const s = document.getElementById("replay-speed"); s.value = "1"; s.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
  await b.ev("document.getElementById('replay-board').focus(); true");
  await b.key(" ", "Space");
  assert.equal(await b.ev("replays.player.playing"), true);
  await b.key(" ", "Space");
  assert.equal(await b.ev("replays.player.playing"), false);
});

test("replays: the viewer shows when the game was played and how everyone finished", async () => {
  const text = await b.ev("document.getElementById('replays-viewer').textContent");
  assert.match(text, /1 Sep 2026, 20:05/);
  const standings = await b.ev("document.getElementById('replay-players').textContent");
  assert.match(standings, /1st\s*Alice/);
  assert.match(standings, /4th\s*Ko/);
});

test("replays: every control in the dialog, list and viewer alike, has an accessible name", async () => {
  const ids = ["replays-close", "replays-from", "replays-to", "replay-board", "replay-first", "replay-back", "replay-play", "replay-fwd", "replay-last", "replay-slider", "replay-speed", "replay-back-list"];
  assert.deepEqual(await b.ev(`${JSON.stringify(ids)}.filter((id) => !document.getElementById(id))`), [], "the dialog's controls are all there");
  const unnamed = await b.ev(`Array.from(document.querySelectorAll("#replays button, #replays input, #replays select, #replays canvas[tabindex]"))
    .filter((el) => el.tabIndex >= 0)
    .filter((el) => {
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent.trim() ||
        (el.labels && Array.from(el.labels).map((l) => l.textContent.trim()).join(""));
      return !label;
    })
    .map((el) => el.outerHTML.slice(0, 80))`);
  assert.deepEqual(unnamed, []);
});

test("replays: All games goes back to the list; closing leaves the home screen as it was", async () => {
  await rig.clickEl("#replay-back-list");
  assert.equal(await b.ev("document.getElementById('replays-list-pane').hidden"), false);
  assert.equal(await b.ev("document.getElementById('replays-viewer').hidden"), true);
  assert.equal(await b.ev("replays.player.playing"), false);
  await rig.clickEl("#replays-close");
  assert.equal(await b.ev("document.getElementById('replays').open"), false);
  assert.equal(await b.ev("lobbyEl.hidden"), false);
  assert.equal(await b.ev("joinButton.disabled"), false);
  rig.assertClean();
});

test("replays: a game played on this server shows up in the list and replays its stone", async () => {
  const { Client } = colyseus();
  const key = () => `k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rooms = [await new Client(rig.server.ws).create("go_custom", { name: "Nia", playerKey: key() })];
  for (const name of ["Oto", "Pia", "Quin"]) rooms.push(await new Client(rig.server.ws).joinById(rooms[0].roomId, { name, playerKey: key() }));
  try {
    await until(() => rooms[0].state.status === "playing", 5000, "the game to start");
    const onTurn = () => rooms.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);
    const mover = onTurn();
    mover.send("move", { x: 6, y: 6, axis: "base" });
    await until(() => rooms[0].state.turnCount === 1, 5000, "the move");
    const color = Array.from(rooms[0].state.players).find((p) => p.sessionId === mover.sessionId).color;
    for (let i = 0; i < 4; i++) {
      const before = rooms[0].state.turnCount;
      onTurn().send("pass");
      await until(() => rooms[0].state.turnCount > before || rooms[0].state.status === "finished", 5000, `pass ${i + 1}`);
    }
    await until(() => rooms[0].state.status === "finished", 5000, "the end of the game");

    await rig.clickEl("#home-replays");
    await b.waitFor(`document.querySelectorAll("#replays-list button[data-id]").length === 4`, 5000, "the new game in the list");
    const newest = (await listed())[0];
    assert.match(await b.ev(`document.querySelector('#replays-list button[data-id]').textContent`), /Nia|Oto|Pia|Quin/);
    await rig.clickEl(`#replays-list button[data-id="${newest}"]`);
    await b.waitFor(`replays.record && replays.record.id === "${newest}"`, 5000, "the new game to load");
    await b.ev("document.getElementById('replay-board').focus(); true");
    await b.key("End");
    assert.equal(await b.ev("replays.steps[replays.player.index].board[6 * 13 + 6]"), color);
    assert.match(await b.ev("document.getElementById('replay-event').textContent"), /^Game over/);
    rig.assertClean();
  } finally {
    for (const r of rooms) await leaveQuietly(r);
  }
});
