// How to play in a real browser: the three illustrated steps, the chapter tabs,
// one chapter at a time, and pictures in place of the old paragraphs. Tests in
// this file share one page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b;
before(async () => {
  rig = await guiRig({ width: 1400, height: 1000 });
  b = rig.browser;
  await b.load(rig.url({ name: "Reader", room: "go_debug" }));
  await b.waitFor("joinButton.disabled === false", 15000, "the page-load rejoin to answer");
  await rig.clickEl("#home-help");
  await b.waitFor("welcomeEl.open", 3000, "How to play");
});
after(async () => rig?.close());

const CHAPTER = (n) => `.welcome-more:nth-of-type(${n})`;
const closeAll = () => b.ev(`welcomeEl.querySelectorAll("details").forEach((d) => (d.open = false)); true`);

test("help: How to play opens on the essentials without a scrollbar, each of the three steps illustrated", async () => {
  await closeAll();
  await wait(100);
  const r = await b.ev(`(() => {
    const body = welcomeEl.querySelector(".welcome-body");
    const steps = Array.from(welcomeEl.querySelectorAll(".howto-step"));
    return {
      scrolls: body.scrollHeight > body.clientHeight,
      steps: steps.length,
      pictures: steps.map((s) => s.querySelectorAll("img, .flip").length),
      tops: steps.map((s) => Math.round(s.getBoundingClientRect().top)),
      text: steps.map((s) => s.textContent.trim().split(/\\s+/).length),
    };
  })()`);
  assert.equal(r.scrolls, false, "the essentials and the tabs fit");
  assert.equal(r.steps, 3);
  for (const n of r.pictures) assert.ok(n >= 1, `pictures per step: ${r.pictures}`);
  assert.equal(new Set(r.tops).size, 1, `the steps sit side by side: ${r.tops}`);
  for (const n of r.text) assert.ok(n <= 26, `words per step: ${r.text}`);
});

test("help: on the home screen's small art pixel the dialog still takes a table's size when the window has room", async () => {
  const r = await b.ev(`({ w: welcomeEl.getBoundingClientRect().width, home: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--px")), own: parseFloat(getComputedStyle(welcomeEl).getPropertyValue("--px")), win: innerWidth })`);
  assert.ok(r.home < 2, `the home screen's art pixel is the small one here: ${JSON.stringify(r)}`);
  assert.equal(r.own, 2, `the dialog's own: ${JSON.stringify(r)}`);
  assert.ok(r.w <= r.win * 0.94 + 1, `inside the window: ${JSON.stringify(r)}`);
});

test("help: the nine chapters are tabs in a three by three grid, each with its picture", async () => {
  const r = await b.ev(`Array.from(welcomeEl.querySelectorAll("details > summary")).map((s) => {
    const box = s.getBoundingClientRect();
    return { label: s.textContent.trim(), left: Math.round(box.left), top: Math.round(box.top), w: box.width, h: box.height, art: s.querySelectorAll("img, .flip").length };
  })`);
  assert.equal(r.length, 9);
  assert.equal(new Set(r.map((t) => t.left)).size, 3, `three columns: ${JSON.stringify(r)}`);
  assert.equal(new Set(r.map((t) => t.top)).size, 3, `three rows: ${JSON.stringify(r)}`);
  for (const t of r) assert.ok(t.art >= 1, `${t.label} has a picture`);
  assert.equal(new Set(r.map((t) => `${t.left},${t.top}`)).size, 9, "no two tabs on the same spot");
});

test("help: a click opens a chapter under the tabs and closes the one before; another click folds it", async () => {
  await closeAll();
  const open = () => b.ev(`Array.from(welcomeEl.querySelectorAll("details")).map((d) => d.open)`);
  await rig.clickEl(`${CHAPTER(2)} > summary`);
  await b.waitFor(`document.querySelector("${CHAPTER(2)}").open`, 2000, "the second chapter");
  // Read together: the open chapter scrolls itself into view, so two separate reads can straddle the scroll.
  const { tabsBottom, panelTop } = await b.ev(`({
    tabsBottom: Math.max(...Array.from(welcomeEl.querySelectorAll("details > summary")).map((s) => s.getBoundingClientRect().bottom)),
    panelTop: document.querySelector("${CHAPTER(2)} .chapter").getBoundingClientRect().top,
  })`);
  assert.ok(panelTop >= tabsBottom - 1, `the panel starts under the tabs: ${panelTop} / ${tabsBottom}`);
  await rig.clickEl(`${CHAPTER(5)} > summary`);
  await b.waitFor(`document.querySelector("${CHAPTER(5)}").open`, 2000, "the fifth chapter");
  assert.deepEqual((await open()).map((o, i) => (o ? i : -1)).filter((i) => i >= 0), [4], "only the fifth is open");
  await rig.clickEl(`${CHAPTER(5)} > summary`);
  await b.waitFor(`!document.querySelector("${CHAPTER(5)}").open`, 2000, "the chapter folded");
  rig.assertClean("the chapters");
});

test("help: every chapter is illustrated and no text block in one runs past 34 words", async () => {
  for (let n = 1; n <= 9; n++) {
    await b.ev(`document.querySelector("${CHAPTER(n)}").open = true; true`);
    await wait(30);
    const r = await b.ev(`(() => {
      const d = document.querySelector("${CHAPTER(n)}");
      const chapter = d.querySelector(".chapter");
      const pictures = Array.from(chapter.querySelectorAll("img, .flip"));
      return {
        label: d.querySelector("summary").textContent.trim(),
        pictures: pictures.length,
        loaded: pictures.every((p) => p.tagName !== "IMG" || (p.complete && p.naturalWidth > 0)),
        words: Array.from(chapter.querySelectorAll("p")).map((p) => [p.textContent.trim().split(/\\s+/).length, p.textContent.trim().slice(0, 60)]),
        wide: chapter.scrollWidth > chapter.clientWidth + 1,
      };
    })()`);
    assert.ok(r.pictures >= 1, `${r.label}: ${r.pictures} pictures`);
    assert.equal(r.loaded, true, `${r.label}: its pictures load`);
    assert.equal(r.wide, false, `${r.label}: nothing runs past the panel's edge`);
    for (const [count, text] of r.words) assert.ok(count <= 34, `${r.label}: ${count} words in "${text}..."`);
  }
  await closeAll();
});

test("help: the step flipbooks animate, and stand still for a player who asks for reduced motion", async () => {
  const name = () => b.ev(`getComputedStyle(welcomeEl.querySelector(".howto-step .flip")).animationName`);
  assert.equal(await name(), "flip");
  await b.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  try {
    assert.equal(await name(), "none");
  } finally {
    await b.cdp("Emulation.setEmulatedMedia", { features: [] });
  }
});

test("help: at the table the steps show my own stones, and Items tonight's market", async () => {
  await b.ev("welcomeCloseButton.click(); true");
  await b.waitFor("!welcomeEl.open", 3000, "the dialog to close");
  await rig.joinWithBots([0, 0, 0]);
  await b.waitFor("lastState && lastState.status === 'playing'", 15000, "the game");
  await b.ev("if (!welcomeEl.open) helpButton.click(); true");
  await b.waitFor("welcomeEl.open", 3000, "How to play");
  try {
    assert.match(await b.ev("document.getElementById('welcome-you').textContent"), /^You play /);
    assert.equal(await b.ev("document.querySelectorAll('#welcome-base-icon img, #welcome-pattern-icon img').length"), 2);
    const items = await b.ev("document.querySelectorAll('#welcome-powerups .welcome-item img').length");
    assert.ok(items >= 6, `tonight's items have pictures: ${items}`);
    assert.match(await b.ev("welcomeEl.querySelector('.welcome-body').textContent"), /Left click/);
  } finally {
    await b.ev("if (welcomeEl.open) welcomeCloseButton.click(); true");
    await b.waitFor("!welcomeEl.open", 3000, "the dialog to close");
  }
  rig.assertClean("How to play at the table");
});
