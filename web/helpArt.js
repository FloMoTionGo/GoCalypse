// GoCalypse How to play: the pictures. Little boards, flipbooks and tab icons,
// composed from the game's own sprites (web/sprites.js) and kept in its 5-colour
// palette. Plain script: `window.HelpArt` in the browser, `module.exports` in
// Node, so tests/web/helpArt.test.mjs checks the same pixels.
//
// A picture is a sprite, or a flipbook: { sheet, w, h, frames, ms, still }, its
// frames side by side on one sheet. CSS steps through the sheet (.flip in
// style.css), a frame held longer simply appears on the sheet more than once;
// `still` is the frame to show a player who asks for reduced motion.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./sprites.js") : root.GoSprites);
  if (node) module.exports = api;
  else root.HelpArt = api;
})(typeof self !== "undefined" ? self : this, function (G) {
  "use strict";

  const { Surface, TRANSPARENT, SPRITES, ANIMS, FONT_SMALL, FONT_BIG } = G;
  const { K, C, A, T, S } = G.INDEX;

  // The game's 3x5 font is digits only; these letters finish it for the signs in the pictures.
  const LETTERS = { A: "010101111101101", E: "111100110100111", F: "111100110100100", G: "011100101101011", M: "101111111101101", O: "010101101101010", P: "110101110100100", R: "110101110101101", S: "011100010001110", V: "101101101101010" };
  const SIGN = { name: "help_sign", height: 5, spacing: 1, glyphs: { ...FONT_SMALL.glyphs } };
  for (const [ch, bits] of Object.entries(LETTERS)) SIGN.glyphs[ch] = { w: 3, h: 5, bits: Uint8Array.from(bits, Number) };

  // Board codes: the characters the little boards below are written in.
  const STONE = { b: 1, w: 2, g: 5, t: 7, e: G.GREY_STONE };

  function blank(w, h) {
    const s = new Surface(w, h);
    s.fill(TRANSPARENT);
    return s;
  }

  const done = (name, s) => G.makeSprite(name, s.w, s.h, s.px);

  /** A rounded block of colour with an ink rim: the kaya under a little board, or `fill` for water. */
  function plate(w, h, fill = A) {
    const s = blank(w, h);
    s.rect(1, 0, w - 2, h, K);
    s.rect(0, 1, w, h - 2, K);
    s.rect(1, 1, w - 2, h - 2, fill);
    return s;
  }

  function ring(s, cx, cy, r, c) {
    for (let y = -r - 1; y <= r + 1; y++)
      for (let x = -r - 1; x <= r + 1; x++)
        if (Math.abs(Math.hypot(x, y) - r) < 0.55) s.set(cx + x, cy + y, c);
  }

  function dot(s, x, y, c = C) {
    s.rect(x - 1, y - 1, 3, 3, c);
  }

  function text(s, font, str, x, y, c) {
    G.drawText(s, font, str, x, y, c);
  }

  function textCentred(s, font, str, cx, y, c) {
    text(s, font, str, cx - (G.textWidth(font, str) >> 1), y, c);
  }

  /** A "+" and digits in amber, for what a thing earns. */
  function plusNumber(s, n, x, y) {
    s.rect(x, y + 2, 5, 1, A);
    s.rect(x + 2, y, 1, 5, A);
    text(s, FONT_BIG, String(n), x + 7, y - 1, A);
  }

  /**
   * A piece of a board, written as rows of characters: b w g t e are stones
   * (e: the storm's grey), * a point of territory, . an empty point. Lines run
   * off the edge, so it reads as a part of something bigger.
   */
  function board(rows, o = {}) {
    const shape = o.shape || "small", step = o.step || 12, m = o.margin || 7;
    const cols = rows[0].length, n = rows.length;
    const s = plate(2 * m + (cols - 1) * step + 1, 2 * m + (n - 1) * step + 1);
    const at = (i) => m + i * step;
    for (let y = 0; y < n; y++) s.rect(1, at(y), s.w - 2, 1, K);
    for (let x = 0; x < cols; x++) s.rect(at(x), 1, 1, s.h - 2, K);
    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (STONE[ch]) s.blitCentered(G.stoneSprite(STONE[ch], shape), at(x), at(y));
        else if (ch === "*") dot(s, at(x), at(y));
      });
    });
    s.at = at;
    return s;
  }

  function book(name, frames, ms, still = 0) {
    const w = frames[0].w, h = frames[0].h, n = frames.length;
    const sheet = blank(w * n, h);
    frames.forEach((f, i) => sheet.blit(f, i * w, 0));
    return { sheet: done(`help_${name}`, sheet), w, h, frames: n, ms, still };
  }

  // ---- the three steps ---------------------------------------------------------------

  /** A white stone loses its last free point: the ring, the black stone, the flash, the empty point. */
  function capture() {
    const o = { shape: "normal", step: 16, margin: 9 };
    const before = [".b.", "bwb", "..."], placed = [".b.", "bwb", ".b."], gone = [".b.", "b.b", ".b."];
    const aim = board(before, o);
    ring(aim, aim.at(1), aim.at(2), 6, C);
    const wait = board(before, o);
    const full = board(placed, o);
    const flash = board(placed, o);
    flash.blitCentered(G.STONES.flash.normal, flash.at(1), flash.at(1));
    const burst = board(gone, o);
    for (const [dx, dy] of [[0, 0], [-5, -5], [5, -5], [-5, 5], [5, 5]]) burst.blitCentered(ANIMS.sparkle.frames[0], burst.at(1) + dx, burst.at(1) + dy);
    const empty = board(gone, o);
    return book("capture", [aim, wait, aim, wait, full, flash, burst, empty, empty, empty], 420, 4);
  }

  /** The four lanterns of the table, each passing in turn: a PASS sign under one more every step, then the end. */
  function passes() {
    const CW = 21, W = 4 * CW - 4, H = 34;
    const frame = (n, end) => {
      const s = blank(W, H);
      for (let i = 0; i < 4; i++) {
        const x = i * CW;
        s.blit(G.turnLantern(i + 1, !end && i === n), x + 1, 0);
        if (i < n) {
          const sign = plate(19, 9);
          sign.blit(G.textSprite(SIGN, "PASS", K), 2, 2);
          s.blit(sign, x, 18);
        }
      }
      if (end) textCentred(s, SIGN, "GAME OVER", W >> 1, H - 5, C);
      return s;
    };
    const last = frame(4, true);
    return book("passes", [frame(0), frame(1), frame(2), frame(3), frame(4), last, last, last], 620, 5);
  }

  function mouse(side) {
    const s = blank(11, 15);
    s.rect(1, 0, 9, 15, S);
    s.rect(0, 1, 11, 13, S);
    s.rect(1, 1, 9, 13, C);
    s.rect(side === "left" ? 1 : 6, 1, 4, 5, A);
    s.rect(5, 1, 1, 6, K);
    s.rect(1, 6, 9, 1, K);
    return done(`help_mouse_${side}`, s);
  }

  /** The strip behind the dialog's title: stars and a moon over the river, lanterns adrift. Empty on the left, where the words are. */
  function riverNight() {
    const W = 330, H = 38, RIVER = 31;
    const STARS = [[208, 5], [226, 11], [243, 4], [262, 9], [274, 16], [312, 7], [322, 16], [218, 18], [296, 19]];
    const MOON = G.sprite("help_moon", ["..CCC..", ".CCC...", "CCC....", "CCC....", "CCC....", ".CCC...", "..CCC.."]);
    const frame = (f) => {
      const s = blank(W, H);
      STARS.forEach(([x, y], i) => {
        if ((i + f) % 4 !== 0) s.set(x, y, i % 3 ? S : C);
      });
      s.blit(MOON, 284, 5);
      for (let y = RIVER; y < H; y++)
        for (let x = 0; x < W; x++) if (G.ditherOn(x, y, Math.min(1, (x - 150) / 70))) s.set(x, y, T);
      for (let i = 0; i < 7; i++) s.rect(214 + i * 16 + (f & 1) * 2, RIVER + 2 + (i % 3) * 2, 5, 1, S);
      const bob = (i) => ((f + i) % 4 < 2 ? 0 : 1);
      s.blit(ANIMS.reedsTall.frames[0], 316, H - 16);
      s.rect(242, 15 + bob(0), 1, 12, S); // the boat's mast
      s.blit(ANIMS.floatLantern.frames[0], 239, 12 + bob(0));
      s.blit(SPRITES.boatHull, 234, 27 + bob(0));
      for (const [i, x] of [204, 266, 298].entries()) s.blit(ANIMS.floatLantern.frames[0], x, 26 + bob(i + 1));
      [[218, 24], [258, 21], [288, 25]].forEach(([x, y], i) => s.set(x + ((f + i) % 2), y - (((f + i) >> 1) & 1), A));
      return s;
    };
    return book("river_night", [frame(0), frame(1), frame(2), frame(3)], 900, 0);
  }

  // ---- tab icons ---------------------------------------------------------------------

  const CLOUD_ROWS = [
    "....CCCCC......",
    "..CCCCCCCCC....",
    ".CCSSCCCCCCCC..",
    "CCCCCCCCCCCCCC.",
    ".SSSSSSSSSSSS..",
    "......AA.......",
    ".....AA........",
    "....AAAAA......",
    "......AA.......",
    ".....AA........",
    "....A..........",
  ];
  const cloud = () => G.sprite("help_cloud", CLOUD_ROWS);

  function tabFronts() {
    const s = plate(15, 15);
    s.blitCentered(G.splitPreviewSprite(1, "small"), 7, 7);
    return done("help_tab_fronts", s);
  }

  function tabScoring() {
    const s = plate(15, 15);
    s.rect(3, 3, 1, 9, K);
    s.rect(3, 11, 9, 1, K);
    for (const [x, y] of [[7, 4], [11, 4], [7, 8], [11, 8]]) s.rect(x - 1, y - 1, 3, 3, C);
    return done("help_tab_scoring", s);
  }

  function tabKata() {
    const s = plate(15, 15);
    for (const p of [5, 9]) {
      s.rect(p, 1, 1, 13, K);
      s.rect(1, p, 13, 1, K);
    }
    for (const [x, y, c] of [[3, 3, K], [11, 7, K], [7, 11, S], [3, 11, K]]) s.rect(x - 1, y - 1, 3, 3, c);
    return done("help_tab_kata", s);
  }

  // ---- two fronts --------------------------------------------------------------------

  function frontsVs() {
    const s = plate(43, 31);
    const row = (a, b, y) => {
      s.blitCentered(G.stoneSprite(STONE[a], "small"), 9, y);
      s.blitCentered(G.stoneSprite(STONE[b], "small"), 33, y);
      textCentred(s, SIGN, "VS", 21, y - 2, K);
    };
    row("b", "w", 8);
    row("g", "t", 22);
    return done("help_fronts_vs", s);
  }

  function connects() {
    const s = board(["bbg"]);
    const y = s.at(0);
    s.rect(s.at(0) + 4, y - 1, 9, 3, C);
    s.rect(s.at(1) + 5, y - 1, 3, 1, K); // the cross between the colours that don't join
    s.rect(s.at(1) + 5, y + 1, 3, 1, K);
    s.set(s.at(1) + 6, y, K);
    return done("help_connects", s);
  }

  function allies() {
    const s = blank(43, 16);
    s.blit(G.turnLantern(1, true), 0, 0);
    s.blit(G.turnLantern(3, true), 26, 0);
    for (const x of [18, 21, 24]) s.rect(x, 7, 2, 2, A);
    return done("help_allies", s);
  }

  // ---- scoring -----------------------------------------------------------------------

  function passTally() {
    const s = blank(43, 15);
    const tick = (x) => {
      s.blit(plate(9, 11), x, 2);
      s.rect(x + 3, 7, 3, 1, K);
    };
    tick(0);
    tick(11);
    s.blit(plate(15, 15), 22, 0);
    s.blitCentered(G.stoneSprite(1, "small"), 29, 7);
    text(s, FONT_BIG, "0", 39, 4, A);
    return done("help_pass_tally", s);
  }

  function prisoners() {
    const s = blank(43, 24);
    const land = plate(31, 11);
    for (let i = 0; i < 4; i++) dot(land, 4 + i * 7 + 1, 5);
    s.blit(land, 0, 0);
    for (let i = 0; i < 4; i++) s.blit(SPRITES.capturedIcon, i * 8, 14, { color: C });
    s.blit(SPRITES.capturedIcon, 34, 14, { color: S });
    s.rect(33, 17, 9, 1, A);
    return done("help_prisoners", s);
  }

  function otherKill() {
    const s = blank(38, 15);
    s.blit(board(["bg"]), 0, 0);
    text(s, FONT_BIG, "0", 31, 4, A);
    return done("help_other_kill", s);
  }

  function lowerScore() {
    const s = blank(36, 34);
    const chip = (code, x) => {
      s.blit(plate(15, 15), x, 19);
      s.blitCentered(G.stoneSprite(code, "small"), x + 7, 26);
    };
    s.rect(3, 3, 9, 15, S);
    s.rect(24, 10, 9, 8, A);
    s.blitCentered(ANIMS.sparkle.frames[0], 28, 5);
    chip(1, 0);
    chip(5, 21);
    return done("help_lower_score", s);
  }

  function finishIt() {
    const s = board([".b.", "bw.", ".b."]);
    ring(s, s.at(2), s.at(1), 5, C);
    return done("help_finish_it", s);
  }

  // ---- market ------------------------------------------------------------------------

  function earn(name, spr, n, opts) {
    const s = blank(44, 15);
    s.blit(plate(15, 15), 0, 0);
    s.blitCentered(spr, 7, 7, opts);
    plusNumber(s, n, 19, 5);
    return done(`help_earn_${name}`, s);
  }

  function stall() {
    const s = blank(30, 24);
    for (let y = 0; y < 6; y++) for (let x = 0; x < 30; x++) s.set(x, y, (x >> 3) & 1 ? C : A);
    for (let x = 0; x < 30; x++) if (x % 8 < 6) s.set(x, 6, (x >> 3) & 1 ? C : A);
    s.rect(2, 7, 2, 13, S);
    s.rect(26, 7, 2, 13, S);
    s.blit(SPRITES.jarIcon, 7, 9);
    s.blit(plate(30, 5), 0, 19);
    return done("help_stall", s);
  }

  function tiers() {
    const s = blank(40, 13);
    [1, 2, 3].forEach((t, i) => s.blit(G.miniCard(t, "left"), i * 10, 0));
    s.blit(SPRITES.baitFish, 32, 4);
    return done("help_tiers", s);
  }

  function stock() {
    const s = blank(29, 13);
    ["left", "left", "gone"].forEach((state, i) => s.blit(G.miniCard(1, state), i * 10, 0));
    return done("help_stock", s);
  }

  function hand() {
    const s = blank(41, 13);
    for (let i = 0; i < 5; i++) s.blit(G.miniCard(1 + (i % 3), "left"), i * 8, 0);
    return done("help_hand", s);
  }

  const ARROW = () => G.sprite("help_arrow", ["...C...", "....C..", "CCCCCC.", "....C..", "...C..."]);

  function useItem() {
    const s = blank(44, 17);
    s.blit(G.powerupIcon("lantern_ward"), 0, 1);
    s.blit(ARROW(), 16, 6);
    const b = board(["."], { margin: 8 });
    ring(b, b.at(0), b.at(0), 5, C);
    s.blit(b, 27, 0);
    return done("help_use_item", s);
  }

  // ---- kata --------------------------------------------------------------------------

  function kataEmpty() {
    const s = plate(27, 27);
    s.blitCentered(G.cardGridSmall([0, 0, 0, 0, 0, 0, 0, 0, 0], 1), 13, 13);
    return done("help_kata_empty", s);
  }

  function kataPrices() {
    const s = blank(44, 35);
    [["FREE", 0], ["100", 12], ["125", 24]].forEach(([price, y], i) => {
      s.blit(plate(11, 11), 0, y);
      s.blitCentered(G.stoneSprite(1, "mini"), 5, y + 5);
      if (i) s.blit(SPRITES.fireflyIcon, 14, y + 2);
      text(s, SIGN, price, i ? 23 : 14, y + 3, C);
    });
    return done("help_kata_prices", s);
  }

  function kataClicks() {
    const s = blank(28, 32);
    [["left", 1, 0], ["right", 5, 17]].forEach(([side, code, y]) => {
      s.blit(mouse(side), 0, y);
      s.blit(plate(15, 15), 13, y);
      s.blitCentered(G.stoneSprite(code, "small"), 20, y + 7);
    });
    return done("help_kata_clicks", s);
  }

  function kataPlay() {
    const s = board(["b.g", ".b.", "g.b"]);
    ring(s, s.at(1), s.at(1), 6, C);
    return done("help_kata_play", s);
  }

  // ---- reading the board -------------------------------------------------------------

  function timers() {
    const s = plate(44, 17);
    s.blit(SPRITES.lilyBoard, 2, 2);
    text(s, FONT_SMALL, "2", 18, 10, K);
    s.blit(SPRITES.driftwood, 23, 5);
    s.rect(37, 9, 5, 7, K); // the last round: an amber number
    text(s, FONT_SMALL, "1", 38, 10, A);
    return done("help_timers", s);
  }

  function owners() {
    const s = plate(31, 16);
    s.blit(SPRITES.wardLanternBig, 3, 2);
    s.blit(G.stoneSprite(1, "mini"), 14, 4);
    s.blit(G.stoneSprite(5, "mini"), 22, 4);
    return done("help_owners", s);
  }

  function growth() {
    const s = plate(41, 15);
    const y = 13;
    [SPRITES.seedBoard, SPRITES.sproutBoard, SPRITES.saplingBoard].forEach((spr, i) => s.blit(spr, 3 + i * 12, y - spr.h));
    return done("help_growth", s);
  }

  function boat() {
    const s = plate(35, 21, T);
    s.blit(SPRITES.boatHull, 9, 14);
    s.rect(17, 6, 1, 8, K);
    const sign = plate(13, 9);
    sign.blit(G.textSprite(SIGN, "R3", K), 3, 2);
    s.blit(sign, 11, 1);
    return done("help_boat", s);
  }

  // ---- storms ------------------------------------------------------------------------

  function d20() {
    const s = blank(15, 15);
    for (let y = 0; y < 15; y++) {
      const hw = y < 4 ? 3 + y : y > 10 ? 3 + (14 - y) : 7;
      s.rect(7 - hw, y, 2 * hw + 1, 1, y === 0 || y === 14 ? C : A);
      s.set(7 - hw, y, C);
      s.set(7 + hw, y, C);
    }
    textCentred(s, FONT_SMALL, "20", 7, 5, K);
    return done("help_d20", s);
  }

  function bolt() {
    const s = blank(29, 28);
    s.blit(board(["."], { margin: 8 }), 6, 11);
    s.blitCentered(G.stoneSprite(2, "small"), 14, 19);
    s.blit(cloud(), 7, 0);
    return done("help_bolt", s);
  }

  function fire() {
    const s = plate(29, 19);
    s.blit(ANIMS.flame.frames[0], 5, 4);
    text(s, FONT_SMALL, "3", 20, 7, K);
    return done("help_fire", s);
  }

  function greyStones() {
    return done("help_grey", board(["eee"]));
  }

  function dial() {
    return G.stormDial(6, 3, 0);
  }

  // ---- the river ---------------------------------------------------------------------

  function water(w, h) {
    const s = plate(w, h, T);
    for (let i = 0; i < 4; i++) s.rect(3 + i * 9, 2 + (i % 2) * (h - 5), 4, 1, S);
    return s;
  }

  function d6() {
    const s = blank(13, 13);
    s.rect(1, 0, 11, 13, K);
    s.rect(0, 1, 13, 11, K);
    s.rect(1, 1, 11, 11, C);
    for (const [x, y] of [[3, 3], [8, 3], [5, 5], [3, 8], [8, 8]]) s.rect(x, y, 2, 2, K);
    return done("help_d6", s);
  }

  function crabSpirit() {
    const s = water(31, 17);
    s.blit(ANIMS.crabIdle.frames[0], 3, 7);
    s.blit(ANIMS.spiritIdle.frames[0], 17, 3);
    return done("help_crab_spirit", s);
  }

  function reach() {
    const s = blank(39, 28);
    const b = board(["bwb"]);
    for (let i = 0; i < 3; i++) ring(b, b.at(i), b.at(0), 6, C);
    const w = water(39, 14);
    w.blit(ANIMS.crabIdle.frames[0], 14, 5);
    text(w, FONT_SMALL, "3", 28, 5, C);
    s.blit(w, 0, 14);
    s.blit(b, 0, 0);
    return done("help_reach", s);
  }

  function takes() {
    const s = water(44, 31);
    const stone = (x, y) => s.blitCentered(G.stoneSprite(2, "small"), x, y);
    s.blit(ANIMS.crabIdle.frames[0], 3, 4);
    stone(21, 8);
    s.blit(ANIMS.spiritIdle.frames[0], 3, 16);
    for (let i = 0; i < 3; i++) stone(21 + i * 9, 22);
    return done("help_takes", s);
  }

  function safe() {
    const s = blank(44, 15);
    ["lantern_ward", "fog", "mist"].forEach((id, i) => s.blit(G.powerupIcon(id), i * 14, 0));
    return done("help_safe", s);
  }

  function bait() {
    const s = water(43, 15);
    s.blit(SPRITES.baitFish, 4, 5);
    s.blit(ARROW(), 14, 5, { color: C });
    s.blit(ANIMS.crabWalk.frames[0], 26, 4);
    return done("help_bait", s);
  }

  function baitAway() {
    const s = water(43, 15);
    s.blitCentered(G.stoneSprite(2, "small"), 9, 7);
    s.blit(ANIMS.crabWalk.frames[0], 17, 4);
    s.blit(ARROW(), 32, 5);
    return done("help_bait_away", s);
  }

  // ---- haiku -------------------------------------------------------------------------

  function haikuPoint(withStone) {
    const s = plate(23, 23);
    s.rect(11, 1, 1, 21, K);
    s.rect(1, 11, 21, 1, K);
    s.blitCentered(G.haikuGlyph("moon", 11, K, 3, null), 11, 11);
    if (withStone) s.blitCentered(G.stoneSprite(1, "small"), 11, 11);
    return s;
  }

  function haikuClaim() {
    const s = haikuPoint(true);
    for (const [x, y] of [[4, 4], [18, 5], [5, 18]]) s.blitCentered(ANIMS.sparkle.frames[0], x, y);
    return done("help_haiku_claim", s);
  }

  function haikuLevels() {
    const s = blank(39, 11);
    [1, 2, 3].forEach((lv, i) => s.blit(G.haikuGlyph("moon", 11, A, lv, S), i * 14, 0));
    return done("help_haiku_levels", s);
  }

  function haikuCardMini() {
    const s = plate(23, 31);
    s.blitCentered(G.haikuGlyph("moon", 11, K, 3, null), 11, 12);
    for (let i = 0; i < 3; i++) s.rect(6 + i * 5, 25, 2, 2, K);
    return done("help_haiku_card", s);
  }

  // ---- by name: data-art in index.html, helpPicture() in main.js -----------------------

  const PICTURES = {
    capture,
    passes,
    riverNight,
    mouseLeft: () => mouse("left"),
    mouseRight: () => mouse("right"),

    tabFronts,
    tabScoring,
    tabMarket: () => SPRITES.jarIcon,
    tabKata,
    tabItems: () => G.powerupIcon("kite"),
    tabBoard: () => SPRITES.lilyBoard,
    tabStorms: cloud,
    tabRiver: () => ANIMS.crabIdle.frames[0],
    tabHaiku: () => G.haikuGlyph("moon", 11, A, 3, null),

    frontsVs,
    anyCaptures: () => done("help_any_captures", board([".g.", "twb", ".b."])),
    connects,
    allies,

    passTally,
    territory: () => done("help_territory", board(["**b", "**b", "bb."])),
    prisoners,
    otherKill,
    lowerScore,
    finishIt,

    earnStone: () => earn("stone", G.stoneSprite(1, "small"), 3),
    earnCapture: () => earn("capture", SPRITES.capturedIcon, 5),
    earnBack: () => earn("back", G.stoneSprite(1, "small"), 3, { coverage: 0.5 }),
    stall,
    tiers,
    stock,
    hand,
    useItem,

    kataEmpty,
    kataPrices,
    kataClicks,
    kataPlay,

    timers,
    owners,
    growth,
    boat,

    d20,
    bolt,
    fire,
    greyStones,
    dial,

    d6,
    crabSpirit,
    reach,
    takes,
    safe,
    bait,
    baitAway,

    haikuFind: () => done("help_haiku_find", haikuPoint(false)),
    haikuClaim,
    haikuLevels,
    haikuCard: haikuCardMini,
    jar: () => SPRITES.jarIcon,
  };

  return { PICTURES };
});
