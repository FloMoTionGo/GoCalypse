// The home screen in a real browser: logo, lobby board, bot picks, How to play,
// and the clean-console and accessible-name rules. Tests in this file share one
// page and run in order.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { wait } from "../lib/harness.mjs";
import { guiRig } from "./page.mjs";

let rig, b;
before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await b.load(rig.url({ name: "Tester" }));
  await b.waitFor("joinButton.disabled === false", 15000, "the page-load rejoin to answer");
});
after(async () => rig?.close());

test("home: loads without errors, the lobby on show and the game hidden", async () => {
  assert.equal(await b.ev("document.title"), "GoCalypse");
  assert.equal(await b.ev("lobbyEl.hidden"), false);
  assert.equal(await b.ev("gameEl.hidden"), true);
  assert.equal(await b.ev("nameInput.value"), "Tester", "the name from the link");
  assert.equal(await b.ev("serverInput.value"), rig.server.ws, "the server from the link");
  assert.equal(await b.ev("joinButton.textContent"), "Play online");
  rig.assertClean();
});

test("home: the logo and the lobby board are drawn, sized, and not blank", async () => {
  await wait(300);
  for (const id of ["logo", "lobby-board"]) {
    const r = await b.ev(`(() => {
      const c = document.getElementById("${id}"), box = c.getBoundingClientRect();
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const colours = new Set();
      for (let i = 0; i < d.length; i += 16) colours.add(d[i] + "," + d[i + 1] + "," + d[i + 2] + "," + d[i + 3]);
      return { w: c.width, h: c.height, cssW: box.width, cssH: box.height, colours: colours.size };
    })()`);
    assert.ok(r.w > 0 && r.h > 0 && r.cssW > 0 && r.cssH > 0, `${id} has a size: ${JSON.stringify(r)}`);
    assert.ok(r.colours >= 3, `${id} is drawn: ${r.colours} colours`);
  }
});

test("home: nothing scrolls sideways at this window size", async () => {
  assert.ok(await b.ev("document.documentElement.scrollWidth <= window.innerWidth"));
});

/** The home screen as the page lays it out, in device px. */
const HOME_MEASURE = `(() => {
  const dpr = devicePixelRatio, logo = document.getElementById("logo"), l = logo.getBoundingClientRect();
  const j = joinButton.getBoundingClientRect(), foot = document.getElementById("home-footer").getBoundingClientRect();
  return {
    k: (l.height * dpr) / logo.height,
    logoW: l.width * dpr, winW: innerWidth * dpr, winH: innerHeight * dpr,
    logoMid: (l.left + l.width / 2) * dpr, joinMid: (j.left + j.width / 2) * dpr,
    joinFont: parseFloat(getComputedStyle(joinButton).fontSize) * dpr,
    tagFont: parseFloat(getComputedStyle(document.querySelector("#lobby .tagline")).fontSize) * dpr,
    bottom: foot.bottom * dpr,
    scrolls: document.documentElement.scrollWidth > innerWidth || document.documentElement.scrollHeight > innerHeight,
  };
})()`;

test("home: one picture in whole pixels near 75% of the window, centred, its text scaled with it", async () => {
  const at = async (width, height) => {
    await b.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(500);
    return b.ev(HOME_MEASURE);
  };
  // 1920x950 is k = 1, where text keeps its 11 device px floor; the text is compared from k = 2 up.
  const hd = await at(1920, 950), small = await at(2560, 1440), big = await at(3840, 2175);
  await b.cdp("Emulation.clearDeviceMetricsOverride", {});
  await wait(300);
  for (const [m, name] of [[hd, "1920x950"], [small, "2560x1440"], [big, "3840x2175"]]) {
    assert.ok(Number.isInteger(m.k) && m.k >= 1, `${name}: whole pixels, k=${m.k}`);
    assert.ok(m.logoW <= 0.75 * m.winW + 0.5 && m.logoW > 0.75 * m.winW - m.k - 0.5, `${name}: the river spans 75% of the width (${m.logoW} of ${m.winW})`);
    assert.ok(Math.abs(m.logoMid - m.winW / 2) <= 1, `${name}: the scene is centred (${m.logoMid})`);
    assert.ok(Math.abs(m.joinMid - m.winW / 2) <= 1, `${name}: Play is centred (${m.joinMid})`);
    assert.ok(m.bottom <= m.winH && !m.scrolls, `${name}: all of it fits the window`);
  }
  assert.ok(big.k > small.k, `a bigger window, a bigger picture: ${small.k} -> ${big.k}`);
  assert.ok(Math.abs(big.joinFont / big.k - small.joinFont / small.k) < 0.01, `Play's text scales with k: ${small.joinFont} -> ${big.joinFont}`);
  assert.ok(Math.abs(big.tagFont / big.k - small.tagFont / small.k) < 0.01, `the tagline too: ${small.tagFont} -> ${big.tagFont}`);
});

test("home: every button, link, input and canvas a user can reach has an accessible name", async () => {
  const unnamed = await b.ev(`Array.from(document.querySelectorAll("button, a[href], input, [role=button], canvas[tabindex]"))
    .filter((el) => !el.closest("[hidden]") && el.getAttribute("aria-hidden") !== "true" && el.tabIndex >= 0)
    .filter((el) => {
      const label = el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent.trim() ||
        (el.labels && Array.from(el.labels).map((l) => l.textContent.trim()).join("")) || el.getAttribute("placeholder");
      return !label;
    })
    .map((el) => el.outerHTML.slice(0, 80))`);
  assert.deepEqual(unnamed, []);
});

test("home: a black stone on the lobby board seats that column's bot, and the Join label follows", async () => {
  await rig.clickLobby(0, 0); // Honte as Player 2
  assert.deepEqual(await b.ev("pickedIds()"), ["pure"]);
  assert.equal(await b.ev("joinButton.textContent"), "Play with 1 bot");
  await rig.clickLobby(5, 1); // Ko as Player 3
  assert.deepEqual(await b.ev("pickedIds()"), ["pure", "shark"]);
  assert.equal(await b.ev("joinButton.textContent"), "Play with 2 bots");
  await b.waitFor("document.getElementById('lobby-announce').textContent === 'Ko seated as Player 3.'", 3000, "the screen-reader announcement");
});

test("home: a white stone (right click) takes a bot off again", async () => {
  await rig.clickLobby(5, 1, "right");
  assert.deepEqual(await b.ev("pickedIds()"), ["pure"]);
});

test("home: a black stone on a seat another bot holds replaces it", async () => {
  await rig.clickLobby(2, 0); // Moyo onto Honte's seat
  assert.deepEqual(await b.ev("pickedIds()"), ["pattern"]);
});

test("home: never more than 3 bots", async () => {
  await rig.clickLobby(0, 1);
  await rig.clickLobby(1, 2);
  assert.equal(await b.ev("pickedTotal()"), 3);
  await rig.clickLobby(4, 2); // replaces the seat's bot: still 3
  assert.equal(await b.ev("pickedTotal()"), 3);
  for (const [c, r] of [[2, 0], [0, 1], [4, 2]]) await rig.clickLobby(c, r, "right");
  assert.equal(await b.ev("pickedTotal()"), 0);
  assert.equal(await b.ev("joinButton.textContent"), "Play online");
});

test("home: the lobby board works from the keyboard: arrows move, Enter seats, Delete takes off", async () => {
  await b.ev("document.getElementById('lobby-board').focus(); true");
  await b.key("ArrowRight");
  await b.key("Enter"); // column 1 (Atsumi), row 0
  assert.deepEqual(await b.ev("pickedIds()"), ["careful"]);
  assert.match(await b.ev("document.getElementById('lobby-caption').textContent"), /Atsumi as Player 2/);
  await b.key("Delete");
  assert.deepEqual(await b.ev("pickedIds()"), []);
});

test("home: How to play opens the general rules; Escape closes them and they count as seen", async () => {
  await b.ev("document.getElementById('home-help').click(); true");
  await b.waitFor("welcomeEl.open", 3000, "the welcome dialog");
  assert.match(await b.ev("welcomeEl.textContent"), /How to play/);
  assert.equal(await b.ev("welcomeBotsEl.hidden"), true, "no bot menu without a table");
  await b.key("Escape");
  await b.waitFor("!welcomeEl.open", 3000, "the dialog to close");
  // The dialog's close event, which marks it seen, comes a task after `open` turns false.
  await b.waitFor("localStorage.getItem('gocalypse.welcomeSeen') === '1'", 2000, "the welcome marked seen");
  rig.assertClean("the home screen");
});
