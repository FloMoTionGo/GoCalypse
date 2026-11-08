// Sky and garland in a real browser: the Storm box is gone from the sidebar, the sidebar with
// it; the sky row with the header's planks sits right on the scene; the forecast's words and
// title stay in the page; and the stone lantern stands in front of a real hover and a real
// click in the board's corner. A debug room with three bots; the tests share one page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Skyward", room: "go_debug", nowelcome: "1" }));
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
});

after(async () => {
  await rig?.close();
});

const near = (a, c, what) => assert.ok(Math.abs(a - c) < 1, `${what}: ${a} vs ${c}`);

test("sky: nothing is left of the sidebar, and the sky row sits right on the scene, as wide as the stage", async () => {
  const m = await b.ev(`(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height }; };
    return { sidebar: !!document.getElementById("sidebar"), px: artPx(), sky: box(document.getElementById("sky")), board: box(boardEl), game: box(gameEl),
      art: [document.getElementById("sky").width, document.getElementById("sky").height], W: scene.width };
  })()`);
  assert.equal(m.sidebar, false, "no sidebar");
  near(m.game.w, m.board.w, "the stage is the scene's width");
  near(m.sky.l, m.board.l, "the sky starts with the scene");
  near(m.sky.w, m.board.w, "and is as wide");
  near(m.sky.h, 21 * m.px, "21 art px tall");
  near(m.sky.b, m.board.t, "right on top of the scene");
  near(m.sky.t, m.game.t, "at the top of the stage");
  assert.deepEqual(m.art, [m.W, 21], "one canvas pixel an art pixel");
});

test("sky: the header's planks are real buttons over the sky, in the row above the hills", async () => {
  const m = await b.ev(`["recall-back", "log-button", "help-button", "leave-button"].map((id) => {
    const el = document.getElementById(id), r = el.getBoundingClientRect(), s = document.getElementById("sky").getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { id, on: el === hit || el.contains(hit), inside: r.left >= s.left && r.right <= s.right && r.top >= s.top && r.bottom <= s.top + 14 * artPx() + 0.5 };
  })`);
  for (const p of m) {
    assert.equal(p.on, true, `${p.id}: nothing covers it`);
    assert.equal(p.inside, true, `${p.id}: in the sky, above the hills`);
  }
  rig.assertClean("the header in the sky");
});

test("storm: the forecast is the sky behind the header and the garland, its numbers only in the title", async () => {
  const w = await b.ev(`(() => {
    const meter = weatherEl.querySelector(".meter");
    return { inHeader: document.getElementById("game-header").contains(weatherEl), label: meter.getAttribute("aria-label"), title: meter.title, text: meter.textContent,
      pictures: meter.querySelectorAll("img").length, names: G.STORM_SKIES.map((s) => s.name), chance: lastState.storm.chance };
  })()`);
  assert.equal(w.inHeader, true, "in the sky row");
  assert.equal(w.pictures, 0, "the pictures are the sky and the garland, not a box of their own");
  assert.ok(!/\d/.test(w.text), `no numbers on show: ${w.text}`);
  assert.ok(w.names.some((n) => w.text.includes(n)), `the sky named: ${w.text}`);
  assert.match(w.label, new RegExp(`${w.chance}% chance`));
  assert.match(w.title, /next roll in \d+ turns?/);
});

test("storm: the forecast's words sit between the turn and the actions, overlapping neither", async () => {
  await rig.waitMyTurn();
  const m = await b.ev(`(() => {
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, w: r.width }; };
    const g = gameEl.getBoundingClientRect();
    return { turn: box(document.getElementById("hdr-label")), words: box(weatherEl.querySelector(".meter")), actions: box(document.getElementById("hdr-actions")), mid: g.left + g.width / 2 };
  })()`);
  assert.ok(m.turn.w > 0, "YOUR TURN on show");
  near((m.turn.l + m.turn.r) / 2, m.mid, "the turn in the middle of the stage");
  assert.ok(m.turn.r <= m.words.l, `turn ${m.turn.r} before the words ${m.words.l}`);
  assert.ok(m.words.r <= m.actions.l, `words ${m.words.r} before the actions ${m.actions.l}`);
});

test("garland: the scene is told the turns to the next roll, and the debug room's roll has a lantern a turn", async () => {
  const m = await b.ev(`({ view: garlandView(lastState), every: lastState.storm.every, turns: lastState.turnCount, lanterns: scene.garlandAt(lastState.storm.every).length })`);
  assert.equal(m.view.every, m.every);
  assert.equal(m.view.left, m.every - (m.turns % m.every));
  assert.equal(m.lanterns, m.every);
});

test("sky: the canvas draws the band of the forecast's sky", async () => {
  // A roll can change the sky between two frames, so it is asked again until they agree.
  await b.waitFor(`(() => {
    const c = document.getElementById("sky"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    const id = G.stormSkyOf((Number(lastState.storm.chance) || 0) / 100).id;
    return [0, 1].some((f) => G.skyBand(c.width, id, f).px.every((v, i) => {
      const rgb = G.PALETTE_RGB[v];
      return d[i * 4] === rgb[0] && d[i * 4 + 1] === rgb[1] && d[i * 4 + 2] === rgb[2];
    }));
  })()`, 4000, "the sky canvas to show one of the forecast sky's two frames");
});

test("stone lantern: a real hover on the corner point puts the hover stone behind it, and a real click still plays there", async () => {
  await rig.waitMyTurn();
  const n = await b.ev("lastState.size");
  const free = await b.ev(`board[${n * n - 1}] === 0 && !overlays.some((o) => o.x === ${n - 1} && o.y === ${n - 1})`);
  assert.equal(free, true, "the corner point is free");
  const p = await rig.boardPoint(n - 1, n - 1);
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await b.waitFor(`hoverPoint && hoverPoint.x === ${n - 1} && hoverPoint.y === ${n - 1}`, 3000, "the hover on the corner");
  await wait(200);
  const m = await b.ev(`(() => {
    const c = scene.pointToNative(${n - 1}, ${n - 1}), x0 = c.x + 3, y0 = c.y + 12 - 21;
    const spr = G.ANIMS.toro.frames[0], data = boardCtx.getImageData(0, 0, scene.width, scene.height).data;
    let wrong = 0, flame = 0;
    for (let y = 0; y < spr.h; y++) for (let x = 0; x < spr.w; x++) {
      const v = spr.px[y * spr.w + x];
      if (v === G.TRANSPARENT) continue;
      const inWindow = y >= 8 && y <= 10 && x >= 5 && x <= 7; // the flame changes frame by frame
      if (inWindow) { flame++; continue; }
      const o = ((y0 + y) * scene.width + x0 + x) * 4, rgb = G.PALETTE_RGB[v];
      if (data[o] !== rgb[0] || data[o + 1] !== rgb[1] || data[o + 2] !== rgb[2]) wrong++;
    }
    return { wrong, flame, kind: hoverKind() };
  })()`);
  assert.equal(m.kind, "stone", "the hover stone is on");
  assert.ok(m.flame > 0, "the lantern has its flame");
  assert.equal(m.wrong, 0, "no pixel of the lantern is covered by the hover stone");
  await rig.playAt(n - 1, n - 1, "left", `board[${n * n - 1}] !== 0`, "the stone played under the lantern");
  rig.assertClean("the corner under the lantern");
});
