// The players panel as a strip of kaya (the Kaya scorebook design, "Full grid"):
// a Go grid of 22 x 28 art px cells under everything, each seat's two stones on
// its intersections after a turn-order digit, the name on a plate of the row's
// colour, the captures and the Kata on the grid to the right. Joined under the
// longest name the server allows, with three bots in a debug room; the tests
// share one page and run in order. States the live game can't reach quickly (a
// seat away, the game over) are drawn by renderPlayers from a made-up state and
// measured in the same evaluation, so no live update gets in between.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;
const LONG_NAME = "Rindfleischetikettierung"; // 24 code points: the server's cap (server/src/util/usernames.ts)

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: LONG_NAME, room: "go_debug", nowelcome: "1" }));
  await rig.joinWithBots([0, 0, 0]); // three Hontes
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
});

after(async () => rig?.close());

/** Every row of the panel, measured, in CSS px; `seen` multiplies the opacities up to the panel. */
const ROWS = `(() => {
  const box = (el) => {
    if (!el) return null;
    const q = el.getBoundingClientRect();
    return { l: q.left, r: q.right, t: q.top, b: q.bottom, w: q.width, h: q.height, cx: (q.left + q.right) / 2, cy: (q.top + q.bottom) / 2 };
  };
  const seen = (el) => {
    let o = 1;
    for (; el && el !== playersEl; el = el.parentElement) o *= +getComputedStyle(el).opacity;
    return o;
  };
  return {
    px: artPx(),
    panel: box(playersEl),
    sidebar: box(document.getElementById("sidebar")),
    v: Array.from(playersEl.querySelectorAll(".grid .v")).map(box),
    h: Array.from(playersEl.querySelectorAll(".grid .h")).map(box),
    ff: playersEl.querySelectorAll(".ff").length,
    rows: Array.from(playersEl.querySelectorAll(".player-row")).map((r) => {
      const name = r.querySelector(".name"), plate = r.querySelector(".plate"), stamp = r.querySelector(".stamp");
      const stones = Array.from(r.querySelectorAll(".stones img")), count = r.querySelector(".count");
      return {
        row: box(r),
        current: r.classList.contains("current"),
        text: r.textContent,
        name: name ? name.textContent : null,
        nameLines: name ? name.getClientRects().length : 0,
        nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : true,
        nameSeen: name ? seen(name) : 0,
        bot: (r.querySelector(".bot") || {}).textContent || "",
        you: r.querySelectorAll("img.you").length,
        stamp: stamp ? stamp.textContent + (stamp.querySelector("img") || {}).alt : "",
        stampSeen: stamp ? seen(stamp) : 0,
        coord: box(r.querySelector("img.coord")),
        coordAlt: (r.querySelector("img.coord") || {}).alt || "",
        stones: stones.map(box),
        stonesSeen: stones.map(seen),
        plate: box(plate),
        plateSeen: plate ? seen(plate) : 0,
        plateBg: plate ? getComputedStyle(plate).backgroundColor : "",
        capt: box(r.querySelector(".capt")),
        count: box(count),
        countLabel: count ? count.getAttribute("aria-label") || "" : "",
        digits: count ? count.querySelectorAll("img").length : 0,
        kata: box(r.querySelector(".card-mini")),
      };
    }),
  };
})()`;

/** A page expression: `seats` drawn by renderPlayers as a made-up state, measured with ROWS, then the live state drawn back. */
function madeUp(status, seats, turnIndex = 0) {
  return `(() => {
    const players = ${JSON.stringify(seats)}.map((s, i) => Object.assign({
      sessionId: s.me ? room.sessionId : "seat" + i, name: "Seat " + (i + 1), color: i + 1, connected: true, bot: false,
      passed: false, jar: 0, mist: false, twin: false, extra: 0, score: 0, fireflies: 0, finalScore: 0, place: 0,
      card: [0, 0, 0, 0, 1, 0, 0, 0, 0], powerups: ["stone_card"],
    }, s));
    renderPlayers({ status: ${JSON.stringify(status)}, turnIndex: ${turnIndex}, players });
    const out = ${ROWS};
    renderPlayers(lastState);
    return out;
  })()`;
}

const near = (a, b, label, tol = 0.51) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);
const plain = (rgb) => /^rgb\(\d+, \d+, \d+\)$/.test(rgb); // no alpha: a solid colour

test("players: four seats on a kaya grid as wide as the sidebar, mine marked by the ember, the bots by (B), and no fireflies (B5)", async () => {
  const m = await b.ev(ROWS);
  assert.equal(m.rows.length, 4);
  near(m.panel.w, 264 * m.px, "the panel is 264 art px");
  near(m.sidebar.w, m.panel.w, "and so is the sidebar");
  assert.deepEqual(m.rows.filter((r) => r.you).map((r) => r.name), [LONG_NAME], "the ember on my row only");
  assert.equal(m.rows.filter((r) => r.bot === "(B)").length, 3, "three bots");
  for (const r of m.rows) assert.doesNotMatch(r.text, /\((you|bot)\)/, r.text);
  assert.equal(m.ff, 0, "no fireflies in the player area: the board shows mine, the others' are hidden");
  assert.ok(m.rows.every((r) => r.kata), "every seat's Kata shows");
});

test("players: every seat's two stones sit on grid intersections, after the turn-order digit on the first line", async () => {
  const m = await b.ev(ROWS);
  assert.equal(m.v.length, 12, "12 lines down");
  assert.equal(m.h.length, 4, "a line across each row");
  m.v.forEach((v, k) => {
    near(v.l, m.panel.l + (11 + 22 * k) * m.px, `line ${k} on its column`);
    near(v.w, m.px, `line ${k} one art px`);
  });
  m.rows.forEach((r, i) => {
    near(m.h[i].t, r.row.t + 13 * m.px, `row ${i}'s line through its middle`);
    // The digit is drawn at two art px a pixel, an even width and height: within half an art px of the crossing.
    near(r.coord.cx, m.v[0].cx, `row ${i}'s digit on the first line`, m.px / 2 + 0.01);
    near(r.coord.cy, m.h[i].cy, `row ${i}'s digit on its line`, m.px / 2 + 0.01);
    near(r.coord.h, 10 * m.px, `row ${i}'s digit twice the board margin's`);
    assert.equal(r.coordAlt, `Plays ${["1st", "2nd", "3rd", "4th"][i]}`);
    assert.equal(r.stones.length, 2);
    r.stones.forEach((s, j) => {
      near(s.cx, m.v[1 + j].cx, `row ${i} stone ${j} on line ${1 + j}`);
      near(s.cy, m.h[i].cy, `row ${i} stone ${j} on the row's line`);
      near(s.w, 15 * m.px, `row ${i} stone ${j} at board size`);
    });
    near(r.capt.cx, m.v[8].cx, `row ${i}'s captured icon on line 8`);
    near(r.count.cx, m.v[9].cx, `row ${i}'s count on line 9`, m.px);
    near(r.kata.cx, (m.v[10].cx + m.v[11].cx) / 2, `row ${i}'s Kata between lines 10 and 11`);
  });
});

test("players: a 24-character name stays on one line, its plate clear of the captured icon", async () => {
  const m = await b.ev(ROWS);
  const me = m.rows.find((r) => r.name === LONG_NAME);
  assert.ok(me, "my row");
  assert.equal(me.nameLines, 1, "one line");
  assert.equal(me.nameClipped, false, "the whole name shows");
  assert.ok(me.plate.l >= me.stones[1].r - 0.5, "the plate starts after the stones");
  assert.ok(me.plate.r <= me.capt.l - 0.5, `the plate ends before the captured icon: ${me.plate.r} vs ${me.capt.l}`);
  for (const r of m.rows) assert.ok(r.plate.r <= r.capt.l - 0.5, `${r.name}'s plate too`);
});

test("players: captured stones are counted in pixel digits on the grid, the count also in words", async () => {
  const m = await b.ev(`(() => ({ ...${ROWS}, scores: Array.from(lastState.players).sort((a, b) => a.color - b.color).map((p) => p.score) }))()`);
  m.rows.forEach((r, i) => {
    assert.equal(r.countLabel, `${m.scores[i]} stones captured`);
    assert.equal(r.digits, String(m.scores[i]).length, `${r.name}: one pixel digit per figure`);
  });
});

test("players: the seat whose turn it is is lit, and the light follows the turn", async () => {
  const LIT = `(() => { const m = ${ROWS};
    return { lit: m.rows.filter((r) => r.current).map((r) => r.name), turn: lastState.players[lastState.turnIndex].name }; })()`;
  await rig.waitMyTurn();
  let m = await b.ev(LIT);
  assert.deepEqual(m.lit, [LONG_NAME], "my row on my turn");
  await b.ev("passButton.click(); true");
  await b.waitFor("!isMyTurn", 10000, "a bot's turn");
  m = await b.ev(LIT);
  assert.deepEqual(m.lit, [m.turn], "the row of whoever's turn it is, alone");
});

test("players: a passed or away seat fades its stones and name, while its plates stay solid over the grid lines", async () => {
  const m = await b.ev(madeUp("playing", [
    { name: "Atsumi", score: 7 },
    { name: "Sternschnuppe", me: true, score: 12 },
    { name: LONG_NAME, score: 3, connected: false },
    { name: "Ko", bot: true, passed: true },
  ]));
  const [lit, mine, away, passed] = m.rows;
  assert.equal(lit.current, true);
  assert.ok(m.rows.every((r) => r.stones.length === 2), "two stones a seat");
  for (const r of [lit, mine]) {
    assert.ok(r.stonesSeen.every((o) => o === 1) && r.nameSeen === 1, `${r.name} in full`);
    assert.equal(r.stamp, "");
  }
  for (const r of [away, passed]) {
    assert.ok(r.stonesSeen.every((o) => o < 0.6), `${r.name}'s stones faded`);
    assert.ok(r.nameSeen < 0.6, `${r.name}'s name faded`);
    assert.equal(r.plateSeen, 1, `${r.name}'s plate stays solid`);
    assert.ok(plain(r.plateBg), `${r.name}'s plate is opaque: ${r.plateBg}`);
  }
  assert.match(away.stamp, /AWAY|Away/, "away says so");
  assert.equal(away.stampSeen, 1, "and the stamp isn't faded");
  assert.equal(passed.stamp, "", "a pass shows by the fade alone");
  assert.equal(away.nameLines, 1, "the long name on one line beside the stamp");
  assert.equal(away.nameClipped, false);
  assert.ok(away.plate.r <= away.capt.l - 0.5, "and its plate clear of the captured icon");
});

test("players: when the game is over each seat's digit is its place, the count its final score, the winner lit", async () => {
  const m = await b.ev(madeUp("finished", [
    { name: "Ko 3", bot: true, finalScore: 18, place: 2 },
    { name: "Sternschnuppe", me: true, finalScore: 24, place: 1 },
    { name: "Ko 2", bot: true, finalScore: 9, place: 4 },
    { name: "Ko", bot: true, finalScore: 15, place: 3, connected: false },
  ]));
  assert.deepEqual(m.rows.map((r) => r.coordAlt), ["Place: 2nd", "Place: 1st", "Place: 4th", "Place: 3rd"]);
  assert.deepEqual(m.rows.map((r) => r.countLabel), ["Final score 18", "Final score 24", "Final score 9", "Final score 15"]);
  assert.deepEqual(m.rows.map((r) => r.current), [false, true, false, false], "the winner's row lit");
  assert.ok(m.rows.every((r) => !r.capt), "no captured icon once it's scores");
  assert.ok(m.rows.every((r) => r.stamp === ""), "nobody away after the game");
});

test("hint: a lit Firefly Jar and a Mist show in the line under the board, now the players panel has no line for them", async () => {
  const hint = (jar, mist) => b.ev(`(() => {
    const real = myPlayer;
    myPlayer = { color: real.color, twin: false, extra: 0, jar: ${jar}, mist: ${mist} };
    try { return stoneHint(); } finally { myPlayer = real; }
  })()`);
  const lit = await hint(3, true);
  assert.match(lit, /Firefly Jar/);
  assert.match(lit, /Mist/);
  const none = await hint(0, false);
  assert.doesNotMatch(none, /Firefly Jar|Mist/);
});

test("players: the page stays clean", () => {
  rig.assertClean();
});
