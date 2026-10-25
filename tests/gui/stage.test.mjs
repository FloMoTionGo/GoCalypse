// The game screen as one stage in a real browser (ideas.md §11.8, §11.9): it
// fits the window with no scrollbars, the same physical window gives the same
// picture whatever the display scaling, and the header carries the turn
// lantern, the history and the actions. A debug room with three bots; the tests
// share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Stager", room: "go_debug", nowelcome: "1" }));
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
});

after(async () => {
  await rig?.close();
});

/** The stage as the page lays it out, in device px, and how big its text is next to the board. */
const MEASURE = `(() => {
  const dpr = window.devicePixelRatio || 1, g = gameEl.getBoundingClientRect(), bd = boardEl.getBoundingClientRect();
  return {
    w: Math.round(g.width * dpr), h: Math.round(g.height * dpr),
    inside: g.left >= 0 && g.top >= 0 && g.right <= innerWidth + 0.5 && g.bottom <= innerHeight + 0.5,
    scrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
    text: parseFloat(getComputedStyle(lastEventEl).fontSize) / bd.height,
    board: Math.round(bd.width * dpr),
  };
})()`;

async function at(width, height, dpr) {
  await b.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
  await wait(400);
  return b.ev(MEASURE);
}

test("stage: at 1400x1000 the whole game fits the window, with no scrollbars", async () => {
  const m = await at(1400, 1000, 1);
  assert.equal(m.scrolls, false, "no scrollbars");
  assert.equal(m.inside, true, "the stage is all on screen");
});

test("stage: 1536x864 at 125% is the same picture in device px as 1400x1000 at 100%", async () => {
  const one = await at(1400, 1000, 1);
  const scaled = await at(1536, 864, 1.25);
  assert.equal(scaled.scrolls, false);
  assert.equal(scaled.w, one.w, "the stage is as wide in device px");
  assert.equal(scaled.board, one.board, "and so is the board");
  assert.ok(Math.abs(scaled.text - one.text) < 0.002, `text to board ${scaled.text} vs ${one.text}`);
  await b.cdp("Emulation.clearDeviceMetricsOverride", {});
  await wait(300);
});

test("stage: the hand's cards are 150% and the header 85% of the stage's art; the hand runs under the board and the sidebar", async () => {
  const m = await b.ev(`(() => {
    const px = artPx(), card = handEl.querySelector(".card, .card-place").getBoundingClientRect();
    const foot = document.getElementById("game-foot").getBoundingClientRect(), side = document.getElementById("sidebar").getBoundingClientRect();
    return { px, cardW: card.width, cardH: card.height, header: document.getElementById("game-header").getBoundingClientRect().height,
      footRight: foot.right, sideRight: side.right, footTop: foot.top, sideBottom: side.bottom };
  })()`);
  assert.ok(Math.abs(m.cardW - 36 * 1.5 * m.px) < 0.5 && Math.abs(m.cardH - 52 * 1.5 * m.px) < 0.5, `card ${m.cardW}x${m.cardH} at px ${m.px}`);
  assert.ok(Math.abs(m.header - 18 * 0.85 * m.px) < 0.5, `header ${m.header}`);
  assert.ok(Math.abs(m.footRight - m.sideRight) < 1, "the hand row reaches the sidebar's right edge");
  assert.ok(m.footTop >= m.sideBottom - 0.5, "and sits under it");
});

test("stage: the hand sits below the board, left aligned with it", async () => {
  const m = await b.ev(`(() => {
    const h = handEl.getBoundingClientRect(), bd = boardEl.getBoundingClientRect();
    return { handLeft: h.left, boardLeft: bd.left, handTop: h.top, boardBottom: bd.bottom };
  })()`);
  assert.ok(Math.abs(m.handLeft - m.boardLeft) < 1, `the hand starts at the board's left edge: ${m.handLeft} vs ${m.boardLeft}`);
  assert.ok(m.handTop >= m.boardBottom - 0.5, "below the board");
});

test("stage: the sidebar runs down beside the hand, and the market shows every stall without scrolling", async () => {
  for (const [w, h] of [[1400, 1000], [1920, 950]]) {
    await b.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await wait(400);
    const m = await b.ev(`(() => {
      const sb = document.getElementById("sidebar").getBoundingClientRect(), g = gameEl.getBoundingClientRect();
      const hand = handEl.getBoundingClientRect(), mk = document.getElementById("market");
      return { sideBottom: sb.bottom, gameBottom: g.bottom, handBottom: hand.bottom, sideLeft: sb.left, handRight: hand.right,
        scroll: mk.scrollHeight - mk.clientHeight, stalls: marketItemsEl.querySelectorAll("button.item").length };
    })()`);
    assert.ok(m.sideBottom >= m.handBottom - 0.5, `${w}x${h}: the sidebar reaches down beside the hand`);
    assert.ok(m.sideBottom <= m.gameBottom + 0.5, `${w}x${h}: and stays on the stage`);
    assert.ok(m.handRight <= m.sideLeft + 0.5, `${w}x${h}: the hand stays left of it`);
    assert.ok(m.scroll <= 1, `${w}x${h}: the market needs no scrolling (${m.scroll} px over)`);
    assert.equal(m.stalls, 7);
  }
  await b.cdp("Emulation.clearDeviceMetricsOverride", {});
  await wait(300);
});

test("stage: a full hand stays under the board, its cards overlapping when they don't fit", async () => {
  for (const id of Array.from(await b.ev("Array.from(lastState.market).filter((m) => !m.removal).map((m) => m.id)")).slice(0, 5)) {
    await b.ev(`room.send("buy", { id: ${JSON.stringify(id)} }); true`);
    await wait(200);
  }
  await b.waitFor("handEl.querySelectorAll('.card').length >= 6", 5000, "a full hand");
  const m = await b.ev(`(() => {
    const h = handEl.getBoundingClientRect(), bd = boardEl.getBoundingClientRect();
    const cards = Array.from(handEl.querySelectorAll(".card, .card-place")).map((c) => c.getBoundingClientRect());
    return { left: h.left, right: Math.max(...cards.map((c) => c.right)), boardLeft: bd.left, boardRight: bd.right,
      overlap: cards.some((c, i) => i > 0 && c.left < cards[i - 1].right - 0.5) };
  })()`);
  assert.ok(Math.abs(m.left - m.boardLeft) < 1, "left aligned with the board");
  assert.ok(m.right <= m.boardRight + 0.5, `no wider than the board: ${m.right} vs ${m.boardRight}`);
  assert.equal(m.overlap, true, "six 150% cards overlap under a 13x13 board");
});

test("storm: the forecast is a dial and a sky that blink in two frames, its numbers only in words", async () => {
  const w = await b.ev(`(() => {
    const meter = weatherEl.querySelector(".meter");
    return { label: meter.getAttribute("aria-label"), text: meter.textContent,
      dial: meter.querySelectorAll(".flicker.dial img").length, sky: meter.querySelectorAll(".flicker.sky img").length,
      names: G.STORM_SKIES.map((s) => s.name), chance: lastState.storm.chance };
  })()`);
  assert.equal(w.dial, 2, "the dial's two frames");
  assert.equal(w.sky, 2, "the sky's two frames");
  assert.ok(!/\d/.test(w.text), `no numbers on show: ${w.text}`);
  assert.ok(w.names.some((n) => w.text.includes(n)), `the sky named: ${w.text}`);
  assert.match(w.label, new RegExp(`${w.chance}% chance`));
  assert.match(w.label, /next roll in \d+ turns?/);
});

test("header: the turn lantern is lit on my turn, dark on another's", async () => {
  await rig.waitMyTurn();
  assert.equal(await b.ev("document.getElementById('hdr-turn').classList.contains('my-turn')"), true);
  await b.ev("passButton.click(); true"); // a pass is always taken on my turn
  await b.waitFor("!isMyTurn", 10000, "a bot's turn");
  assert.equal(await b.ev("document.getElementById('hdr-turn').classList.contains('my-turn')"), false);
});

test("header: the history buttons sit in the header and step back and forward", async () => {
  await b.waitFor("history.length >= 3", 15000, "a few moves of history");
  assert.equal(await b.ev("document.getElementById('hdr-history').contains(recallEl)"), true);
  await rig.clickEl("#recall-back");
  assert.equal(await b.ev("recallStepsEl.textContent"), "-1");
  await rig.clickEl("#recall-fwd");
  assert.equal(await b.ev("recallStepsEl.textContent"), "0");
  await rig.clickEl("#recall-back");
  await rig.clickEl("#recall-live");
  assert.equal(await b.ev("recallStepsEl.textContent"), "0");
});

test("header: PASS, How to play and Leave are pixel planks, named for screen readers", async () => {
  const r = await b.ev(`["pass-button", "help-button", "leave-button"].map((id) => {
    const el = document.getElementById(id);
    return { inActions: document.getElementById("hdr-actions").contains(el), img: !!el.querySelector("img"), label: el.getAttribute("aria-label") };
  })`);
  assert.deepEqual(r.map((x) => x.inActions), [true, true, true]);
  assert.deepEqual(r.map((x) => x.img), [true, true, true]);
  assert.deepEqual(r.map((x) => x.label), ["Pass", "How to play", "Leave game"]);
});

test("header: Leave asks first, saying a bot takes the seat; cancelling keeps me at the table", async () => {
  let message = null;
  b.on("Page.javascriptDialogOpening", (p) => {
    message = p.message;
    b.cdp("Page.handleJavaScriptDialog", { accept: false });
  });
  await b.ev("document.getElementById('leave-button').click(); true");
  await wait(300);
  assert.match(message ?? "", /Leave the table\?/);
  assert.match(message ?? "", /bot/i);
  assert.equal(await b.ev("gameEl.hidden"), false, "still at the table");
  rig.assertClean("the stage");
});
