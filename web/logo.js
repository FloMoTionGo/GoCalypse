// GoCalypse logo for the lobby: the name cut out of a Go board and set in the
// lantern river, drawn with the game's own palette and sprites (sprites.js).
// Every letter is a little kaya board whose grid runs along the stroke, with a
// hoshi where lines meet; the "o" of "Go" is a black stone. The river runs
// round the letters with the game's streaks, foam, floating lanterns, garland,
// reeds and stone lantern. Below the word the river widens round the bot
// board's island (lobbyBoard.js, a canvas of its own laid over the river at
// twice this scene's pixel size), with surf all along its shore.
//
// Sized to 75% of the window width at a whole number of device pixels per
// native pixel, so it stays as crisp as the board. Animates at the scene's
// ambient 10 fps while the lobby is on screen; one still frame with reduced motion.
(function () {
  "use strict";
  const G = window.GoSprites;
  const canvas = document.getElementById("logo");
  const lobby = document.getElementById("lobby");
  const githubLink = document.getElementById("github-link");
  if (!G || !canvas) return;
  const { K, C, A, T, S } = G.INDEX;
  const ANIMS = G.ANIMS;

  // ---------------------------------------------------------------------------
  // Lettering: glyphs drawn on the board grid. '#' is an intersection; next-door
  // intersections are joined by a grid line, diagonal ones too when nothing
  // else joins them. Rows 0-6 are cap height, 2-6 x-height, 7-8 descenders.
  // ---------------------------------------------------------------------------
  const P = 9; // native px between grid lines, and the stroke width
  const R = 4.5; // stroke half-width
  const GLYPHS = {
    G: [".###.", "#...#", "#....", "#.###", "#...#", "#...#", ".###."],
    C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
    a: ["", "", ".###.", "....#", ".####", "#...#", ".####"],
    l: ["##.", ".#.", ".#.", ".#.", ".#.", ".#.", "..#"],
    y: ["", "", "#...#", "#...#", "#...#", "#...#", ".####", "....#", "####."],
    p: ["", "", "####.", "#...#", "#...#", "#...#", "####.", "#....", "#...."],
    s: ["", "", ".####", "#....", ".###.", "....#", "####."],
    e: ["", "", ".###.", "#...#", "#####", "#....", ".####"],
  };
  const WORD = ["G", "stone", "C", "a", "l", "y", "p", "s", "e"];
  const STONE_CELLS = 5; // the "o": a black stone as wide as a lowercase letter
  // Small stones on the lettering, one of each other look: the four stones of the game.
  const PLACED = [
    { letter: 0, col: 4, row: 1, look: "white" },
    { letter: 4, col: 0, row: 0, look: "gray" },
    { letter: 8, col: 4, row: 6, look: "transparent" },
  ];

  // Word on the grid: nodes in global cell coordinates.
  const nodes = new Map(); // "cx,cy" -> {cx, cy, letter, col, row}
  let stoneCell = null;
  let cols = 0;
  WORD.forEach((ch, li) => {
    if (li) cols += 1; // one cell of river between letters
    if (ch === "stone") {
      stoneCell = { cx: cols + (STONE_CELLS - 1) / 2, cy: 4 };
      cols += STONE_CELLS;
      return;
    }
    const rows = GLYPHS[ch];
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    rows.forEach((r, row) => {
      for (let col = 0; col < r.length; col++) {
        if (r[col] === "#") nodes.set(`${cols + col},${row}`, { cx: cols + col, cy: row, letter: li, col, row });
      }
    });
    cols += w;
  });
  const has = (cx, cy) => nodes.has(`${cx},${cy}`);
  const edges = [];
  for (const n of nodes.values()) {
    const { cx, cy } = n;
    if (has(cx + 1, cy)) edges.push([cx, cy, cx + 1, cy]);
    if (has(cx, cy + 1)) edges.push([cx, cy, cx, cy + 1]);
    for (const dx of [-1, 1]) {
      if (has(cx + dx, cy + 1) && !has(cx + dx, cy) && !has(cx, cy + 1)) edges.push([cx, cy, cx + dx, cy + 1]);
    }
  }
  const degree = (cx, cy) =>
    edges.reduce((d, e) => d + ((e[0] === cx && e[1] === cy) || (e[2] === cx && e[3] === cy) ? 1 : 0), 0);

  // ---------------------------------------------------------------------------
  // Scene layout (native px)
  // ---------------------------------------------------------------------------
  const WORD_W = cols * P;
  const MARGIN = 40; // room for the stone lantern and reeds beside the word
  const MIN_W = WORD_W + 2 * MARGIN;
  const TOP_BANK = 11; // far bank with the garland
  const ROW0_Y = 23; // centre of the top grid row
  const FACE = 3; // visible front face under the lettering
  const NEAR_BANK = 4;
  const FADE = 20; // dithered fade into the page at each end
  // The bot board's island (lobbyBoard.js) lies in the river under the word, at
  // twice this scene's pixel size; the river widens to take it.
  const ISLE = window.GoLobbyIsland;
  const ISLE_PX = 2; // scene px per island px
  const ISLAND_TOP = 103; // just under the descenders
  const SIGN_Y = 87; // top of the GitHub signboard, at the end of the word
  const H = ISLE ? ISLAND_TOP + ISLE.H * ISLE_PX + 24 : 124;
  const LANE_Y = H - 13; // floating lanterns' lane, the last stretch of river

  function hash2(x, y, seed) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const frac = (v) => v - Math.floor(v);

  /** A stone of any size in one of the game's looks (same zones as sprites.js). */
  function bigStone(size, lookName) {
    const look = G.STONE_LOOKS[lookName];
    const cx = (size - 1) / 2, cy = cx, r = size / 2;
    const inside = (x, y) => x >= 0 && y >= 0 && x < size && y < size && ((x - cx) / r) ** 2 + ((y - cy) / r) ** 2 <= 1.02;
    const px = new Uint8Array(size * size).fill(G.TRANSPARENT);
    const glossR = Math.max(0.6, (size * 0.09) ** 2);
    const paint = (v, x, y) => (v ? "KCATS".indexOf(v[(x + y) % v.length]) : G.TRANSPARENT);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!inside(x, y)) continue;
        let z;
        if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) z = "o";
        else {
          const dx = (x - cx) / r, dy = (y - cy) / r;
          const lt = -(dx + dy) / Math.SQRT2, d = Math.hypot(dx, dy);
          const gx = x - (cx - r * 0.38), gy = y - (cy - r * 0.45);
          if (gx * gx + gy * gy <= glossR) z = "g";
          else if (lt > 0.3 && d > 0.6) z = "h";
          else if (lt < -0.35 && d > 0.6) z = "s";
          else if (lt < -0.15 && d > 0.72) z = "x";
          else z = "m";
        }
        px[y * size + x] = paint(look[z], x, y);
      }
    }
    return G.makeSprite(`logoStone_${lookName}_${size}`, size, size, px);
  }
  const O_STONE = bigStone(STONE_CELLS * P, "black");

  // The GitHub mark as a pixel sign: a disc with the octocat cut out of it.
  // '#' is the disc (slate, amber while the link is hovered), 'K' the cat.
  const GITHUB_MARK = [
    ".....#####.....",
    "...#########...",
    "..##K#####K##..",
    ".###KK###KK###.",
    ".##KKKKKKKKK##.",
    "##KKKKKKKKKKK##",
    "##KKKKKKKKKKK##",
    "##KKKKKKKKKKK##",
    "###KKKKKKKKK###",
    "#K###KKKKK#####",
    ".#K##KKKKK####.",
    ".##KKKKKKK####.",
    "..####KKK####..",
    "...###KKK###...",
    ".....#KKK#.....",
  ];
  const markSprite = (disc) => G.sprite("githubMark", GITHUB_MARK.map((row) => row.replace(/#/g, disc)));
  const MARK = { S: markSprite("S"), A: markSprite("A") };
  const SIGN = 21; // the signboard, frame included

  // ---------------------------------------------------------------------------
  // Scene for one canvas width
  // ---------------------------------------------------------------------------
  const R_BANK = 0, R_WATER = 1, R_LETTER = 2, R_FACE = 3, R_STONE = 4, R_ISLAND = 5;

  function buildScene(W) {
    const s = new G.Surface(W, H);
    const region = new Uint8Array(W * H).fill(R_WATER);
    const wordX = Math.floor((W - WORD_W) / 2) + 3; // centre of grid column 0
    const nx = (cx) => wordX + cx * P, ny = (cy) => ROW0_Y + cy * P;
    const idx = (x, y) => y * W + x;
    const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

    // Banks, far and near, with wavy lips.
    const topLip = (x) => TOP_BANK + Math.round(Math.sin(x * 0.11) * 1.2 + Math.sin(x * 0.27 + 2) * 0.6);
    const nearLip = (x) => H - NEAR_BANK + Math.round(Math.sin(x * 0.09 + 1) * 1.2 + Math.sin(x * 0.23) * 0.6);
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < topLip(x); y++) region[idx(x, y)] = R_BANK;
      for (let y = nearLip(x); y < H; y++) region[idx(x, y)] = R_BANK;
    }

    // The island, where lobbyBoard.js's canvas covers the river.
    const islandX = ISLE ? Math.floor((W - ISLE.W * ISLE_PX) / 2) : 0;
    if (ISLE) {
      for (let y = 0; y < ISLE.H * ISLE_PX; y++) {
        for (let x = 0; x < ISLE.W * ISLE_PX; x++) {
          if (ISLE.solid[((y / ISLE_PX) | 0) * ISLE.W + ((x / ISLE_PX) | 0)] && inside(islandX + x, ISLAND_TOP + y)) region[idx(islandX + x, ISLAND_TOP + y)] = R_ISLAND;
        }
      }
    }

    // Lettering: every pixel within a stroke's half-width of a grid line or intersection.
    const segs = edges.map((e) => [nx(e[0]), ny(e[1]), nx(e[2]), ny(e[3])]);
    for (const n of nodes.values()) segs.push([nx(n.cx), ny(n.cy), nx(n.cx), ny(n.cy)]);
    for (const [x0, y0, x1, y1] of segs) {
      const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
      for (let y = Math.min(y0, y1) - 5; y <= Math.max(y0, y1) + 5; y++) {
        for (let x = Math.min(x0, x1) - 5; x <= Math.max(x0, x1) + 5; x++) {
          if (!inside(x, y)) continue;
          const u = len2 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2)) : 0;
          if (Math.hypot(x - (x0 + u * dx), y - (y0 + u * dy)) <= R) region[idx(x, y)] = R_LETTER;
        }
      }
    }
    // Front face under each letter, like the deck's.
    const faceDepth = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (region[idx(x, y)] !== R_WATER) continue;
        for (let d = 1; d <= FACE; d++) {
          if (y - d >= 0 && region[idx(x, y - d)] === R_LETTER) { faceDepth[idx(x, y)] = d; break; }
        }
      }
    }
    for (let i = 0; i < W * H; i++) if (faceDepth[i]) region[i] = R_FACE;

    // The "o": a black stone on the water.
    const stoneX = Math.round(wordX + stoneCell.cx * P), stoneY = ny(stoneCell.cy);
    const sr = O_STONE.w / 2, sb = Math.ceil(sr); // radius, and whole-pixel bounds
    for (let y = stoneY - sb; y <= stoneY + sb; y++) {
      for (let x = stoneX - sb; x <= stoneX + sb; x++) {
        if (inside(x, y) && Math.hypot(x - stoneX, y - stoneY) <= sr) region[idx(x, y)] = R_STONE;
      }
    }

    // Bank: ink with a teal lawn dither along the water, as on the game's banks.
    const isWater = (x, y) => inside(x, y) && region[idx(x, y)] === R_WATER;
    function toWater(x, y, max) {
      for (let d = 1; d <= max; d++) {
        for (let k = -d; k <= d; k++) {
          if (isWater(x + k, y - d) || isWater(x + k, y + d) || isWater(x - d, y + k) || isWater(x + d, y + k)) return d;
        }
      }
      return max + 1;
    }
    // Water: teal, darker in the lettering's shadow and along each bank.
    const solid = (x, y) => inside(x, y) && region[idx(x, y)] >= R_LETTER;
    function toSolid(x, y, max) {
      for (let d = 1; d <= max; d++) {
        for (let k = -d; k <= d; k++) {
          if (solid(x + k, y - d) || solid(x + k, y + d) || solid(x - d, y + k) || solid(x + d, y + k)) return d;
        }
      }
      return max + 1;
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = region[idx(x, y)];
        let c;
        if (r === R_BANK) {
          const d = toWater(x, y, 4);
          c = K;
          if (d <= 2 && G.ditherOn(x, y, 0.25)) c = T;
          else if (d <= 4 && G.ditherOn(x, y, 0.125)) c = T;
        } else if (r === R_WATER) {
          c = T;
          const d = toSolid(x, y, 3);
          if (d <= 3 && G.ditherOn(x, y, d <= 1 ? 0.5 : d === 2 ? 0.25 : 0.125)) c = K;
          if (inside(x, y + 1) && region[idx(x, y + 1)] === R_BANK && G.ditherOn(x, y, 0.5)) c = K;
          else if (inside(x, y + 2) && region[idx(x, y + 2)] === R_BANK && G.ditherOn(x, y, 0.125)) c = K;
        } else if (r === R_FACE) {
          // shadowed planks, the bottom edge catching the light
          c = faceDepth[idx(x, y)] === FACE ? S : K;
        } else if (r === R_LETTER) {
          // kaya, with an ink lip wherever it meets something else
          const edge = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => {
            const q = inside(x + dx, y + dy) ? region[idx(x + dx, y + dy)] : R_WATER;
            return q !== R_LETTER && q !== R_FACE;
          });
          c = edge ? K : A;
        } else c = T; // under the stone, painted below
        s.px[idx(x, y)] = c;
      }
    }
    // Ink lip where the face meets the water on its sides.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (region[idx(x, y)] !== R_FACE) continue;
        if (!solid(x - 1, y) || !solid(x + 1, y)) s.px[idx(x, y)] = K;
      }
    }

    // Grid lines along the strokes, hoshi where three or more lines meet.
    function line(x0, y0, x1, y1) {
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        s.set(x0, y0, K);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    }
    for (const e of edges) line(nx(e[0]), ny(e[1]), nx(e[2]), ny(e[3]));
    for (const n of nodes.values()) {
      if (degree(n.cx, n.cy) >= 3) s.blitCentered(G.SPRITES.hoshi, nx(n.cx), ny(n.cy));
    }
    // Stones: the black "o" with its shadow on the water, and the three small ones.
    for (let y = stoneY - sb; y <= stoneY + sb + 3; y++) {
      for (let x = stoneX - sb; x <= stoneX + sb + 3; x++) {
        if (isWater(x, y) && Math.hypot(x - stoneX - 2, y - stoneY - 2) <= sr + 0.5 && G.ditherOn(x, y, 0.5)) s.px[idx(x, y)] = K;
      }
    }
    for (let y = stoneY - sb; y <= stoneY + sb; y++) {
      for (let x = stoneX - sb; x <= stoneX + sb; x++) {
        if (inside(x, y) && region[idx(x, y)] === R_STONE) s.px[idx(x, y)] = T;
      }
    }
    s.blitCentered(O_STONE, stoneX, stoneY);
    for (const st of PLACED) {
      const n = [...nodes.values()].find((q) => q.letter === st.letter && q.col === st.col && q.row === st.row);
      if (n) s.blitCentered(G.STONES[st.look].icon, nx(n.cx), ny(n.cy));
    }

    // Bank dressing.
    const rb = rng(4321);
    const topLipAt = (x) => { let y = 0; while (y < H && !isWater(x, y)) y++; return y - 1; };
    const nearLipAt = (x) => { let y = H - 1; while (y > 0 && !isWater(x, y)) y--; return y + 1; };
    for (let x = 2 + Math.floor(rb() * 6); x < W - 8; x += 9 + Math.floor(rb() * 11)) {
      s.blit(rb() < 0.55 ? G.SPRITES.grassTuft : G.SPRITES.grassTuftSmall, x, topLipAt(x) - 1);
    }
    for (let x = 30 + Math.floor(rb() * 20); x < W - 10; x += 60 + Math.floor(rb() * 40)) {
      s.blit(G.SPRITES.flower, x, Math.max(0, topLipAt(x) - 4));
      s.blit(G.SPRITES.pebble, x + 22, topLipAt(x + 22) - 1);
    }
    for (let x = 0; x < W; x++) {
      const y = nearLipAt(x);
      if (y < H && hash2(x, 0, 11) < 0.45) s.px[idx(x, y)] = T;
    }
    for (let x = 12 + Math.floor(rb() * 8); x < W - 6; x += 18 + Math.floor(rb() * 20)) {
      s.blit(G.SPRITES.grassTuft, x, nearLipAt(x) - 1);
    }

    // Light never touches the lettering or the stone, as on the board.
    const noLight = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) noLight[i] = region[i] >= R_LETTER ? 1 : 0;

    // Foam: water right under a letter's face or beside a stroke.
    const foam = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!isWater(x, y)) continue;
        if (inside(x, y - 1) && region[idx(x, y - 1)] === R_FACE) foam.push({ x, y, k: 0 });
        else if ([[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dx, dy]) => inside(x + dx, y + dy) && region[idx(x + dx, y + dy)] === R_ISLAND)) foam.push({ x, y, k: 2 });
        else if (solid(x - 1, y) || solid(x + 1, y)) foam.push({ x, y, k: 1 });
      }
    }

    // --- ambient actors -------------------------------------------------------
    const r = rng(99);
    const firstX = nx(0) - 3, lastX = nx(cols - 1) + 3;
    const streaks = [];
    for (let i = 0; i < Math.round((W * H) / (7 * 124)); i++) {
      streaks.push({
        y: TOP_BANK + 2 + Math.floor(r() * (H - NEAR_BANK - TOP_BANK - 4)),
        along: r(), speed: 6 * (0.7 + r() * 0.6), period: 1.1 + r() * 1.8, phase: r(), len: 2 + Math.floor(r() * 4),
      });
    }
    const twinkles = [];
    for (let i = 0; i < Math.round((W * H) / (30 * 124)); i++) {
      twinkles.push({ x: 2 + Math.floor(r() * (W - 4)), y: TOP_BANK + 2 + Math.floor(r() * (H - TOP_BANK - NEAR_BANK - 4)), period: 2.5 + r() * 3, phase: r() });
    }
    const floaters = [];
    for (let i = 0; i < Math.max(3, Math.round(W / 110)); i++) floaters.push({ offset: r(), lane: [0, 3, -2, 2, -1][i % 5], phase: r() * 6.28 });
    const garland = [];
    for (let x = 10; x < W - FADE - 18; x += 25) garland.push({ x, phase: r() * 6.28, cream: garland.length % 2 === 1 });
    const toro = { x: firstX - 21, y: H - 2 - 22 };
    // The GitHub signboard on its post, under the end of the word, the river running past it.
    const sign = { x: lastX - SIGN - 2, y: SIGN_Y };
    const reeds = [
      { anim: "reedsTall", x: firstX - 34, y: H - 17, phase: 0.8 },
      { anim: "reedsShort", x: lastX + 4, y: H - 17, phase: 1.9 },
      { anim: "reedsTall", x: lastX + 12, y: H - 18, phase: 2.7 },
      { anim: "reedsShort", x: Math.round(W * 0.12), y: H - 17, phase: 0.1 },
      { anim: "reedsShort", x: Math.round(W * 0.2), y: TOP_BANK - 15, phase: 2.3 },
      { anim: "reedsShort", x: Math.round(W * 0.7), y: TOP_BANK - 15, phase: 0.6 },
    ];
    const pads = [
      { spr: G.SPRITES.lilyPad, x: Math.round(W * 0.3), y: H - 13 },
      { spr: G.SPRITES.lilyPadSmall, x: Math.round(W * 0.3) + 17, y: H - 9 },
      { spr: G.SPRITES.lilyPadSmall, x: Math.round(W * 0.78), y: H - 12 },
      { spr: G.SPRITES.lilyPad, x: Math.max(FADE, islandX - 34), y: ISLAND_TOP + 60 },
      { spr: G.SPRITES.lilyPadSmall, x: Math.min(W - FADE - 8, islandX + (ISLE ? ISLE.W * ISLE_PX : 0) + 14), y: ISLAND_TOP + 140 },
      { spr: G.SPRITES.lilyPadSmall, x: lastX + 6, y: ROW0_Y + 8 },
    ];
    const lotus = { x: Math.round(W * 0.3) + 2, y: H - 16 };
    const fireflies = [];
    const addFly = (cx, cy, ax, ay) =>
      fireflies.push({ cx, cy, ax, ay, fx: 0.25 + r() * 0.35, fy: 0.3 + r() * 0.4, p1: r() * 6.28, p2: r() * 6.28, period: 3 + r() * 3, phase: r() });
    addFly(firstX - 14, 40, 8, 14); addFly(lastX + 14, 50, 8, 16);
    addFly(W * 0.25, 5, 26, 3); addFly(W * 0.6, 4, 30, 3);
    addFly(W * 0.45, LANE_Y - 2, 40, 4); addFly(W * 0.8, LANE_Y + 2, 30, 3);

    const surf = new G.Surface(W, H);
    const waterSet = (x, y, c) => { if (isWater(x, y)) surf.px[idx(x, y)] = c; };
    const animFrame = (name, t, phase) => {
      const a = ANIMS[name], n = a.frames.length;
      return a.frames[((Math.floor(t * a.fps + (phase || 0) * n) % n) + n) % n];
    };
    const LANTERN_SPEED = 6;
    const span = W + 24;

    function render(t) {
      surf.copyFrom(s);

      // 1. water life: streaks running left, pads, foam, glints
      for (const st of streaks) {
        const len = Math.round(st.len * Math.sin(Math.PI * frac(t / st.period + st.phase)));
        if (len <= 0) continue;
        const x = Math.floor(((((st.along * (W + 12) - st.speed * t) % (W + 12)) + W + 12) % (W + 12)) - 6);
        for (let k = 0; k < len; k++) waterSet(x + k, st.y, S);
      }
      for (const p of pads) surf.blit(p.spr, p.x, p.y);
      surf.blit(G.SPRITES.lotus, lotus.x, lotus.y);
      for (const f of foam) {
        const w = f.k === 0
          ? Math.sin(f.x * 0.42 + t * 2.4) + 0.7 * Math.sin(f.x * 0.15 - t * 1.1 + 1)
          : f.k === 2 // surf breaking all round the island's shore
            ? Math.sin((f.x + f.y) * 0.21 - t * 1.9) + 0.6 * Math.sin(f.x * 0.09 - f.y * 0.13 + t * 1.3)
            : Math.sin(f.y * 0.5 + f.x * 0.3 + t * 2.7) - 0.9;
        if (w > 0.1 || (w > -0.7 && (f.x + f.y + Math.floor(t * 4)) & 1 && f.k === 0)) waterSet(f.x, f.y, C);
      }
      for (const tw of twinkles) {
        const u = frac(t / tw.period + tw.phase);
        if (u < 0.06 || (u >= 0.16 && u < 0.22)) waterSet(tw.x, tw.y, C);
        else if (u < 0.16) {
          waterSet(tw.x, tw.y, C);
          waterSet(tw.x - 1, tw.y, S); waterSet(tw.x + 1, tw.y, S);
          waterSet(tw.x, tw.y - 1, S); waterSet(tw.x, tw.y + 1, S);
        }
      }

      // 2. lights
      const floats = floaters.map((fl) => ({
        x: Math.round(W + 12 - (((fl.offset * span + t * LANTERN_SPEED) % span))),
        y: LANE_Y + fl.lane + Math.round(Math.sin(t * 2.1 + fl.phase) * 0.9),
        fl,
      })).sort((a, b) => a.y - b.y);
      const toroFrame = Math.floor(t * ANIMS.toro.fps) % ANIMS.toro.frames.length;
      const flies = fireflies.map((ff) => {
        const u = frac(t / ff.period + ff.phase);
        const frame = u < 0.3 ? -1 : u < 0.55 ? 0 : u < 0.62 ? 1 : u < 0.8 ? 2 : u < 0.88 ? 1 : 3;
        return { x: Math.round(ff.cx + ff.ax * Math.sin(t * ff.fx + ff.p1)), y: Math.round(ff.cy + ff.ay * Math.sin(t * ff.fy + ff.p2)), frame };
      });
      const lights = [{ x: toro.x + 6, y: toro.y + 9, r: 17 + (toroFrame === 1 ? 2 : 0), s: 0.6 }];
      for (const f of floats) lights.push({ x: f.x, y: f.y - 2, r: 9, s: 0.55 });
      for (const g of garland) lights.push({ x: g.x, y: 5, r: 7, s: 0.45 });
      for (const f of flies) if (f.frame === 2) lights.push({ x: f.x, y: f.y, r: 3.5, s: 0.7 });
      for (const lt of lights) surf.ramp(G.LIGHT, lt.x, lt.y, lt.r, lt.s, 1, noLight);

      // 3. floating lanterns and their reflections
      for (const f of floats) {
        for (let k = 0; k < 7; k++) {
          const yy = f.y + 3 + k;
          const wob = Math.round(Math.sin(t * 5 + k * 1.4 + f.x) * (k > 1 ? 1 : 0));
          const cov = 0.8 - k * (0.8 / 7);
          if (G.ditherOn(f.x + wob, yy, cov)) waterSet(f.x + wob, yy, A);
          if (k < 5 && G.ditherOn(f.x + wob + 1, yy, cov * 0.6)) waterSet(f.x + wob + 1, yy, A);
          if (k < 5 && G.ditherOn(f.x + wob - 1, yy, cov * 0.6)) waterSet(f.x + wob - 1, yy, A);
        }
        surf.blitCentered(animFrame("floatLantern", t, f.fl.phase / 6.28), f.x, f.y);
      }

      // 4. props: reeds, stone lantern, garland, fireflies
      for (const rd of reeds) surf.blit(animFrame(rd.anim, t, rd.phase / 3), rd.x, rd.y);
      surf.blit(G.SPRITES.rock, toro.x - 1, H - 5);
      surf.blit(ANIMS.toro.frames[toroFrame], toro.x, toro.y);
      drawSign(sign);
      const ropeEnd = W - FADE - 6;
      for (let y = 0; y < TOP_BANK - 1; y++) { surf.set(ropeEnd, y, K); surf.set(ropeEnd + 1, y, S); surf.set(ropeEnd + 2, y, K); }
      surf.set(ropeEnd + 1, 0, C);
      const hooks = [-10].concat(garland.map((g) => g.x), [ropeEnd]);
      for (let h = 0; h < hooks.length - 1; h++) {
        const a = hooks[h], b = hooks[h + 1];
        for (let x = a; x <= b; x++) {
          const u = (x - a) / (b - a);
          surf.set(x, 1 + Math.round(2.6 * 4 * u * (1 - u)), S);
        }
      }
      for (const g of garland) {
        const sway = Math.round(Math.sin(t * 1.4 + g.phase) * 0.8);
        surf.blit(animFrame(g.cream ? "garlandCream" : "garlandAmber", t, g.phase / 6.28), g.x - 3 + sway, 1);
        surf.set(g.x, 1, K);
      }
      for (const f of flies) if (f.frame >= 0) surf.blitCentered(ANIMS.firefly.frames[f.frame], f.x, f.y);

      // 5. both ends fade into the page's ink
      for (let d = 0; d < FADE; d++) {
        const cov = 1 - (d + 0.5) / FADE;
        for (let y = 0; y < H; y++) {
          if (G.ditherOn(d, y, cov)) surf.px[idx(d, y)] = K;
          if (G.ditherOn(W - 1 - d, y, cov)) surf.px[idx(W - 1 - d, y)] = K;
        }
      }
      return surf;
    }
    /** The GitHub signboard: post down to the bank, lacquer frame, the mark; lit while its link is hovered. */
    function drawSign(g) {
      const postX = g.x + (SIGN >> 1) - 1;
      for (let y = g.y + SIGN; y < g.y + SIGN + 8; y++) { surf.set(postX, y, K); surf.set(postX + 1, y, S); surf.set(postX + 2, y, K); }
      if (signLit) surf.ramp(G.LIGHT, g.x + SIGN / 2, g.y + SIGN / 2, SIGN, 0.7, 1, noLight);
      surf.rect(g.x, g.y, SIGN, SIGN, K);
      for (let k = 1; k < SIGN - 1; k++) { surf.set(g.x + k, g.y + 1, S); surf.set(g.x + 1, g.y + k, S); }
      surf.blit(signLit ? MARK.A : MARK.S, g.x + 3, g.y + 3);
    }

    return { W, render, sign, islandX };
  }

  // ---------------------------------------------------------------------------
  // Canvas: 75% of the window, whole device pixels per native pixel
  // ---------------------------------------------------------------------------
  const ctx = canvas.getContext("2d");
  let scene = null, image = null;
  function fit() {
    // The page is zoomed (--ui-zoom in style.css): the window and the device pixels are
    // in window px, the canvas's style width in page px, each worth `zoom` window px.
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const dpr = window.devicePixelRatio || 1;
    // 75% of the window; on a narrow one the whole width (less the page gutters), as the bot board is in it.
    let target = Math.floor(window.innerWidth * 0.75 * dpr); // device px
    if (target < MIN_W) target = Math.floor((window.innerWidth - 32 * zoom) * dpr);
    const scale = Math.floor(target / MIN_W);
    const W = scale >= 1 ? Math.floor(target / scale) : MIN_W;
    // Too narrow for whole pixels: let the browser shrink it to the window instead.
    canvas.style.width = scale >= 1 ? `${(W * scale) / (dpr * zoom)}px` : `${window.innerWidth / zoom - 32}px`;
    if (scene && scene.W === W) return placeIsland();
    canvas.width = W;
    canvas.height = H;
    scene = buildScene(W);
    if (githubLink) {
      Object.assign(githubLink.style, {
        left: `${(scene.sign.x / W) * 100}%`,
        top: `${(scene.sign.y / H) * 100}%`,
        width: `${(SIGN / W) * 100}%`,
        height: `${(SIGN / H) * 100}%`,
      });
    }
    image = ctx.createImageData(W, H);
    draw(performance.now());
    placeIsland();
  }
  /** Lays the island's canvas over its outline in the river, at twice this scene's pixel size. */
  function placeIsland() {
    if (!ISLE || !scene) return;
    const zoom = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    const u = canvas.getBoundingClientRect().width / zoom / scene.W; // page px per scene px; exact px, as percentages round off
    Object.assign(ISLE.wrap.style, {
      left: `${scene.islandX * u}px`,
      top: `${ISLAND_TOP * u}px`,
      width: `${ISLE.W * ISLE_PX * u}px`,
    });
    ISLE.wrap.style.setProperty("--np", String(u * ISLE_PX));
  }
  let signLit = false;
  if (githubLink) {
    const lit = (on) => () => { signLit = on; if (scene) draw(performance.now()); };
    githubLink.addEventListener("pointerenter", lit(true));
    githubLink.addEventListener("pointerleave", lit(false));
    githubLink.addEventListener("focus", lit(true));
    githubLink.addEventListener("blur", lit(false));
  }
  function draw(now) {
    scene.render(reduced.matches ? 0 : now / 1000).toRGBA(image.data);
    ctx.putImageData(image, 0, 0);
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const FRAME_MS = 100; // the scene's ambient 10 fps
  let last = 0;
  function tick(now) {
    requestAnimationFrame(tick);
    if (reduced.matches || document.hidden || (lobby && lobby.hidden)) return;
    if (now - last < FRAME_MS) return;
    last = now;
    draw(now);
  }
  window.addEventListener("resize", fit);
  reduced.addEventListener("change", () => scene && draw(performance.now()));
  fit();
  requestAnimationFrame(tick);
})();
