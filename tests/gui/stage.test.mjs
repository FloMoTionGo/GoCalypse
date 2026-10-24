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

test("header: the turn lantern is lit on my turn, dark on another's", async () => {
  await rig.waitMyTurn();
  assert.equal(await b.ev("document.getElementById('hdr-turn').classList.contains('my-turn')"), true);
  const p = await rig.freePoint();
  await b.ev(`room.send("move", { x: ${p.x}, y: ${p.y}, axis: "base" }); true`);
  await b.waitFor("!isMyTurn", 5000, "a bot's turn");
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
