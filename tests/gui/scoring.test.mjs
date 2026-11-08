// Picking a table's scoring mode on the lobby board, and what the table then says about
// it. A debug room with three bots.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Scorer", room: "go_debug", nowelcome: "1" }));
  await b.waitFor("!!window.GoLobbyIsland", 10000, "the lobby board");
});

after(async () => rig?.close());

test("scoring modes: the lobby board offers GoCalypse, Japanese and Chinese, GoCalypse to begin with", async () => {
  assert.deepEqual(await b.ev("window.GoLobbyIsland.modes.map((m) => m.mode)"), ["gocalypse", "japanese", "chinese"]);
  assert.equal(await b.ev("scoringPick()"), "gocalypse");
});

test("scoring modes: a black stone on Japanese picks it, the page remembers it, and the table is Japanese", async () => {
  const p = await b.ev(`window.GoLobbyIsland.modes.find((m) => m.mode === "japanese")`);
  await rig.clickLobby(p.col, p.row);
  assert.equal(await b.ev("scoringPick()"), "japanese");
  await b.load(rig.url({ name: "Scorer", room: "go_debug", nowelcome: "1" }));
  await b.waitFor("!!window.GoLobbyIsland", 10000, "the lobby board again");
  assert.equal(await b.ev("scoringPick()"), "japanese", "remembered");
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState && lastState.status === 'playing'", 15000, "the table");
  assert.equal(await b.ev("lastState.scoring"), "japanese");
  rig.assertClean("the Japanese table");
});

test("scoring modes: How to play says how this table counts, and what happens to dead groups", async () => {
  await b.ev("helpButton.click(); true");
  await b.waitFor("welcomeEl.open", 3000, "How to play");
  const text = await b.ev("document.getElementById('welcome-scoring').textContent");
  assert.match(text, /Japanese/);
  assert.match(text, /every prisoner/i);
  assert.match(text, /dead/i);
  assert.match(text, /in doubt/i);
  await b.ev("welcomeCloseButton.click(); true");
  await b.waitFor("!welcomeEl.open", 3000, "How to play to close");
});

test("scoring modes: the results name the mode, say how many stones were dead, and spell Chinese totals as stones", async () => {
  const r = await b.ev(`(() => {
    const fake = Object.create(lastState);
    const players = Array.from(lastState.players).map((p, i) => Object.assign(Object.create(p), { place: i + 1, finalScore: 10 - i, baseTerritory: 6, patternTerritory: 7, baseCounted: 4, patternCounted: 3, basePrisoners: 1, patternPrisoners: 0 }));
    Object.defineProperty(fake, "players", { value: players });
    Object.defineProperty(fake, "scoring", { value: "chinese" });
    Object.defineProperty(fake, "deadStones", { value: [3, 4, 5] });
    openResult(fake);
    const out = { mode: document.getElementById("result-scoring").textContent, table: document.getElementById("result-table").textContent };
    resultEl.close();
    return out;
  })()`);
  assert.match(r.mode, /Chinese/);
  assert.match(r.mode, /3 dead stones/);
  assert.match(r.table, /6 territory \+ 4 stones/);
});

test("scoring modes: a GoCalypse table says that whatever stands is alive", async () => {
  const facts = await b.ev(`(() => {
    const fake = Object.create(lastState);
    Object.defineProperty(fake, "scoring", { value: "gocalypse" });
    return scoringFacts(fake).map((f) => f[2]).join(" ");
  })()`);
  assert.match(facts, /stands is alive/i);
  assert.match(facts, /never more/i);
});
