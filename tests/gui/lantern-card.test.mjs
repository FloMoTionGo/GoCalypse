// The lantern hunt in a real browser: click the twelve floating lanterns off, then the
// stone lantern as the thirteenth, and the whole table gets the Lantern Festival in the
// dark. It is cosmetic: the hunt tells the server nothing, and nothing in the game
// changes. Three bots in a debug room; the tests share one page and run in order, on my
// turn, so the game stands still around them.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";
import { wait } from "../lib/harness.mjs";

let rig, b;
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

/** The page point of the stone lantern's middle. */
const STONE = `(() => {
  const r = boardEl.getBoundingClientRect(), q = scene.stoneLantern;
  return { x: r.left + ((q.x + q.w / 2 + 0.5) * r.width) / scene.width, y: r.top + ((q.y + q.h / 2 + 0.5) * r.height) / scene.height };
})()`;

/** A real click on a lantern still on; waits for one more to go out. */
async function putOutOne() {
  const out = await b.ev("outLanterns.length");
  for (let tries = 0; tries < 80; tries++) {
    const todo = await b.ev("scene.lanternGoal(false).filter((i) => !outLanterns.includes(i))");
    for (const i of todo) {
      const p = await b.ev(WHERE(i));
      if (!p) continue;
      await b.click(p.x, p.y);
      await b.waitFor(`outLanterns.length > ${out}`, 2000, "a lantern to go out");
      return;
    }
    await wait(150);
  }
  assert.fail("no lantern still on could be reached");
}

/** What a festival or a hunt must not change. */
const GAME = `JSON.stringify({ turnCount, isMyTurn, board: Array.from(board), mine: myPlayer.fireflies, score: myPlayer.score, hand: Array.from(myPlayer.powerups), bought: Array.from(myPlayer.bought), event: lastState.lastEvent, action: lastState.action.seq })`;
const sentLately = () => b.ev("window.__sent.filter((t) => t !== 'ping')");
let game;

test("lantern hunt: a click on a floating lantern turns it off, and tells the server nothing", async () => {
  game = await b.ev(GAME);
  await putOutOne();
  assert.equal(await b.ev("outLanterns.length"), 1);
  assert.deepEqual(await sentLately(), [], "no move, nothing at all");
});

test("lantern hunt: clicking a lantern already out changes nothing", async () => {
  const i = await b.ev("outLanterns[0]");
  for (let tries = 0; tries < 80; tries++) {
    const p = await b.ev(WHERE(i));
    if (p) {
      // Only this lantern may be under the pointer, or the click would put out a neighbour.
      const alone = await b.ev(`scene.floatersAt(clock()).filter((q) => Math.max(Math.abs(q.x - scene.floatersAt(clock())[${i}].x), Math.abs(q.y - scene.floatersAt(clock())[${i}].y)) <= 22).length === 1`);
      if (alone) {
        await b.click(p.x, p.y);
        await wait(150);
        assert.equal(await b.ev("outLanterns.length"), 1);
        return;
      }
    }
    await wait(150);
  }
  assert.fail("the lantern never stood alone");
});

test("lantern hunt: a lantern clicked while looking back counts, with no recall warning", async () => {
  const out = await b.ev("outLanterns.length");
  await b.ev(`window.__blocked = 0; window.__rb = recallBlocked; recallBlocked = function () { window.__blocked++; return window.__rb(); }; viewId = 0; true`);
  try {
    await putOutOne();
  } finally {
    await b.ev("viewId = null; recallBlocked = window.__rb; true");
  }
  assert.equal(await b.ev("outLanterns.length"), out + 1);
  assert.equal(await b.ev("window.__blocked"), 0);
});

test("lantern hunt: the stone lantern does nothing before the twelfth is out", async () => {
  const p = await b.ev(STONE);
  await b.click(p.x, p.y);
  await wait(200);
  assert.deepEqual(await sentLately(), [], "nothing sent");
  assert.equal(await b.ev("festival"), null);
});

test("lantern hunt: with all twelve out the page says only the stone lantern burns, and nothing was sent or changed", async () => {
  while ((await b.ev("outLanterns.length")) < 12) await putOutOne();
  assert.deepEqual(await sentLately(), [], "the server knows nothing of it");
  assert.equal(await b.ev(GAME), game, "and nothing in the game moved");
  assert.match(await b.ev("noticeEl.textContent"), /stone lantern/i);
  assert.equal(await b.ev("!!document.querySelector('[data-id=lantern_card]')"), false, "and no card comes of it");
});

test("lantern hunt: turning off the stone lantern sends one message, and the festival starts when the server answers", async () => {
  await rig.waitMyTurn();
  await b.ev("window.__sent.length = 0; true");
  game = await b.ev(GAME);
  const p = await b.ev(STONE);
  await b.click(p.x, p.y);
  await b.waitFor("festival !== null", 3000, "the festival");
  assert.deepEqual(await sentLately(), ["lanternFestival"]);
  assert.equal(await b.ev("festival.seed"), await b.ev("P.festivalSeed(room.roomId, myPlayer.color)"));
  assert.equal(await b.ev("stoneLanternOut"), true);
  assert.match(await b.ev("noticeEl.textContent"), new RegExp(`${NAME}.*Lantern Festival`));
  assert.equal(await b.ev(GAME), game, "not the turn, the fireflies, the board or the hand");
});

test("lantern hunt: while the festival runs the scene is drawn with it on every frame", async () => {
  await b.ev("window.__seen = 0; window.__r0 = scene.render; scene.render = function (v) { if (v.festival) window.__seen++; return window.__r0.call(this, v); }; true");
  await wait(500);
  const seen = await b.ev("window.__seen");
  await b.ev("scene.render = window.__r0; true");
  assert.ok(seen >= 5, `drawn ${seen} times in half a second`);
});

test("lantern hunt: the lanterns stay out after a reload, kept per seat and room, and it can't be done twice", async () => {
  const keys = await b.ev(`Object.keys(sessionStorage).filter((k) => k.includes("lanternHunt"))`);
  const roomId = await b.ev("room.roomId");
  assert.equal(keys.length, 1);
  assert.ok(keys[0].endsWith(roomId) && keys[0].includes(NAME), keys[0]);
  await b.cdp("Page.reload");
  await b.waitFor("typeof joinButton !== 'undefined'", 10000, "main.js after the reload");
  await b.waitFor("room && lastState && lastState.status === 'playing' && !gameEl.hidden", 15000, "the rejoin");
  await b.ev(LISTEN);
  await wait(300);
  assert.equal(await b.ev("outLanterns.length"), 12);
  assert.equal(await b.ev("stoneLanternOut"), true);
  const p = await b.ev(STONE);
  await b.click(p.x, p.y);
  await wait(200);
  assert.deepEqual(await sentLately(), [], "the stone lantern stays out");
});

test("lantern hunt: another player's festival plays here too, with a notice naming them", async () => {
  await b.ev(`room.dispatchMessage("lanternFestival", { by: 3, name: "Rival" }); true`);
  await b.waitFor("festival !== null", 2000, "the festival");
  assert.equal(await b.ev("festival.seed"), await b.ev("P.festivalSeed(room.roomId, 3)"));
  assert.match(await b.ev("noticeEl.textContent"), /Rival.*Lantern Festival/);
  rig.assertClean("the page");
});
