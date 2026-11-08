// The Night Market on the water, in a real browser (tasks/2026-11-07_night_market_water/PLAN.md):
// seven boats right of the deck, one real button each over the canvas, a tip on hover,
// and the card flying into the hand from the boat. A debug room (rich, the market open
// at once) with three Hontes, who never buy; the tests share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Marketeer", room: "go_debug", nowelcome: "1" }));
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing'", 15000, "the game to start");
});

after(async () => rig?.close());

/** Every boat's button as the page lays it out, with the scene's box for it in CSS px. */
const BOATS = `(() => {
  const px = artPx(), bd = boardEl.getBoundingClientRect(), L = scene.layout;
  const view = marketView(lastState);
  return Array.from(marketItemsEl.querySelectorAll("button.item")).map((el, i) => {
    const q = el.getBoundingClientRect(), m = Array.from(lastState.market).find((s) => s.id === el.dataset.id);
    const v = view.stalls.find((s) => s.id === el.dataset.id), want = P.marketBox(L, i, v), goods = el.querySelector(".goods").getBoundingClientRect();
    return { id: el.dataset.id, name: m.name, price: m.price, stock: m.stock, left: m.left, description: m.description, free: m.free, disabled: el.disabled,
      label: el.getAttribute("aria-label"), l: q.left, r: q.right, t: q.top, b: q.bottom, cx: (q.left + q.right) / 2, cy: (q.top + q.bottom) / 2,
      goodsCx: (goods.left + goods.right) / 2, goodsCy: (goods.top + goods.bottom) / 2,
      wantL: bd.left + want.x * px, wantT: bd.top + want.y * px, wantW: want.w * px, wantH: want.h * px,
      zoneL: bd.left + L.marketX0 * px, zoneR: bd.left + L.marketX1 * px, px, on: document.elementFromPoint((q.left + q.right) / 2, (q.top + q.bottom) / 2) === el };
  });
})()`;

const near = (a, c, label, tol = 0.51) => assert.ok(Math.abs(a - c) <= tol, `${label}: ${a} vs ${c}`);

test("market: the frame hands the scene the market the page shows, and a pole stands in the water on the canvas", async () => {
  const m = await b.ev(`(() => {
    const before = scene.render, seen = [];
    scene.render = function (view) { seen.push(view); return before.call(this, view); };
    return new Promise((done) => setTimeout(() => {
      scene.render = before;
      try {
        const view = seen[seen.length - 1], s = scene.layout.stalls[0];
        const d = boardCtx.getImageData(s.poleX, s.wl - 6, 1, 1).data;
        done({ ids: view.market.stalls.map((x) => x.id), page: Array.from(lastState.market).map((x) => x.id), sign: view.market.sign, cap: [d[0], d[1], d[2]], cream: G.PALETTE_RGB[G.INDEX.C] });
      } catch (err) { done({ error: String(err) }); }
    }, 400));
  })()`);
  assert.equal(m.error, undefined, "the frame carries a market");
  assert.equal(m.ids.length, 7, "seven boats");
  assert.deepEqual(m.ids, m.page, "the stalls in the market's order");
  assert.deepEqual(m.sign, { text: "NIGHT MARKET", lit: true }, "open, and the sign says so");
  assert.deepEqual(m.cap, m.cream, "the pole's cream cap on the canvas");
});

test("market: no sidebar is left, and the stalls are seven real buttons over the water right of the deck", async () => {
  assert.equal(await b.ev(`!!document.getElementById("sidebar")`), false, "no sidebar");
  const boats = await b.ev(BOATS);
  assert.equal(boats.length, 7);
  for (const s of boats) {
    assert.ok(s.l >= s.zoneL - 2 * s.px - 0.5 && s.r <= s.zoneR + 2 * s.px + 0.5, `${s.id}: over the market's water`);
    near(s.l, s.wantL, `${s.id}: where the scene put it, across`);
    near(s.t, s.wantT, `${s.id}: down`);
    near(s.r - s.l, s.wantW, `${s.id}: as wide`);
    near(s.b - s.t, s.wantH, `${s.id}: as tall`);
    assert.equal(s.on, true, `${s.id}: nothing covers its middle`);
  }
});

test("market: each boat's button is named for a screen reader with the item and what it costs", async () => {
  for (const s of await b.ev(BOATS)) assert.equal(s.label, `${s.name}, ${s.price} fireflies`, s.id);
});

test("market: hovering a boat names the item and says what it does, its stock, whether it takes the turn and that a click buys it, beside the boat", async () => {
  const s = (await b.ev(BOATS)).find((x) => !x.disabled && x.stock > 1 && !x.free);
  assert.ok(s, "a boat I can buy from");
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.cx, y: s.cy });
  await b.waitFor("!!document.querySelector('.market-tip')", 2000, "the tip");
  const tip = await b.ev(`(() => { const t = document.querySelector(".market-tip"), r = t.getBoundingClientRect();
    return { text: t.textContent, l: r.left, r: r.right, t: r.top, b: r.bottom, h: innerHeight }; })()`);
  assert.ok(tip.text.includes(s.name), tip.text);
  assert.ok(tip.text.includes(s.description), "what it does");
  assert.ok(tip.text.includes(`${s.left} of ${s.stock} left tonight`), tip.text);
  assert.match(tip.text, /Takes your turn/);
  assert.match(tip.text, /Click to buy/);
  assert.ok(tip.r <= s.l + 0.5, `left of the boat: ${tip.r} vs ${s.l}`);
  assert.ok(tip.t >= 0 && tip.b <= tip.h, "on screen");
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await b.waitFor("!document.querySelector('.market-tip')", 2000, "the tip gone once the pointer leaves");
});

test("market: the view the scene draws follows the table: lit to buy, half lit when short or out of room, out once sold or had, dark before it opens", async () => {
  const v = await b.ev(`(() => {
    const stall = (id, o) => Object.assign({ id, name: id, price: 40, stock: 3, left: 3, share: 1, free: false, tier: 1 }, o);
    const market = [stall("a"), stall("b", { price: 90 }), stall("c", { left: 0 }), stall("d"), stall("e", { free: true })];
    const state = { status: "playing", shopAfter: 5, handLimit: 5, market, turnCount: 25, players: [1, 2, 3, 4] };
    const me = (o) => Object.assign({ moves: 5, bought: ["d"], fireflies: 50, powerups: [] }, o);
    return {
      open: marketView(state, me()),
      closed: marketView(Object.assign({}, state, { turnCount: 15 }), me()),
      full: marketView(state, me({ powerups: ["1", "2", "3", "4", "5"] })),
      done: marketView(Object.assign({}, state, { status: "finished" }), me()),
    };
  })()`);
  const at = (view) => view.stalls.map((s) => s.state);
  assert.deepEqual(at(v.open), ["open", "poor", "sold", "bought", "open"], "tonight");
  assert.deepEqual(v.open.stalls.map((s) => s.turn), [true, true, true, true, false], "the turn marker on all but the free item");
  assert.deepEqual(v.open.sign, { text: "NIGHT MARKET", lit: true });
  assert.deepEqual(at(v.closed), ["closed", "closed", "closed", "closed", "closed"], "not open for me yet");
  assert.deepEqual(v.closed.sign, { text: "OPENS 3/5", lit: false });
  assert.deepEqual(at(v.full), ["poor", "poor", "sold", "bought", "poor"], "for sale, but my hand is full");
  assert.deepEqual(at(v.done), ["closed", "closed", "closed", "closed", "closed"], "the game is over");
  assert.deepEqual(v.done.sign, { text: "NIGHT MARKET", lit: false });
});

test("market: the sign counts the rounds the table has finished, the same for every seat, and the tip says round 6", async () => {
  const v = await b.ev(`(() => {
    const state = (turnCount) => ({ status: "playing", shopAfter: 5, handLimit: 5, market: [], turnCount, players: [1, 2, 3, 4] });
    const me = (moves) => ({ moves, bought: [], fireflies: 50, powerups: [] });
    return {
      played: marketView(state(14), me(9)).sign,
      idle: marketView(state(14), me(0)).sign,
      lastTurn: marketView(state(19), me(9)).sign,
      open: marketView(state(20), me(0)).sign,
      tip: stallVerdict({ name: "x" }, { state: "closed" }, marketContext(state(14), me(9))),
    };
  })()`);
  assert.deepEqual(v.played, { text: "OPENS 3/5", lit: false });
  assert.deepEqual(v.idle, v.played, "the same for a seat that has placed no stone");
  assert.deepEqual(v.lastTurn, { text: "OPENS 4/5", lit: false });
  assert.deepEqual(v.open, { text: "NIGHT MARKET", lit: true });
  assert.match(v.tip, /start of round 6/);
  assert.doesNotMatch(v.tip, /moves/);
});

test("market: a real click on a boat buys its item, takes one lantern off its string and flies the card in from the boat", async () => {
  await b.ev(`(() => {
    window.__flights = [];
    const animate = Element.prototype.animate;
    Element.prototype.animate = function (frames, opts) {
      if (this.classList.contains("flying")) window.__flights.push({ first: frames[0].transform, left: parseFloat(this.style.left), top: parseFloat(this.style.top), w: parseFloat(this.style.width), h: parseFloat(this.style.height) });
      return animate.call(this, frames, opts);
    };
    return true;
  })()`);
  const s = (await b.ev(BOATS)).find((x) => !x.disabled && x.stock > 1);
  assert.ok(s, "a boat I can buy from");
  await b.click(s.cx, s.cy);
  const id = JSON.stringify(s.id);
  await b.waitFor(`Array.from(myPlayer.powerups).includes(${id})`, 5000, "the item in my hand");
  await b.waitFor("window.__flights.length === 1", 3000, "the card in flight");
  const f = (await b.ev("window.__flights"))[0];
  const [, dx, dy] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(f.first).map(Number);
  near(f.left + f.w / 2 + dx, s.goodsCx, "it starts at the boat's goods, across", 1);
  near(f.top + f.h / 2 + dy, s.goodsCy, "and down", 1);
  const left = await b.ev(`marketView(lastState).stalls.find((x) => x.id === ${id}).left`);
  assert.equal(left, s.left - 1, "one lantern fewer lit on its string");
  rig.assertClean("the market");
});

test("market: a sold-out boat still explains itself on hover, and its button says it's sold out", async () => {
  const one = (await b.ev(BOATS)).find((x) => x.stock === 1);
  assert.ok(one, "the tier 3 stall holds a single copy");
  await b.ev(`room.send("buy", { id: ${JSON.stringify(one.id)} }); true`);
  const id = JSON.stringify(one.id);
  await b.waitFor(`marketView(lastState).stalls.find((x) => x.id === ${id}).state === "sold"`, 5000, "the last copy bought");
  await b.waitFor(`marketItemsEl.querySelector('button.item[data-id=${id}]').disabled`, 3000, "the boat closed");
  const s = (await b.ev(BOATS)).find((x) => x.id === one.id);
  assert.equal(s.label, `${s.name}, sold out`);
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: s.cx, y: s.cy });
  await b.waitFor("!!document.querySelector('.market-tip')", 2000, "the tip, though the button is disabled");
  assert.match(await b.ev(`document.querySelector(".market-tip").textContent`), /sold out tonight/);
  await b.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await b.waitFor("!document.querySelector('.market-tip')", 2000, "the tip gone");
});

test("market: How to play says the market is on the water, not in the sidebar", async () => {
  await b.ev("helpButton.click(); true");
  await b.waitFor("welcomeEl.open", 3000, "How to play");
  const text = await b.ev(`document.getElementById("welcome").textContent`);
  await b.ev("welcomeCloseButton.click(); true");
  await b.waitFor("!welcomeEl.open", 3000, "the dialog to close");
  assert.doesNotMatch(text, /Night Market opens in the sidebar/);
  assert.match(text, /Night Market opens on the water right of the board/);
});
