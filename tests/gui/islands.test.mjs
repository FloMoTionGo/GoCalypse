// Lobby islands on the home screen (tasks/2026-11-02_lobby_islands), in a real
// browser against a real server: the main island sits left of centre, and every
// open lobby is an islet in the river, its seats as stones (bots by initial),
// labelled "Lobby n/4". Clicking one joins that lobby; one that fills sinks.
// Tests in this file share one page and one host's table, and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { colyseus, leaveQuietly } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b, host;
before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Islander" }));
  await b.waitFor("joinButton.disabled === false", 15000, "the page-load rejoin to answer");
});
after(async () => {
  if (host) await leaveQuietly(host);
  await rig?.close();
});

const islet = (id) => `GoLobbyIslets.list().find((t) => t.roomId === ${JSON.stringify(id)})`;

test("islands: the main island sits left of centre, a quarter of the river's width", async () => {
  const r = await b.ev(`(() => {
    const l = document.getElementById("logo").getBoundingClientRect(), i = document.getElementById("lobby-board-wrap").getBoundingClientRect();
    return { mid: l.left + l.width / 2, isle: i.left + i.width / 2, w: l.width, gap: i.left - l.left, u: l.width / document.getElementById("logo").width };
  })()`);
  const quarter = r.w / 4;
  const clamped = r.gap <= 27 * r.u; // a narrow river: the island stops at its left end
  assert.ok(clamped || Math.abs(r.mid - r.isle - quarter) <= 2 * r.u, `the island's middle is ${(r.mid - r.isle).toFixed(1)} px left of the river's, a quarter is ${quarter.toFixed(1)}`);
  assert.ok(r.isle < r.mid, "left of centre");
  rig.assertClean();
});

test("islands: an open lobby shows as an islet with its seats as stones, its bots by initial, and a Lobby label", async () => {
  const { Client } = colyseus();
  host = await new Client(rig.server.ws).create("go_custom", { name: "Hostname", playerKey: `host-${Date.now()}`, size: 19 });
  host.send("addBots", { ids: ["shark"] });
  await b.waitFor(`${islet(host.roomId)}?.phase === "idle" && ${islet(host.roomId)}.seats.filter(Boolean).length === 2`, 15000, "the host's islet with its bot");
  const t = await b.ev(islet(host.roomId));
  const me = host.state.players.find((p) => !p.bot), bot = host.state.players.find((p) => p.bot);
  assert.equal(t.size, 19);
  assert.equal(t.seats[me.color - 1], "p", "the host's stone at their colour");
  assert.equal(t.seats[bot.color - 1], "bot:shark", "the bot's stone at its colour");
  assert.deepEqual(t.stones.find((s) => s.seat === bot.color - 1)?.letter, "K", "Ko's stone carries its initial");
  assert.equal(t.stones.find((s) => s.seat === me.color - 1)?.letter, null, "a person's stone is plain");
  assert.equal(t.label, "Lobby 2/4");
  const name = await b.ev(`document.querySelector('.islet-label[data-room="${host.roomId}"]').getAttribute("aria-label")`);
  assert.match(name, /19×19/);
  assert.match(name, /Ko/);
  assert.match(name, /2 seats free/);
  assert.doesNotMatch(name, /Hostname/, "nobody's name on the home screen");
  const drawn = await b.ev(`(() => { const c = document.getElementById("lobby-islets"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; })()`);
  assert.ok(drawn > 500, `the islet is drawn (${drawn} px)`);
  rig.assertClean();
});

test("islands: clicking an islet's label joins that very lobby", async () => {
  await rig.clickEl(`.islet-label[data-room="${host.roomId}"]`);
  await b.waitFor(`room && room.roomId === ${JSON.stringify(host.roomId)} && !gameEl.hidden`, 10000, "the page at the host's table");
  await b.waitFor("lastState && lastState.players.length === 3", 5000, "three at the table");
  await b.ev("document.getElementById('leave-button').click(); true");
  try {
    await b.waitFor("document.getElementById('leave-dialog').open", 3000, "the Leave dialog");
    await rig.clickEl("#leave-confirm");
  } finally {
    await b.ev("(() => { const d = document.getElementById('leave-dialog'); if (d.open) d.close(); return true; })()");
  }
  await b.waitFor("!lobbyEl.hidden && gameEl.hidden", 5000, "back home");
  rig.assertClean();
});

test("islands: a lobby that fills sinks with lanterns and leaves the river", async () => {
  await b.waitFor(`${islet(host.roomId)}?.seats.filter(Boolean).length === 2`, 15000, "the islet without the one who left");
  host.send("addBots", { ids: ["pure", "pure"] });
  await b.waitFor(`${islet(host.roomId)}?.phase === "sink"`, 15000, "the islet to sink");
  assert.equal(await b.ev(`${islet(host.roomId)}.lanterns`), true, "its stones go off as lanterns");
  await b.waitFor(`!${islet(host.roomId)}`, 15000, "the islet gone");
  assert.equal(await b.ev(`document.querySelectorAll('.islet-label[data-room="${host.roomId}"]').length`), 0, "its label too");
  rig.assertClean();
});
