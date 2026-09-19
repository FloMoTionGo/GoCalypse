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
  const FRAME = 9; // dark lacquer frame band around the kaya (holds the labels)
  const KAYA_MARGIN = 8; // kaya between the outer grid line and the frame
  const FRONT = 5; // visible front face of the deck
  const TOP = 16; // bank strip above the board (lantern garland)
  const LEFT = 1; // bank sliver left of the board
  const STREAM = 11; // side stream right of the board
  const RIGHT_BANK = 2;
  const RIVER = 32; // river below the board (incl. the far bank strip)
  const FAR_BANK = 4; // near-camera bank at the very bottom
  const AMBIENT_FPS = 10;

  // Region codes for the static layer.
  const R_BANK = 0, R_WATER = 1, R_FRAME = 2, R_KAYA = 3, R_FRONT = 4;

  function computeLayout(size) {
    const grid = (size - 1) * SPACING;
    const kaya = grid + 2 * KAYA_MARGIN;
    const board = kaya + 2 * FRAME;
    const boardX = LEFT, boardY = TOP;
    const kayaX = boardX + FRAME, kayaY = boardY + FRAME;
    const gridX = kayaX + KAYA_MARGIN, gridY = kayaY + KAYA_MARGIN;
    const boardRight = boardX + board; // exclusive
    const boardBottom = boardY + board; // exclusive (top surface of the deck)
    const frontBottom = boardBottom + FRONT;
    const streamX0 = boardRight, streamX1 = streamX0 + STREAM;
    const width = streamX1 + RIGHT_BANK;
    const riverY0 = frontBottom;
    const height = riverY0 + RIVER;
    return {
      size, spacing: SPACING, frame: FRAME, kayaMargin: KAYA_MARGIN,
      width, height,
      boardX, boardY, boardW: board, boardH: board, boardRight, boardBottom, frontBottom,
      kayaX, kayaY, kayaW: kaya, kayaH: kaya,
      gridX, gridY, gridSpan: grid,
      streamX0, streamX1, riverY0,
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

    // Regions.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let r = R_BANK;
        const bankTop = H - FAR_BANK + Math.round(Math.sin(x * 0.09 + 1) * 1.2 + Math.sin(x * 0.23) * 0.6);
        if (y >= L.riverY0) r = y < bankTop ? R_WATER : R_BANK;
        else if (x >= L.streamX0 && x < L.streamX1) r = R_WATER;
        else if (x >= L.streamX1 && y >= L.riverY0 - 3 && x - L.streamX1 + (y - (L.riverY0 - 3)) >= 1) r = R_WATER; // rounded bank corner
        if (x >= L.boardX && x < L.boardRight && y >= L.boardY && y < L.boardBottom) {
          const inKaya = x >= L.kayaX && x < L.kayaX + L.kayaW && y >= L.kayaY && y < L.kayaY + L.kayaH;
          r = inKaya ? R_KAYA : R_FRAME;
        } else if (x >= L.boardX && x < L.boardRight && y >= L.boardBottom && y < L.frontBottom) {
          r = R_FRONT;
        }
        region[y * W + x] = r;
      }
    }

    // Bank: night grass -- ink ground, teal tufts in a band along the deck,
    // a few pebbles and tiny flowers. Kept sparse so it stays calm.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (region[y * W + x] !== R_BANK) continue;
        // a soft teal "lawn" band right above the deck (1/8 then 1/4 dither)
        let c = K;
        const toDeck = L.boardY - 1 - y;
        if (y < L.boardY && toDeck < 2 && G.ditherOn(x, y, 0.25)) c = T;
        else if (y < L.boardY && toDeck < 4 && G.ditherOn(x, y, 0.125)) c = T;
        s.px[y * W + x] = c;
      }
    }
    const rb = rng(1234);
    for (let x = 2 + Math.floor(rb() * 6); x < L.streamX0 - 8; x += 7 + Math.floor(rb() * 9)) {
      const y = L.boardY - 3 - Math.floor(rb() * 2);
      s.blit(rb() < 0.55 ? G.SPRITES.grassTuft : G.SPRITES.grassTuftSmall, x, y);
    }
    for (let i = 0; i < 4; i++) s.blit(G.SPRITES.flower, 20 + i * 52 + Math.floor(rb() * 20), L.boardY - 5 + Math.floor(rb() * 2));
    for (let i = 0; i < 4; i++) s.blit(G.SPRITES.pebble, 44 + i * 50 + Math.floor(rb() * 16), L.boardY - 3);
    for (let y = 20; y < L.riverY0 - 8; y += 14 + Math.floor(rb() * 16)) s.set(L.streamX1 + (y & 1), y, T);
    // Far bank along the bottom: teal tufts on its lip.
    for (let x = 0; x < W; x++) {
      for (let y = L.riverY0; y < H; y++) {
        if (region[y * W + x] !== R_BANK) continue;
        if (region[(y - 1) * W + x] === R_WATER && (hash2(x, 0, 11) < 0.45)) s.px[y * W + x] = T;
        break;
      }
    }
    for (let x = 30 + Math.floor(rb() * 8); x < W - 6; x += 18 + Math.floor(rb() * 20)) {
      let y = L.riverY0;
      while (y < H && region[y * W + x] !== R_BANK) y++;
      s.blit(G.SPRITES.grassTuft, x, y - 1);
    }

    // Water base: teal, darker under the deck and toward the bottom edge.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (region[y * W + x] !== R_WATER) continue;
        let c = T;
        const du = y - L.riverY0; // depth below the deck
        const dl = x - L.streamX0; // distance from the deck's right side
        const underDeck = (y >= L.riverY0 && x < L.boardRight + 1 && du < 3) || (x < L.streamX0 + 2 && y < L.riverY0 + 2);
        if (underDeck && ((du >= 0 ? du : dl) < 2 || G.ditherOn(x, y, 0.5))) {
          if (G.ditherOn(x, y, (du >= 0 && x < L.boardRight + 1 ? du : dl) < 1 ? 0.75 : 0.5)) c = K;
        }
        // shade along the far bank's lip
        if (y + 1 < H && region[(y + 1) * W + x] === R_BANK && y >= L.riverY0 + 4 && G.ditherOn(x, y, 0.5)) c = K;
        else if (y + 2 < H && region[(y + 2) * W + x] === R_BANK && y >= L.riverY0 + 4 && G.ditherOn(x, y, 0.125)) c = K;
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

    // Kaya: flat amber with a few long, gently flowing grain lines (cream on a
    // checkerboard, so they read as a lighter tone) and a cream bevel on the
    // lit edges. Kept sparse: the stones must own this surface.
    const kx0 = L.kayaX, ky0 = L.kayaY, kx1 = L.kayaX + L.kayaW - 1, ky1 = L.kayaY + L.kayaH - 1;
    for (let y = ky0; y <= ky1; y++) for (let x = kx0; x <= kx1; x++) s.px[y * W + x] = A;
    const rg = rng(4242);
    const grain = [];
    for (let gx = kx0 + 5; gx < kx1 - 3; gx += 9 + Math.floor(rg() * 11)) {
      grain.push({ x: gx, a: 2.5 + rg() * 3, f: 0.03 + rg() * 0.03, p: rg() * 6.28, y0: ky0 + Math.floor(rg() * 80), len: 40 + Math.floor(rg() * 90) });
    }
    for (const g of grain) {
      for (let k = 0; k < g.len; k++) {
        const y = ky0 + 1 + ((g.y0 - ky0 + k) % (L.kayaH - 2));
        const x = Math.round(g.x + g.a * Math.sin(y * g.f + g.p) + 0.8 * Math.sin(y * 0.11 + g.p * 2));
        // taper: sparser at both ends of each streak
        const edge = Math.min(k, g.len - 1 - k);
        const on = edge > 10 ? (x + y) & 1 : (x + y) % 4 === 0;
        if (x > kx0 && x < kx1 && on) s.px[y * W + x] = C;
      }
    }
    for (let x = kx0; x <= kx1; x++) s.px[ky0 * W + x] = C; // bevel highlight
    for (let y = ky0; y <= ky1; y++) s.px[y * W + kx0] = C;

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

  const TIMELINES = {
    place: [PLACE_TIMELINE, []],
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
  function diffTurn(prev, next, size, action, newOverlays, time) {
    const effects = [];
    if (!prev || prev.length !== next.length) return effects;
    const used = action && action.kind === "powerup" ? action.id : null;
    const isTarget = (x, y) => action && action.x === x && action.y === y;
    const inBurst = (x, y) => used === "bomb" && Math.abs(x - action.x) <= 1 && Math.abs(y - action.y) <= 1;
    for (let i = 0; i < next.length; i++) {
      const a = prev[i], b = next[i];
      if (a === b) continue;
      const x = i % size, y = (i / size) | 0;
      if (a === 0) {
        effects.push(b === G.DRIFTWOOD ? makeEffect("drop", x, y, { code: b }, time) : placeEffect(x, y, b, time));
      } else if (b === 0) {
        if (a === G.DRIFTWOOD && !inBurst(x, y)) effects.push(makeEffect("driftAway", x, y, { code: a }, time));
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
   * Draw one effect frame centred on native pixel (cx, cy). Exposed so the
   * sprite-sheet preview can show effects in isolation.
   * Returns a light source {x, y, r} if the frame glows, else null.
   */
  function drawEffect(surf, effect, elapsed, cx, cy, reducedMotion) {
    const tl = timelineFor(effect.kind, reducedMotion);
    const at = frameAt(tl, elapsed);
    if (!at) return null;
    const f = at.frame;
    const code = effect.code;
    if (effect.kind === "place") {
      const spr = G.stoneSprite(code, f.shape);
      surf.blitCentered(G.stoneSprite(code, f.shadow), cx + 1, cy + 1, { color: K, coverage: 0.5 });
      if (f.ripple !== undefined) {
        surf.blitCentered(ANIMS.ripple.frames[f.ripple], cx, cy, { coverage: f.rippleCov });
      }
      surf.blitCentered(spr, cx, cy + f.dy);
      if (f.specks !== undefined) {
        const d = 9 + f.specks * 2;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          surf.set(cx + sx * d, cy + sy * (d - 3), C);
          if (f.specks === 0) surf.set(cx + sx * (d - 1), cy + sy * (d - 4), C);
        }
      }
      return null;
    }
    const powerup = drawPowerupFrame(surf, effect, f, at.index, cx, cy);
    if (powerup !== undefined) return powerup;

    // capture (also the tail of the snipe timeline)
    const look = G.lookForCode(code);
    if (f.kind === "stone") {
      surf.blitCentered(G.pieceSprite(code), cx + f.dx, cy);
      return null;
    }
    if (f.kind === "squish") {
      surf.blitCentered(G.pieceSprite(code, "squash"), cx, cy + 1);
      return null;
    }
    if (f.kind === "flash") {
      surf.blitCentered(G.STONES[f.look][f.shape], cx, cy);
      return { x: cx, y: cy, r: 9 };
    }
    if (f.kind === "fade") {
      surf.blitCentered(G.pieceSprite(code), cx, cy, { coverage: f.coverage });
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
  function drawPowerupFrame(surf, effect, f, index, cx, cy) {
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
        if (f.mark && effect.owner) surf.blitCentered(G.splitPreviewSprite(effect.owner, "mini"), cx, cy + 1);
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
        surf.blitCentered(G.stoneSprite(code, "icon"), cx + 1, cy + 1, { color: K, coverage: 0.5 });
        surf.blitCentered(G.stoneSprite(code, f.shape), cx, cy + f.dy);
        if (f.spark !== undefined) drawSparkRing(surf, cx, cy, f.sparkR, f.spark);
        return null;
      }
      case "gust": {
        drawWind(surf, cx, cy, f.wind);
        surf.blitCentered(G.pieceSprite(effect.code, f.shape), cx + f.dx, cy + f.dy, { coverage: f.cov });
        return null;
      }
      case "aim": {
        surf.blitCentered(G.pieceSprite(effect.code), cx, cy);
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
    const laneY = L.riverY0 + 13;
    const CORNER = 8;
    const seg1 = laneY - CORNER + 12;
    const arcLen = (Math.PI / 2) * CORNER;
    const seg3 = streamCx - CORNER + 12;
    const pathLen = seg1 + arcLen + seg3;
    function lanternPath(s) {
      if (s < seg1) return { x: streamCx, y: -12 + s, river: 0 };
      s -= seg1;
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
    for (let x = 10; x < L.streamX0 - 8; x += 25) garland.push({ x, phase: r() * 6.28, cream: garland.length % 2 === 1 });

    const fireflies = [];
    const addFly = (cx, cy, ax, ay) =>
      fireflies.push({ cx, cy, ax, ay, fx: 0.25 + r() * 0.35, fy: 0.3 + r() * 0.4, p1: r() * 6.28, p2: r() * 6.28, period: 3 + r() * 3, phase: r() });
    const rv = L.riverY0;
    addFly(40, 8, 26, 4); addFly(120, 7, 30, 4); addFly(190, 9, 20, 4);
    addFly(60, rv + 13, 24, 7); addFly(120, rv + 18, 30, 6); addFly(175, rv + 11, 22, 7); addFly(28, rv + 8, 10, 5);
    addFly(streamCx, 70, 3, 22); addFly(streamCx, 170, 3, 26); addFly(214, rv + 19, 12, 5);

    const reeds = [
      { anim: "reedsTall", x: L.streamX1 - 7, y: 40 - 15, phase: 0.3 },
      { anim: "reedsShort", x: L.streamX1 - 6, y: 118 - 15, phase: 1.3 },
      { anim: "reedsTall", x: L.streamX1 - 7, y: 206 - 15, phase: 2.1 },
      { anim: "reedsTall", x: 60, y: H - 18, phase: 0.8 },
      { anim: "reedsShort", x: 144, y: H - 17, phase: 1.9 },
      { anim: "reedsTall", x: 198, y: H - 17, phase: 2.7 },
      { anim: "reedsShort", x: 17, y: H - 17, phase: 0.1 },
      { anim: "reedsTall", x: 120, y: H - 17, phase: 1.1 },
    ];

    const pads = [
      { spr: G.SPRITES.lilyPad, x: 84, y: H - 11 },
      { spr: G.SPRITES.lilyPadSmall, x: 101, y: H - 7 },
      { spr: G.SPRITES.lilyPad, x: 158, y: L.riverY0 + 4 },
      { spr: G.SPRITES.lilyPadSmall, x: 40, y: L.riverY0 + 5 },
    ];
    const lotus = { x: 86, y: H - 14 };

    // Flow streaks in the river and stream.
    const riverStreaks = [];
    for (let i = 0; i < 38; i++) {
      riverStreaks.push({
        x0: r() * (W + 12), y: L.riverY0 + 4 + Math.floor(r() * (RIVER - 7)),
        speed: 4 + r() * 6, period: 1.2 + r() * 1.8, phase: r(), len: 2 + Math.floor(r() * 4),
      });
    }
    const streamStreaks = [];
    for (let i = 0; i < 16; i++) {
      streamStreaks.push({
        x: L.streamX0 + 2 + Math.floor(r() * (STREAM - 4)), y0: r() * L.riverY0,
        speed: 9 + r() * 6, period: 1 + r() * 1.5, phase: r(), len: 2 + Math.floor(r() * 2),
      });
    }
    const foamSpecks = [];
    for (let i = 0; i < 14; i++) foamSpecks.push({ x0: r() * W, row: 1 + (i % 3), speed: 5 + r() * 4, period: 2 + r() * 2, phase: r() });
    // Glints of lantern light twinkling on the water.
    const twinkles = [];
    for (let i = 0; i < 9; i++) {
      const inStream = i < 2;
      twinkles.push({
        x: inStream ? L.streamX0 + 3 + Math.floor(r() * (STREAM - 6)) : 24 + Math.floor(r() * (W - 40)),
        y: inStream ? 30 + Math.floor(r() * (L.riverY0 - 60)) : L.riverY0 + 6 + Math.floor(r() * (RIVER - FAR_BANK - 10)),
        period: 2.5 + r() * 3, phase: r(),
      });
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
      for (const st of riverStreaks) {
        const life = frac(t / st.period + st.phase);
        const len = Math.round(st.len * Math.sin(Math.PI * life));
        if (len <= 0) continue;
        const span = W + 12;
        const x = Math.floor(((((st.x0 - st.speed * t) % span) + span) % span) - 6);
        for (let k = 0; k < len; k++) waterSet(x + k, st.y, S);
      }
      for (const st of streamStreaks) {
        const life = frac(t / st.period + st.phase);
        const len = Math.round(st.len * Math.sin(Math.PI * life));
        if (len <= 0) continue;
        const y = Math.floor((st.y0 + st.speed * t) % (L.riverY0 + 4));
        for (let k = 0; k < len; k++) waterSet(st.x, y + k, S);
      }
    }

    function drawFoam(t) {
      // Lapping along the deck's front face (river flows left).
      const y0 = L.riverY0;
      for (let x = L.boardX; x <= L.boardRight; x++) {
        const w = Math.sin(x * 0.42 + t * 2.4) + 0.7 * Math.sin(x * 0.15 - t * 1.1 + 1);
        if (w > 1.05) {
          surf.set(x, y0 - 1, C);
          waterSet(x, y0, C);
          if (G.ditherOn(x, y0 + 1, 0.5)) waterSet(x, y0 + 1, C);
        } else if (w > 0.1) {
          waterSet(x, y0, C);
        } else if (w > -0.7) {
          if ((x + Math.floor(t * 4)) & 1) waterSet(x, y0, C);
        }
      }
      // Along the deck's right side (stream flows down).
      const x0 = L.streamX0;
      for (let y = L.boardY; y < L.riverY0; y++) {
        const w = Math.sin(y * 0.42 - t * 3.0) + 0.7 * Math.sin(y * 0.17 - t * 1.3 + 2);
        if (w > 1.05) {
          surf.set(x0 - 1, y, C);
          waterSet(x0, y, C);
          if (G.ditherOn(x0 + 1, y, 0.5)) waterSet(x0 + 1, y, C);
        } else if (w > 0.1) {
          waterSet(x0, y, C);
        } else if (w > -0.7) {
          if ((y + Math.floor(t * 4)) & 1) waterSet(x0, y, C);
        }
      }
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
          G.drawText(surf, f, label, L.gridX + i * SPACING - (w >> 1), L.boardY + 2, A);
        }
        if (!(hover && hover.y === i)) {
          const cx = L.boardX + (FRAME >> 1);
          G.drawText(surf, f, label, cx - (w >> 1), L.gridY + i * SPACING - 2, A);
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

    function drawStones(board, skip) {
      // Shadows first so they never cover a neighbour.
      for (let i = 0; i < board.length; i++) {
        const code = board[i];
        if (!code || skip.has(i)) continue;
        const p = pointToNative(i % size, (i / size) | 0);
        surf.blitCentered(G.pieceSprite(code), p.x + 1, p.y + 1, { color: K, coverage: 0.5 });
      }
      for (let i = 0; i < board.length; i++) {
        const code = board[i];
        if (!code || skip.has(i)) continue;
        const p = pointToNative(i % size, (i / size) | 0);
        surf.blitCentered(G.pieceSprite(code), p.x, p.y);
      }
    }

    /** Lily pads (under stones) on empty cells, each showing its owner's mini split stone. */
    function drawLilyPads(overlays, board, busy) {
      for (const o of overlays) {
        if (o.kind !== "lily") continue;
        const i = o.y * size + o.x;
        if (board[i] || busy.has("lily:" + i)) continue;
        const p = pointToNative(o.x, o.y);
        surf.blitCentered(G.SPRITES.lilyBoard, p.x, p.y + 1);
        if (o.owner) surf.blitCentered(G.splitPreviewSprite(o.owner, "mini"), p.x, p.y + 1);
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
     *   overlays:      [{kind: "lily" | "ward", x, y, owner}] -- lasting board markers,
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
      for (const ff of flies) if (ff.frame === 2) lights.push({ x: ff.x, y: ff.y, r: 3.5, s: 0.7 });
      for (const lt of lights) surf.ramp(G.LIGHT, lt.x, lt.y, lt.r, lt.s, 1, noLight);

      // 3. floating lanterns + reflections
      for (const fl of floats) {
        drawReflection(fl.x, fl.y + 3, t, 7, false);
        surf.blitCentered(animFrame("floatLantern", t, fl.fl.phase / 6.28), fl.x, fl.y);
      }

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
      drawLilyPads(overlays, board, busy);
      drawStones(board, skip);
      drawWards(overlays, board, busy, time, reduced);

      // 7. last-move ember
      if (st.lastMove && !skip.has(st.lastMove.y * size + st.lastMove.x) && board[st.lastMove.y * size + st.lastMove.x]) {
        const p = pointToNative(st.lastMove.x, st.lastMove.y);
        surf.blitCentered(animFrame("ember", reduced ? 0 : time), p.x, p.y);
      }

      // 8. effects in flight
      for (const e of active) {
        const p = pointToNative(e.x, e.y);
        const glow = drawEffect(surf, e, time - e.start, p.x, p.y, reduced);
        if (glow) surf.ramp(G.LIGHT, glow.x, glow.y, glow.r, 0.6, 1, noLight);
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
        drawHighlightTag(String(hover.x), L.gridX + hover.x * SPACING, L.boardY + (FRAME >> 1), "down");
        drawHighlightTag(String(hover.y), L.boardX + (FRAME >> 1), L.gridY + hover.y * SPACING, "right");
      }

      // 10. fireflies (never over the playing surface)
      for (const ff of flies) {
        if (ff.frame < 0 || inKaya(ff.x, ff.y)) continue;
        surf.blitCentered(ANIMS.firefly.frames[ff.frame], ff.x, ff.y);
      }

      return surf.toRGBA(rgba);
    }

    /** Amber rim around a sprite's outline (hover pulse). */
    function outlineGlow(spr, cx, cy) {
      const x0 = cx - ((spr.w - 1) >> 1), y0 = cy - ((spr.h - 1) >> 1);
      for (let y = 0; y < spr.h; y++) {
        for (let x = 0; x < spr.w; x++) {
          const v = spr.px[y * spr.w + x];
          if (v === G.TRANSPARENT) continue;
          const edge =
            x === 0 || y === 0 || x === spr.w - 1 || y === spr.h - 1 ||
            spr.px[y * spr.w + x - 1] === G.TRANSPARENT || spr.px[y * spr.w + x + 1] === G.TRANSPARENT ||
            spr.px[(y - 1) * spr.w + x] === G.TRANSPARENT || spr.px[(y + 1) * spr.w + x] === G.TRANSPARENT;
          if (edge) surf.set(x0 + x, y0 + y, C);
        }
      }
    }

    function drawGarland(t) {
      const ropeEnd = L.streamX0 - 3;
      // post on the stream bank
      for (let y = 0; y < TOP - 2; y++) { surf.set(ropeEnd, y, K); surf.set(ropeEnd + 1, y, S); surf.set(ropeEnd + 2, y, K); }
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
