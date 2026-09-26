// GoCalypse pixel sprites: palette, sprite data, pixel fonts, animation
// frames and a tiny software rasterizer. Plain script, no dependencies:
// attaches to `window.GoSprites` in the browser and `module.exports` in Node,
// so the exact same pixels can be rendered (and checked) outside a browser.
//
// Everything is drawn into a palette-index buffer (one byte per pixel) and
// only turned into RGBA at the very end, which keeps the whole scene inside
// the 5-colour palette below. In-between tones come from ordered dithering.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GoSprites = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // PALETTE -- the only colours in the scene. Swap hex values here to re-theme.
  // Keys are the characters used in sprite rows below.
  // ---------------------------------------------------------------------------
  const PALETTE = [
    { key: "K", name: "ink", hex: "#1f1a24" }, //  outlines, grid, black stones, night bank
    { key: "C", name: "cream", hex: "#f4e8c8" }, // white stones, highlights, lantern light, foam
    { key: "A", name: "amber", hex: "#d49040" }, // kaya board, lantern paper, warm glow
    { key: "T", name: "teal", hex: "#2e6b73" }, //  river, grass on the night bank
    { key: "S", name: "slate", hex: "#767d88" }, // gray stones, stone lantern, ripples
  ];

  const TRANSPARENT = 255;
  const KEY_TO_INDEX = {};
  PALETTE.forEach((c, i) => (KEY_TO_INDEX[c.key] = i));
  const K = KEY_TO_INDEX.K, C = KEY_TO_INDEX.C, A = KEY_TO_INDEX.A, T = KEY_TO_INDEX.T, S = KEY_TO_INDEX.S;

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const PALETTE_RGB = PALETTE.map((c) => hexToRgb(c.hex));

  /** 4x4 ordered-dither (Bayer) matrix, values 0..15. */
  const BAYER4 = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  /** True if a pixel at (x, y) should be "on" for a coverage in 0..1. */
  function ditherOn(x, y, coverage) {
    if (coverage >= 1) return true;
    if (coverage <= 0) return false;
    return (BAYER4[y & 3][x & 3] + 0.5) / 16 < coverage;
  }

  // Light / shade ramps (palette index -> palette index). Warm light turns the
  // night bank and river amber, amber cream; shade goes the other way.
  const LIGHT = new Uint8Array(256).map((_, i) => i);
  LIGHT[K] = A; LIGHT[T] = A; LIGHT[S] = C; LIGHT[A] = C;
  const SHADE = new Uint8Array(256).map((_, i) => i);
  SHADE[C] = S; SHADE[A] = K; SHADE[T] = K; SHADE[S] = K;

  // ---------------------------------------------------------------------------
  // Sprites. Rows are strings, one char per pixel:
  //   K C A T S  -> palette colour
  //   k c a t s  -> that colour on a 50% checkerboard, transparent otherwise
  //   . or space -> transparent
  // ---------------------------------------------------------------------------
  function makeSprite(name, w, h, px) {
    return { name, w, h, px };
  }

  function sprite(name, rows) {
    const h = rows.length;
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const px = new Uint8Array(w * h).fill(TRANSPARENT);
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === "." || ch === " ") continue;
        const upper = ch.toUpperCase();
        const idx = KEY_TO_INDEX[upper];
        if (idx === undefined) throw new Error(`sprite ${name}: bad char '${ch}'`);
        if (ch !== upper && ((x + y) & 1)) continue; // lowercase = checker
        px[y * w + x] = idx;
      }
    }
    return makeSprite(name, w, h, px);
  }

  function flipX(spr, name) {
    const px = new Uint8Array(spr.w * spr.h);
    for (let y = 0; y < spr.h; y++)
      for (let x = 0; x < spr.w; x++) px[y * spr.w + x] = spr.px[y * spr.w + (spr.w - 1 - x)];
    return makeSprite(name || spr.name + "_flip", spr.w, spr.h, px);
  }

  /** Recolour every opaque pixel of a sprite with one palette index. */
  function silhouette(spr, colorIndex, name) {
    const px = spr.px.map((v) => (v === TRANSPARENT ? TRANSPARENT : colorIndex));
    return makeSprite(name || spr.name + "_sil", spr.w, spr.h, px);
  }

  // ---------------------------------------------------------------------------
  // Stones. A zone template (hand-tuned for the 15x15 game stone, generated
  // for squash/stretch frames) is coloured per look:
  //   o outline, m main, h rim light, g gloss, s shade, x shade transition.
  // ---------------------------------------------------------------------------
  const STONE_TEMPLATE_15 = [
    ".....ooooo.....",
    "...oommmmmoo...",
    "..omhhhmmmmmo..",
    ".omhhghmmmmmmo.",
    ".ohhghmmmmmmmo.",
    "ohhhhmmmmmmmmmo",
    "ohhmmmmmmmmmmxo",
    "ohmmmmmmmmmmmxo",
    "ommmmmmmmmmmxso",
    "ommmmmmmmmmxsso",
    ".ommmmmmmmxsso.",
    ".ommmmmmmxssso.",
    "..ommmmxsssso..",
    "...ooxssssoo...",
    ".....ooooo.....",
  ];

  /** Procedural zone template for an ellipse of w x h (squash/stretch/shrink frames). */
  function stoneZones(w, h) {
    const cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2, ry = h / 2;
    const inside = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      return dx * dx + dy * dy <= 1.02;
    };
    const rows = [];
    for (let y = 0; y < h; y++) {
      let s = "";
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) { s += "."; continue; }
        if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) { s += "o"; continue; }
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const lt = -(dx + dy) / Math.SQRT2;
        const r = Math.sqrt(dx * dx + dy * dy);
        const gx = x - (cx - rx * 0.38), gy = y - (cy - ry * 0.45);
        if (gx * gx + gy * gy <= 0.6) s += "g";
        else if (lt > 0.3 && r > 0.6) s += "h";
        else if (lt < -0.35 && r > 0.6) s += "s";
        else if (lt < -0.15 && r > 0.72) s += "x";
        else s += "m";
      }
      rows.push(s);
    }
    return rows;
  }

  // Zone -> colour per stone look. Two-letter values are a checkerboard, and a
  // zone with no colour is see-through, so the board shows through it. Four
  // stones, four colours you can tell apart at a glance:
  //   black, white   solid: the two stones of the base front (left click)
  //   gray           solid slate: one of the two of the other front (right click)
  //   transparent    an ink ring with a glint and a shaded edge, and nothing
  //                  inside it: the kaya and its grid lines read straight through
  const STONE_LOOKS = {
    black: { o: "K", m: "K", h: "S", g: "C", s: "K", x: "K" },
    white: { o: "K", m: "C", h: "C", g: "C", s: "S", x: "SC" },
    gray: { o: "K", m: "S", h: "SC", g: "C", s: "KS", x: "S" },
    transparent: { o: "K", m: null, h: "C", g: "C", s: "S", x: null },
    // Capture "hit flash": cream silhouette, ink outline.
    flash: { o: "K", m: "C", h: "C", g: "C", s: "C", x: "C" },
    // Brightest flash frame: pure cream, no outline, so it reads as light.
    glow: { o: "C", m: "C", h: "C", g: "C", s: "C", x: "C" },
  };

  /** Board code -> look. 1/3 black, 2/4 white, 5/6 gray, 7/8 transparent. */
  const CODE_LOOK = [null, "black", "white", "black", "white", "gray", "gray", "transparent", "transparent", null,
    "black", "white", "black", "white"]; // 10..13: twin stones, which flash like their solid side
  function lookForCode(code) {
    return CODE_LOOK[code] || null;
  }
  /** Player p's pattern-axis code is p + 4 (matches server/src/rules/goRules.ts). */
  function patternCode(playerColor) {
    return playerColor + 4;
  }

  function zoneColor(look, zone, x, y) {
    const v = look[zone];
    if (!v) return TRANSPARENT;
    if (v.length === 1) return KEY_TO_INDEX[v];
    return KEY_TO_INDEX[v[(x + y) & 1]];
  }

  function paintStone(name, template, lookName) {
    const look = STONE_LOOKS[lookName];
    const h = template.length, w = template[0].length;
    const px = new Uint8Array(w * h).fill(TRANSPARENT);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const z = template[y][x];
        if (z === ".") continue;
        px[y * w + x] = zoneColor(look, z, x, y);
      }
    }
    return makeSprite(name, w, h, px);
  }

  const LOOKS = ["black", "white", "gray", "transparent"];
  const TEMPLATES = {
    normal: STONE_TEMPLATE_15,
    squash: stoneZones(17, 13), // impact frame
    stretch: stoneZones(13, 17), // falling / rebound frames
    small: stoneZones(11, 11), // capture shrink
    icon: stoneZones(9, 9), // sidebar-size swatch / falling shadow
    big: stoneZones(17, 17), // capture flash burst
    thin11: stoneZones(11, 15), // "Turn the Lantern" flip: the stone turning edge-on...
    thin7: stoneZones(7, 15),
    thin3: stoneZones(3, 15), // ...until only its edge shows
    mini: stoneZones(7, 7), // owner mark sitting on a lily pad
  };
  const STONES = {};
  for (const look of LOOKS.concat(["flash", "glow"])) {
    STONES[look] = {};
    for (const shape of Object.keys(TEMPLATES)) {
      STONES[look][shape] = paintStone(`stone_${look}_${shape}`, TEMPLATES[shape], look);
    }
  }
  /** Stone sprite for a board code (1..8) and shape ("normal", "squash", ...). */
  function stoneSprite(code, shape = "normal") {
    // A twin stone (10..13, player + 9) fights on both fronts, so it wears both: the split stone.
    if (code >= 10 && code <= 13) return splitPreviewSprite(code - 9, shape);
    const look = lookForCode(code);
    return look ? STONES[look][shape] : null;
  }

  /**
   * Hover preview: left half = the player's solid (base-axis) stone, right
   * half = their gray or transparent stone, with an ink divider down the middle.
   */
  const splitCache = {};
  function splitPreviewSprite(playerColor, shape = "normal") {
    const key = `${playerColor}_${shape}`;
    if (splitCache[key]) return splitCache[key];
    const left = stoneSprite(playerColor, shape);
    const right = stoneSprite(patternCode(playerColor), shape);
    if (!left || !right) return null;
    const w = left.w, h = left.h, mid = (w - 1) >> 1;
    const px = new Uint8Array(w * h).fill(TRANSPARENT);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (left.px[i] === TRANSPARENT) continue;
        px[i] = x < mid ? left.px[i] : x > mid ? right.px[i] : K;
      }
    }
    const name = shape === "normal" ? `preview_p${playerColor}` : `preview_p${playerColor}_${shape}`;
    return (splitCache[key] = makeSprite(name, w, h, px));
  }

  /** Board code 9 (matches DRIFTWOOD in server/src/rules/goRules.ts): a neutral log. */
  const DRIFTWOOD = 9;
  /** Sprite for any board code: stones 1..8, or the driftwood log (which has one shape). */
  function pieceSprite(code, shape = "normal") {
    if (code === DRIFTWOOD) return SPRITES.driftwood;
    return stoneSprite(code, shape);
  }

  /** True for a player stone's board code (1..8, or a twin 10..13); false for empty, driftwood or anything else. */
  function isPlayerStoneCode(code) {
    return (code >= 1 && code <= 8) || (code >= 10 && code <= 13);
  }

  // ---------------------------------------------------------------------------
  // Props & effect sprites
  // ---------------------------------------------------------------------------
  const SPRITES = {};
  const ANIMS = {};
  function anim(name, fps, frames, opts = {}) {
    return (ANIMS[name] = { name, fps, frames, loop: opts.loop !== false, durations: opts.durations || null });
  }

  SPRITES.hoshi = sprite("hoshi", ["KKK", "KKK", "KKK"]);

  // Last-move marker: a small glowing ember, flickering.
  anim("ember", 6, [
    sprite("ember_0", ["..K..", ".KAK.", "KACAK", ".KAK.", "..K.."]),
    sprite("ember_1", ["..K..", ".KCK.", "KCCCK", ".KCK.", "..K.."]),
    sprite("ember_2", ["..K..", ".KAK.", "KACAK", ".KAK.", "..K.."]),
    sprite("ember_3", [".....", "..K..", ".KAK.", "..K..", "....."]),
  ]);
  // The same ember, grown to fill a stone: marks each of your stones when an
  // item armed needs one of them as its target. Flickers like the small one.
  const EMBER_BIG = [
    "....K....", "...KAK...", "..KAAAK..", ".KAACAAK.", "KAACCCAAK", ".KAACAAK.", "..KAAAK..", "...KAK...", "....K....",
  ];
  anim("emberBig", 6, [
    sprite("emberBig_0", EMBER_BIG),
    sprite("emberBig_1", [
      "....K....", "...KCK...", "..KACAK..", ".KACCCAK.", "KACCCCCAK", ".KACCCAK.", "..KACAK..", "...KCK...", "....K....",
    ]),
    sprite("emberBig_2", EMBER_BIG),
    sprite("emberBig_3", [
      ".........", "....K....", "...KAK...", "..KAAAK..", ".KAACAAK.", "..KAAAK..", "...KAK...", "....K....", ".........",
    ]),
  ]);

  // Firefly blink cycle (scene decides when each firefly is lit).
  anim("firefly", 8, [
    sprite("firefly_0", ["...", ".A.", "..."]),
    sprite("firefly_1", [".a.", "aCa", ".a."]),
    sprite("firefly_2", [".A.", "ACA", ".A."]),
    sprite("firefly_3", ["...", ".C.", "..."]),
  ]);

  // Capture sparkle (four-point star shrinking).
  anim("sparkle", 12, [
    sprite("sparkle_0", ["..C..", "..C..", "CCCCC", "..C..", "..C.."]),
    sprite("sparkle_1", [".....", "..C..", ".CAC.", "..C..", "....."]),
    sprite("sparkle_2", [".....", ".....", "..A..", ".....", "....."]),
  ], { loop: false });

  // Captured stones turn into a little paper lantern that floats away.
  anim("wisp", 6, [
    sprite("wisp_0", [
      "...K...",
      "..KKK..",
      ".KAAAK.",
      "KACCCAK",
      "KACCCAK",
      ".KAAAK.",
      "..KKK..",
      "...A...",
      "...a...",
    ]),
    sprite("wisp_1", [
      "...K...",
      "..KKK..",
      ".KAAAK.",
      "KAACAAK",
      "KACCCAK",
      ".KAAAK.",
      "..KKK..",
      "...A...",
      "....a..",
    ]),
  ]);

  // Floating paper lantern (toro nagashi): glowing paper box on a little float.
  anim("floatLantern", 4, [
    sprite("floatLantern_0", [
      "..KKK..",
      ".KCCCK.",
      ".KCCCK.",
      ".KCACK.",
      ".KCACK.",
      "KKKKKKK",
      "KAAAAAK",
      ".KKKKK.",
    ]),
    sprite("floatLantern_1", [
      "..KKK..",
      ".KCCCK.",
      ".KCCCK.",
      ".KCCCK.",
      ".KCACK.",
      "KKKKKKK",
      "KAAAAAK",
      ".KKKKK.",
    ]),
  ]);

  // Hanging festival lanterns (chochin) for the garland, two paper colours.
  anim("garlandAmber", 3, [
    sprite("garlandAmber_0", [
      "...K...",
      "..KKK..",
      ".KAAAK.",
      "KAACAAK",
      "KACCCAK",
      "KAACAAK",
      ".KAAAK.",
      "..KKK..",
      "...A...",
    ]),
    sprite("garlandAmber_1", [
      "...K...",
      "..KKK..",
      ".KAAAK.",
      "KACCCAK",
      "KACCCAK",
      "KAACAAK",
      ".KAAAK.",
      "..KKK..",
      "...A...",
    ]),
  ]);
  anim("garlandCream", 3, [
    sprite("garlandCream_0", [
      "...K...",
      "..KKK..",
      ".KCCCK.",
      "KCCACCK",
      "KCAAACK",
      "KCCACCK",
      ".KCCCK.",
      "..KKK..",
      "...A...",
    ]),
    sprite("garlandCream_1", [
      "...K...",
      "..KKK..",
      ".KCCCK.",
      "KCCCCCK",
      "KCCACCK",
      "KCCCCCK",
      ".KCCCK.",
      "..KKK..",
      "...A...",
    ]),
  ]);

  // Stone lantern (toro) with a flickering fire box.
  const TORO_ROWS = [
    "......K......",
    ".....KCK.....",
    "....KSSSK....",
    "..KKCSSSSKK..",
    ".KCSSSSSSSSK.",
    "KCSSSSSSSSSTK",
    "KKKKKKKKKKKKK",
    "...KSSSSSK...",
    "...KS@@@SK...",
    "...KS@@@SK...",
    "...KS@@@SK...",
    "...KSSSSSK...",
    "..KKKKKKKKK..",
    "..KCSSSSSTK..",
    "...KKKKKKK...",
    "....KSSSK....",
    "....KSSTK....",
    "....KSSSK....",
    "....KSTSK....",
    "...KKKKKKK...",
    "..KCSSSSSTK..",
    ".KKKKKKKKKKK.",
  ];
  const TORO_FLAMES = [
    ["AAA", "ACA", "AAA"],
    ["ACA", "CCC", "ACA"],
    ["AAA", "ACA", "ACA"],
  ];
  anim("toro", 5, TORO_FLAMES.map((f, i) => {
    let k = 0;
    const rows = TORO_ROWS.map((r) => r.replace(/@@@/, () => f[k++]));
    return sprite(`toro_${i}`, rows);
  }));

  SPRITES.rock = sprite("rock", [
    "...KKKKKKKKK...",
    ".KKSSSCSSSSSKK.",
    "KSSSSSSSSSSSSTK",
    "KKSSSSSSSSSTTKK",
    ".KKKKKKKKKKKKK.",
  ]);

  // Lily pads: dark leaf silhouettes with a slate rim light and a notch.
  SPRITES.lilyPad = sprite("lilyPad", [
    "...KKKKK...",
    ".KKSSSKKKK.",
    "KKSKKKKT.KK",
    "KSKKKKKKT.K",
    "KKKKKKKKKKK",
    ".KKKKKKKKK.",
    "...KKKKK...",
  ]);
  SPRITES.lilyPadSmall = sprite("lilyPadSmall", [
    ".KKKKK.",
    "KSSKT.K",
    "KKKKKKK",
    ".KKKKK.",
  ]);
  SPRITES.lotus = sprite("lotus", [
    "...C...",
    ".C.C.C.",
    "CKCACKC",
    "KCCACCK",
    ".KCCCK.",
  ]);

  // Reeds / cattails: generated as sway frames (lean left, upright, lean right).
  function reedFrames(name, stalks) {
    const w = 11, h = 16;
    const frames = [];
    for (let f = 0; f < 4; f++) {
      const lean = [-1, 0, 1, 0][f];
      const px = new Uint8Array(w * h).fill(TRANSPARENT);
      const put = (x, y, c) => {
        if (x >= 0 && y >= 0 && x < w && y < h) px[y * w + x] = c;
      };
      for (const st of stalks) {
        for (let i = 0; i < st.len; i++) {
          const t = i / (st.len - 1); // 0 at the base, 1 at the tip
          const dx = Math.round(lean * t * t * st.bend);
          put(st.x + dx, h - 1 - i, st.color);
        }
        if (st.head) {
          const tipX = st.x + Math.round(lean * st.bend);
          const tipY = h - st.len;
          put(tipX, tipY - 1, K);
          put(tipX, tipY, K);
          put(tipX, tipY + 1, A);
          put(tipX + 1, tipY + 1, K);
          put(tipX, tipY + 2, A);
          put(tipX + 1, tipY + 2, K);
          put(tipX, tipY + 3, K);
        }
      }
      frames.push(makeSprite(`${name}_${f}`, w, h, px));
    }
    return frames;
  }
  anim("reedsTall", 3, reedFrames("reedsTall", [
    { x: 3, len: 14, bend: 2, color: K, head: true },
    { x: 5, len: 11, bend: 1.5, color: T },
    { x: 7, len: 15, bend: 2.5, color: K, head: true },
    { x: 8, len: 9, bend: 1, color: T },
  ]));
  anim("reedsShort", 3, reedFrames("reedsShort", [
    { x: 4, len: 9, bend: 1.5, color: K, head: true },
    { x: 6, len: 7, bend: 1, color: T },
    { x: 2, len: 6, bend: 1, color: T },
  ]));

  SPRITES.grassTuft = sprite("grassTuft", ["T.T.T", ".TTT."]);
  SPRITES.grassTuftSmall = sprite("grassTuftSmall", ["T.T", ".T."]);
  SPRITES.flower = sprite("flower", [".C.", "CAC", ".C."]);
  SPRITES.pebble = sprite("pebble", [".SS", "SSK"]);

  // Powerup targeting reticle (corner brackets), pulsing.
  anim("reticle", 4, [
    sprite("reticle_0", [
      "CCC.........CCC",
      "C.............C",
      "C.............C",
      "...............",
      "...............",
      "...............",
      "...............",
      ".......A.......",
      "...............",
      "...............",
      "...............",
      "...............",
      "C.............C",
      "C.............C",
      "CCC.........CCC",
    ]),
    sprite("reticle_1", [
      "...............",
      ".CCC.......CCC.",
      ".C...........C.",
      ".C...........C.",
      "...............",
      "...............",
      "...............",
      ".......C.......",
      "...............",
      "...............",
      "...............",
      ".C...........C.",
      ".C...........C.",
      ".CCC.......CCC.",
      "...............",
    ]),
  ]);

  /** Ring sprite of radius r (pixels at distance ~r), used for placement ripples. */
  function ringSprite(name, r, color) {
    const size = 2 * r + 1;
    const px = new Uint8Array(size * size).fill(TRANSPARENT);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - r, y - r);
        if (Math.abs(d - r) < 0.5) px[y * size + x] = color;
      }
    }
    return makeSprite(name, size, size, px);
  }
  anim("ripple", 12, [9, 11, 13].map((r, i) => ringSprite(`ripple_${i}`, r, C)), { loop: false });

  // ---------------------------------------------------------------------------
  // Thunderstorm: lightning fires burning on a board point. The ink outline
  // and cream core are what make a flame read on the amber kaya -- amber alone
  // would vanish into the board.
  // ---------------------------------------------------------------------------
  anim("flame", 8, [
    sprite("flame_0", [
      "....K....",
      "...KCK...",
      "...KCK...",
      "..KCAK...",
      "..KCAAK..",
      ".KCAAAK..",
      ".KCAACAK.",
      "KCAACCAK.",
      "KAACCCAK.",
      ".KAAAAK..",
      "..KKKK...",
    ]),
    sprite("flame_1", [
      "...K.....",
      "..KCK....",
      "..KCK.K..",
      "..KCAKCK.",
      ".KCAAKAK.",
      ".KCAAAK..",
      "KCAACAK..",
      "KCAACCAK.",
      "KAACCCAK.",
      ".KAAAAK..",
      "..KKKK...",
    ]),
    sprite("flame_2", [
      ".....K...",
      "....KCK..",
      "...KCCK..",
      "...KCAK..",
      "..KCAAK..",
      "..KCAAAK.",
      ".KCAACAK.",
      ".KCACCAK.",
      "KAACCCAK.",
      ".KAAAAK..",
      "..KKKK...",
    ]),
    sprite("flame_3", [
      "....K....",
      "...KAK...",
      "...KCK...",
      "..KCCK...",
      "..KCAK.K.",
      ".KCAAKCK.",
      ".KCAACAK.",
      "KCAACCAK.",
      "KAACCCAK.",
      ".KAAAAK..",
      "..KKKK...",
    ]),
  ]);
  // The last round of a fire: guttering down to embers.
  anim("flameLow", 6, [
    sprite("flameLow_0", ["..K..", ".KCK.", ".KAK.", "KACAK", ".KAK.", "..K.."]),
    sprite("flameLow_1", ["..K..", ".KAK.", "KACAK", "KACAK", ".KAK.", "..K.."]),
    sprite("flameLow_2", ["..K..", ".KCK.", "KACAK", ".KAK.", "..K..", "....."]),
  ]);
  // A struck point once the fire is out: soot on the board.
  SPRITES.scorch = sprite("scorch", [
    "..K.K..",
    ".K.K.K.",
    "K.KKK.K",
    ".K.K.K.",
    "..K.K..",
  ]);

  // ---------------------------------------------------------------------------
  // Powerups: board pieces, markers and Night Market icons
  // ---------------------------------------------------------------------------

  // Driftwood: a weathered slate log with a cream cut face and a tuft of moss.
  SPRITES.driftwood = sprite("driftwood", [
    "...KKKKKKKKKK..",
    "..KCKSSSSSTTSKK",
    ".KCACKSSKSSSSSK",
    ".KAAAKSSSSSKSSK",
    ".KCACKSKSSSSSSK",
    "..KCKSSSSSKSSK.",
    "...KKKKKKKKKK..",
  ]);

  // A small wooden boat for the turn sign: an amber hull, ink outline, cream planks.
  SPRITES.boatHull = sprite("boatHull", [
    "KKKKKKKKKKKKKKKKK",
    "KAAAAAAAAAAAAAAAK",
    ".KACAACAACAACAAK.",
    "..KKAAAAAAAAAKK..",
    "....KKKKKKKKK....",
  ]);

  /** Lily pad: teal leaf with an ink outline, a cream rim light and a notch. */
  function lilyPadSprite(name, w, h, notch) {
    const cx = (w - 1) / 2, cy = (h - 1) / 2, rx = w / 2, ry = h / 2;
    const inside = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy > 1.02) return false;
      if (notch && dx * dx + dy * dy > 0.05) {
        const a = Math.atan2(dy, dx); // notch cut toward the upper right
        if (Math.abs(a + Math.PI / 3) < 0.3) return false;
      }
      return true;
    };
    const px = new Uint8Array(w * h).fill(TRANSPARENT);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!inside(x, y)) continue;
        const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
        const dx = (x - cx) / rx, dy = (y - cy) / ry;
        const lt = -(dx + dy) / Math.SQRT2, r = Math.sqrt(dx * dx + dy * dy);
        px[y * w + x] = edge ? K : lt > 0.35 && r > 0.62 ? C : T;
      }
    }
    return makeSprite(name, w, h, px);
  }
  SPRITES.lilyBoard = lilyPadSprite("lilyBoard", 15, 13, true);
  SPRITES.lilyBoardMid = lilyPadSprite("lilyBoardMid", 9, 7, true);
  SPRITES.lilyBoardBud = lilyPadSprite("lilyBoardBud", 5, 4, false);

  // Lantern Ward: a dashed ring of lantern light turning around the stone,
  // plus a small paper lantern hanging above it.
  function dashedRing(name, r, phase) {
    const size = 2 * r + 1;
    const px = new Uint8Array(size * size).fill(TRANSPARENT);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (Math.abs(Math.hypot(x - r, y - r) - r) >= 0.5) continue;
        const a = (Math.atan2(y - r, x - r) + Math.PI) / (2 * Math.PI);
        px[y * size + x] = Math.floor(a * 12 + phase) % 2 ? A : C;
      }
    }
    return makeSprite(name, size, size, px);
  }
  anim("wardRing", 5, [0, 0.5, 1, 1.5].map((p, i) => dashedRing(`wardRing_${i}`, 8, p)));
  anim("wardBloom", 12, [4, 6, 8].map((r, i) => ringSprite(`wardBloom_${i}`, r, C)), { loop: false });
  anim("wardLantern", 4, [
    sprite("wardLantern_0", ["..K..", ".KKK.", "KACAK", "KCCCK", "KACAK", ".KKK.", "..A.."]),
    sprite("wardLantern_1", ["..K..", ".KKK.", "KAAAK", "KACAK", "KAAAK", ".KKK.", "..a.."]),
  ]);
  SPRITES.wardLanternBig = sprite("wardLanternBig", [
    "....K....",
    "...KKK...",
    "..KAAAK..",
    ".KACCCAK.",
    "KACCCCCAK",
    "KACCACCAK",
    "KACCCCCAK",
    ".KACCCAK.",
    "..KAAAK..",
    "...KKK...",
    "....A....",
    "....a....",
  ]);

  SPRITES.gustIcon = sprite("gustIcon", [
    "..........CC...",
    ".........C..C..",
    "............C..",
    "CCCCCCCCCCCC...",
    "...............",
    "..SSSSSSSSSSS..",
    "...............",
    ".CCCCCCCCCC....",
    "...........C...",
    "........C..C...",
    ".........CC....",
  ]);
  SPRITES.fireworkIcon = sprite("fireworkIcon", [
    ".......A.......",
    "..A....C....A..",
    "...C...A...C...",
    "....C.....C....",
    ".......C.......",
    "......CAC......",
    "AAC..CAAAC..CAA",
    "......CAC......",
    ".......C.......",
    "....C.....C....",
    "...C...A...C...",
    "..A....C....A..",
    ".......A.......",
  ]);
  // Icons for the market's newer items, and the two board markers (a seed and a mist).
  const pad15 = (rows) => rows.map((r) => r.padEnd(15, "."));
  SPRITES.jarIcon = sprite("jarIcon", pad15([
    "....SSSSSSS....",
    "....SSSSSSS....",
    "...SSCCCCCSS...",
    "...S.......S...",
    "...S...A...S...",
    "...S..ACA..S...",
    "...S...A...S...",
    "...S.A.....S...",
    "...S.......S...",
    "...SSSSSSSSS...",
  ]));
  SPRITES.seedlingIcon = sprite("seedlingIcon", pad15([
    "...TT..........",
    "..TCTT....TT...",
    "..TTTT...TCTT..",
    "...TT....TTTT..",
    "....T.....TT...",
    ".....T...T.....",
    "......T.T......",
    ".......T.......",
    ".......A.......",
    "..AAAAAAAAAAA..",
    ".AAAAAAAAAAAAA.",
  ]));
  SPRITES.mistIcon = sprite("mistIcon", pad15([
    "......CCC......",
    ".....CSSSC.CC..",
    "..CCCSSSSSCSSC.",
    ".CSSSSSSSSSSSSC",
    "CSSSSSSSSSSSSSC",
    ".CCCCCCCCCCCCC.",
    "..S..S...S..S..",
    ".S..S..S...S...",
  ]));
  SPRITES.kiteIcon = sprite("kiteIcon", pad15([
    ".......A.......",
    "......ACA......",
    ".....ACCAA.....",
    "....ACCCAAA....",
    ".....ACAAA.....",
    "......AAA......",
    ".......A.......",
    ".......S.......",
    "......S........",
    ".......S.......",
    "......S.C......",
    ".......C.C.....",
  ]));
  SPRITES.ferryIcon = sprite("ferryIcon", pad15([
    ".......S.......",
    "......SCS......",
    ".....SCCCS.....",
    "....SCCCCCS....",
    ".......S.......",
    "SSSSSSSSSSSSSSS",
    ".SAAAAAAAAAAAS.",
    "..SAAAAAAAAAS..",
    "...SSSSSSSSS...",
    "TT.TTT..TT.TTT.",
  ]));
  SPRITES.twinWickIcon = sprite("twinWickIcon", pad15([
    "..A.....A......",
    ".ACA...ACA.....",
    ".ACA...ACA.....",
    "..A.....A......",
    "..S.....S......",
    ".SCS...SCS.....",
    ".SCS...SCS.....",
    ".SCS...SCS.....",
    "SSSSS.SSSSS....",
  ]));
  SPRITES.currentIcon = sprite("currentIcon", pad15([
    "...............",
    ".TT..TT..TT..T.",
    "T..TT..TT..TT..",
    "...............",
    ".TT..TT..TT.TTT",
    "T..TT..TT..TT..",
    "...............",
    "..TT..TT..TT.T.",
    ".T..TT..TT..TT.",
  ]));
  SPRITES.chimeIcon = sprite("chimeIcon", pad15([
    ".......S.......",
    "......SAS......",
    ".....SAAAS.....",
    "....SACAAAS....",
    "....SACAAAS....",
    "...SAACAAAAS...",
    "..SSSSSSSSSSS..",
    ".......C.......",
    "..C.........C..",
    ".C...........C.",
  ]));
  SPRITES.fogIcon = sprite("fogIcon", pad15([
    "..CC...CC......",
    ".CSSC.CSSC.....",
    "CSSSSCSSSSC....",
    ".CCCCCCCCCC....",
    "...............",
    ".S.S.S.S.S.S...",
    "..S.S.S.S.S....",
    ".S.S.S.S.S.S...",
  ]));
  SPRITES.seedBoard = sprite("seedBoard", [
    "..TT.....",
    ".TCTT.TT.",
    ".TTTT.TCT",
    "..TT..TTT",
    "...T.TT..",
    "....TT...",
    "....A....",
    "..AAAAA..",
  ]);
  SPRITES.mistPuff = sprite("mistPuff", [
    "....CCCC.....",
    "..CCSSSSCC.C.",
    ".CSSSSSSSSCSC",
    "CSSSSSSSSSSSC",
    "CSSSSSSSSSSSC",
    ".CCSSSSSSSCC.",
    "...CCCCCCC...",
  ]);

  SPRITES.flipArrows = sprite("flipArrows", [
    "....AAAAA......",
    "..AA.....AA.A..",
    ".A.........AA..",
    ".A........AAA..",
    "...............",
    "...............",
    "...............",
    "...............",
    "...............",
    "...............",
    "..AAA........A.",
    "..AA.........A.",
    "..A.AA.....AA..",
    "......AAAAA....",
    "...............",
  ]);
  // Firework sparks: ink-outlined so they read on the kaya and on white stones alike.
  anim("burstStar", 12, [
    sprite("burstStar_0", [".......", "...K...", "..KCK..", ".KCCCK.", "..KCK..", "...K...", "......."]),
    sprite("burstStar_1", [".....", "..K..", ".KCK.", "..K..", "....."]),
    sprite("burstStar_2", ["...", ".C.", "..."]),
  ], { loop: false });

  // Fireflies are the market currency: a little glowing light.
  SPRITES.fireflyIcon = sprite("fireflyIcon", [
    "...a...",
    "..aAa..",
    ".aACAa.",
    "aACCCAa",
    ".aACAa.",
    "..aAa..",
    "...a...",
  ]);

  // ---------------------------------------------------------------------------
  // Pixel fonts: 3x5 for the board margin, 4x6 for the highlighted label.
  // ---------------------------------------------------------------------------
  const FONT_SMALL_ROWS = {
    0: ["###", "#.#", "#.#", "#.#", "###"],
    1: [".#.", "##.", ".#.", ".#.", "###"],
    2: ["##.", "..#", ".#.", "#..", "###"],
    3: ["##.", "..#", ".#.", "..#", "##."],
    4: ["#.#", "#.#", "###", "..#", "..#"],
    5: ["###", "#..", "##.", "..#", "##."],
    6: [".##", "#..", "###", "#.#", "###"],
    7: ["###", "..#", ".#.", ".#.", ".#."],
    8: ["###", "#.#", "###", "#.#", "###"],
    9: ["###", "#.#", "###", "..#", "##."],
  };
  const FONT_BIG_ROWS = {
    0: [".##.", "#..#", "#..#", "#..#", "#..#", ".##."],
    1: [".#.", "##.", ".#.", ".#.", ".#.", "###"],
    2: [".##.", "#..#", "..#.", ".#..", "#...", "####"],
    3: ["###.", "...#", ".##.", "...#", "...#", "###."],
    4: ["#..#", "#..#", "####", "...#", "...#", "...#"],
    5: ["####", "#...", "###.", "...#", "...#", "###."],
    6: [".##.", "#...", "###.", "#..#", "#..#", ".##."],
    7: ["####", "...#", "..#.", ".#..", ".#..", ".#.."],
    8: [".##.", "#..#", ".##.", "#..#", "#..#", ".##."],
    9: [".##.", "#..#", "#..#", ".###", "...#", ".##."],
    P: ["###.", "#..#", "###.", "#...", "#...", "#..."],
    A: [".##.", "#..#", "#..#", "####", "#..#", "#..#"],
    S: [".###", "#...", ".##.", "...#", "...#", "###."],
    R: ["###.", "#..#", "###.", "#.#.", "#..#", "#..#"], // the sign on the boat reads "R3": the round being played
  };
  function buildFont(name, rowsByChar, height) {
    const glyphs = {};
    for (const ch of Object.keys(rowsByChar)) {
      const rows = rowsByChar[ch];
      const w = rows[0].length;
      const bits = new Uint8Array(w * height);
      rows.forEach((r, y) => {
        for (let x = 0; x < w; x++) bits[y * w + x] = r[x] === "#" ? 1 : 0;
      });
      glyphs[ch] = { w, h: height, bits };
    }
    return { name, height, spacing: 1, glyphs };
  }
  const FONT_SMALL = buildFont("small", FONT_SMALL_ROWS, 5);
  const FONT_BIG = buildFont("big", FONT_BIG_ROWS, 6);

  function textWidth(font, text) {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const g = font.glyphs[text[i]];
      w += (g ? g.w : 3) + (i ? font.spacing : 0);
    }
    return w;
  }

  // ---------------------------------------------------------------------------
  // Rasterizer: a palette-index surface with sprite blits, dithered fades and
  // light/shade ramps. toRGBA() converts to an RGBA buffer (ImageData-ready).
  // ---------------------------------------------------------------------------
  class Surface {
    constructor(w, h) {
      this.w = w;
      this.h = h;
      this.px = new Uint8Array(w * h);
    }
    fill(c) {
      this.px.fill(c);
    }
    copyFrom(other) {
      this.px.set(other.px);
    }
    set(x, y, c) {
      x |= 0; y |= 0;
      if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
    }
    get(x, y) {
      x |= 0; y |= 0;
      if (x < 0 || y < 0 || x >= this.w || y >= this.h) return TRANSPARENT;
      return this.px[y * this.w + x];
    }
    rect(x, y, w, h, c) {
      const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0);
      const x1 = Math.min(this.w, (x + w) | 0), y1 = Math.min(this.h, (y + h) | 0);
      for (let yy = y0; yy < y1; yy++) this.px.fill(c, yy * this.w + x0, yy * this.w + x1);
    }
    /** Rectangle filled on a checkerboard (50% dither) or Bayer coverage. */
    ditherRect(x, y, w, h, c, coverage = 0.5) {
      for (let yy = y; yy < y + h; yy++)
        for (let xx = x; xx < x + w; xx++) if (ditherOn(xx, yy, coverage)) this.set(xx, yy, c);
    }
    /**
     * Draw a sprite with its top-left at (x, y).
     * opts.coverage: 0..1 ordered-dither fade (screen-aligned).
     * opts.color:    draw every opaque pixel in this palette index (silhouette).
     * opts.map:      palette remap table (Uint8Array) applied to sprite pixels.
     * opts.mask:     Uint8Array(w*h) of this surface; pixels with mask set are skipped.
     * opts.clipX0/clipX1: horizontal clip in sprite space (for split drawing).
     */
    blit(spr, x, y, opts) {
      if (!spr) return;
      x |= 0; y |= 0;
      const o = opts || {};
      const cov = o.coverage === undefined ? 1 : o.coverage;
      if (cov <= 0) return;
      const W = this.w, H = this.h, px = this.px, sp = spr.px;
      const sx0 = Math.max(0, -x, o.clipX0 || 0), sy0 = Math.max(0, -y);
      const sx1 = Math.min(spr.w, W - x, o.clipX1 === undefined ? spr.w : o.clipX1);
      const sy1 = Math.min(spr.h, H - y);
      for (let sy = sy0; sy < sy1; sy++) {
        const dy = y + sy;
        for (let sx = sx0; sx < sx1; sx++) {
          const v = sp[sy * spr.w + sx];
          if (v === TRANSPARENT) continue;
          const dx = x + sx;
          if (cov < 1 && !ditherOn(dx, dy, cov)) continue;
          const di = dy * W + dx;
          if (o.mask && o.mask[di]) continue;
          px[di] = o.color !== undefined ? o.color : o.map ? o.map[v] : v;
        }
      }
    }
    /** Blit a sprite centred on (cx, cy) (centre pixel = floor((w-1)/2)). */
    blitCentered(spr, cx, cy, opts) {
      if (!spr) return;
      this.blit(spr, cx - ((spr.w - 1) >> 1), cy - ((spr.h - 1) >> 1), opts);
    }
    /**
     * Apply a palette ramp in a dithered disc: intensity falls off linearly
     * from `strength` at the centre to 0 at `radius`; `levels` > 1 applies the
     * ramp repeatedly near the centre. mask: Uint8Array of pixels to leave alone.
     */
    ramp(table, cx, cy, radius, strength = 1, levels = 1, mask = null) {
      const W = this.w, H = this.h, px = this.px;
      const r = Math.max(0.5, radius);
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = y * W + x;
          if (mask && mask[i]) continue;
          const d = Math.hypot(x - cx, y - cy);
          if (d >= r) continue;
          const amount = strength * (1 - d / r) * levels;
          let n = Math.floor(amount);
          // Quantise the remainder to clean ordered patterns (1/8, 1/4, 1/2)
          // so halos read as crisp concentric dither rings, not noise.
          const rest = amount - n;
          const q = rest >= 0.5 ? 0.5 : rest >= 0.25 ? 0.25 : rest >= 0.125 ? 0.125 : 0;
          if (q > 0 && ditherOn(x, y, q)) n++;
          let v = px[i];
          for (let k = 0; k < n; k++) v = table[v];
          px[i] = v;
        }
      }
    }
    /** Write this surface as RGBA into `out` (Uint8ClampedArray / Uint8Array of w*h*4). */
    toRGBA(out) {
      const n = this.w * this.h;
      const dst = out || new Uint8ClampedArray(n * 4);
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const c = PALETTE_RGB[this.px[i]] || PALETTE_RGB[0];
        dst[j] = c[0]; dst[j + 1] = c[1]; dst[j + 2] = c[2]; dst[j + 3] = 255;
      }
      return dst;
    }
  }

  /** Draw text with its top-left at (x, y). Returns the drawn width. */
  function drawText(surface, font, text, x, y, color) {
    let cx = x;
    for (let i = 0; i < text.length; i++) {
      const g = font.glyphs[text[i]];
      if (!g) { cx += 3 + font.spacing; continue; }
      for (let gy = 0; gy < g.h; gy++)
        for (let gx = 0; gx < g.w; gx++) if (g.bits[gy * g.w + gx]) surface.set(cx + gx, y + gy, color);
      cx += g.w + font.spacing;
    }
    return cx - x - font.spacing;
  }

  /** 15x15 Night Market icon for a powerup id (matches server/src/powerups/definitions.ts), or null. */
  const iconCache = {};
  function powerupIcon(id) {
    if (id in iconCache) return iconCache[id];
    const s = new Surface(15, 15);
    s.fill(TRANSPARENT);
    const c = 7;
    switch (id) {
      case "driftwood":
        s.blitCentered(SPRITES.driftwood, c, c - 1);
        for (const x of [2, 3, 8, 9, 10]) s.set(x, c + 4, T);
        break;
      case "lily_pad":
        s.blitCentered(SPRITES.lilyBoard, c, c + 1);
        s.blitCentered(SPRITES.flower, c - 3, c - 3);
        break;
      case "lantern_ward":
        s.blitCentered(SPRITES.wardLanternBig, c, c);
        break;
      case "turn_lantern":
        s.blit(SPRITES.flipArrows, 0, 0);
        s.blitCentered(splitPreviewSprite(1, "icon"), c, c);
        break;
      case "gust":
        s.blitCentered(SPRITES.gustIcon, c, c);
        break;
      case "remove_stone":
        s.blitCentered(ANIMS.reticle.frames[0], c, c);
        s.blitCentered(stoneSprite(2, "icon"), c, c);
        break;
      case "bomb":
        s.blitCentered(SPRITES.fireworkIcon, c, c);
        break;
      case "firefly_jar":
        s.blitCentered(SPRITES.jarIcon, c, c);
        break;
      case "seedling":
        s.blitCentered(SPRITES.seedlingIcon, c, c);
        break;
      case "mist":
        s.blitCentered(SPRITES.mistIcon, c, c);
        break;
      case "kite":
        s.blitCentered(SPRITES.kiteIcon, c, c);
        break;
      case "ferry":
        s.blitCentered(SPRITES.ferryIcon, c, c);
        break;
      case "twin_wick":
        s.blitCentered(SPRITES.twinWickIcon, c, c);
        break;
      case "river_current":
        s.blitCentered(SPRITES.currentIcon, c, c);
        break;
      case "echo_chime":
        s.blitCentered(SPRITES.chimeIcon, c, c);
        break;
      case "fog":
        s.blitCentered(SPRITES.fogIcon, c, c);
        break;
      case "skiff":
        // A stone gliding right, with its wake behind it.
        s.blitCentered(stoneSprite(2, "icon"), 10, 7);
        for (const x of [1, 2, 4, 5]) s.set(x, 7, A);
        for (const x of [2, 3]) s.set(x, 5, S);
        for (const x of [2, 3]) s.set(x, 9, S);
        break;
      case "stepping_stones":
        // Two stones and a dotted hop between them.
        s.blitCentered(stoneSprite(5, "icon"), 4, 10);
        s.blitCentered(stoneSprite(2, "icon"), 10, 4);
        for (const [x, y] of [[7, 8], [8, 7]]) s.set(x, y, A);
        break;
      default:
        return (iconCache[id] = null);
    }
    return (iconCache[id] = makeSprite(`icon_${id}`, 15, 15, s.px));
  }
  const POWERUP_ICON_IDS = [
    "driftwood", "lily_pad", "lantern_ward", "turn_lantern", "gust", "remove_stone", "bomb",
    "firefly_jar", "seedling", "mist", "kite", "ferry", "twin_wick", "river_current", "echo_chime", "stepping_stones",
    "fog", "skiff",
  ];

  // ---------------------------------------------------------------------------
  // Item cards: a bought item is a portrait card in the player's hand under the
  // board. An ink card with a frame in its tier's colour (I teal, II amber, III
  // cream), one gem per tier on the top edge, the item's icon in a night-sky
  // window, then two empty ink panels where the page writes the text (the pixel
  // fonts only have digits): the item's name, and under a dotted rule its
  // description, small in the hand and read when the card is shown enlarged.
  // ---------------------------------------------------------------------------
  const CARD_W = 36;
  const CARD_H = 52;
  const CARD_ART = { x: 3, y: 5, w: 30, h: 14 }; // the icon's window
  const CARD_NAME_Y = 20; // first row of the name panel (rows 20..28)
  const CARD_RULE_Y = 29; // the dotted rule between name and description
  const CARD_TEXT_Y = 31; // first row of the description panel (rows 31..48)
  const CARD_FRAME = { 1: T, 2: A, 3: C };

  /** The card's silhouette: a rectangle with two pixels cut off each corner. */
  function inCard(x, y) {
    const w = CARD_W - 1, h = CARD_H - 1;
    if (x < 0 || y < 0 || x > w || y > h) return false;
    const cx = Math.min(x, w - x), cy = Math.min(y, h - y);
    return cx + cy >= 2;
  }

  /** Card-face sprite for an item: CARD_W x CARD_H, tier 1..3 (anything else reads as 1). */
  const cardCache = {};
  function itemCard(id, tier) {
    const t = tier === 2 || tier === 3 ? tier : 1;
    const key = `${id}:${t}`;
    if (key in cardCache) return cardCache[key];
    const W = CARD_W, H = CARD_H, frame = CARD_FRAME[t];
    const s = new Surface(W, H);
    s.fill(TRANSPARENT);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!inCard(x, y)) continue;
        const edge = !inCard(x - 1, y) || !inCard(x + 1, y) || !inCard(x, y - 1) || !inCard(x, y + 1);
        const ring = !inCard(x - 2, y) || !inCard(x + 2, y) || !inCard(x, y - 2) || !inCard(x, y + 2);
        s.set(x, y, edge ? K : ring ? frame : K);
      }
    }
    // The art window: night sky over a strip of river, framed in slate.
    const a = CARD_ART;
    for (let y = a.y - 1; y <= a.y + a.h; y++) {
      for (let x = a.x - 1; x <= a.x + a.w; x++) {
        const border = y === a.y - 1 || y === a.y + a.h || x === a.x - 1 || x === a.x + a.w;
        const corner = (y === a.y - 1 || y === a.y + a.h) && (x === a.x - 1 || x === a.x + a.w);
        if (corner) continue;
        const water = y >= a.y + a.h - 3;
        s.set(x, y, border ? S : water && ditherOn(x, y, y === a.y + a.h - 3 ? 0.25 : 0.5) ? T : K);
      }
    }
    for (const [x, y] of [[a.x + 3, a.y + 2], [a.x + 24, a.y + 1], [a.x + 26, a.y + 6], [a.x + 1, a.y + 8]]) s.set(x, y, S);
    const icon = powerupIcon(id) || SPRITES.fireflyIcon;
    s.blitCentered(icon, a.x + (a.w >> 1), a.y + (a.h >> 1));
    // The rule under the name: slate dots, fading out towards the frame.
    for (let x = 6; x < W - 6; x += 2) s.set(x, CARD_RULE_Y, S);
    // Tier gems on the top edge: amber diamonds set in ink, each with a cream glint.
    for (let i = 0; i < t; i++) {
      const gx = (W >> 1) + Math.round((i - (t - 1) / 2) * 6), gy = 2;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const d = Math.abs(dx) + Math.abs(dy);
          if (d <= 2) s.set(gx + dx, gy + dy, d === 2 ? K : d === 0 ? C : A);
        }
      }
    }
    return (cardCache[key] = makeSprite(`card_${id}_${t}`, W, H, s.px));
  }

  /** An empty place in the hand: the card's outline, dotted in slate. */
  let cardSlotSprite = null;
  function cardSlot() {
    if (cardSlotSprite) return cardSlotSprite;
    const W = CARD_W, H = CARD_H;
    const s = new Surface(W, H);
    s.fill(TRANSPARENT);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!inCard(x, y)) continue;
        const edge = !inCard(x - 1, y) || !inCard(x + 1, y) || !inCard(x, y - 1) || !inCard(x, y + 1);
        if (edge && ((x + y) & 3) < 2) s.set(x, y, S);
      }
    }
    return (cardSlotSprite = makeSprite("card_slot", W, H, s.px));
  }

  /** Every sprite and animation, for sprite sheets and previews. */
  function catalog() {
    const out = [];
    for (const look of Object.keys(STONES))
      for (const shape of Object.keys(TEMPLATES))
        out.push({ name: `stone_${look}_${shape}`, frames: [STONES[look][shape]], fps: 1, group: "stones" });
    for (let p = 1; p <= 4; p++)
      out.push({ name: `preview_p${p}`, frames: [splitPreviewSprite(p)], fps: 1, group: "stones" });
    for (const k of Object.keys(SPRITES)) out.push({ name: k, frames: [SPRITES[k]], fps: 1, group: "props" });
    for (const k of Object.keys(ANIMS)) out.push({ name: k, frames: ANIMS[k].frames, fps: ANIMS[k].fps, group: "anims" });
    for (const id of POWERUP_ICON_IDS) out.push({ name: `icon_${id}`, frames: [powerupIcon(id)], fps: 1, group: "icons" });
    return out;
  }

  /** Render a string as a standalone sprite (for sprite sheets). */
  function textSprite(font, text, color) {
    const w = Math.max(1, textWidth(font, text)), h = font.height;
    const s = new Surface(w, h);
    s.fill(TRANSPARENT);
    drawText(s, font, text, 0, 0, color);
    return makeSprite(`text_${font.name}_${text}`, w, h, s.px);
  }

  return {
    PALETTE,
    PALETTE_RGB,
    TRANSPARENT,
    INDEX: { K, C, A, T, S },
    BAYER4,
    ditherOn,
    LIGHT,
    SHADE,
    sprite,
    flipX,
    silhouette,
    makeSprite,
    STONES,
    STONE_LOOKS,
    STONE_TEMPLATE_15,
    TEMPLATES,
    LOOKS,
    lookForCode,
    patternCode,
    stoneSprite,
    splitPreviewSprite,
    DRIFTWOOD,
    pieceSprite,
    isPlayerStoneCode,
    powerupIcon,
    POWERUP_ICON_IDS,
    CARD_W,
    CARD_H,
    CARD_NAME_Y,
    CARD_TEXT_Y,
    itemCard,
    cardSlot,
    SPRITES,
    ANIMS,
    FONT_SMALL,
    FONT_BIG,
    textWidth,
    drawText,
    textSprite,
    Surface,
    catalog,
  };
});
