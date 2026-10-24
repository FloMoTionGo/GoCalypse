// Aiming the two-point items in a real browser (ideas.md §11.3): Ferry and Skiff
// pick one of your stones, then where it goes. A debug room with three bots; the
// market may not stock either item tonight, so the page is told it does (the
// server's own refusal is not what these tests are about). Tests in this file
// share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b;
const mine = []; // two of my stones on the board: {x, y}

/** The page's market answers for Ferry and Skiff, whatever tonight's stalls are. */
const STUB = `window.__marketItem = window.__marketItem || marketItem;
  marketItem = (id) => id === "skiff" ? { id, name: "Skiff", points: 2, free: false, tier: 2 }
    : id === "ferry" ? { id, name: "Ferry", points: 2, free: false, tier: 2 } : window.__marketItem(id); true`;
/** Records the next render's arguments in window.__args. */
const SPY = `window.__render = window.__render || scene.render;
  scene.render = function (...a) { window.__args = a[0]; return window.__render.apply(this, a); }; true`;
/** Records what the page sends. */
const SENT = `window.__sent = []; window.__send = window.__send || Colyseus.Room.prototype.send;
  Colyseus.Room.prototype.send = function (type, msg) { window.__sent.push(type); return window.__send.call(this, type, msg); }; true`;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Aimer", room: "go_debug", nowelcome: "1" }));
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
  for (let k = 0; k < 2; k++) {
    await rig.waitMyTurn();
    const p = await rig.freePoint(k * 7);
    const turn = await b.ev("lastState.turnCount");
    await b.ev(`room.send("move", { x: ${p.x}, y: ${p.y}, axis: "base" }); true`);
    await b.waitFor(`lastState.turnCount > ${turn}`, 10000, "my stone");
    mine.push(p);
  }
  await rig.waitMyTurn();
  await b.waitFor(`[${mine.map((p) => `${p.y} * lastState.size + ${p.x}`).join(", ")}].every((i) => [myPlayer.color, 14].includes(board[i]))`, 5000, "both stones on my board");
  await b.ev(STUB);
  await b.ev(SPY);
});
after(async () => rig?.close());

const idx = (p) => `(${p.y} * lastState.size + ${p.x})`;

test("targeting: after the stone to move is picked, only that stone is marked, and it blinks", async () => {
  await b.ev(`setSelectedPowerup("skiff"); true`);
  await wait(150);
  const armed = await b.ev("window.__args.highlightMine");
  if (!(await b.ev("stormGreys()"))) {
    for (const p of mine) assert.ok(armed.includes(await b.ev(idx(p))), "every stone of mine has its ember before the pick");
  }
  await rig.clickBoard(mine[0].x, mine[0].y);
  assert.deepEqual(await b.ev("firstTarget"), mine[0]);
  await wait(150);
  const a = await b.ev("({ mine: window.__args.highlightMine, blink: window.__args.highlightBlink })");
  assert.deepEqual(a.mine, [await b.ev(idx(mine[0]))], "only the picked stone");
  assert.equal(a.blink, true, "and it blinks");
  assert.match(await b.ev("boardHintEl.textContent"), /point to move it to/);
});

test("targeting: the points a Skiff or a Ferry can take the picked stone to are marked", async () => {
  const r = await b.ev(`(() => {
    const n = 13, cells = new Array(n * n).fill(0), at = (x, y) => y * n + x;
    cells[at(6, 6)] = myPlayer.color; cells[at(6, 2)] = 2; cells[at(9, 6)] = 9;
    const fire = [{ kind: "fire", x: 4, y: 6, owner: 0, until: 999 }];
    const pts = (id) => landingPoints(id, { x: 6, y: 6 }, cells, n, fire).map((i) => [i % n, (i / n) | 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { skiff: pts("skiff"), ferry: pts("ferry"), live: window.__args.landings, wanted: landingPoints("skiff", firstTarget, board, lastState.size) };
  })()`);
  const sort = (l) => l.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(r.skiff, sort([[6, 3], [6, 4], [6, 5], [6, 7], [6, 8], [6, 9], [6, 10], [6, 11], [6, 12], [0, 6], [1, 6], [2, 6], [3, 6], [5, 6], [7, 6], [8, 6]]),
    "Skiff: along its row and column up to the first piece, past a fire but never onto one");
  assert.deepEqual(r.ferry, sort([[6, 5], [6, 7], [5, 6], [7, 6]]), "Ferry: the empty points beside it");
  assert.deepEqual(r.live.slice().sort((a, b) => a - b), r.wanted.slice().sort((a, b) => a - b), "the live board marks the picked stone's");
  assert.ok(r.live.length > 0);
});

test("targeting: a first pick that isn't one of my stones is refused with a notice, and nothing is sent", async () => {
  // A debug room's storm (every 6 turns) greys every stone, and then any stone is taken: not this test's case.
  await b.ev(`stormUntil = 0; setSelectedPowerup(null); setSelectedPowerup("skiff"); true`);
  await b.ev(SENT);
  const p = await rig.freePoint(3);
  await rig.clickBoard(p.x, p.y);
  await wait(200);
  assert.equal(await b.ev("firstTarget"), null);
  assert.equal(await b.ev("selectedPowerup"), "skiff", "still armed");
  assert.match(await b.ev("noticeEl.textContent"), /one of your own stones/);
  assert.deepEqual(await b.ev("window.__sent"), []);
});

test("targeting: another of my stones re-picks; the picked stone again un-picks", async () => {
  await rig.clickBoard(mine[0].x, mine[0].y);
  assert.deepEqual(await b.ev("firstTarget"), mine[0]);
  await rig.clickBoard(mine[1].x, mine[1].y);
  assert.deepEqual(await b.ev("firstTarget"), mine[1], "re-picked");
  await rig.clickBoard(mine[1].x, mine[1].y);
  assert.equal(await b.ev("firstTarget"), null, "un-picked");
  assert.equal(await b.ev("selectedPowerup"), "skiff");
  assert.deepEqual(await b.ev("window.__sent"), []);
  await b.ev("setSelectedPowerup(null); true");
  rig.assertClean("the aiming");
});
