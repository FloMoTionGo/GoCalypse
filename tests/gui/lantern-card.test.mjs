// The Lantern Card in a real browser (tasks/2026-11-08_lantern_card/PLAN.md): click every
// floating lantern once and a secret card flies to your hand; playing it shows the whole
// table the Lantern Festival. It is cosmetic: the hunt tells the server nothing, and
// nothing in the game changes. Three bots in a debug room; the tests share one page and
// run in order, on my turn, so the game stands still around them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";
import { wait } from "../lib/harness.mjs";

let rig, b;
const CARD = `#hand .card[data-id="lantern_card"]`;
const NAME = "Finder";

/** Records everything the page sends, again after a reload. */
const LISTEN = `(() => {
  if (!window.__sent) {
    window.__sent = [];
    const send = Colyseus.Room.prototype.send;
    Colyseus.Room.prototype.send = function (type, msg) { window.__sent.push(type); return send.call(this, type, msg); };
  }
  return true;
})()`;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: NAME, room: "go_debug", nowelcome: "1" }));
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
  await rig.waitMyTurn();
  await b.ev(LISTEN);
});

after(async () => rig?.close());

/** Where lantern `i` is on the page now, if a click there would reach the canvas. */
const WHERE = (i) => `(() => {
  const r = boardEl.getBoundingClientRect(), f = scene.floatersAt(clock()).find((q) => q.i === ${i});
  if (!f || f.x < 2 || f.y < 2 || f.x >= scene.width - 2 || f.y >= scene.height - 2) return null;
  const p = { x: r.left + ((f.x + 0.5) * r.width) / scene.width, y: r.top + ((f.y + 0.5) * r.height) / scene.height };
  return document.elementFromPoint(p.x, p.y) === boardEl ? p : null;
})()`;

/** A real click on an unlit lantern; waits for one more to be lit. */
async function lightOne() {
  const lit = await b.ev("litLanterns.length");
  for (let tries = 0; tries < 80; tries++) {
    const todo = await b.ev("scene.lanternGoal(false).filter((i) => !litLanterns.includes(i))");
    for (const i of todo) {
      const p = await b.ev(WHERE(i));
      if (!p) continue;
      await b.click(p.x, p.y);
      await b.waitFor(`litLanterns.length > ${lit}`, 2000, "a lantern to light");
      return;
    }
    await wait(150);
  }
  assert.fail("no unlit lantern could be reached");
}

/** What a festival or a hunt must not change. */
const GAME = `JSON.stringify({ turnCount, isMyTurn, board: Array.from(board), mine: myPlayer.fireflies, score: myPlayer.score, hand: Array.from(myPlayer.powerups), bought: Array.from(myPlayer.bought), event: lastState.lastEvent, action: lastState.action.seq })`;
const sentLately = () => b.ev("window.__sent.filter((t) => t !== 'ping')");
let game;

test("lantern card: a click on a floating lantern lights it, and tells the server nothing", async () => {
  game = await b.ev(GAME);
  await lightOne();
  assert.equal(await b.ev("litLanterns.length"), 1);
  assert.deepEqual(await sentLately(), [], "no move, nothing at all");
});

test("lantern card: clicking a lit lantern changes nothing", async () => {
  const i = await b.ev("litLanterns[0]");
  for (let tries = 0; tries < 80; tries++) {
    const p = await b.ev(WHERE(i));
    if (p) {
      // Only this lantern may be under the pointer, or the click would light a neighbour.
      const alone = await b.ev(`scene.floatersAt(clock()).filter((q) => Math.max(Math.abs(q.x - scene.floatersAt(clock())[${i}].x), Math.abs(q.y - scene.floatersAt(clock())[${i}].y)) <= 14).length === 1`);
      if (alone) {
        await b.click(p.x, p.y);
        await wait(150);
        assert.equal(await b.ev("litLanterns.length"), 1);
        return;
      }
    }
    await wait(150);
  }
  assert.fail("the lit lantern never stood alone");
});

test("lantern card: a lantern clicked while looking back counts, with no recall warning", async () => {
  const lit = await b.ev("litLanterns.length");
  await b.ev(`window.__blocked = 0; window.__rb = recallBlocked; recallBlocked = function () { window.__blocked++; return window.__rb(); }; viewId = 0; true`);
  try {
    await lightOne();
  } finally {
    await b.ev("viewId = null; recallBlocked = window.__rb; true");
  }
  assert.equal(await b.ev("litLanterns.length"), lit + 1);
  assert.equal(await b.ev("window.__blocked"), 0);
});

test("lantern card: lighting the last lantern puts the card in the hand, and the hunt sent nothing to the server", async () => {
  const cards = await b.ev("handEl.querySelectorAll('.card').length");
  assert.equal(await b.ev(`!!document.querySelector(${JSON.stringify(CARD)})`), false, "no card before the last lantern");
  while ((await b.ev("litLanterns.length")) < 12) await lightOne();
  await b.waitFor(`!!document.querySelector(${JSON.stringify(CARD)})`, 3000, "the Lantern Card");
  assert.equal(await b.ev("handEl.querySelectorAll('.card').length"), cards + 1);
  assert.deepEqual(await sentLately(), [], "the server knows nothing of it");
  assert.equal(await b.ev(GAME), game, "and nothing in the game moved");
  assert.match(await b.ev("noticeEl.textContent"), /lantern/i, "the finder is told");
});

test("lantern card: it takes up no place in the hand and arms nothing while it waits", async () => {
  assert.equal(await b.ev(`!!document.querySelector(${JSON.stringify(CARD)})`), true, "the card is in the hand");
  assert.equal(await b.ev("marketContext(lastState, myPlayer).full"), false);
  assert.equal(await b.ev("Array.from(myPlayer.powerups).includes('lantern_card')"), false, "the server's hand doesn't hold it");
  assert.equal(await b.ev("selectedPowerup"), null);
});

test("lantern card: the find is kept per seat and room", async () => {
  const keys = await b.ev(`Object.keys(sessionStorage).filter((k) => k.includes("lanternCard"))`);
  const roomId = await b.ev("room.roomId");
  assert.equal(keys.length, 1);
  assert.ok(keys[0].endsWith(roomId), keys[0]);
  assert.ok(keys[0].includes(NAME), keys[0]);
});

test("lantern card: the card survives a reload, and every lantern stays lit", async () => {
  await b.cdp("Page.reload");
  await b.waitFor("typeof joinButton !== 'undefined'", 10000, "main.js after the reload");
  await b.waitFor("room && lastState && lastState.status === 'playing' && !gameEl.hidden", 15000, "the rejoin");
  await b.ev(LISTEN);
  await b.waitFor(`!!document.querySelector(${JSON.stringify(CARD)})`, 5000, "the card back in the hand");
  assert.equal(await b.ev("litLanterns.length"), 12);
});

test("lantern card: playing it sends one message, leaves the hand when the server answers, and changes nothing in the game", async () => {
  await rig.waitMyTurn();
  await b.ev("window.__sent.length = 0; true");
  game = await b.ev(GAME);
  await rig.clickEl(CARD);
  await b.waitFor("festival !== null", 3000, "the festival");
  await b.waitFor(`!document.querySelector(${JSON.stringify(CARD)})`, 3000, "the card to leave the hand");
  assert.deepEqual(await sentLately(), ["lanternFestival"]);
  assert.equal(await b.ev("festival.seed"), await b.ev("P.festivalSeed(room.roomId, myPlayer.color)"));
  assert.match(await b.ev("noticeEl.textContent"), new RegExp(`${NAME}.*Lantern Festival`));
  assert.equal(await b.ev(GAME), game, "not the turn, the fireflies, the board or the hand");
});

test("lantern card: while the festival runs the scene is drawn with it on every frame", async () => {
  await b.ev("window.__seen = 0; window.__r0 = scene.render; scene.render = function (v) { if (v.festival) window.__seen++; return window.__r0.call(this, v); }; true");
  await wait(500);
  const seen = await b.ev("window.__seen");
  await b.ev("scene.render = window.__r0; true");
  assert.ok(seen >= 5, `drawn ${seen} times in half a second`);
});

test("lantern card: a card already played stays gone after a reload", async () => {
  await b.cdp("Page.reload");
  await b.waitFor("typeof joinButton !== 'undefined'", 10000, "main.js after the reload");
  await b.waitFor("room && lastState && lastState.status === 'playing' && !gameEl.hidden", 15000, "the rejoin");
  await wait(300);
  assert.equal(await b.ev(`!!document.querySelector(${JSON.stringify(CARD)})`), false);
  assert.equal(await b.ev("litLanterns.length"), 12, "the lanterns it lit stay lit");
});

test("lantern card: another player's festival plays here too, with a notice naming them", async () => {
  await b.ev(`room.dispatchMessage("lanternFestival", { by: 3, name: "Rival" }); true`);
  await b.waitFor("festival !== null", 2000, "the festival");
  assert.equal(await b.ev("festival.seed"), await b.ev("P.festivalSeed(room.roomId, 3)"));
  assert.match(await b.ev("noticeEl.textContent"), /Rival.*Lantern Festival/);
  rig.assertClean("the page");
});
