// A game in a real browser: joined from the lobby board with three bots in a
// debug room (rich, market open at once), played with the mouse. Tests in this
// file share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { serverModule } from "../lib/paths.mjs";
import { guiRig } from "./page.mjs";

let rig, b;

/**
 * A page expression: my stone with this code offset (0 solid, 4 pattern) now
 * stands on (x, y), put there by my last action. While a storm's grey lasts
 * every stone is sent as the grey stone (14), my own included (findings B5):
 * debug rooms roll for storms every 6 turns, so that can happen mid-test.
 */
const mine = (x, y, offset = 0) =>
  `(lastState.action.player === myPlayer.color && lastState.action.x === ${x} && lastState.action.y === ${y} &&
    [myPlayer.color + ${offset}, 14].includes(board[${y} * lastState.size + ${x}]))`;
before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Tester", room: "go_debug" }));
  await rig.joinWithBots([0, 0, 0]); // three Hontes: no items, quick to read
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
});
after(async () => rig?.close());

test("game: the board replaces the lobby, and the first visit opens How to play, without the bot menu", async () => {
  assert.equal(await b.ev("lobbyEl.hidden"), true);
  assert.equal(await b.ev("gameEl.hidden"), false);
  await b.waitFor("welcomeEl.open", 5000, "the welcome dialog");
  assert.equal(await b.ev("welcomeBotsEl.hidden"), true, "a full table has no seats for bots");
  assert.match(await b.ev("document.getElementById('welcome-you').textContent"), /\S/, "it says which stones are mine");
  await b.ev("welcomeCloseButton.click(); true");
  await b.waitFor("!welcomeEl.open", 3000, "the dialog to close");
});

test("game: the board canvas is drawn in the five palette colours only", async () => {
  await wait(300);
  const { bad, colours } = await rig.offPaletteBoardPixels();
  assert.equal(bad, 0);
  assert.ok(colours >= 4, `${colours} colours`);
});

test("game: four seats in the sidebar, one of them (you) and three (bot), only mine with fireflies (B5)", async () => {
  const rows = await b.ev(`Array.from(document.querySelectorAll("#players .player-row")).map((r) => ({
    text: r.textContent, ff: !!r.querySelector(".ff"), card: !!r.querySelector(".card-mini") }))`);
  assert.equal(rows.length, 4);
  assert.equal(rows.filter((r) => /\(you\)/.test(r.text)).length, 1);
  assert.equal(rows.filter((r) => /\(bot\)/.test(r.text)).length, 3);
  rows.forEach((r) => assert.equal(r.ff, /\(you\)/.test(r.text), r.text));
  assert.ok(rows.every((r) => r.card), "everyone's Stone Card mini shows");
});

test("game: the market is open with six stalls; the hand holds the Stone Card and empty places", async () => {
  assert.match(await b.ev("marketStatusEl.textContent"), /6 stalls tonight/);
  assert.equal(await b.ev("marketItemsEl.querySelectorAll('button.item').length"), 6);
  assert.equal(await b.ev("handEl.querySelectorAll('.stone-card').length"), 1);
  assert.equal(await b.ev("handEl.querySelectorAll('.card-place').length"), 4);
});

test("game: the turn indicator and Pass follow the turn", async () => {
  await rig.waitMyTurn();
  assert.equal(await b.ev("turnIndicatorEl.textContent"), "Your turn");
  assert.equal(await b.ev("passButton.hidden || passButton.disabled"), false);
});

test("game: a left click on my turn plays my solid stone there", async () => {
  await rig.waitMyTurn();
  const p = await rig.freePoint();
  await rig.playAt(p.x, p.y, "left", mine(p.x, p.y), "my stone on the board");
  assert.match(await b.ev("lastEventEl.textContent + ' ' + history.at(-1).event"), new RegExp(`played \\(${p.x}, ${p.y}\\)`));
  assert.equal(await b.ev("isMyTurn"), false);
  assert.equal(await b.ev("passButton.disabled"), true);
});

test("game: a right click plays my pattern stone", async () => {
  await rig.waitMyTurn();
  const p = await rig.freePoint();
  await rig.playAt(p.x, p.y, "right", mine(p.x, p.y, 4), "my pattern stone on the board");
});

test("game: clicks out of turn send nothing", async () => {
  await b.waitFor("!isMyTurn", 10000, "a bot's turn");
  const turn = await b.ev("lastState.turnCount");
  const p = await rig.freePoint(3);
  await rig.clickBoard(p.x, p.y);
  await wait(200);
  assert.notEqual(await b.ev(`board[${p.y} * lastState.size + ${p.x}]`), await b.ev("myPlayer.color"));
  assert.ok((await b.ev("lastState.turnCount")) >= turn);
});

test("game: recall steps back with the arrow keys, blocks clicks, and Escape goes live", async () => {
  await b.waitFor("history.length >= 3", 15000, "a few moves of history");
  await b.ev("document.activeElement && document.activeElement.blur(); true");
  await b.key("ArrowLeft");
  assert.equal(await b.ev("recallEl.hidden"), false);
  assert.equal(await b.ev("recallStepsEl.textContent"), "-1");
  assert.equal(await b.ev("boardEl.classList.contains('recalling')"), true);
  const p = await rig.freePoint(5);
  await rig.clickBoard(p.x, p.y);
  await b.waitFor("/looking back/.test(noticeEl.textContent)", 3000, "the recall notice");
  await b.key("Escape");
  assert.equal(await b.ev("viewId"), null);
  assert.equal(await b.ev("recallStepsEl.textContent"), "0");
});

test("game: a stone goes on the Stone Card with a click on its grid, any time, free the first time", async () => {
  const before = await b.ev("myPlayer.fireflies");
  await b.ev(`handEl.querySelector('.stone-card .card-cell[style*="--col: 1"][style*="--row: 1"]').click(); true`);
  await b.waitFor("myPlayer.card[4] === 1", 5000, "the centre stone on my card");
  assert.equal(await b.ev("myPlayer.fireflies"), before, "the first stone is free");
  await b.waitFor(`/1 of 9/.test(handEl.querySelector('.stone-card .card-text').textContent)`, 3000, "the card's text");
});

test("game: the client's Stone Card prices match the server's", async () => {
  const { nextStoneCost } = serverModule("rules/stoneCard.js");
  for (let n = 0; n <= 9; n++) {
    const cells = Array.from({ length: 9 }, (_, i) => (i < n ? 1 : 0));
    assert.equal(await b.ev(`nextCardCost(${JSON.stringify(cells)})`), nextStoneCost(cells), `${n} stones`);
  }
});

test("game: buying from a stall puts the item's card in my hand", async () => {
  const stall = await b.ev(`(() => {
    const i = Array.from(marketItemsEl.querySelectorAll("button.item")).findIndex((el) => !el.disabled);
    return i < 0 ? null : { i, id: lastState.market[i].id };
  })()`);
  assert.ok(stall, "a stall I can buy from");
  await b.ev(`marketItemsEl.querySelectorAll("button.item")[${stall.i}].click(); true`);
  await b.waitFor(`Array.from(myPlayer.powerups).includes(${JSON.stringify(stall.id)})`, 5000, "the item in my satchel");
  await b.waitFor(`!!handEl.querySelector('.card[data-index="1"]')`, 3000, "its card in my hand");
});

test("game: the Stone Card is played on my turn with a click on the card and one on the board", async () => {
  await rig.waitMyTurn();
  await b.ev(`handEl.querySelector('.stone-card').click(); true`);
  await b.waitFor("selectedPowerup === 'stone_card'", 3000, "the card armed");
  assert.match(await b.ev("boardHintEl.textContent"), /Stone Card/);
  const p = await rig.freePoint();
  await rig.playAt(p.x, p.y, "left", mine(p.x, p.y), "the card's stone on the board");
  await b.waitFor("!Array.from(myPlayer.powerups).includes('stone_card')", 3000, "the card used up");
});

test("game: Leave asks first, then puts me back in the lobby and stops drawing the board", async () => {
  b.on("Page.javascriptDialogOpening", () => b.cdp("Page.handleJavaScriptDialog", { accept: true }));
  await b.ev("document.getElementById('leave-button').click(); true");
  await b.waitFor("!lobbyEl.hidden && gameEl.hidden", 5000, "the lobby");
  assert.equal(await b.ev("lobbyStatus.textContent"), "You left the game.");
  await b.ev("window.__renders = 0; const r0 = scene.render; scene.render = function (...a) { window.__renders++; return r0.apply(this, a); }; true");
  await wait(700);
  assert.equal(await b.ev("window.__renders"), 0, "no frames for the hidden board (P1)");
});

test("game: joining again brings nothing of the old game along (B2)", async () => {
  const old = await b.ev("history.length");
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing'", 15000, "the new game");
  await wait(800);
  const s = await b.ev(`({ storm, history: history.length, effects: effects.length, viewId, resultOpened })`);
  assert.equal(s.storm, null);
  assert.ok(s.history <= 2 && s.history < old, `history ${s.history}`);
  assert.equal(s.viewId, null);
  assert.equal(s.resultOpened, false);
  assert.ok((await b.ev("window.__renders")) > 0, "the board is drawn again");
});

test("game: a reload mid-game locks Join while it asks, then sits back down in the same game (B4, B18)", async () => {
  await rig.waitMyTurn();
  const gameId = await b.ev("room.roomId");
  await b.ev("room.send('pass'); true");
  await b.waitFor("/passed/.test(lastState.lastEvent || '')", 5000, "the pass");
  await b.cdp("Page.reload");
  await b.waitFor("typeof joinButton !== 'undefined'", 10000, "main.js after the reload");
  const lockedEarly = await b.ev("joinButton.disabled");
  await b.waitFor("room && lastState && lastState.status === 'playing' && !gameEl.hidden", 15000, "the rejoin");
  assert.equal(lockedEarly, true);
  assert.equal(await b.ev("room.roomId"), gameId);
  assert.equal(await b.ev("passFlashAt"), undefined, "no stray PASS sign (B18)");
  rig.assertClean("the game");
});
