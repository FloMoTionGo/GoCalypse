// GoCalypse pixel scene: a lantern-festival riverbank with the Go board as a
// wooden deck. Renders the whole scene at native resolution into a palette
// surface (see sprites.js) and hands back RGBA for putImageData. Pure JS, no
// DOM access: runs unchanged in Node for verification renders.
//
// Browser: `window.GoPixelScene` (needs sprites.js loaded first).
// Node:    `require("./pixelScene.js")`.
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const G = isNode ? require("./sprites.js") : root.GoSprites;
  const api = factory(G);
  if (isNode) module.exports = api;
  else root.GoPixelScene = api;
})(typeof self !== "undefined" ? self : this, function (G) {
  "use strict";

  const { K, C, A, T, S } = G.INDEX;
  const ANIMS = G.ANIMS;

  // ---------------------------------------------------------------------------
  // Layout (native pixels)
  // ---------------------------------------------------------------------------
  const SPACING = 16; // native px between grid lines (x2 = today's 32 CSS px)
  const FRAME = 12; // dark lacquer frame band around the kaya (holds the labels)
  const LABEL_GAP = 2; // px between the row/column numbers and the wooden board
  const KAYA_MARGIN = 6; // kaya between the outer grid line and the frame
  const FRONT = 5; // visible front face of the deck
  // The deck is a pier standing in the river: water runs all the way round it.
  const TOP_BANK = 10; // far bank at the very top (the lantern garland hangs here)
  const TOP_WATER = 13; // river above the deck
  const LEFT = 13; // river left of the deck, running off the left edge
  const STREAM = 13; // river right of the deck
  const RIGHT_BANK = 2; // bank sliver at the right edge (reeds)
  const RIVER = 30; // river below the deck (incl. the near bank strip)
  const FAR_BANK = 4; // near-camera bank at the very bottom
  const AMBIENT_FPS = 10;

  // Region codes for the static layer.
  const R_BANK = 0, R_WATER = 1, R_FRAME = 2, R_KAYA = 3, R_FRONT = 4;

  function computeLayout(size) {
    const grid = (size - 1) * SPACING;
    const kaya = grid + 2 * KAYA_MARGIN;
    const board = kaya + 2 * FRAME;
    const boardX = LEFT, boardY = TOP_BANK + TOP_WATER;
    const kayaX = boardX + FRAME, kayaY = boardY + FRAME;
    const gridX = kayaX + KAYA_MARGIN, gridY = kayaY + KAYA_MARGIN;
    const boardRight = boardX + board; // exclusive
    const boardBottom = boardY + board; // exclusive (top surface of the deck)
    const frontBottom = boardBottom + FRONT;
    const streamX0 = boardRight, streamX1 = streamX0 + STREAM;
    const width = streamX1 + RIGHT_BANK;
    const riverY0 = frontBottom;
    const topWaterY0 = TOP_BANK; // first water row above the deck
    const height = riverY0 + RIVER;
    return {
      size, spacing: SPACING, frame: FRAME, kayaMargin: KAYA_MARGIN,
      width, height,
      boardX, boardY, boardW: board, boardH: board, boardRight, boardBottom, frontBottom,
      kayaX, kayaY, kayaW: kaya, kayaH: kaya,
      gridX, gridY, gridSpan: grid,
      streamX0, streamX1, riverY0, topWaterY0, topBank: TOP_BANK, farBank: FAR_BANK,
    };
  }

  // ---------------------------------------------------------------------------
  // Deterministic noise helpers
  // ---------------------------------------------------------------------------
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

  function starPoints(size) {
    if (size < 9) return [];
    const edge = size >= 13 ? 3 : 2;
    const far = size - 1 - edge;
    if (edge >= far) return [];
    const mid = size % 2 === 1 ? (size - 1) / 2 : null;
    const full = size >= 17 && mid !== null;
    const coords = full ? [edge, mid, far] : [edge, far];
    const pts = [];
    for (const px of coords) for (const py of coords) pts.push({ x: px, y: py });
    if (mid !== null && !full) pts.push({ x: mid, y: mid });
    return pts;
  }

  // ---------------------------------------------------------------------------
  // Static layer: bank, water base, the deck (frame, front face, kaya, grid)
  // ---------------------------------------------------------------------------
  function buildStatic(L) {
    const W = L.width, H = L.height;
    const s = new G.Surface(W, H);
    const region = new Uint8Array(W * H);
    const setR = (x, y, r) => { if (x >= 0 && y >= 0 && x < W && y < H) region[y * W + x] = r; };

    // Regions. The river is everything that isn't bank or deck: a channel
    // above the board, one down each side and the wide river below, so the
    // deck stands in the water on all four sides.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Wavy bank lips, so no shoreline is a ruled line.
        const topLip = L.topBank + Math.round(Math.sin(x * 0.11) * 1.2 + Math.sin(x * 0.27 + 2) * 0.6);
        const nearLip = H - FAR_BANK + Math.round(Math.sin(x * 0.09 + 1) * 1.2 + Math.sin(x * 0.23) * 0.6);
        const rightLip = L.streamX1 + Math.round(Math.sin(y * 0.13 + 1) * 0.8);
        let r;
        if (y < topLip) r = R_BANK;
        else if (y >= nearLip) r = R_BANK;
        else if (x >= rightLip) r = R_BANK;
        else r = R_WATER;

        if (x >= L.boardX && x < L.boardRight && y >= L.boardY && y < L.boardBottom) {
          const inKaya = x >= L.kayaX && x < L.kayaX + L.kayaW && y >= L.kayaY && y < L.kayaY + L.kayaH;
          r = inKaya ? R_KAYA : R_FRAME;
        } else if (x >= L.boardX && x < L.boardRight && y >= L.boardBottom && y < L.frontBottom) {
          r = R_FRONT;
        }
        region[y * W + x] = r;
      }
    }

    // Bank: night grass -- ink ground with a soft teal "lawn" dither along
    // every waterline, a few pebbles and tiny flowers. Kept sparse so it
    // stays calm.
    const isWaterAt = (x, y) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === R_WATER;
    /** Chebyshev distance from a bank pixel to the nearest water, capped at `max`. */
    function toWater(x, y, max) {
      for (let d = 1; d <= max; d++) {
        for (let k = -d; k <= d; k++) {
          if (isWaterAt(x + k, y - d) || isWaterAt(x + k, y + d) || isWaterAt(x - d, y + k) || isWaterAt(x + d, y + k)) {
            return d;
          }
        }
      }
      return max + 1;
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (region[y * W + x] !== R_BANK) continue;
        const d = toWater(x, y, 4);
        let c = K;
        if (d <= 2 && G.ditherOn(x, y, 0.25)) c = T;
        else if (d <= 4 && G.ditherOn(x, y, 0.125)) c = T;
        s.px[y * W + x] = c;
      }
    }
    /** First bank row above the water at column x (the top bank's lip). */
    function topLipAt(x) {
      let y = 0;
      while (y < H && !isWaterAt(x, y)) y++;
      return y - 1;
    }
    /** First bank row below the water at column x (the near bank's lip). */
    function nearLipAt(x) {
      let y = H - 1;
      while (y > 0 && !isWaterAt(x, y)) y--;
      return y + 1;
    }
    const rb = rng(1234);
    // Tufts, flowers and pebbles along the top bank.
    for (let x = 2 + Math.floor(rb() * 6); x < W - 8; x += 9 + Math.floor(rb() * 11)) {
      s.blit(rb() < 0.55 ? G.SPRITES.grassTuft : G.SPRITES.grassTuftSmall, x, topLipAt(x) - 1);
    }
    for (let i = 0; i < 4; i++) {
      const x = 16 + i * 56 + Math.floor(rb() * 20);
      s.blit(G.SPRITES.flower, x, Math.max(0, topLipAt(x) - 4));
    }
    for (let i = 0; i < 4; i++) {
      const x = 40 + i * 52 + Math.floor(rb() * 16);
      s.blit(G.SPRITES.pebble, x, topLipAt(x) - 1);
    }
    // Teal lip along the near bank at the bottom, and tufts standing on it.
    for (let x = 0; x < W; x++) {
      const y = nearLipAt(x);
      if (y < H && hash2(x, 0, 11) < 0.45) s.px[y * W + x] = T;
    }
    for (let x = 12 + Math.floor(rb() * 8); x < W - 6; x += 18 + Math.floor(rb() * 20)) {
      s.blit(G.SPRITES.grassTuft, x, nearLipAt(x) - 1);
    }
    for (let y = L.topBank + 8; y < L.riverY0 - 8; y += 14 + Math.floor(rb() * 16)) s.set(L.streamX1 + (y & 1), y, T);

    // Water base: teal, darkest in the deck's shadow (which now runs all the
    // way round the pier) and along the far lip of each bank.
    /** Chebyshev distance from a water pixel to the deck, capped at `max`. */
    function toDeck(x, y, max) {
      const dx = x < L.boardX ? L.boardX - x : x >= L.boardRight ? x - (L.boardRight - 1) : 0;
      const dy = y < L.boardY ? L.boardY - y : y >= L.frontBottom ? y - (L.frontBottom - 1) : 0;
      const d = Math.max(dx, dy);
      return d > max ? max + 1 : d;
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (region[y * W + x] !== R_WATER) continue;
        let c = T;
        const d = toDeck(x, y, 3);
        if (d <= 3 && G.ditherOn(x, y, d <= 1 ? 0.5 : d === 2 ? 0.25 : 0.125)) c = K;
        // shade along a bank's lip
        if (y + 1 < H && region[(y + 1) * W + x] === R_BANK && G.ditherOn(x, y, 0.5)) c = K;
        else if (y + 2 < H && region[(y + 2) * W + x] === R_BANK && G.ditherOn(x, y, 0.125)) c = K;
        s.px[y * W + x] = c;
      }
    }

    // Deck frame: dark lacquer with a slate rim light on the top/left edges
    // and on the front edge, mitred corners.
    const bx0 = L.boardX, by0 = L.boardY, bx1 = L.boardRight - 1, by1 = L.boardBottom - 1;
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        if (region[y * W + x] !== R_FRAME) continue;
        let c = K;
        if (y === by0 + 1 && x > bx0 && x < bx1) c = S; // top rim light
        if (x === bx0 + 1 && y > by0 && y < by1) c = S; // left rim light
        if (y === by1 && x > bx0 && x < bx1) c = S; // front edge catching light
        // Mitre joints: 1px slate diagonal from the outer to the inner corner.
        const ix = x - bx0, iy = y - by0, jx = bx1 - x, jy = by1 - y;
        if ((ix === iy || jx === jy) && ix < FRAME && iy < FRAME) c = S;
        if ((jx === iy && jx < FRAME && iy < FRAME) || (ix === jy && ix < FRAME && jy < FRAME)) c = S;
        s.px[y * W + x] = c;
      }
    }
    // Inner lip: ink line around the kaya so the playing surface is framed crisply.
    // (Frame is already ink; the lip is the kaya's bevel below.)

    // Front face: shadowed planks, slate seams between them.
    for (let y = L.boardBottom; y < L.frontBottom; y++) {
      for (let x = bx0; x <= bx1; x++) {
        const fy = y - L.boardBottom;
        let c = K;
        if (fy >= 1 && fy <= 3 && (x - bx0) % 19 === 9) c = S;
        if (fy === 2 && (x - bx0) % 19 === 0) c = T; // peg heads
        s.px[y * W + x] = c;
      }
    }
    // Deck posts reaching into the water.
    for (const px of [bx0 + 12, bx1 - 14]) {
      for (let y = L.frontBottom; y < L.frontBottom + 3; y++) {
        s.set(px, y, K); s.set(px + 1, y, S); s.set(px + 2, y, K);
        region[y * W + px] = region[y * W + px + 1] = region[y * W + px + 2] = R_FRONT;
      }
    }

    // Kaya: flat amber, no bevel, and nothing else on
    // it, no grain or specks: the stones and the grid own this surface.
    const kx0 = L.kayaX, ky0 = L.kayaY, kx1 = L.kayaX + L.kayaW - 1, ky1 = L.kayaY + L.kayaH - 1;
    for (let y = ky0; y <= ky1; y++) for (let x = kx0; x <= kx1; x++) s.px[y * W + x] = A;

    // Grid + hoshi (ink, crisp, 1px).
    const last = L.size - 1;
    for (let i = 0; i < L.size; i++) {
      const p = L.gridX + i * SPACING;
      for (let t = 0; t <= last * SPACING; t++) {
        s.set(p, L.gridY + t, K);
        s.set(L.gridX + t, L.gridY + i * SPACING, K);
      }
    }
    for (const pt of starPoints(L.size)) {
      s.blitCentered(G.SPRITES.hoshi, L.gridX + pt.x * SPACING, L.gridY + pt.y * SPACING);
    }

    // Light mask: lantern light never touches the playing surface.
    const noLight = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) noLight[i] = region[i] === R_KAYA ? 1 : 0;

    return { surface: s, region, noLight };
  }

  // ---------------------------------------------------------------------------
  // Effects (placement / capture): frame timelines, snappy with anticipation
  // and follow-through. Durations in milliseconds.
  // ---------------------------------------------------------------------------
  // shadow: which silhouette marks the landing spot while the stone falls.
  const PLACE_TIMELINE = [
    { ms: 40, shape: "stretch", dy: -10, shadow: "icon" },
    { ms: 40, shape: "stretch", dy: -5, shadow: "small" },
    { ms: 60, shape: "squash", dy: 1, shadow: "normal", ripple: 0, rippleCov: 1, specks: 0 },
    { ms: 60, shape: "stretch", dy: -1, shadow: "normal", ripple: 1, rippleCov: 0.75, specks: 1 },
    { ms: 70, shape: "normal", dy: 0, shadow: "normal", ripple: 2, rippleCov: 0.45, specks: 2 },
    { ms: 80, shape: "normal", dy: 0, shadow: "normal", ripple: 2, rippleCov: 0.2 },
  ];
  const CAPTURE_TIMELINE = (() => {
    const t = [
      { ms: 55, kind: "stone", dx: -1 }, // anticipation: a little shiver...
      { ms: 55, kind: "stone", dx: 1 },
      { ms: 50, kind: "squish" }, // ...and a squish down
      { ms: 45, kind: "flash", look: "glow", shape: "big" }, // hit flash: burst of light
      { ms: 45, kind: "flash", look: "flash", shape: "normal" },
      { ms: 50, kind: "flash", look: "flash", shape: "small" },
      { ms: 60, kind: "pop", spark: 0, sparkR: 6 }, // pop into a lantern
    ];
    const RISE = 16;
    for (let k = 0; k < RISE; k++) {
      t.push({
        ms: 70,
        kind: "rise",
        dy: -Math.round(k * 1.6 + 1),
        dx: Math.round(Math.sin(k * 0.55) * 1.4),
        coverage: k < RISE - 6 ? 1 : (RISE - k) / 7,
        spark: k < 2 ? k + 1 : -1,
        sparkR: 8 + k * 2,
      });
    }
    return t;
  })();
  const REDUCED_CAPTURE_TIMELINE = [
    { ms: 120, kind: "flash", look: "flash", shape: "normal" },
    { ms: 120, kind: "fade", coverage: 0.66 },
    { ms: 120, kind: "fade", coverage: 0.33 },
  ];

  // --- powerup effects ------------------------------------------------------
  // Driftwood splashes down onto the deck (same beats as a stone landing).
  const DROP_TIMELINE = [
    { ms: 50, kind: "drop", dy: -9, cov: 0.5 },
    { ms: 50, kind: "drop", dy: -4, cov: 1 },
    { ms: 60, kind: "drop", dy: 1, cov: 1, ripple: 0, rippleCov: 1, splash: 0 },
    { ms: 60, kind: "drop", dy: 0, cov: 1, ripple: 1, rippleCov: 0.75, splash: 1 },
    { ms: 80, kind: "drop", dy: 0, cov: 1, ripple: 2, rippleCov: 0.45, splash: 2 },
    { ms: 80, kind: "drop", dy: 0, cov: 1, ripple: 2, rippleCov: 0.2 },
  ];
  // Expired driftwood bobs and drifts off downstream, fading out.
  const DRIFT_AWAY_TIMELINE = Array.from({ length: 12 }, (_, k) => ({
    ms: 80, kind: "driftAway", dx: Math.round(k * 1.4), dy: Math.round(Math.sin(k * 0.9)),
    cov: k < 5 ? 1 : (12 - k) / 8, splash: k < 3 ? k : -1,
  }));
  // A lily pad unfurls from a bud, sparkles, and shows its owner.
  const LILY_TIMELINE = [
    { ms: 70, kind: "lily", spr: "lilyBoardBud" },
    { ms: 70, kind: "lily", spr: "lilyBoardMid" },
    { ms: 60, kind: "lily", spr: "lilyBoard", spark: 0, sparkR: 8 },
    { ms: 70, kind: "lily", spr: "lilyBoard", spark: 1, sparkR: 10, mark: true },
    { ms: 80, kind: "lily", spr: "lilyBoard", spark: 2, sparkR: 11, mark: true },
  ];
  // Lantern Ward: a ring of light blooms outward and the lantern drops in with a bounce.
  const WARD_TIMELINE = [
    { ms: 60, kind: "ward", bloom: 0, lanternDy: -8 },
    { ms: 60, kind: "ward", bloom: 1, lanternDy: -5 },
    { ms: 60, kind: "ward", bloom: 2, lanternDy: 1 },
    { ms: 70, kind: "ward", ring: true, lanternDy: -1, spark: 0 },
    { ms: 80, kind: "ward", ring: true, lanternDy: 0, spark: 1 },
    { ms: 80, kind: "ward", ring: true, lanternDy: 0, spark: 2 },
  ];
  // Turn the Lantern: the stone lifts, turns edge-on, and lands showing its other face.
  const FLIP_TIMELINE = [
    { ms: 45, kind: "flip", side: "from", shape: "thin11", dy: -1 },
    { ms: 45, kind: "flip", side: "from", shape: "thin7", dy: -2 },
    { ms: 45, kind: "flip", side: "from", shape: "thin3", dy: -3 },
    { ms: 45, kind: "flip", side: "to", shape: "thin3", dy: -3 },
    { ms: 45, kind: "flip", side: "to", shape: "thin7", dy: -2 },
    { ms: 45, kind: "flip", side: "to", shape: "thin11", dy: -1 },
    { ms: 55, kind: "flip", side: "to", shape: "squash", dy: 1, spark: 0, sparkR: 8 },
    { ms: 60, kind: "flip", side: "to", shape: "normal", dy: 0, spark: 1, sparkR: 10 },
    { ms: 70, kind: "flip", side: "to", shape: "normal", dy: 0, spark: 2, sparkR: 11 },
  ];
  // Gust: wind streaks sweep in, the stone leans, then tumbles away on the wind.
  const GUST_TIMELINE = [
    { ms: 60, kind: "gust", wind: 0, dx: 0, dy: 0, shape: "normal", cov: 1 },
    { ms: 60, kind: "gust", wind: 1, dx: -1, dy: 0, shape: "normal", cov: 1 },
    { ms: 60, kind: "gust", wind: 2, dx: 1, dy: -1, shape: "stretch", cov: 1 },
    { ms: 60, kind: "gust", wind: 3, dx: 3, dy: -3, shape: "normal", cov: 1 },
    { ms: 60, kind: "gust", wind: 4, dx: 6, dy: -5, shape: "small", cov: 1 },
    { ms: 70, kind: "gust", wind: 5, dx: 10, dy: -7, shape: "small", cov: 0.8 },
    { ms: 70, kind: "gust", wind: 6, dx: 15, dy: -8, shape: "icon", cov: 0.6 },
    { ms: 70, kind: "gust", wind: 7, dx: 21, dy: -8, shape: "icon", cov: 0.35 },
    { ms: 70, kind: "gust", wind: 8, dx: 27, dy: -7, shape: "icon", cov: 0.15 },
  ];
  // Snipe: brackets close in on the stone, strike, then the usual capture lantern.
  const SNIPE_TIMELINE = [
    { ms: 80, kind: "aim", d: 12 },
    { ms: 70, kind: "aim", d: 9 },
    { ms: 60, kind: "aim", d: 7, strike: true },
  ].concat(CAPTURE_TIMELINE.slice(2));
  // Firework: a burst of sparks from the target point, then drifting embers.
  const FIREWORK_TIMELINE = [
    { ms: 90, kind: "burst", r: 0, flash: true },
    { ms: 60, kind: "burst", r: 7, star: 0, ring: 0 },
    { ms: 60, kind: "burst", r: 12, star: 0, ring: 1, trail: 1 },
    { ms: 70, kind: "burst", r: 17, star: 0, ring: 2, trail: 0.66 },
    { ms: 70, kind: "burst", r: 21, star: 1, trail: 0.33, embers: 0 },
    { ms: 80, kind: "burst", r: 23, star: 2, embers: 1 },
    { ms: 80, kind: "burst", r: 24, embers: 2 },
  ];

  // A stone the lightning set alight, three rounds on: it shrivels in the
  // flame and goes up as smoke (nobody captured it, so no lantern rises).
  const BURN_AWAY_TIMELINE = [
    { ms: 70, kind: "burn", shape: "normal", cov: 1, flame: 0 },
    { ms: 70, kind: "burn", shape: "squash", cov: 0.75, flame: 1 },
    { ms: 70, kind: "burn", shape: "small", cov: 0.5, flame: 2, spark: 0, sparkR: 7 },
    { ms: 80, kind: "burn", shape: "icon", cov: 0.3, flame: 3, spark: 1, sparkR: 9 },
    { ms: 90, kind: "burn", cov: 0, smoke: 0 },
    { ms: 90, kind: "burn", cov: 0, smoke: 1 },
    { ms: 110, kind: "burn", cov: 0, smoke: 2 },
  ];

  const TIMELINES = {
    place: [PLACE_TIMELINE, []],
    burnAway: [BURN_AWAY_TIMELINE, [
      { ms: 130, kind: "burn", shape: "small", cov: 0.5, flame: 1 },
      { ms: 130, kind: "burn", cov: 0, smoke: 1 },
    ]],
    capture: [CAPTURE_TIMELINE, REDUCED_CAPTURE_TIMELINE],
    drop: [DROP_TIMELINE, []],
    driftAway: [DRIFT_AWAY_TIMELINE, [
      { ms: 120, kind: "driftAway", dx: 0, dy: 0, cov: 0.66, splash: -1 },
      { ms: 120, kind: "driftAway", dx: 0, dy: 0, cov: 0.33, splash: -1 },
    ]],
    lily: [LILY_TIMELINE, []],
    ward: [WARD_TIMELINE, [{ ms: 150, kind: "ward", ring: true, lanternDy: 0 }]],
    flip: [FLIP_TIMELINE, []],
    gust: [GUST_TIMELINE, REDUCED_CAPTURE_TIMELINE],
    snipe: [SNIPE_TIMELINE, REDUCED_CAPTURE_TIMELINE],
    firework: [FIREWORK_TIMELINE, [{ ms: 150, kind: "burst", r: 0, flash: true }]],
  };
  /** Effect kinds that draw their own piece at the cell while playing (the board already shows the end state). */
  const OWNS_CELL = new Set(["place", "drop", "flip"]);

  function timelineFor(kind, reducedMotion) {
    const pair = TIMELINES[kind];
    return pair ? pair[reducedMotion ? 1 : 0] : [];
  }
  function timelineDuration(tl) {
    return tl.reduce((sum, f) => sum + f.ms, 0) / 1000;
  }
  /** Frame of a timeline at `elapsed` seconds, or null once finished. */
  function frameAt(tl, elapsed) {
    if (elapsed < 0) return null;
    let acc = 0;
    const ms = elapsed * 1000;
    for (let i = 0; i < tl.length; i++) {
      acc += tl[i].ms;
      if (ms < acc) return { index: i, frame: tl[i] };
    }
    return null;
  }

  /** Effect records passed to render() via state.effects. Times in seconds. */
  function placeEffect(x, y, code, start) {
    return { kind: "place", x, y, code, start };
  }
  function captureEffect(x, y, code, start) {
    return { kind: "capture", x, y, code, start };
  }
  /**
   * Any other effect kind (see TIMELINES), e.g.
   *   makeEffect("flip", x, y, { from: 1, code: 5 }, t)
   *   makeEffect("lily", x, y, { owner: 2 }, t)
   *   makeEffect("gust", x, y, { code: 3 }, t)
   */
  function makeEffect(kind, x, y, props, start) {
    return Object.assign({ kind, x, y, start }, props);
  }
  function effectDuration(effect, reducedMotion) {
    return timelineDuration(timelineFor(effect.kind, reducedMotion));
  }
  function effectDone(effect, time, reducedMotion) {
    return time - effect.start >= effectDuration(effect, reducedMotion);
  }
  function pruneEffects(effects, time, reducedMotion) {
    return effects.filter((e) => !effectDone(e, time, reducedMotion));
  }

  /**
   * Compare two board snapshots and return effects for what changed:
   * a new stone -> "place", a stone that disappeared -> "capture".
   * `lastMove` is the single newly placed point (if exactly one).
   */
  function diffBoards(prev, next, size, time) {
    const effects = [];
    let placed = [];
    if (!prev || prev.length !== next.length) return { effects, lastMove: null };
    for (let i = 0; i < next.length; i++) {
      const a = prev[i], b = next[i];
      if (a === b) continue;
      const x = i % size, y = (i / size) | 0;
      if (a !== 0) effects.push(captureEffect(x, y, a, time));
      if (b !== 0) {
        effects.push(placeEffect(x, y, b, time));
        placed.push({ x, y });
      }
    }
    return { effects, lastMove: placed.length === 1 ? placed[0] : null };
  }

  /**
   * Effects for one server update, powerup-aware. `action` is the room's
   * LastAction ({kind: "move"|"powerup", id, x, y}) if it changed in this
   * update, else null. `newOverlays` are lily/ward markers that just appeared.
   * Picks the matching animation per changed cell: driftwood drops in or
   * drifts away, a flipped stone turns over, the Gust/Snipe target gets its
   * own exit, everything else that vanished is captured (Firework included).
   */
  function diffTurn(prev, next, size, action, newOverlays, time, goneOverlays) {
    const effects = [];
    if (!prev || prev.length !== next.length) return effects;
    const used = action && action.kind === "powerup" ? action.id : null;
    const isTarget = (x, y) => action && action.x === x && action.y === y;
    // A Ferry's or Skiff's stone lands on the action's point and leaves a point in line with it:
    // that one goes quietly, it is not a capture.
    const ferried = new Set();
    if (used === "ferry" || used === "skiff") {
      const landed = next[action.y * size + action.x];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        // Nearest first: a Ferry steps once, a Skiff glides as far as the way is clear.
        for (let fx = action.x + dx, fy = action.y + dy; fx >= 0 && fy >= 0 && fx < size && fy < size; fx += dx, fy += dy) {
          const fi = fy * size + fx;
          if (prev[fi] === landed && next[fi] === 0) { ferried.add(fi); break; }
          if (prev[fi] !== 0) break; // something stood in the way: not this line
        }
        if (ferried.size) break;
      }
    }
    const inBurst = (x, y) => used === "bomb" && Math.abs(x - action.x) <= 1 && Math.abs(y - action.y) <= 1;
    // Cells whose lightning fire just went out: whatever stood there burned up.
    const burntOut = new Set(
      (goneOverlays || []).filter((o) => o.kind === "fire").map((o) => o.y * size + o.x)
    );
    for (let i = 0; i < next.length; i++) {
      const a = prev[i], b = next[i];
      if (a === b) continue;
      const x = i % size, y = (i / size) | 0;
      if (a === 0) {
        effects.push(b === G.DRIFTWOOD ? makeEffect("drop", x, y, { code: b }, time) : placeEffect(x, y, b, time));
      } else if (b === 0) {
        if (ferried.has(i)) continue;
        if (burntOut.has(i)) effects.push(makeEffect("burnAway", x, y, { code: a }, time));
        else if (a === G.DRIFTWOOD && !inBurst(x, y)) effects.push(makeEffect("driftAway", x, y, { code: a }, time));
        else if (used === "gust" && isTarget(x, y)) effects.push(makeEffect("gust", x, y, { code: a }, time));
        else if (used === "remove_stone" && isTarget(x, y)) effects.push(makeEffect("snipe", x, y, { code: a }, time));
        else effects.push(captureEffect(x, y, a, time));
      } else if (a <= 8 && b <= 8 && (a > 4 ? a - 4 : a + 4) === b) {
        effects.push(makeEffect("flip", x, y, { from: a, code: b }, time));
      } else {
        effects.push(captureEffect(x, y, a, time), placeEffect(x, y, b, time));
      }
    }
    if (used === "bomb") effects.push(makeEffect("firework", action.x, action.y, {}, time));
    for (const o of newOverlays || []) {
      if (o.kind === "lily" || o.kind === "ward") effects.push(makeEffect(o.kind, o.x, o.y, { owner: o.owner }, time));
    }
    return effects;
  }

  /**
   * A piece centred on (cx, cy), faded towards the storm's slate grey by `grey`
   * (0..1) if it's a player stone. The one grey ramp for stones at rest and
   * stones in flight, so nothing a storm hides shows its colour while it moves.
   * With opts.coverage (a fading piece) the grey never covers more than the
   * piece: at full grey the two land on the same dither pixels.
   */
  function blitPiece(surf, code, shape, cx, cy, grey, opts) {
    surf.blitCentered(G.pieceSprite(code, shape), cx, cy, opts);
    if (!(grey > 0) || !G.isPlayerStoneCode(code)) return;
    const cov = opts && opts.coverage !== undefined ? Math.min(opts.coverage, grey) : grey;
    surf.blitCentered(G.pieceSprite(6, shape), cx, cy, { coverage: cov });
  }
  /**
   * A piece's drop shadow. The transparent stones are rings, so their shadows
   * are too: under the storm's grey every player stone casts the grey stone's
   * solid one, or a stone in the air would still say which kind it is.
   */
  function blitShadow(surf, code, shape, cx, cy, grey) {
    const look = grey > 0 && G.isPlayerStoneCode(code) ? 6 : code;
    surf.blitCentered(G.pieceSprite(look, shape), cx, cy, { color: K, coverage: 0.5 });
  }

  /**
   * Draw one effect frame centred on native pixel (cx, cy). Exposed so the
   * sprite-sheet preview can show effects in isolation. `grey` (0..1) is the
   * storm's grey: stones in flight wear it too, and owner marks stay hidden.
   * Returns a light source {x, y, r} if the frame glows, else null.
   */
  function drawEffect(surf, effect, elapsed, cx, cy, reducedMotion, grey = 0) {
    const tl = timelineFor(effect.kind, reducedMotion);
    const at = frameAt(tl, elapsed);
    if (!at) return null;
    const f = at.frame;
    const code = effect.code;
    if (effect.kind === "place") {
      blitShadow(surf, code, f.shadow, cx + 1, cy + 1, grey);
      if (f.ripple !== undefined) {
        surf.blitCentered(ANIMS.ripple.frames[f.ripple], cx, cy, { coverage: f.rippleCov });
      }
      blitPiece(surf, code, f.shape, cx, cy + f.dy, grey);
      if (f.specks !== undefined) {
        const d = 9 + f.specks * 2;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          surf.set(cx + sx * d, cy + sy * (d - 3), C);
          if (f.specks === 0) surf.set(cx + sx * (d - 1), cy + sy * (d - 4), C);
        }
      }
      return null;
    }
    const powerup = drawPowerupFrame(surf, effect, f, at.index, cx, cy, grey);
    if (powerup !== undefined) return powerup;

    // capture (also the tail of the snipe timeline)
    const look = G.lookForCode(code);
    if (f.kind === "stone") {
      blitPiece(surf, code, "normal", cx + f.dx, cy, grey);
      return null;
    }
    if (f.kind === "squish") {
      blitPiece(surf, code, "squash", cx, cy + 1, grey);
      return null;
    }
    if (f.kind === "flash") {
      surf.blitCentered(G.STONES[f.look][f.shape], cx, cy);
      return { x: cx, y: cy, r: 9 };
    }
    if (f.kind === "fade") {
      blitPiece(surf, code, "normal", cx, cy, grey, { coverage: f.coverage });
      return null;
    }
    const wisp = ANIMS.wisp.frames[at.index & 1];
    if (f.kind === "pop") {
      surf.blitCentered(wisp, cx, cy - 1);
      drawSparkRing(surf, cx, cy, f.sparkR, f.spark);
      return { x: cx, y: cy - 1, r: 10 };
    }
    // rise
    const wx = cx + f.dx, wy = cy - 1 + f.dy;
    if (f.spark >= 0) drawSparkRing(surf, cx, cy, f.sparkR, f.spark);
    surf.blitCentered(wisp, wx, wy, { coverage: f.coverage });
    if (look && f.coverage >= 0.5) {
      // A trailing ember below the lantern.
      surf.set(wx, wy + 6 + (at.index & 1), A);
    }
    return f.coverage > 0.3 ? { x: wx, y: wy, r: 8 * f.coverage } : null;
  }

  /**
   * Frames of the powerup timelines. Returns a light source / null when it
   * drew the frame, or undefined if the frame kind isn't a powerup kind.
   */
  function drawPowerupFrame(surf, effect, f, index, cx, cy, grey) {
    switch (f.kind) {
      case "drop": {
        const log = G.SPRITES.driftwood;
        surf.blitCentered(log, cx + 1, cy + 1, { color: K, coverage: 0.5 * f.cov });
        if (f.ripple !== undefined) surf.blitCentered(ANIMS.ripple.frames[f.ripple], cx, cy, { coverage: f.rippleCov });
        surf.blitCentered(log, cx, cy + f.dy, { coverage: f.cov });
        if (f.splash !== undefined) drawSplash(surf, cx, cy, f.splash);
        return null;
      }
      case "driftAway": {
        surf.blitCentered(G.SPRITES.driftwood, cx + f.dx, cy + f.dy, { coverage: f.cov });
        if (f.splash >= 0) drawSplash(surf, cx, cy, f.splash);
        return null;
      }
      case "lily": {
        surf.blitCentered(G.SPRITES[f.spr], cx, cy + 1);
        if (f.mark && effect.owner && !(grey > 0)) surf.blitCentered(G.splitPreviewSprite(effect.owner, "mini"), cx, cy + 1);
        if (f.spark !== undefined) drawSparkRing(surf, cx, cy, f.sparkR, f.spark);
        return null;
      }
      case "ward": {
        if (f.bloom !== undefined) surf.blitCentered(ANIMS.wardBloom.frames[f.bloom], cx, cy);
        if (f.ring) surf.blitCentered(ANIMS.wardRing.frames[index & 3], cx, cy);
        surf.blitCentered(ANIMS.wardLantern.frames[0], cx + WARD_LANTERN_DX, cy + WARD_LANTERN_DY + f.lanternDy);
        if (f.spark !== undefined) drawSparkRing(surf, cx, cy, 10, f.spark);
        return { x: cx + WARD_LANTERN_DX, y: cy + WARD_LANTERN_DY, r: 6 };
      }
      case "flip": {
        const code = f.side === "from" ? effect.from : effect.code;
        blitShadow(surf, code, "icon", cx + 1, cy + 1, grey);
        blitPiece(surf, code, f.shape, cx, cy + f.dy, grey);
        if (f.spark !== undefined) drawSparkRing(surf, cx, cy, f.sparkR, f.spark);
        return null;
      }
      case "gust": {
        drawWind(surf, cx, cy, f.wind);
        blitPiece(surf, effect.code, f.shape, cx + f.dx, cy + f.dy, grey, { coverage: f.cov });
        return null;
      }
      case "aim": {
        blitPiece(surf, effect.code, "normal", cx, cy, grey);
        drawBrackets(surf, cx, cy, f.d);
        if (f.strike) {
          for (let k = 3; k <= 10; k++) {
            surf.set(cx - k, cy, C); surf.set(cx + k, cy, C);
            surf.set(cx, cy - k, C); surf.set(cx, cy + k, C);
          }
          return { x: cx, y: cy, r: 8 };
        }
        return null;
      }
      case "burn": {
        if (f.cov > 0 && effect.code) {
          blitPiece(surf, effect.code, f.shape, cx, cy, grey, { coverage: f.cov });
        }
        if (f.flame !== undefined) {
          surf.blitCentered(ANIMS.flame.frames[f.flame % ANIMS.flame.frames.length], cx, cy - 3);
        }
        if (f.spark !== undefined) drawSparkRing(surf, cx, cy, f.sparkR, f.spark);
        if (f.smoke !== undefined) {
          // Puffs lifting off the empty point.
          for (let k = 0; k <= f.smoke; k++) {
            const d = f.smoke - k;
            const y = cy - 2 - k * 4;
            const x = cx + Math.round(Math.sin(k * 1.7 + f.smoke) * 2);
            surf.set(x, y, d === 0 ? S : K);
            surf.set(x + 1, y, S);
            surf.set(x - 1, y + 1, K);
          }
        }
        return f.flame !== undefined ? { x: cx, y: cy - 3, r: 7 } : null;
      }
      case "burst": {
        if (f.flash) {
          surf.blitCentered(G.STONES.glow.big, cx, cy);
          return { x: cx, y: cy, r: 14 };
        }
        if (f.ring !== undefined) surf.blitCentered(ANIMS.ripple.frames[f.ring], cx, cy);
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4 + (k & 1 ? 0.2 : 0);
          const rr = k & 1 ? f.r * 0.8 : f.r;
          const px = Math.round(cx + Math.cos(a) * rr), py = Math.round(cy + Math.sin(a) * rr);
          if (f.trail !== undefined) {
            for (let d = 5; d < rr - 3; d++) {
              const tx = Math.round(cx + Math.cos(a) * d), ty = Math.round(cy + Math.sin(a) * d);
              if (G.ditherOn(tx, ty, f.trail * 0.5)) surf.set(tx, ty, k & 1 ? A : C);
            }
          }
          if (f.star !== undefined) {
            // Alternate cream and amber hearts; the ink outline keeps every spark visible.
            surf.blitCentered(ANIMS.burstStar.frames[f.star], px, py, k & 1 ? { map: SWAP_CREAM_AMBER } : undefined);
          }
          if (f.embers !== undefined) {
            const ey = py + 1 + f.embers * 2;
            surf.set(px, ey, f.embers < 2 ? A : S);
            if (f.embers === 0) surf.set(px, ey - 1, C);
          }
        }
        return f.r < 20 ? { x: cx, y: cy, r: 22 - f.r } : null;
      }
      default:
        return undefined;
    }
  }

  const WARD_LANTERN_DX = 5, WARD_LANTERN_DY = -6;
  const SWAP_CREAM_AMBER = new Uint8Array(256).map((_, i) => (i === C ? A : i === A ? C : i));

  // ---------------------------------------------------------------------------
  // Thunderstorm. Every 20 turns the server rolls a D20 (plus a bonus for every
  // calm roll) and at 20 the sky opens (see server/src/rooms/GoRoom.ts). The
  // client plays it out in two layers. First a ~10 s cloudburst
  // (STORM_SECONDS): clouds roll over the scene, rain falls, and up to three
  // bolts come down on the points the server picked, each lighting a fire that
  // burns for three rounds. Behind it a much weaker copy of the same weather
  // (STORM_LINGER) stays for the storm's full three rounds, easing out through
  // the last. The board gets a lighter share of that weather, and every player
  // stone goes the same slate grey for the storm's three rounds (drawStones):
  // the rules still run on the real colours, the players just cannot see them.
  // ---------------------------------------------------------------------------
  const STORM_SECONDS = 10;
  const STORM_DARK_IN = 1.4; // dusk ramps up over this
  const STORM_DARK_OUT = 1.6; // ... and clears again at the end
  const STORM_DARKNESS = 0.32; // peak dither coverage of the shade ramp
  const STORM_LINGER = 0.35; // how much of that weather stays for the storm's three rounds
  const STORM_BOARD_SHARE = 0.6; // the lingering weather over the board, as a share of what the river gets
  const STORM_FIRST_BOLT = 2.4; // when the first bolt lands
  const STORM_BOLT_GAP = 2.0; // and how far apart the rest fall
  const BOLT_FLASH = 0.5; // how long one bolt's flash lasts

  /** When bolt `i` of a storm lands, in seconds from the storm's start. */
  function boltTime(i) {
    return STORM_FIRST_BOLT + i * STORM_BOLT_GAP;
  }

  /**
   * What the storm looks like right now. `elapsed` is seconds since it broke.
   * Returns null once it's over. `bolts[i]` is 0..1 through bolt i's flash, or
   * -1 if that bolt hasn't fallen yet; `landed[i]` says its fire is alight.
   */
  function stormPhase(elapsed, strikeCount, reduced) {
    if (elapsed < 0 || elapsed >= STORM_SECONDS) return null;
    const fadeIn = Math.min(1, elapsed / STORM_DARK_IN);
    const fadeOut = Math.min(1, (STORM_SECONDS - elapsed) / STORM_DARK_OUT);
    const weight = Math.min(fadeIn, fadeOut);
    const bolts = [];
    const landed = [];
    for (let i = 0; i < strikeCount; i++) {
      const dt = elapsed - boltTime(i);
      bolts.push(dt >= 0 && dt < BOLT_FLASH ? dt / BOLT_FLASH : -1);
      landed.push(dt >= 0);
    }
    return {
      weight,
      darkness: STORM_DARKNESS * weight,
      rain: reduced ? 0 : weight,
      clouds: weight,
      bolts,
      landed,
      elapsed,
    };
  }

  /**
   * How much of a storm's three rounds is left, 0..1: full for the first two
   * rounds, then easing out through the last. Worked out from the synced turn
   * counters alone, so a client that joins mid-storm sees the same weather.
   */
  function stormLinger(turnCount, until, roundLength) {
    if (turnCount === undefined || until === undefined || !(roundLength > 0) || turnCount >= until) return 0;
    return Math.min(1, (until - turnCount) / roundLength);
  }

  /** A bolt's jagged path from the top of the scene down to (x1, y1). */
  function boltPath(x1, y1, seed) {
    const steps = 7;
    const x0 = x1 + Math.round((hash2(seed, 3, 91) - 0.5) * 60);
    const pts = [{ x: x0, y: 0 }];
    for (let k = 1; k < steps; k++) {
      const u = k / steps;
      const jitter = (hash2(seed, k, 17) - 0.5) * 16 * (1 - u * 0.6);
      pts.push({ x: Math.round(x0 + (x1 - x0) * u + jitter), y: Math.round(y1 * u) });
    }
    pts.push({ x: x1, y: y1 });
    return pts;
  }

  function drawSegment(surf, x0, y0, x1, y1, color) {
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      surf.set(x0, y0, color);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }

  /**
   * One lightning bolt, `u` (0..1) through its flash: a cream channel with an
   * ink edge so it reads over water, bank and board alike, plus a fork or two.
   */
  function drawBolt(surf, x1, y1, seed, u) {
    const pts = boltPath(x1, y1, seed);
    const flicker = u < 0.25 || (u > 0.4 && u < 0.5);
    if (!flicker) return;
    const fat = u < 0.25;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      if (fat) {
        drawSegment(surf, a.x - 1, a.y, b.x - 1, b.y, K);
        drawSegment(surf, a.x + 1, a.y, b.x + 1, b.y, K);
      }
      drawSegment(surf, a.x, a.y, b.x, b.y, C);
    }
    // A fork peeling off the middle of the bolt.
    const f = pts[Math.floor(pts.length / 2)];
    const fx = f.x + Math.round((hash2(seed, 5, 23) - 0.5) * 30);
    const fy = f.y + Math.round(y1 * 0.25);
    drawSegment(surf, f.x, f.y, fx, fy, C);
  }

  /** Rolling cloud cover: soft ink masses drifting right, lit along their tops. */
  function drawClouds(surf, W, H, t, weight, accept) {
    const count = 5;
    for (let i = 0; i < count; i++) {
      const speed = 9 + i * 2.5;
      const span = W + 120;
      const cx = (((i * 83 + t * speed) % span) + span) % span - 60;
      const cy = 4 + hash2(i, 1, 5) * (H * 0.75);
      const rx = 34 + hash2(i, 2, 5) * 26;
      const ry = 9 + hash2(i, 3, 5) * 6;
      const cov = (0.4 + 0.2 * hash2(i, 4, 5)) * weight;
      for (let y = Math.max(0, Math.floor(cy - ry)); y <= Math.min(H - 1, Math.ceil(cy + ry)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rx)); x <= Math.min(W - 1, Math.ceil(cx + rx)); x++) {
          const dx = (x - cx) / rx, dy = (y - cy) / ry;
          const d = dx * dx + dy * dy;
          if (d > 1) continue;
          // Lumpy edge: puffs rather than one smooth ellipse.
          const lump = 0.72 + 0.28 * Math.sin(x * 0.27 + i) * Math.sin(y * 0.4 + i * 2);
          if (d > lump) continue;
          if (accept && !accept(x, y)) continue;
          const i0 = y * W + x;
          // Painted, not shaded: over an already dusky scene a shade ramp
          // would do nothing, and a cloud you can't see isn't weather.
          if (d > lump - 0.14) {
            if (G.ditherOn(x, y, 0.5 * weight)) surf.px[i0] = dy < 0 ? S : K;
          } else if (G.ditherOn(x, y, cov)) {
            surf.px[i0] = K;
          }
        }
      }
    }
  }

  /** Slanting rain over the whole scene, with drops bouncing where they land. */
  function drawRain(surf, W, H, t, weight, accept) {
    const drops = Math.round(200 * weight);
    for (let i = 0; i < drops; i++) {
      const seedX = hash2(i, 0, 31), seedY = hash2(i, 1, 31);
      const speed = 150 + seedY * 90;
      const len = 4 + Math.floor(seedX * 3);
      const span = H + 40;
      const y = (((seedY * span + t * speed) % span) + span) % span - 20;
      const x = seedX * (W + 80) - 40 + y * 0.35; // the whole curtain slants
      for (let k = 0; k < len; k++) {
        const px = Math.round(x - k * 0.35), py = Math.round(y - k);
        if (accept && !accept(px, py)) continue;
        surf.set(px, py, k === 0 || G.ditherOn(px, py, 0.5) ? C : S);
      }
    }
  }

  const FIRE_LIGHT_R = 7;

  /** Little teal and cream droplets thrown up around a landing piece. */
  function drawSplash(surf, cx, cy, step) {
    const d = 6 + step * 2;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 0], [1, 0]]) {
      surf.set(cx + sx * (d + 2), cy + sy * (2 + step) - 1, step < 2 ? C : T);
      if (step === 0) surf.set(cx + sx * (d + 1), cy + sy * (2 + step), T);
    }
  }

  /** Three wind streaks sweeping left to right, each with a curl at its head. */
  function drawWind(surf, cx, cy, step) {
    const rows = [[-6, 0, C], [-1, 3, S], [4, -2, C]];
    for (const [oy, ox, c] of rows) {
      const head = cx - 14 + step * 5 + ox;
      const len = step < 7 ? 7 : 9 - step;
      for (let k = 0; k < len; k++) surf.set(head - k, cy + oy, c);
      surf.set(head + 1, cy + oy - 1, c);
      surf.set(head + 1, cy + oy - 2, c);
      surf.set(head, cy + oy - 3, c);
    }
  }

  /** Four corner brackets at distance d from (cx, cy) (the snipe's closing sight). */
  function drawBrackets(surf, cx, cy, d) {
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const x = cx + sx * d, y = cy + sy * d;
      for (let k = 0; k < 3; k++) {
        surf.set(x - sx * k, y, C);
        surf.set(x, y - sy * k, C);
      }
    }
  }

  function drawSparkRing(surf, cx, cy, r, frame) {
    if (frame < 0) return;
    const spr = ANIMS.sparkle.frames[Math.min(frame, ANIMS.sparkle.frames.length - 1)];
    const d = Math.round(r * 0.7);
    surf.blitCentered(spr, cx - d, cy - d);
    surf.blitCentered(spr, cx + d, cy - d);
    surf.blitCentered(spr, cx - r, cy + 2);
    surf.blitCentered(spr, cx + r, cy + 2);
  }

  // ---------------------------------------------------------------------------
  // Scene
  // ---------------------------------------------------------------------------
  function createScene(options) {
    const opts = options || {};
    const size = opts.size || 13;
    const L = computeLayout(size);
    const W = L.width, H = L.height;
    const base = buildStatic(L);
    const surf = new G.Surface(W, H);
    const rgba = new Uint8ClampedArray(W * H * 4);
    const region = base.region;
    const noLight = base.noLight;

    // --- ambient actors -----------------------------------------------------
    const r = rng(99);
    const streamCx = L.streamX0 + (STREAM >> 1);
    const topLaneY = L.topWaterY0 + (TOP_WATER >> 1);
    const laneY = L.riverY0 + 13;
    const CORNER = 8;
    // The lanterns ride the current all the way round the pier: in along the
    // top channel, down the right one, then out along the wide river below.
    const arcLen = (Math.PI / 2) * CORNER;
    const segTop = streamCx - CORNER + 12; // from off-screen left to the first bend
    const segSide = laneY - CORNER - (topLaneY + CORNER); // down the right channel
    const segRiver = streamCx - CORNER + 12; // back out to the left
    const pathLen = segTop + arcLen + segSide + arcLen + segRiver;
    function lanternPath(s) {
      if (s < segTop) return { x: -12 + s, y: topLaneY, river: 0 };
      s -= segTop;
      if (s < arcLen) {
        const a = s / CORNER - Math.PI / 2;
        return { x: streamCx - CORNER + Math.cos(a) * CORNER, y: topLaneY + CORNER + Math.sin(a) * CORNER, river: 0 };
      }
      s -= arcLen;
      if (s < segSide) return { x: streamCx, y: topLaneY + CORNER + s, river: 0 };
      s -= segSide;
      if (s < arcLen) {
        const a = s / CORNER;
        return { x: streamCx - CORNER + Math.cos(a) * CORNER, y: laneY - CORNER + Math.sin(a) * CORNER, river: 0 };
      }
      s -= arcLen;
      return { x: streamCx - CORNER - s, y: laneY, river: Math.min(1, s / 30) };
    }
    const floaters = [0, 1, 2, 3].map((i) => ({
      offset: (i / 4) * pathLen + r() * 20,
      lane: [-3, 4, -1, 6][i],
      phase: r() * 6.28,
    }));
    const LANTERN_SPEED = 6; // px per second

    const garland = [];
    for (let x = 10; x < W - 12; x += 25) garland.push({ x, phase: r() * 6.28, cream: garland.length % 2 === 1 });

    const fireflies = [];
    const addFly = (cx, cy, ax, ay) =>
      fireflies.push({ cx, cy, ax, ay, fx: 0.25 + r() * 0.35, fy: 0.3 + r() * 0.4, p1: r() * 6.28, p2: r() * 6.28, period: 3 + r() * 3, phase: r() });
    const rv = L.riverY0;
    addFly(40, 5, 26, 3); addFly(120, 4, 30, 3); addFly(196, 6, 20, 3);
    addFly(60, rv + 13, 24, 7); addFly(120, rv + 18, 30, 6); addFly(180, rv + 11, 22, 7); addFly(28, rv + 8, 10, 5);
    addFly(streamCx, 90, 3, 26); addFly(streamCx, 190, 3, 26);
    addFly(6, 110, 3, 24); addFly(6, 210, 3, 22);

    const reeds = [
      { anim: "reedsTall", x: L.streamX1 - 7, y: 60 - 15, phase: 0.3 },
      { anim: "reedsShort", x: L.streamX1 - 6, y: 140 - 15, phase: 1.3 },
      { anim: "reedsTall", x: L.streamX1 - 7, y: 220 - 15, phase: 2.1 },
      { anim: "reedsTall", x: 60, y: H - 18, phase: 0.8 },
      { anim: "reedsShort", x: 150, y: H - 17, phase: 1.9 },
      { anim: "reedsTall", x: 206, y: H - 17, phase: 2.7 },
      { anim: "reedsShort", x: 17, y: H - 17, phase: 0.1 },
      { anim: "reedsTall", x: 124, y: H - 17, phase: 1.1 },
      // Short reeds on the far bank at the top, their tips just clearing it.
      { anim: "reedsShort", x: 34, y: L.topBank - 15, phase: 2.3 },
      { anim: "reedsShort", x: 166, y: L.topBank - 15, phase: 0.6 },
    ];

    const pads = [
      { spr: G.SPRITES.lilyPad, x: 84, y: H - 11 },
      { spr: G.SPRITES.lilyPadSmall, x: 101, y: H - 7 },
      { spr: G.SPRITES.lilyPad, x: 164, y: L.riverY0 + 4 },
      { spr: G.SPRITES.lilyPadSmall, x: 40, y: L.riverY0 + 5 },
      // A couple more in the quieter side channels.
      { spr: G.SPRITES.lilyPadSmall, x: 2, y: L.boardY + 60 },
      { spr: G.SPRITES.lilyPadSmall, x: L.streamX0 + 3, y: L.boardY + 132 },
    ];
    const lotus = { x: 86, y: H - 14 };

    /**
     * Flow streaks, one set per channel of the river. `axis` is the direction
     * the water runs; `dir` which way along it. Positions are seeded inside
     * the channel's band and wrap around it.
     */
    function makeStreaks(count, axis, dir, x0, x1, y0, y1, speed) {
      const out = [];
      for (let i = 0; i < count; i++) {
        out.push({
          axis, dir,
          x0, x1, y0, y1,
          across: axis === "h" ? y0 + Math.floor(r() * Math.max(1, y1 - y0)) : x0 + Math.floor(r() * Math.max(1, x1 - x0)),
          along: r(),
          speed: speed * (0.7 + r() * 0.6),
          period: 1.1 + r() * 1.8,
          phase: r(),
          len: 2 + Math.floor(r() * 4),
        });
      }
      return out;
    }
    const currents = [
      // top channel: running right, into the bend
      ...makeStreaks(16, "h", 1, -6, W + 6, L.topWaterY0 + 1, L.boardY - 1, 7),
      // right channel: running down
      ...makeStreaks(14, "v", 1, L.streamX0 + 2, L.streamX1 - 2, -6, L.riverY0 + 6, 9),
      // left channel: running down
      ...makeStreaks(12, "v", 1, 1, L.boardX - 2, -6, L.riverY0 + 6, 8),
      // the wide river below: running left, back out of the scene
      ...makeStreaks(30, "h", -1, -6, W + 6, L.riverY0 + 4, H - FAR_BANK - 2, 6),
    ];
    const foamSpecks = [];
    for (let i = 0; i < 14; i++) foamSpecks.push({ x0: r() * W, row: 1 + (i % 3), speed: 5 + r() * 4, period: 2 + r() * 2, phase: r() });
    // Glints of lantern light twinkling on the water, anywhere it runs.
    const twinkles = [];
    for (let i = 0; i < 12; i++) {
      twinkles.push({ x: 2 + Math.floor(r() * (W - 4)), y: L.topWaterY0 + Math.floor(r() * (H - L.topWaterY0 - FAR_BANK)), period: 2.5 + r() * 3, phase: r() });
    }

    const toro = { x: 3, y: H - 2 - 22, lightX: 9, lightY: H - 2 - 22 + 9 };

    // --- helpers --------------------------------------------------------------
    const isWater = (x, y) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === R_WATER;
    const inKaya = (x, y) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === R_KAYA;
    function waterSet(x, y, c) {
      if (isWater(x, y)) surf.px[y * W + x] = c;
    }
    function animFrame(name, t, phase) {
      const a = ANIMS[name];
      const n = a.frames.length;
      return a.frames[((Math.floor(t * a.fps + (phase || 0) * n) % n) + n) % n];
    }

    function pointToNative(x, y) {
      return { x: L.gridX + x * SPACING, y: L.gridY + y * SPACING };
    }
    /**
     * Native pixel -> nearest intersection. Returns null outside the playing
     * area (more than half a cell beyond the outer lines) unless opts.clamp.
     */
    function nativeToPoint(nx, ny, o) {
      const fx = (nx - L.gridX) / SPACING, fy = (ny - L.gridY) / SPACING;
      let x = Math.round(fx), y = Math.round(fy);
      if (o && o.clamp) {
        return { x: Math.min(size - 1, Math.max(0, x)), y: Math.min(size - 1, Math.max(0, y)) };
      }
      if (fx < -0.5 || fy < -0.5 || fx > size - 0.5 || fy > size - 0.5) return null;
      x = Math.min(size - 1, Math.max(0, x));
      y = Math.min(size - 1, Math.max(0, y));
      return { x, y };
    }

    // --- ambient passes -------------------------------------------------------
    function drawWater(t) {
      for (const st of currents) {
        const life = frac(t / st.period + st.phase);
        const len = Math.round(st.len * Math.sin(Math.PI * life));
        if (len <= 0) continue;
        if (st.axis === "h") {
          const span = st.x1 - st.x0;
          const x = st.x0 + Math.floor(((((st.along * span + st.dir * st.speed * t) % span) + span) % span));
          for (let k = 0; k < len; k++) waterSet(x + k, st.across, S);
        } else {
          const span = st.y1 - st.y0;
          const y = st.y0 + Math.floor(((((st.along * span + st.dir * st.speed * t) % span) + span) % span));
          for (let k = 0; k < len; k++) waterSet(st.across, y + k, S);
        }
      }
    }

    /**
     * Water lapping against one edge of the deck. `deckDelta` points from the
     * first water pixel toward the deck, so the same code does all four sides.
     */
    function foamEdge(t, horizontal, fixed, from, to, deckDelta, speed) {
      const at = (i, off) => (horizontal ? { x: i, y: fixed + off } : { x: fixed + off, y: i });
      for (let i = from; i <= to; i++) {
        const w = Math.sin(i * 0.42 + t * speed) + 0.7 * Math.sin(i * 0.15 - t * 1.1 + 1);
        const p0 = at(i, 0);
        if (w > 1.05) {
          const onDeck = at(i, deckDelta), deeper = at(i, -deckDelta);
          surf.set(onDeck.x, onDeck.y, C);
          waterSet(p0.x, p0.y, C);
          if (G.ditherOn(deeper.x, deeper.y, 0.5)) waterSet(deeper.x, deeper.y, C);
        } else if (w > 0.1) {
          waterSet(p0.x, p0.y, C);
        } else if (w > -0.7 && (i + Math.floor(t * 4)) & 1) {
          waterSet(p0.x, p0.y, C);
        }
      }
    }

    function drawFoam(t) {
      const y0 = L.riverY0;
      // All four sides of the pier, each with its own rhythm.
      foamEdge(t, true, y0, L.boardX, L.boardRight, -1, 2.4); // below, river flowing left
      foamEdge(t, true, L.boardY - 1, L.boardX, L.boardRight - 1, 1, -2.1); // above
      foamEdge(t, false, L.streamX0, L.boardY, L.riverY0 - 1, -1, 3.0); // right channel
      foamEdge(t, false, L.boardX - 1, L.boardY, L.riverY0 - 1, 1, 2.7); // left channel
      // Foam around the deck posts.
      for (const px of [L.boardX + 12, L.boardRight - 15]) {
        const ph = Math.floor(t * 3) & 1;
        waterSet(px - 1, L.frontBottom + 2 + ph, C);
        waterSet(px + 3, L.frontBottom + 2 + (1 - ph), C);
        waterSet(px + 1, L.frontBottom + 3, ph ? C : S);
      }
      // Detached specks drifting away from the deck.
      for (const f of foamSpecks) {
        const life = frac(t / f.period + f.phase);
        if (life > 0.7) continue;
        const span = W + 8;
        const x = Math.floor(((((f.x0 - f.speed * t) % span) + span) % span) - 4);
        const y = y0 + f.row + Math.floor(life * 3);
        waterSet(x, y, life < 0.45 ? C : S);
      }
      // Bank edge ripples on the right bank and stream mouth.
      for (let y = 4; y < L.riverY0 - 3; y += 7) {
        if (((y >> 3) + Math.floor(t * 2)) & 1) waterSet(L.streamX1 - 1, y, S);
      }
      // Twinkling glints: dot, then a small cross, then gone.
      for (const tw of twinkles) {
        const u = frac(t / tw.period + tw.phase);
        if (u < 0.06 || (u >= 0.16 && u < 0.22)) {
          waterSet(tw.x, tw.y, C);
        } else if (u < 0.16) {
          waterSet(tw.x, tw.y, C);
          waterSet(tw.x - 1, tw.y, S); waterSet(tw.x + 1, tw.y, S);
          waterSet(tw.x, tw.y - 1, S); waterSet(tw.x, tw.y + 1, S);
        }
      }
    }

    function floaterPositions(t) {
      const out = [];
      for (let i = 0; i < floaters.length; i++) {
        const fl = floaters[i];
        const s = (fl.offset + t * LANTERN_SPEED) % pathLen;
        const p = lanternPath(s);
        const bob = Math.round(Math.sin(t * 2.1 + fl.phase) * 0.9);
        const sway = p.river ? 0 : Math.round(Math.sin(t * 1.3 + fl.phase) * 0.8);
        out.push({ x: Math.round(p.x) + sway, y: Math.round(p.y + fl.lane * p.river) + bob, i, fl });
      }
      return out.sort((a, b) => a.y - b.y);
    }

    function drawReflection(x, y, t, len, strong) {
      for (let k = 0; k < len; k++) {
        const yy = y + k;
        const wob = Math.round(Math.sin(t * 5 + k * 1.4 + x) * (k > 1 ? 1 : 0));
        const cov = (strong ? 0.95 : 0.8) - k * (0.8 / len);
        if (G.ditherOn(x + wob, yy, cov)) waterSet(x + wob, yy, k < 2 && strong ? C : A);
        if (k < len - 2 && G.ditherOn(x + wob + 1, yy, cov * 0.6)) waterSet(x + wob + 1, yy, A);
        if (k < len - 2 && G.ditherOn(x + wob - 1, yy, cov * 0.6)) waterSet(x + wob - 1, yy, A);
      }
    }

    function fireflyState(ff, t) {
      const x = Math.round(ff.cx + ff.ax * Math.sin(t * ff.fx + ff.p1));
      const y = Math.round(ff.cy + ff.ay * Math.sin(t * ff.fy + ff.p2));
      const u = frac(t / ff.period + ff.phase);
      let frame = -1;
      if (u < 0.3) frame = -1;
      else if (u < 0.55) frame = 0;
      else if (u < 0.62) frame = 1;
      else if (u < 0.8) frame = 2;
      else if (u < 0.88) frame = 1;
      else frame = 3;
      return { x, y, frame };
    }

    // --- board passes ---------------------------------------------------------
    function drawLabels(hover) {
      const f = G.FONT_SMALL;
      for (let i = 0; i < size; i++) {
        const label = String(i);
        const w = G.textWidth(f, label);
        if (!(hover && hover.x === i)) {
          G.drawText(surf, f, label, L.gridX + i * SPACING - (w >> 1), L.boardY + FRAME - LABEL_GAP - 5, A);
        }
        if (!(hover && hover.y === i)) {
          G.drawText(surf, f, label, L.kayaX - LABEL_GAP - w, L.gridY + i * SPACING - 2, A);
        }
      }
    }

    function drawHighlightTag(text, cx, cy, pointer) {
      const f = G.FONT_BIG;
      const tw = G.textWidth(f, text);
      const w = tw + 3, h = f.height + 3;
      const x0 = cx - (w >> 1), y0 = cy - (h >> 1);
      surf.rect(x0, y0, w, h, C);
      // round the corners with ink so the tag reads as a paper slip
      surf.set(x0, y0, K); surf.set(x0 + w - 1, y0, K); surf.set(x0, y0 + h - 1, K); surf.set(x0 + w - 1, y0 + h - 1, K);
      G.drawText(surf, f, text, x0 + 2, y0 + 2, K);
      if (pointer === "down") {
        surf.set(cx - 1, y0 + h, C); surf.set(cx, y0 + h, C); surf.set(cx + 1, y0 + h, C);
        surf.set(cx, y0 + h + 1, C);
      } else if (pointer === "right") {
        surf.set(x0 + w, cy - 1, C); surf.set(x0 + w, cy, C); surf.set(x0 + w, cy + 1, C);
        surf.set(x0 + w + 1, cy, C);
      }
    }

    /**
     * Every stone in its own look -- except in a storm (`grey` 0..1), when the
     * rain and dark take the colour out of them all: each player stone fades to
     * the same slate grey, so nobody can tell whose is whose. The server plays on
     * the real colours, so captures and suicide work as ever; the players must
     * remember what they cannot see. Driftwood keeps its own look.
     */
    function drawStones(board, skip, grey) {
      // Shadows first so they never cover a neighbour.
      for (let i = 0; i < board.length; i++) {
        const code = board[i];
        if (!code || skip.has(i)) continue;
        const p = pointToNative(i % size, (i / size) | 0);
        blitShadow(surf, code, "normal", p.x + 1, p.y + 1, grey);
      }
      for (let i = 0; i < board.length; i++) {
        const code = board[i];
        if (!code || skip.has(i)) continue;
        const p = pointToNative(i % size, (i / size) | 0);
        blitPiece(surf, code, "normal", p.x, p.y, grey);
      }
    }

    /**
     * Lily pads (under stones) on empty cells, each showing its owner's split
     * stone (base | other front) -- except while the storm greys the board
     * (`hideOwners`): no owner marks then, so nobody is told whose grey stones are whose.
     */
    function drawLilyPads(overlays, board, busy, hideOwners) {
      for (const o of overlays) {
        if (o.kind !== "lily") continue;
        const i = o.y * size + o.x;
        if (board[i] || busy.has("lily:" + i)) continue;
        const p = pointToNative(o.x, o.y);
        surf.blitCentered(G.SPRITES.lilyBoard, p.x, p.y + 1);
        if (o.owner && !hideOwners) surf.blitCentered(G.splitPreviewSprite(o.owner, "icon"), p.x, p.y + 1);
      }
    }

    /**
     * Seedlings sprout on empty points. A mist puffs over the stone it hides: the
     * others see only the cloud (main.js takes the stone out of what it hands
     * over), its owner sees their stone through a thinner one.
     */
    function drawSeeds(overlays, board, busy, hideOwners) {
      for (const o of overlays) {
        if (o.kind !== "seed") continue;
        const i = o.y * size + o.x;
        if (board[i]) continue;
        const p = pointToNative(o.x, o.y);
        surf.blitCentered(G.SPRITES.seedBoard, p.x, p.y);
        // The stone it will grow into: the solid one, or the gray/transparent one for a right-click seed.
        const mark = o.owner && !hideOwners && G.stoneSprite(o.axis === "pattern" ? G.patternCode(o.owner) : o.owner, "mini");
        if (mark) blitHaloed(mark, p.x - 7, p.y - 7);
      }
    }
    /** A fog is a cloud over every point it covers; the stones under it are taken out by main.js. */
    function drawFogs(overlays) {
      for (const o of overlays) {
        if (o.kind !== "fog") continue;
        const p = pointToNative(o.x, o.y);
        // A grey wash over the whole square of the board that belongs to this point, then the cloud.
        const half = SPACING >> 1;
        for (let dy = -half; dy < half; dy++) {
          for (let dx = -half; dx < half; dx++) {
            if (inKaya(p.x + dx, p.y + dy) && G.ditherOn(p.x + dx, p.y + dy, 0.4)) surf.set(p.x + dx, p.y + dy, S);
          }
        }
        surf.blitCentered(G.SPRITES.mistPuff, p.x, p.y, { coverage: 0.7 });
      }
    }
    function drawMists(overlays, myColor) {
      for (const o of overlays) {
        if (o.kind !== "mist") continue;
        const p = pointToNative(o.x, o.y);
        surf.blitCentered(G.SPRITES.mistPuff, p.x, p.y, o.owner === myColor ? { coverage: 0.45 } : undefined);
      }
    }

    // --- timers and owner markers ------------------------------------------------
    /** Rounds an effect has left: 3, 2, 1. A 1 means it ends within the next round. */
    function roundsLeft(o, turnCount, roundLength) {
      if (o.until === undefined || turnCount === undefined || !(roundLength > 0)) return 0;
      return Math.max(0, Math.ceil((o.until - turnCount) / roundLength));
    }

    /** A small ink tag on the upper right of a point, showing the rounds left (amber on the last one). */
    function drawTimerTag(cx, cy, rounds) {
      if (rounds <= 0) return;
      const font = G.FONT_SMALL, text = String(rounds), w = G.textWidth(font, text) + 2;
      const x0 = cx + 9 - w, y0 = cy - 10;
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < w; x++) {
          if ((x === 0 || x === w - 1) && (y === 0 || y === 6)) continue; // round the corners
          surf.set(x0 + x, y0 + y, K);
        }
      }
      G.drawText(surf, font, text, x0 + 1, y0 + 1, rounds === 1 ? A : C);
    }

    /** A sprite ringed in cream, so a black stone under it can't swallow it. */
    function blitHaloed(spr, cx, cy) {
      const x0 = cx - ((spr.w - 1) >> 1), y0 = cy - ((spr.h - 1) >> 1);
      const opaque = (x, y) => x >= 0 && y >= 0 && x < spr.w && y < spr.h && spr.px[y * spr.w + x] !== G.TRANSPARENT;
      for (let y = -1; y <= spr.h; y++) {
        for (let x = -1; x <= spr.w; x++) {
          if (opaque(x, y)) continue;
          let near = false;
          for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (opaque(x + dx, y + dy)) { near = true; break; }
          if (near) surf.set(x0 + x, y0 + y, C);
        }
      }
      surf.blit(spr, x0, y0);
    }

    /**
     * Everything timed on the board shows how long it has left, and whatever
     * belongs to a player carries that player's mark (their two stones side by
     * side, on the upper left of the point). Lily pads and wards are owned;
     * driftwood and fires are nobody's. A ward covers a whole group, one
     * overlay per stone, so only its first stone carries the mark and the tag.
     * (The lily pad's mark is the split stone drawn on the pad itself.) While
     * the storm greys the board (`hideOwners`) only the timers are left.
     */
    function drawTimers(overlays, board, busy, turnCount, roundLength, pendingFires, myColor, hideOwners) {
      const wardAnchor = new Map();
      for (const o of overlays) {
        if (o.kind !== "ward") continue;
        const i = o.y * size + o.x;
        if (!board[i] || busy.has("ward:" + i)) continue;
        const first = wardAnchor.get(o.owner);
        if (!first || i < first.y * size + first.x) wardAnchor.set(o.owner, o);
      }
      for (const o of wardAnchor.values()) {
        const p = pointToNative(o.x, o.y);
        if (o.owner && !hideOwners) blitHaloed(G.splitPreviewSprite(o.owner, "mini"), p.x - 7, p.y - 7);
        drawTimerTag(p.x, p.y, roundsLeft(o, turnCount, roundLength));
      }
      const fogs = new Map();
      for (const o of overlays) {
        if (o.kind !== "fog") continue;
        const key = o.owner + ":" + o.until;
        if (!fogs.has(key)) fogs.set(key, []);
        fogs.get(key).push(o);
      }
      for (const cells of fogs.values()) {
        // A fog is a 3x3 square clipped by the board: its tag sits on the point nearest the middle.
        const mx = cells.reduce((a, c) => a + c.x, 0) / cells.length;
        const my = cells.reduce((a, c) => a + c.y, 0) / cells.length;
        const mid = cells.reduce((best, c) => (Math.hypot(c.x - mx, c.y - my) < Math.hypot(best.x - mx, best.y - my) ? c : best));
        const p = pointToNative(mid.x, mid.y);
        drawTimerTag(p.x, p.y, roundsLeft(mid, turnCount, roundLength));
      }
      for (const o of overlays) {
        if (o.kind !== "lily" && o.kind !== "drift" && o.kind !== "fire" && o.kind !== "seed" && o.kind !== "mist") continue;
        const i = o.y * size + o.x;
        if (o.kind === "seed" && board[i]) continue;
        if (o.kind === "mist" && o.owner !== myColor) continue; // the others shouldn't be told whose it is
        if (o.kind === "lily" && (board[i] || busy.has("lily:" + i))) continue;
        if (o.kind === "drift" && (board[i] !== G.DRIFTWOOD || busy.has("drop:" + i) || busy.has("driftAway:" + i))) continue;
        if (o.kind === "fire" && (busy.has("burnAway:" + i) || pendingFires.has(i))) continue;
        const p = pointToNative(o.x, o.y);
        drawTimerTag(p.x, p.y, roundsLeft(o, turnCount, roundLength));
      }
    }

    // --- the turn boat ---------------------------------------------------------------
    // A little boat drifting up and down the wide river, carrying the round number
    // on a signboard. It is scenery with one job: it moves on its own clock, not
    // the game's, and only the number on its sign follows the play. It is there
    // for orientation, like a clock on the wall.
    const BOAT_X0 = 34, BOAT_X1 = W - 34, BOAT_SPEED = 3.5; // px per second
    const BOAT_WATERLINE = L.riverY0 + 21; // the hull's bottom row
    // The firefly boat is the same craft going the other way: slower, lower in the
    // water, with a dark sign and the firefly icon, so the two never read as one.
    const FIREBOAT = { speed: 2.2, dir: -1, phase: 0.37, waterline: L.riverY0 + 27, bob: 1.3, sign: C, edge: K, text: K, icon: true };
    function drawBoat(t, label, opts) {
      const o = opts || { speed: BOAT_SPEED, dir: 1, phase: 0, waterline: BOAT_WATERLINE, bob: 0.9, sign: C, edge: K, text: K };
      const span = BOAT_X1 - BOAT_X0;
      const u = frac(o.phase + o.dir * ((t * o.speed) / (2 * span)));
      const leg = u < 0.5 ? u * 2 : 2 - u * 2; // there and back
      const cx = Math.round(BOAT_X0 + (0.5 - 0.5 * Math.cos(Math.PI * leg)) * span); // slowing at each turn
      const wl = o.waterline + Math.round(Math.sin(t * 1.6 + o.phase * 9) * o.bob);
      const hull = G.SPRITES.boatHull;
      const hullTop = wl - hull.h + 1;
      const ripple = Math.floor(t * 2) & 1;
      for (const side of [-1, 1]) {
        waterSet(cx + side * (hull.w >> 1) + side * (1 + ripple), wl, S);
        waterSet(cx + side * ((hull.w >> 1) + 3 - ripple), wl + 1, C);
      }
      surf.blit(hull, cx - (hull.w >> 1), hullTop);

      const icon = o.icon ? G.SPRITES.fireflyIcon : null;
      const iconW = icon ? icon.w + 2 : 0;
      const sw = G.textWidth(G.FONT_BIG, label) + iconW + 4, sh = Math.max(10, icon ? icon.h + 4 : 0);
      const mastTop = hullTop - 4;
      for (let y = mastTop; y < hullTop; y++) surf.set(cx, y, K);
      const sx = cx - (sw >> 1), sy = mastTop - sh;
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const edge = x === 0 || y === 0 || x === sw - 1 || y === sh - 1;
          surf.set(sx + x, sy + y, edge ? o.edge : o.sign);
        }
      }
      if (icon) surf.blit(icon, sx + 2, sy + ((sh - icon.h) >> 1));
      G.drawText(surf, G.FONT_BIG, label, sx + 2 + iconW, sy + ((sh - G.FONT_BIG.height) >> 1), o.text);
    }

    /** "PASS" at triple size on an ink plate in the middle of the board; holds, then dithers away. */
    const PASS_HOLD = 1.6, PASS_FADE = 0.7;
    function drawPassSign(age) {
      if (age < 0 || age > PASS_HOLD + PASS_FADE) return;
      const fade = age > PASS_HOLD ? (age - PASS_HOLD) / PASS_FADE : 0;
      const label = "PASS", scale = 3, font = G.FONT_BIG;
      const tw = G.textWidth(font, label) * scale, th = font.height * scale;
      const pw = tw + 10, ph = th + 6;
      const px0 = L.boardX + ((L.boardW - pw) >> 1), py0 = L.boardY + ((L.boardH - ph) >> 1);
      const on = (x, y) => fade === 0 || G.ditherOn(x, y, 1 - fade);
      for (let y = 0; y < ph; y++) {
        for (let x = 0; x < pw; x++) {
          const edge = x === 0 || y === 0 || x === pw - 1 || y === ph - 1;
          if (on(px0 + x, py0 + y)) surf.set(px0 + x, py0 + y, edge ? A : K);
        }
      }
      let cx = px0 + 5;
      for (const ch of label) {
        const g = font.glyphs[ch];
        for (let y = 0; y < g.h * scale; y++) {
          for (let x = 0; x < g.w * scale; x++) {
            if (g.bits[((y / scale) | 0) * g.w + ((x / scale) | 0)] && on(cx + x, py0 + 3 + y)) surf.set(cx + x, py0 + 3 + y, C);
          }
        }
        cx += (g.w + font.spacing) * scale;
      }
    }

    /**
     * Lightning fires: a flame on every burning point (guttering down to
     * embers in its last round), drawn over whatever stands there. A fire
     * whose bolt hasn't landed yet in the storm animation is held back, so
     * the flame never beats the lightning to the board.
     */
    function drawFires(overlays, busy, time, reduced, turnCount, roundLength, pending) {
      for (const o of overlays) {
        if (o.kind !== "fire") continue;
        const i = o.y * size + o.x;
        if (busy.has("burnAway:" + i) || pending.has(i)) continue;
        const p = pointToNative(o.x, o.y);
        // One round left: the fire has eaten what it can and is dying down.
        const lastRound =
          o.until !== undefined && turnCount !== undefined && roundLength > 0 && o.until - turnCount <= roundLength;
        const phase = (o.x * 7 + o.y * 3) / 16;
        const t = reduced ? 0 : time;
        // A bed of embers first: it is what marks the point as unplayable,
        // and it reads on the bare amber board as well as in the dark.
        drawEmberBed(p.x, p.y, t + phase, lastRound);
        surf.blitCentered(animFrame(lastRound ? "flameLow" : "flame", t, phase), p.x, p.y - (lastRound ? 1 : 3));
        if (!lastRound) {
          // A second, smaller tongue, out of step with the first.
          surf.blitCentered(animFrame("flameLow", t, phase + 0.5), p.x + 4, p.y + 1);
        }
      }
    }

    /** Scorched ground with embers glowing through it, under a fire. */
    function drawEmberBed(cx, cy, t, low) {
      const rx = low ? 5 : 7, ry = low ? 3 : 4;
      for (let dy = -ry; dy <= ry; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
          const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
          if (d > 1) continue;
          const x = cx + dx, y = cy + dy;
          if (G.ditherOn(x, y, 0.75 - d * 0.35)) surf.set(x, y, K);
        }
      }
      // Embers breathing in the ash.
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3 + t * 1.6;
        const x = cx + Math.round(Math.cos(a) * (rx - 2));
        const y = cy + 1 + Math.round(Math.sin(a * 1.7) * (ry - 2));
        const hot = Math.sin(t * 3 + k * 2) > 0.2;
        surf.set(x, y, hot ? A : K);
        if (hot && k === 0) surf.set(x, y - 1, C);
      }
    }

    /** Lantern Ward: a turning ring of light and a hanging lantern on each warded stone. */
    function drawWards(overlays, board, busy, time, reduced) {
      const ring = animFrame("wardRing", reduced ? 0 : time);
      const lantern = animFrame("wardLantern", reduced ? 0 : time);
      const bob = reduced ? 0 : Math.round(Math.sin(time * 2.4) * 0.8);
      for (const o of overlays) {
        if (o.kind !== "ward") continue;
        const i = o.y * size + o.x;
        if (!board[i] || busy.has("ward:" + i)) continue;
        const p = pointToNative(o.x, o.y);
        surf.blitCentered(ring, p.x, p.y);
        surf.blitCentered(lantern, p.x + WARD_LANTERN_DX, p.y + WARD_LANTERN_DY + bob);
      }
    }

    // --- main render ------------------------------------------------------------
    /**
     * state = {
     *   time:          seconds (drives effects and the hover bob),
     *   ambientTime:   seconds for ambient loops (defaults to time; freeze it for reduced motion),
     *   board:         flat array of codes, length size*size (row-major, y * size + x),
     *   hover:         {x, y} | null,
     *   hoverKind:     "stone" (split preview) | "target" (powerup reticle) | "none" (labels only),
     *   myColor:       1..4, the viewing player (for the split preview),
     *   lastMove:      {x, y} | null,
     *   effects:       [placeEffect(...) | captureEffect(...) | makeEffect(kind, ...)],
     *   overlays:      [{kind: "lily" | "ward" | "drift" | "fire" | "seed" | "mist" | "fog", x, y, owner, until}] -- timed board
     *                  pieces; each shows its rounds left, and owned ones carry their owner's mark,
     *   round:         the number on the boat's signboard: the round being played (scenery: it drifts on its own clock),
     *   passFlash:     time (seconds) a pass happened, to show the PASS sign (omit for none),
     *   fireflies:     the viewing player's firefly count, on a second boat (omit for none),
     *   turnCount:     the room's turn counter (lets a fire show its last round, and every timer its rounds),
     *   roundLength:   players in the room (how many turns make one round),
     *   storm:         {start: seconds, seq, strikes: [{x, y}, ...]} while a storm plays,
     *   stormUntil:    turnCount when the storm's fires go out; while turnCount is below
     *                  this, a weak copy of the storm's weather lingers over the scene (see
     *                  stormLinger) -- for the full 3 rounds, not just the ~10s cloudburst,
     *   stormTurnCount: the turn counter the storm is judged by (defaults to turnCount); the live
     *                  one while an older board is recalled, so a storm on now greys the old boards too,
     *   reducedMotion: boolean,
     * }
     * Returns the RGBA buffer (Uint8ClampedArray, width*height*4).
     */
    function render(state) {
      const st = state || {};
      const time = st.time || 0;
      const reduced = !!st.reducedMotion;
      const ambientRaw = st.ambientTime === undefined ? (reduced ? 0 : time) : st.ambientTime;
      const t = Math.floor(ambientRaw * AMBIENT_FPS) / AMBIENT_FPS;
      const board = st.board || [];
      const effects = st.effects || [];

      // The storm's weights, worked out first: the weather decides which lights
      // shine (fireflies sit it out) and the grey what the stones show.
      // Two layers of weather (see the Thunderstorm notes above): the ~10 s
      // cloudburst (`storm`, introW) over the whole scene, playing surface
      // included, and behind it a weak copy for the storm's full three rounds
      // (lingerW, from GoState.storm.until) that leaves the playing surface alone.
      const storm = st.storm
        ? stormPhase(time - st.storm.start, (st.storm.strikes || []).length, reduced)
        : null;
      const linger = stormLinger(
        st.stormTurnCount === undefined ? st.turnCount : st.stormTurnCount, st.stormUntil, st.roundLength || 0
      );
      const introW = storm ? storm.weight : 0;
      const lingerW = linger * STORM_LINGER;
      const outsideW = Math.max(introW, lingerW); // over water, banks and the frame
      const boardW = Math.max(introW, lingerW * STORM_BOARD_SHARE); // over the playing surface
      const weather = outsideW > 0;
      // The storm greys every stone for its full three rounds: it comes in with
      // the cloudburst and eases out through the last round (stormLinger).
      const stormElapsed = st.storm ? time - st.storm.start : STORM_DARK_IN;
      const greyW = Math.min(1, linger, stormElapsed / STORM_DARK_IN);
      const hideOwners = greyW > 0;

      surf.copyFrom(base.surface);

      // 1. water life
      drawWater(t);
      for (const p of pads) surf.blit(p.spr, p.x, p.y);
      surf.blit(G.SPRITES.lotus, lotus.x, lotus.y);
      drawFoam(t);

      // 2. light sources (applied before the sprites that emit them)
      const floats = floaterPositions(t);
      const lights = [];
      const toroFrame = Math.floor(t * ANIMS.toro.fps) % ANIMS.toro.frames.length;
      lights.push({ x: toro.lightX, y: toro.lightY, r: 17 + (toroFrame === 1 ? 2 : 0), s: 0.6 });
      for (const fl of floats) lights.push({ x: fl.x, y: fl.y - 2, r: 9, s: 0.55 });
      garland.forEach((g) => lights.push({ x: g.x, y: 5, r: 7, s: 0.45 }));
      const flies = fireflies.map((ff) => fireflyState(ff, t));
      if (!weather) for (const ff of flies) if (ff.frame === 2) lights.push({ x: ff.x, y: ff.y, r: 3.5, s: 0.7 });
      for (const lt of lights) surf.ramp(G.LIGHT, lt.x, lt.y, lt.r, lt.s, 1, noLight);

      // 3. floating lanterns + reflections
      for (const fl of floats) {
        drawReflection(fl.x, fl.y + 3, t, 7, false);
        surf.blitCentered(animFrame("floatLantern", t, fl.fl.phase / 6.28), fl.x, fl.y);
      }

      // 3b. the turn boat, drifting on its own clock (only its sign follows play)
      drawBoat(t, "R" + (st.round === undefined ? 1 : st.round));
      if (st.fireflies !== undefined) drawBoat(t, String(st.fireflies), FIREBOAT);

      // 4. props: reeds, stone lantern, garland
      for (const rd of reeds) surf.blit(animFrame(rd.anim, t, rd.phase / 3), rd.x, rd.y);
      surf.blit(G.SPRITES.rock, toro.x - 1, H - 5);
      surf.blit(ANIMS.toro.frames[toroFrame], toro.x, toro.y);
      drawGarland(t);

      // 5. board labels (the hovered row/column label is drawn later as a tag)
      const hover = st.hover && st.hover.x >= 0 && st.hover.y >= 0 && st.hover.x < size && st.hover.y < size ? st.hover : null;
      drawLabels(hover);

      // 6. lily pads, stones and wards (effects in flight draw their own piece/marker)
      const skip = new Set();
      const busy = new Set();
      const active = [];
      for (const e of effects) {
        const el = time - e.start;
        if (!frameAt(timelineFor(e.kind, reduced), el)) continue;
        active.push(e);
        if (OWNS_CELL.has(e.kind)) skip.add(e.y * size + e.x);
        busy.add(e.kind + ":" + (e.y * size + e.x));
      }
      const overlays = st.overlays || [];
      // A storm in flight: its bolts haven't all landed, so hold back the
      // fires that belong to bolts still on their way.
      const pendingFires = new Set();
      if (storm) {
        (st.storm.strikes || []).forEach((s, i) => {
          if (!storm.landed[i]) pendingFires.add(s.y * size + s.x);
        });
      }
      drawLilyPads(overlays, board, busy, hideOwners);
      drawSeeds(overlays, board, busy, hideOwners);
      drawStones(board, skip, greyW);
      drawWards(overlays, board, busy, time, reduced);
      drawMists(overlays, st.myColor);
      drawFogs(overlays);

      // 7. last-move ember
      if (st.lastMove && !skip.has(st.lastMove.y * size + st.lastMove.x) && board[st.lastMove.y * size + st.lastMove.x]) {
        const p = pointToNative(st.lastMove.x, st.lastMove.y);
        surf.blitCentered(animFrame("ember", reduced ? 0 : time), p.x, p.y);
      }

      // 8. effects in flight
      for (const e of active) {
        const p = pointToNative(e.x, e.y);
        const glow = drawEffect(surf, e, time - e.start, p.x, p.y, reduced, greyW);
        if (glow) surf.ramp(G.LIGHT, glow.x, glow.y, glow.r, 0.6, 1, noLight);
      }

      // 8b. weather: dusk, cloud cover and rain (both layers, weighed at the
      // top), then the bolts themselves. Both sit under the hover UI, so you
      // can still see where you are about to play.
      if (weather) {
        const darkOut = STORM_DARKNESS * outsideW;
        const darkIn = STORM_DARKNESS * boardW;
        for (let i = 0; i < surf.px.length; i++) {
          const d = region[i] === R_KAYA ? darkIn : darkOut;
          if (d > 0 && G.ditherOn(i % W, (i / W) | 0, d)) surf.px[i] = G.SHADE[surf.px[i]];
        }
        if (!reduced) {
          const offBoard = (x, y) => !inKaya(x, y);
          drawClouds(surf, W, H, ambientRaw, outsideW, offBoard);
          drawRain(surf, W, H, time, outsideW, offBoard);
          if (boardW > 0) {
            drawClouds(surf, W, H, ambientRaw, boardW, inKaya);
            drawRain(surf, W, H, time, boardW, inKaya);
          }
        }
      }
      if (storm) {
        (st.storm.strikes || []).forEach((s, i) => {
          const u = storm.bolts[i];
          if (u < 0) return;
          const p = pointToNative(s.x, s.y);
          // The whole sky lights up for the first instant of each bolt.
          if (u < 0.12) {
            // Two passes of the light ramp take ink all the way to cream, so
            // the sky blows out white rather than merely turning warm.
            const passes = u < 0.06 ? 2 : 1;
            for (let n = 0; n < passes; n++) {
              for (let k = 0; k < surf.px.length; k++) {
                if (G.ditherOn(k % W, (k / W) | 0, n === 0 ? 1 : 0.75)) surf.px[k] = G.LIGHT[surf.px[k]];
              }
            }
          }
          drawBolt(surf, p.x, p.y, i + st.storm.seq * 7, u);
          if (u < 0.35) {
            surf.blitCentered(G.STONES.glow[u < 0.15 ? "big" : "normal"], p.x, p.y);
            surf.ramp(G.LIGHT, p.x, p.y, 16 * (1 - u), 0.8, 1, null);
          } else {
            drawSparkRing(surf, p.x, p.y, 8, Math.min(2, Math.floor((u - 0.35) * 8)));
          }
        });
      }

      // 8c. fires burn on top of the weather: they are the one thing the
      // storm doesn't dim, and they keep burning long after it has passed.
      drawFires(overlays, busy, time, reduced, st.turnCount, st.roundLength || 0, pendingFires);
      drawTimers(overlays, board, busy, st.turnCount, st.roundLength || 0, pendingFires, st.myColor, hideOwners);

      // 8d. a pass: a quick PASS sign over the board that fades out
      if (st.passFlash !== undefined) drawPassSign(time - st.passFlash);

      // 8e. an item armed that needs one of your own stones (Lantern Ward, Turn
      // the Lantern, Ferry, Skiff before its first target): the last-move ember,
      // enlarged, in the centre of every stone of yours on the board, so you
      // don't have to work out which ones are yours by memory. main.js decides
      // which points qualify (none while the storm greys the board); this just draws them.
      if (st.highlightMine) {
        const ember = animFrame("emberBig", reduced ? 0 : time);
        for (const i of st.highlightMine) {
          if (!board[i]) continue; // hidden under a fog, or no longer there
          const p = pointToNative(i % size, (i / size) | 0);
          surf.blitCentered(ember, p.x, p.y);
        }
      }

      // 9. hover: split preview or powerup reticle, then the highlighted labels
      if (hover) {
        const p = pointToNative(hover.x, hover.y);
        const kind = st.hoverKind || "none";
        const occupied = !!board[hover.y * size + hover.x];
        if (kind === "stone" && !occupied && st.myColor) {
          const spr = G.splitPreviewSprite(st.myColor);
          const bob = reduced ? 0 : Math.round(Math.sin(time * 3.2) * 1);
          const lift = 2 + bob;
          surf.blitCentered(spr, p.x + 1, p.y + 1, { color: K, coverage: 0.5 });
          const pulse = !reduced && Math.sin(time * 3.2) > 0.55;
          surf.blitCentered(spr, p.x, p.y - lift);
          if (pulse) outlineGlow(spr, p.x, p.y - lift);
        } else if (kind === "target") {
          surf.blitCentered(animFrame("reticle", reduced ? 0 : time), p.x, p.y);
        }
        drawHighlightTag(String(hover.x), L.gridX + hover.x * SPACING, L.boardY + FRAME - LABEL_GAP - 3, "down");
        drawHighlightTag(String(hover.y), L.kayaX - LABEL_GAP - 4, L.gridY + hover.y * SPACING, "right");
      }

      // 10. fireflies (never over the playing surface; they sit the storm out)
      if (!weather) {
        for (const ff of flies) {
          if (ff.frame < 0 || inKaya(ff.x, ff.y)) continue;
          surf.blitCentered(ANIMS.firefly.frames[ff.frame], ff.x, ff.y);
        }
      }

      return surf.toRGBA(rgba);
    }

    /** A colour rim traced around a sprite's outline (cream by default: the hover pulse). */
    function outlineGlow(spr, cx, cy, color = C) {
      const x0 = cx - ((spr.w - 1) >> 1), y0 = cy - ((spr.h - 1) >> 1);
      for (let y = 0; y < spr.h; y++) {
        for (let x = 0; x < spr.w; x++) {
          const v = spr.px[y * spr.w + x];
          if (v === G.TRANSPARENT) continue;
          const edge =
            x === 0 || y === 0 || x === spr.w - 1 || y === spr.h - 1 ||
            spr.px[y * spr.w + x - 1] === G.TRANSPARENT || spr.px[y * spr.w + x + 1] === G.TRANSPARENT ||
            spr.px[(y - 1) * spr.w + x] === G.TRANSPARENT || spr.px[(y + 1) * spr.w + x] === G.TRANSPARENT;
          if (edge) surf.set(x0 + x, y0 + y, color);
        }
      }
    }

    function drawGarland(t) {
      const ropeEnd = W - 5;
      // post on the far bank, at the right end of the rope
      for (let y = 0; y < L.topBank - 1; y++) { surf.set(ropeEnd, y, K); surf.set(ropeEnd + 1, y, S); surf.set(ropeEnd + 2, y, K); }
      surf.set(ropeEnd + 1, 0, C);
      // rope sagging between hooks
      const hooks = [-10].concat(garland.map((g) => g.x), [ropeEnd]);
      for (let h = 0; h < hooks.length - 1; h++) {
        const a = hooks[h], b = hooks[h + 1];
        for (let x = a; x <= b; x++) {
          const u = (x - a) / (b - a);
          surf.set(x, 1 + Math.round(2.6 * 4 * u * (1 - u)), S);
        }
      }
      garland.forEach((g) => {
        const sway = Math.round(Math.sin(t * 1.4 + g.phase) * 0.8);
        const spr = animFrame(g.cream ? "garlandCream" : "garlandAmber", t, g.phase / 6.28);
        surf.blit(spr, g.x - 3 + sway, 1);
        surf.set(g.x, 1, K);
      });
    }

    return {
      layout: L,
      width: W,
      height: H,
      surface: surf,
      rgba,
      render,
      pointToNative,
      nativeToPoint,
      /** Region code at a native pixel: 0 bank, 1 water, 2 frame, 3 kaya, 4 deck front. */
      regionAt: (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? region[(y | 0) * W + (x | 0)] : -1),
    };
  }

  return {
    SPACING,
    AMBIENT_FPS,
    STORM_SECONDS,
    boltTime,
    stormPhase,
    stormLinger,
    REGION: { BANK: R_BANK, WATER: R_WATER, FRAME: R_FRAME, KAYA: R_KAYA, FRONT: R_FRONT },
    computeLayout,
    createScene,
    starPoints,
    placeEffect,
    captureEffect,
    makeEffect,
    EFFECT_KINDS: Object.keys(TIMELINES),
    effectDuration,
    effectDone,
    pruneEffects,
    diffBoards,
    diffTurn,
    drawEffect,
    timelineFor,
    PLACE_TIMELINE,
    CAPTURE_TIMELINE,
  };
});
