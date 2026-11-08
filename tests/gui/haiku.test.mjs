// Haiku points in a real browser (ideas.md §11.11): a glyph on each point still to
// collect, gone once a stone collects it, and the haiku's card in the hand with its
// level in pips. A debug room with three bots, without storms (their grey would
// hide whose stone is whose); the tests share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;
let point; // the haiku point this page collects: {x, y, haiku, line}

before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Poet", room: "go_debug", nowelcome: "1", nostorm: "1" }));
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState.status === 'playing' && lastState.haiku && lastState.haiku.length === 9", 15000, "the game with its haiku");
});

after(async () => {
  await rig?.close();
});

test("haiku: each point still to collect is on the board as a glyph", async () => {
  await rig.waitMyTurn();
  point = await b.ev(`(() => { const p = Array.from(lastState.haiku).find((h) => !h.by && !board[h.y * lastState.size + h.x]); return p && { x: p.x, y: p.y, haiku: p.haiku, line: p.line }; })()`);
  assert.ok(point, "a haiku point free to take");
  assert.equal(await b.ev(`overlays.filter((o) => o.kind === "haiku").length`), await b.ev("Array.from(lastState.haiku).filter((h) => !h.by).length"));
  assert.equal(await b.ev(`overlays.some((o) => o.kind === "haiku" && o.x === ${point.x} && o.y === ${point.y} && o.axis === "${point.haiku}" && o.until === ${point.line})`), true);
});

test("haiku: a stone on it collects the line: the glyph goes, and the card comes with one pip lit", async () => {
  await rig.playAt(point.x, point.y, "left", `Array.from(lastState.haiku).some((h) => h.x === ${point.x} && h.y === ${point.y} && h.by === myPlayer.color)`, "the line collected");
  await b.waitFor(`!overlays.some((o) => o.kind === "haiku" && o.x === ${point.x} && o.y === ${point.y})`, 3000, "the glyph gone");
  await b.waitFor(`!!handEl.querySelector('.card.haiku-card[data-id="haiku_${point.haiku}"]')`, 5000, "the haiku's card in the hand");
  assert.equal(await b.ev(`handEl.querySelector('.card.haiku-card[data-id="haiku_${point.haiku}"]').dataset.level`), "1");
  assert.match(await b.ev(`handEl.querySelector('.card.haiku-card').getAttribute("aria-label")`), /level 1/i);
  rig.assertClean("the haiku");
});

test("haiku: the card highlights only the lines I collected of its haiku", async () => {
  const card = `handEl.querySelector('.card.haiku-card[data-id="haiku_${point.haiku}"]')`;
  assert.equal(await b.ev(`${card}.querySelectorAll(".haiku-line").length`), 3, "all three lines on the card");
  assert.deepEqual(await b.ev(`Array.from(${card}.querySelectorAll(".haiku-line.got")).map((el) => Number(el.dataset.line))`), [point.line]);
});

test("haiku: every power fits its card under the poem", async () => {
  const sizes = await b.ev(`(() => {
    const out = [];
    for (const h of HAIKU) h.powers.forEach((power, i) => {
      const card = document.createElement("div");
      card.className = "card haiku-card";
      const text = document.createElement("span");
      text.className = "card-text";
      text.textContent = h.lines.join(" / ") + " -- " + power;
      card.append(text);
      handEl.append(card);
      out.push({ id: h.id, level: i + 1, need: text.scrollHeight, has: text.clientHeight });
      card.remove();
    });
    return out;
  })()`);
  assert.equal(sizes.length, 9);
  for (const s of sizes) assert.ok(s.need <= s.has + 1, `${s.id} level ${s.level}: needs ${s.need}, has ${s.has}`);
});

test("haiku: 川 at level 3 marks every stone of my two colours, below that only my own", async () => {
  const v = await b.ev(`(() => {
    const realPlayer = myPlayer, realLevel = haikuLevel, real = selectedPowerup;
    myPlayer = Object.assign(Object.create(realPlayer), { color: 1 });
    selectedPowerup = "haiku_river";
    const codes = [1, 5, 3, 6, 2, 7, 4, 8, 10, 11, 12, 13];
    const at = (level) => { haikuLevel = () => level; return codes.filter((c) => mayCarry(c)); };
    const out = { two: at(2), three: at(3) };
    haikuLevel = realLevel; myPlayer = realPlayer; selectedPowerup = real;
    return out;
  })()`);
  assert.deepEqual(v.two, [1, 5, 10], "level 2: my own, the twin included");
  assert.deepEqual(v.three, [1, 5, 3, 6, 10, 11, 12], "level 3: black and gray whoever's, and any twin showing either");
});

test("haiku: 木 at level 3 sends the colour of each click, left then right and right then left", async () => {
  await b.ev(`(() => {
    window.__real = { send: room.send, level: haikuLevel };
    window.__seeds = [];
    room.send = function (type, msg) { if (type === "usePowerup") window.__seeds.push(msg); };
    haikuLevel = () => 3;
    return true;
  })()`);
  try {
    for (const [first, second] of [["left", "right"], ["right", "left"]]) {
      await b.ev(`setSelectedPowerup("haiku_tree"); true`);
      await rig.clickBoard(2, 2, first);
      await rig.clickBoard(9, 9, second);
    }
  } finally {
    await b.ev("room.send = window.__real.send; haikuLevel = window.__real.level; setSelectedPowerup(null); true");
  }
  const sent = await b.ev("window.__seeds");
  assert.deepEqual(sent.map((m) => [m.target.x, m.target2.x, m.axis, m.axis2]), [[2, 9, "base", "pattern"], [2, 9, "pattern", "base"]]);
});
