// The browser as one of four humans at a debug table, the other three played by
// Colyseus clients from here (quick, so storms come round fast). Covers the
// storm's grey in the client (findings B6-B9, was findings-tests/client-browser.mjs)
// and the end of the game: Results. Tests in this file share one table and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly, until, wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

const { Client } = colyseus();
let rig, b, others = [], playing = true;

/** The three other seats take their turns with random points that look free to them. */
async function playOthers() {
  while (playing) {
    for (const r of others) {
      const s = r.state;
      if (s.status !== "playing" || s.players[s.turnIndex]?.sessionId !== r.sessionId) continue;
      const me = Array.from(s.players).find((p) => p.sessionId === r.sessionId);
      const cells = Array.from(s.seen);
      const m = Array.from(me.misted || []);
      for (let i = 0; i + 1 < m.length; i += 2) cells[m[i]] = m[i + 1];
      const free = cells.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
      const i = free[Math.floor(Math.random() * free.length)];
      r.send("move", { x: i % s.size, y: (i / s.size) | 0, axis: Math.random() < 0.5 ? "base" : "pattern" });
    }
    await wait(60);
  }
}

// The browser's own turns: random base stones on points that look free to it.
const AUTOPLAY = `window.__auto = setInterval(() => {
  if (!room || !isMyTurn || !lastState) return;
  const free = Array.from(board).map((c, i) => (c ? -1 : i)).filter((i) => i >= 0), n = lastState.size;
  const i = free[Math.floor(Math.random() * free.length)];
  room.send("move", { x: i % n, y: (i / n) | 0, axis: "base" });
}, 150); true`;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Tester", room: "go_debug", nowelcome: "1" }));
  await b.waitFor("joinButton.disabled === false", 15000, "Join to unlock");
  await b.ev("joinButton.click(); true");
  await b.waitFor("!!room && !!lastState", 15000, "a table");
  const roomId = await b.ev("room.roomId");
  for (const n of ["B", "C", "D"]) others.push(await new Client(rig.server.ws).joinById(roomId, { name: n, playerKey: `${n}-${Date.now()}` }));
  await b.waitFor("lastState.status === 'playing'", 10000, "the game to start");
});
after(async () => {
  playing = false;
  for (const r of others) await leaveQuietly(r);
  await rig?.close();
});

test("table: a storm breaks during play and the client shows the cloudburst", async () => {
  const loop = playOthers();
  await b.ev(AUTOPLAY);
  await b.waitFor("lastStormSeq > 0", 180000, "a storm to break");
  await b.ev("clearInterval(window.__auto); true");
  assert.match(await b.ev("noticeEl.textContent"), /Thunder/);
  playing = false;
  await loop;
  playing = true;
  void playOthers(); // the others play on until it is my turn again
  await b.waitFor("storm === null && isMyTurn", 60000, "the cloudburst to pass and my turn");
  playing = false;
  assert.equal(await b.ev("stormGreys()"), true, "the grey is still on for the checks below");
});

/** In-page tools: turn every stone and owner to the next player's colour, and count changed pixels. */
const P2 = `window.__p2 = {
  rot(c) { return c >= 1 && c <= 4 ? (c % 4) + 1 : c >= 5 && c <= 8 ? ((c - 4) % 4) + 5 : c >= 10 && c <= 13 ? ((c - 9) % 4) + 10 : c; },
  recolor(b) { return Array.from(b, (c) => this.rot(c)); },
  diff(s1, s2) { const a = scene.render(s1).slice(), b = scene.render(s2); let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; },
}; true`;

test("table (B6): a recalled board is drawn as grey as the live one while the storm lasts", async () => {
  await b.ev(P2);
  await b.ev("window.__args = null; window.__r1 = scene.render; scene.render = function (...a) { window.__args = a[0]; return window.__r1.apply(this, a); }; true");
  const r = await b.ev(`(async () => {
    viewId = history[0].id;
    await new Promise((res) => setTimeout(res, 300));
    const a = window.__args;
    const out = { stones: a.board.filter(Boolean).length, stormTurnCount: a.stormTurnCount, turnCount, argUntil: a.stormUntil, liveUntil: stormUntil,
      diff: __p2.diff(a, Object.assign({}, a, { board: __p2.recolor(a.board) })) };
    viewId = null;
    scene.render = window.__r1;
    return out;
  })()`);
  assert.ok(r.stones > 0, JSON.stringify(r));
  assert.equal(r.stormTurnCount, r.turnCount);
  assert.equal(r.argUntil, r.liveUntil);
  assert.equal(r.diff, 0, "recolouring the recalled board changes no pixel");
});

test("table (B8): arming an own-stone item in the storm marks none of my stones, and the hint says why", async () => {
  const r = await b.ev(`(() => {
    const id = Array.from(OWN_STONE_TARGET_ITEMS).find((k) => marketItem(k));
    if (!id) return { skipped: true };
    setSelectedPowerup(id);
    const out = { storm: ownStoneHighlight(board), hint: boardHintEl.textContent };
    const keep = stormUntil; stormUntil = 0;
    out.calm = ownStoneHighlight([0, myPlayer.color, 0]); out.calmHint = targetingText();
    stormUntil = keep;
    setSelectedPowerup(null);
    return { storm: out.storm, calm: out.calm && out.calm.length, hint: out.hint, calmHint: out.calmHint };
  })()`);
  if (r.skipped) return; // this match's market stocks no own-stone item: nothing to arm
  assert.equal(r.storm, null);
  assert.ok(r.calm > 0);
  assert.match(r.hint, /storm hides/);
  assert.match(r.calmHint, /ember/);
});

test("table (B9): no stone preview over a rival's mist; one's own mist still offers it", async () => {
  const r = await b.ev(`(() => {
    const n = lastState.size, i = Array.from(board).findIndex((c) => !c);
    const x = i % n, y = (i / n) | 0, rival = myPlayer.color % 4 + 1, keep = hoverPoint;
    hoverPoint = { x, y };
    overlays.push({ kind: "mist", x, y, owner: rival });
    const theirs = hoverKind();
    overlays[overlays.length - 1].owner = myPlayer.color;
    const mine = hoverKind();
    overlays.pop();
    hoverPoint = keep;
    return { theirs, mine };
  })()`);
  assert.deepEqual(r, { theirs: "none", mine: "stone" });
});

test("table: four passes end the game and Results opens by itself with every seat", async () => {
  const onTurn = () => others.find((r) => r.state.players[r.state.turnIndex]?.sessionId === r.sessionId);
  for (let t = 0; t < 40; t++) {
    if (await b.ev("lastState.status === 'finished'")) break;
    if (await b.ev("isMyTurn")) await b.ev("passButton.click(); true");
    else onTurn()?.send("pass");
    await wait(150);
  }
  await b.waitFor("lastState.status === 'finished'", 10000, "the game to finish");
  await b.waitFor("resultEl.open", 5000, "Results to open");
  const r = await b.ev(`({
    rows: document.querySelectorAll("#result-table .result-row:not(.head)").length,
    summary: document.getElementById("result-summary").textContent,
    you: Array.from(document.querySelectorAll("#result-table .name")).filter((e) => /\\(you\\)/.test(e.textContent)).length,
    territory: document.getElementById("result-territory").children.length,
  })`);
  assert.equal(r.rows, 4);
  assert.equal(r.you, 1);
  assert.match(r.summary, /(wins|share first place) with \d+\./);
  assert.ok(r.territory > 0, "the territory diagrams are drawn");
  assert.equal(await b.ev("passButton.hidden"), true);
  assert.equal(await b.ev("resultButton.hidden"), false);
});

test("table: Results closes, and the Results button opens it again", async () => {
  await b.ev("resultCloseButton.click(); true");
  await b.waitFor("!resultEl.open", 3000, "Results to close");
  await b.ev("resultButton.click(); true");
  await b.waitFor("resultEl.open", 3000, "Results to open again");
  assert.match(await b.ev("roomStatusEl.textContent"), /Game finished/);
  rig.assertClean("the table");
});
