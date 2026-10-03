// Helpers for driving web/index.html in the GUI tests. main.js keeps its state
// in top-level script variables (room, lastState, myPlayer, scene, ...), which
// Runtime.evaluate can read, so the tests act through real mouse and keyboard
// events and check both the DOM and that state.
import assert from "node:assert/strict";
import { gameRig, wait } from "../lib/harness.mjs";

/** Console noise that is part of normal operation, not a fault. */
const EXPECTED = [
  // The page-load rejoin asks /rejoin first; "no game" is a 404, which Chrome logs.
  /status of 404.*\/rejoin$/,
];

/** A rig with the page's own helpers bound to its browser. */
export async function guiRig() {
  const rig = await gameRig();
  const b = rig.browser;
  return Object.assign(rig, {
    /** Problems on the page that aren't expected noise (the clean-console rule). */
    problems: () => b.problems.filter((p) => !EXPECTED.some((re) => re.test(p))),
    assertClean(label = "the page") {
      assert.deepEqual(this.problems(), [], `${label} logged errors`);
    },
    /** Page coordinates of a board intersection, scrolled into view. */
    async boardPoint(x, y) {
      return b.ev(`(() => {
        boardEl.scrollIntoView({ block: "center" });
        const r = boardEl.getBoundingClientRect(), p = scene.pointToNative(${x}, ${y});
        return { x: r.left + ((p.x + 0.5) * r.width) / scene.width, y: r.top + ((p.y + 0.5) * r.height) / scene.height };
      })()`);
    },
    async clickBoard(x, y, button = "left") {
      const p = await this.boardPoint(x, y);
      await b.click(p.x, p.y, button);
      return p;
    },
    /**
     * Clicks a board point and waits until `expect` (a page expression) holds.
     * On a timeout, says what the page did with the click: what was under the
     * pointer, what it sent, the notice, and whose turn it was.
     */
    async playAt(x, y, button, expect, label) {
      await b.ev(`(() => {
        if (!window.__sent) {
          window.__sent = [];
          const send = Colyseus.Room.prototype.send;
          Colyseus.Room.prototype.send = function (type, msg) { window.__sent.push([type, msg, Date.now()]); return send.call(this, type, msg); };
        }
        return true;
      })()`);
      const p = await this.clickBoard(x, y, button);
      try {
        await b.waitFor(expect, 5000, label);
      } catch (err) {
        const why = await b.ev(`({
          under: (() => { const el = document.elementFromPoint(${p.x}, ${p.y}); return el && (el.id || el.className || el.tagName); })(),
          hit: (() => { const r = boardEl.getBoundingClientRect(); return scene.nativeToPoint(((${p.x} - r.left) * scene.width) / r.width, ((${p.y} - r.top) * scene.height) / r.height); })(),
          sent: (window.__sent || []).slice(-3),
          notice: noticeEl.textContent, isMyTurn, selectedPowerup, viewId, dialogs: Array.from(document.querySelectorAll("dialog[open]")).map((d) => d.id),
          at: board[${y} * lastState.size + ${x}], lastEvent: lastState.lastEvent,
        })`);
        throw new Error(`${err.message}\n  clicked (${x}, ${y}) with ${button} at page ${JSON.stringify(p)}\n  page: ${JSON.stringify(why)}`);
      }
    },
    /** Page coordinates of a lobby-board point (column = bot kind, row = seat; startRow = Start). */
    async lobbyPoint(col, row) {
      return b.ev(`(() => {
        const I = window.GoLobbyIsland, c = document.getElementById("lobby-board");
        c.scrollIntoView({ block: "center" });
        const r = c.getBoundingClientRect(), p = I.point(${col}, ${row});
        return { x: r.left + (p.x * r.width) / I.W, y: r.top + (p.y * r.height) / I.H };
      })()`);
    },
    async clickLobby(col, row, button = "left") {
      const p = await this.lobbyPoint(col, row);
      await b.click(p.x, p.y, button);
      await wait(50);
    },
    /** Picks bots on the lobby board by column (BOT_OPTIONS order), one seat each, and plays Start. */
    async joinWithBots(cols) {
      cols.forEach((c, seat) => assert.ok(seat < 3 && c >= 0));
      for (let seat = 0; seat < cols.length; seat++) await this.clickLobby(cols[seat], seat);
      const start = await b.ev("window.GoLobbyIsland.startRow");
      await b.waitFor("joinButton.disabled === false", 15000, "Join to unlock");
      await this.clickLobby(0, start);
      await b.waitFor("!!room && !!lastState && !gameEl.hidden", 15000, "the game view");
    },
    async waitMyTurn(ms = 30000) {
      await b.waitFor("isMyTurn === true", ms, "my turn");
    },
    /** An empty point with all four neighbours empty too, as this player sees the board. */
    async freePoint(skip = 0) {
      return b.ev(`(() => {
        const n = lastState.size, at = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : board[y * n + x]);
        let found = ${skip};
        for (let y = 2; y < n - 2; y++) for (let x = 2; x < n - 2; x++) {
          if (at(x, y) || at(x + 1, y) || at(x - 1, y) || at(x, y + 1) || at(x, y - 1)) continue;
          if (overlays.some((o) => o.x === x && o.y === y)) continue;
          if (found-- === 0) return { x, y };
        }
        return null;
      })()`);
    },
    /** Every pixel of the board canvas, checked against the five palette colours. */
    async offPaletteBoardPixels() {
      return b.ev(`(() => {
        const ok = new Set(G.PALETTE_RGB.map(([r, g, b]) => r + "," + g + "," + b));
        const d = boardCtx.getImageData(0, 0, boardEl.width, boardEl.height).data;
        let bad = 0, colours = new Set();
        for (let i = 0; i < d.length; i += 4) {
          const k = d[i] + "," + d[i + 1] + "," + d[i + 2];
          colours.add(k);
          if (!ok.has(k) || d[i + 3] !== 255) bad++;
        }
        return { bad, colours: colours.size };
      })()`);
    },
  });
}
