// The Landing in a real browser (tasks/2026-11-07_turn_landing/PLAN.md): the
// players panel leaves the sidebar for four islands left of the board, one a
// seat in turn order. Each island carries the Kaya scorebook's grid edge to
// edge, the name on its first line, the digit, both stones, the captures and
// the Kata on its second; the round lives on the river boat's sign and whose
// turn it is on the lanterns, so the header keeps only YOUR TURN. Joined under the longest
// name the server allows, with three bots in a debug room; the tests share one
// page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;
const LONG_NAME = "Rindfleischetikettierung"; // 24 code points: the server's cap (server/src/util/usernames.ts)
const COLS = [8, 26, 44, 62, 80, 98, 116]; // the grid's lines down, in art px from the island top's left edge
const ROWS_Y = [7, 26]; // and across: the name's line, the stones' line

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: LONG_NAME, room: "go_debug", nowelcome: "1" }));
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
});

after(async () => rig?.close());

/** The islands as the scene lays them out and every seat row as the page lays it out, in CSS px. */
const LANDING = `(() => {
  const box = (el) => {
    if (!el) return null;
    const q = el.getBoundingClientRect();
    return { l: q.left, r: q.right, t: q.top, b: q.bottom, w: q.width, h: q.height, cx: (q.left + q.right) / 2, cy: (q.top + q.bottom) / 2 };
  };
  const px = artPx(), bd = boardEl.getBoundingClientRect();
  return {
    px, board: box(boardEl),
    landingW: scene.layout.landingW,
    islands: scene.layout.islands.map((i) => ({ l: bd.left + (i.x + 2) * px, t: bd.top + (i.y + 2) * px })),
    inSidebar: document.getElementById("sidebar").contains(playersEl),
    sidebarFirst: document.getElementById("sidebar").firstElementChild.id,
    ff: playersEl.querySelectorAll(".ff").length,
    rows: Array.from(playersEl.querySelectorAll(".player-row")).map((r) => {
      const name = r.querySelector(".name"), plate = r.querySelector(".plate");
      return {
        row: box(r),
        name: name ? name.textContent : null,
        nameLines: name ? name.getClientRects().length : 0,
        nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : true,
        bot: (r.querySelector(".bot") || {}).textContent || "",
        you: r.querySelectorAll("img.you").length,
        v: Array.from(r.querySelectorAll(".grid .v")).map(box),
        h: Array.from(r.querySelectorAll(".grid .h")).map(box),
        coord: box(r.querySelector("img.coord")),
        stones: Array.from(r.querySelectorAll(".stones img")).map(box),
        plate: box(plate),
        capt: box(r.querySelector(".capt img")),
        count: box(r.querySelector(".count")),
        kata: box(r.querySelector(".card-mini")),
      };
    }),
  };
})()`;

const near = (a, b, label, tol = 0.51) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} vs ${b}`);

test("landing: the players sit on four islands left of the board, one a seat in turn order, and the sidebar opens with the weather", async () => {
  const m = await b.ev(LANDING);
  assert.equal(m.inSidebar, false, "the players are not in the sidebar");
  assert.equal(m.sidebarFirst, "weather", "the weather is on top of it now");
  assert.equal(m.rows.length, 4);
  m.rows.forEach((r, i) => {
    near(r.row.l, m.islands[i].l, `row ${i} on island ${i}, across`);
    near(r.row.t, m.islands[i].t, `row ${i} on island ${i}, down`);
    near(r.row.w, 122 * m.px, `row ${i} as wide as the island's top`);
    near(r.row.h, 38 * m.px, `row ${i} as tall as it`);
    assert.ok(r.row.r <= m.board.l + m.landingW * m.px + 0.5, `row ${i} stays on the landing, off the deck`);
  });
  assert.deepEqual(m.rows.filter((r) => r.you).map((r) => r.name), [LONG_NAME], "the ember on my island only");
  assert.equal(m.rows.filter((r) => r.bot === "(B)").length, 3, "three bots");
  assert.equal(m.ff, 0, "no fireflies on the islands either");
  assert.ok(m.rows.every((r) => r.kata), "every seat's Kata shows");
});

test("landing: each island's grid runs edge to edge, the digit and both stones on its crossings, the captures and the Kata on its lines", async () => {
  const m = await b.ev(LANDING);
  m.rows.forEach((r, i) => {
    assert.equal(r.v.length, COLS.length, `island ${i}: ${COLS.length} lines down`);
    assert.equal(r.h.length, ROWS_Y.length, `island ${i}: two lines across`);
    r.v.forEach((v, k) => {
      near(v.l, r.row.l + COLS[k] * m.px, `island ${i} line ${k} down`);
      near(v.t, r.row.t, `island ${i} line ${k} from the top edge`);
      near(v.b, r.row.b, `island ${i} line ${k} to the bottom edge`);
    });
    r.h.forEach((h, k) => {
      near(h.t, r.row.t + ROWS_Y[k] * m.px, `island ${i} line ${k} across`);
      near(h.l, r.row.l, `island ${i} line ${k} from the left edge`);
      near(h.r, r.row.r, `island ${i} line ${k} to the right edge`);
    });
    const half = m.px / 2 + 0.01;
    near(r.coord.cx, r.v[0].cx, `island ${i}'s digit on the first line down`, half);
    near(r.coord.cy, r.h[1].cy, `island ${i}'s digit on the stones' line`, half);
    assert.equal(r.stones.length, 2);
    r.stones.forEach((s, j) => {
      near(s.cx, r.v[1 + j].cx, `island ${i} stone ${j} on line ${1 + j}`);
      near(s.cy, r.h[1].cy, `island ${i} stone ${j} on the stones' line`);
      near(s.w, 15 * m.px, `island ${i} stone ${j} at board size`);
    });
    near(r.capt.cx, r.v[3].cx, `island ${i}'s captured icon on line 3`);
    near(r.count.cx, r.v[4].cx, `island ${i}'s count on line 4`, m.px);
    near(r.kata.cx, (r.v[5].cx + r.v[6].cx) / 2, `island ${i}'s Kata between lines 5 and 6`);
    near(r.kata.cy, r.h[1].cy, `island ${i}'s Kata on the stones' line`);
    near(r.plate.cy, r.h[0].cy, `island ${i}'s name on the first line across`);
  });
});

test("landing: the longest name the server allows stays whole on one line, on its island", async () => {
  const m = await b.ev(LANDING);
  const me = m.rows.find((r) => r.name === LONG_NAME);
  assert.ok(me, "my island");
  assert.equal(me.nameLines, 1, "one line");
  assert.equal(me.nameClipped, false, "the whole name shows");
  for (const r of m.rows) {
    assert.ok(r.plate.l >= r.row.l - 0.5 && r.plate.r <= r.row.r + 0.5, `${r.name}'s plate on its island`);
    assert.ok(r.plate.b <= r.stones[0].t + 0.5, `${r.name}'s plate above the stones`);
  }
});

test("landing: a passed or away seat fades its stones and name, its stamp on the name's line, its plates solid over the grid", async () => {
  const m = await b.ev(`(() => {
    const players = [
      { name: "Atsumi", score: 7 },
      { name: "Sternschnuppe", me: true, score: 12 },
      { name: ${JSON.stringify(LONG_NAME)}, score: 3, connected: false },
      { name: "Ko", bot: true, passed: true },
    ].map((s, i) => Object.assign({
      sessionId: s.me ? room.sessionId : "seat" + i, color: i + 1, connected: true, bot: false, passed: false,
      score: 0, finalScore: 0, place: 0, card: [0, 0, 0, 0, 1, 0, 0, 0, 0], powerups: ["stone_card"],
    }, s));
    renderPlayers({ status: "playing", turnIndex: 0, players });
    const seen = (el) => { let o = 1; for (; el && el !== playersEl; el = el.parentElement) o *= +getComputedStyle(el).opacity; return o; };
    const out = Array.from(playersEl.querySelectorAll(".player-row")).map((r) => {
      const name = r.querySelector(".name"), plate = r.querySelector(".plate"), stamp = r.querySelector(".stamp");
      const q = (el) => el.getBoundingClientRect();
      return { name: name.textContent, nameSeen: seen(name), stonesSeen: Array.from(r.querySelectorAll(".stones img")).map(seen),
        plateSeen: seen(plate), plateBg: getComputedStyle(plate).backgroundColor, stamp: stamp ? stamp.textContent + (stamp.querySelector("img") || {}).alt : "",
        stampInPlate: !!(stamp && plate.contains(stamp)), clipped: name.scrollWidth > name.clientWidth + 1, lines: name.getClientRects().length,
        plateR: q(plate).right, rowR: q(r).right, plateCy: (q(plate).top + q(plate).bottom) / 2,
        nameLineCy: (() => { const h = r.querySelector(".grid .h"); return h ? (q(h).top + q(h).bottom) / 2 : null; })() };
    });
    renderPlayers(lastState);
    return out;
  })()`);
  const [lit, mine, away, passed] = m;
  for (const r of [lit, mine]) assert.ok(r.stonesSeen.every((o) => o === 1) && r.nameSeen === 1, `${r.name} in full`);
  for (const r of [away, passed]) {
    assert.ok(r.stonesSeen.every((o) => o < 0.6), `${r.name}'s stones faded`);
    assert.ok(r.nameSeen < 0.6, `${r.name}'s name faded`);
    assert.equal(r.plateSeen, 1, `${r.name}'s plate stays solid`);
    assert.match(r.plateBg, /^rgb\(\d+, \d+, \d+\)$/, `${r.name}'s plate is opaque`);
  }
  assert.match(away.stamp, /AWAY|Away/, "away says so");
  assert.equal(away.stampInPlate, true, "on the name's plate");
  for (const r of m) {
    assert.notEqual(r.nameLineCy, null, `${r.name}'s island has its name's line`);
    near(r.plateCy, r.nameLineCy, `${r.name}'s plate on that line`);
  }
  assert.equal(away.lines, 1, "the long name on one line beside the stamp");
  assert.equal(away.clipped, false);
  assert.ok(away.plateR <= away.rowR + 0.5, "and the plate stays on its island");
  assert.equal(passed.stamp, "", "a pass shows by the fade alone");
});

test("landing: a seat's captures tip opens beside its island, over the water, not over the island or the sidebar", async () => {
  const m = await b.ev(`(() => {
    const row = Array.from(playersEl.querySelectorAll(".player-row")).find((r) => r.querySelector("img.you"));
    const count = row.querySelector(".count");
    count.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    const tip = document.querySelector(".capture-tip"), t = tip.getBoundingClientRect(), r = row.getBoundingClientRect(), c = count.getBoundingClientRect();
    const out = { left: t.left, right: t.right, top: t.top, bottom: t.bottom, rowR: r.right, countCy: (c.top + c.bottom) / 2,
      sideL: document.getElementById("sidebar").getBoundingClientRect().left };
    count.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" }));
    return out;
  })()`);
  assert.ok(m.left >= m.rowR - 0.5, `right of the island: ${m.left} vs ${m.rowR}`);
  assert.ok(m.right <= m.sideL + 0.5, "not over the sidebar");
  assert.ok(m.top <= m.countCy && m.bottom >= m.countCy, "level with the count");
});

test("landing: the seat whose turn it is has its lantern lit, the river boat's sign shows the round, and the header says only YOUR TURN", async () => {
  const look = `(() => {
    const v = landingView(lastState), label = document.getElementById("hdr-label");
    const order = Array.from(lastState.players).sort((a, b) => a.color - b.color);
    return { sign: v.round, moored: "boat" in v, lit: v.seats.map((s) => !!(s && s.lit)), turnSeat: order.indexOf(lastState.players[lastState.turnIndex]),
      round: Math.floor(lastState.turnCount / Array.from(lastState.players).length) + 1,
      label: label.hidden ? "" : label.dataset.text || "", lantern: !document.getElementById("hdr-lantern").hidden,
      name: document.getElementById("hdr-name").textContent };
  })()`;
  await rig.waitMyTurn();
  let m = await b.ev(look);
  assert.equal(m.sign, m.round, "the round on the river boat's sign");
  assert.equal(m.moored, false, "no boat moored at an island");
  assert.deepEqual(m.lit, [0, 1, 2, 3].map((i) => i === m.turnSeat), "my lantern alone lit");
  assert.match(m.label, /YOUR TURN/, "the header calls me");
  assert.doesNotMatch(m.label, /R\d/, "but leaves the round to the boat");
  assert.equal(m.lantern, false, "no lantern in the header");
  assert.equal(m.name, "", "no name in the header");
  await b.ev("passButton.click(); true");
  await b.waitFor("!isMyTurn", 10000, "a bot's turn");
  m = await b.ev(look);
  assert.equal(m.moored, false, "and still no boat at the islands");
  assert.deepEqual(m.lit, [0, 1, 2, 3].map((i) => i === m.turnSeat), "the light moves on with the turn");
  assert.equal(m.label, "", "the header is quiet on another's turn");
});

test("landing: the page stays clean", () => {
  rig.assertClean();
});
