// GoCalypse lobby islands (tasks/2026-11-02_lobby_islands): every open lobby on
// the server is a small island in the home screen's river, beside the main
// island (lobbyBoard.js), which logo.js sets left of centre to make room.
//
// An islet carries a 2x2 board whose lines run out to its kaya's edges: a
// corner of a bigger board, one point per seat. P1 is top left, then
// clockwise. A person is a plain stone in the seat's base colour (P1/P3 black,
// P2/P4 white, so a full table reads as a cross-cut); a bot is the same stone
// with its initial on it, as on the main island's columns. The board size is
// written in the deck's bottom frame, and a label over the islet reads
// "Lobby n/4" ("Join n/4" under the pointer). Nobody's name is shown: the home
// screen is public (rooms/tables.ts lists seats only).
//
// A lobby that opens rises out of the river. One whose game starts sinks: its
// stones lift off as lanterns, the shore floods, the deck goes under and rings
// spread. One that closes (its last person left) sinks quietly. Clicking an
// islet, or its label (a real button, so the keyboard and screen readers have
// it too), joins that lobby through main.js's joinLobby.
//
// Its core -- the islet's picture, the slots on the river, which islets rise,
// wait and sink, and the drawing -- is plain script: `module.exports` in Node
// (tests/web/lobbyIslets.test.mjs), `window.GoLobbyIsletsCore` in the browser.
// The rest of this file puts it on the page: a see-through canvas laid over the
// logo's river (as lobbyBoard.js lays the main island), fed by main.js's
// GET /tables poll through window.GoLobbyIslets.sync. Loaded after logo.js.
(function (root, factory) {
  const node = typeof module === "object" && module.exports;
  const api = factory(node ? require("./sprites.js") : root.GoSprites);
  if (node) module.exports = api;
  else root.GoLobbyIsletsCore = api;
})(typeof self !== "undefined" ? self : this, function (G) {
  "use strict";
  const { K, C, A, T, S } = G.INDEX;
  const NONE = G.TRANSPARENT;

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
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (u) => u * u * (3 - 2 * u);
  /** A room id as a seed, so the same lobby is always the same islet. */
  function seedOf(text) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    return (h >>> 0) % 100000;
  }

  // ---------------------------------------------------------------------------
  // One islet: a deck with a 2x2 board on a wobbly patch of grass, in the
  // river scene's native px (half the main island's pixel size)
  // ---------------------------------------------------------------------------
  const SP = 18; // between the board's two lines
  const KM = 8; // kaya margin round the points
  const KS = SP + 2 * KM; // kaya side
  const FR = 4, FB = 9; // frame: top/left/right, bottom (the size is written there)
  const FACE = 3, CLIFF = 2, PAD = 4;
  const DW = KS + 2 * FR, DH = FR + KS + FB, DT = DH + FACE;
  const R_NONE = 0, R_LAND = 1, R_CLIFF = 2, R_DECK = 3;
  const SEAT_LOOK = ["black", "white", "black", "white"]; // each seat's base stone (sprites.js CODE_LOOK 1..4)
  const SEAT_NODE = [[0, 0], [1, 0], [1, 1], [0, 1]]; // P1 top left, then clockwise

  function buildIslet(seed, size) {
    const R = rng(seed);
    const s1 = R() * 6.28, s2 = R() * 6.28, s3 = R() * 6.28, head = R() * 6.28, cove = head + 2 + R() * 2;
    const bump = (a, at, width) => { const d = Math.atan2(Math.sin(a - at), Math.cos(a - at)) / width; return Math.exp(-d * d); };
    // The shore's distance from the deck by angle: low sines make it wonky, a
    // headland and a cove break it, teeth of random height make it jagged.
    function margin(a) {
      let m = 9 + 2.4 * Math.sin(2 * a + s1) + 1.4 * Math.sin(3 * a + s2) + 0.8 * Math.sin(7 * a + s3);
      m += 7 * bump(a, head, 0.3) - 3 * bump(a, cove, 0.3);
      const u = ((a + Math.PI) / (2 * Math.PI)) * 64, q = Math.floor(u);
      m += (1 - Math.abs(2 * (u - q) - 1)) * (0.5 + hash2(q % 64, seed, 3) * 1.6) - 0.8;
      return Math.max(5, m);
    }
    const landRel = (x, y) => {
      const dx = x < 0 ? -x : x >= DW ? x - DW + 1 : 0;
      const dy = y < 0 ? -y : y >= DT ? y - DT + 1 : 0;
      return Math.hypot(dx, dy) < margin(Math.atan2(y - DT / 2, x - DW / 2));
    };
    let minX = 0, minY = 0, maxX = DW - 1, maxY = DT - 1;
    for (let y = -24; y < DT + 24; y++) {
      for (let x = -24; x < DW + 24; x++) {
        if (!landRel(x, y)) continue;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y + CLIFF);
      }
    }
    const ox = -minX + PAD, oy = -minY + PAD;
    const W = maxX - minX + 1 + 2 * PAD, H = maxY - minY + 1 + 2 * PAD;
    const idx = (x, y) => y * W + x;
    const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    const region = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (x >= ox && x < ox + DW && y >= oy && y < oy + DT) region[idx(x, y)] = R_DECK;
        else if (landRel(x - ox, y - oy)) region[idx(x, y)] = R_LAND;
      }
    }
    // Cliff: the near shore shows its earth face down to the water.
    const cliff = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (region[idx(x, y)] !== R_NONE) continue;
        for (let d = 1; d <= CLIFF; d++) {
          if (y - d >= 0 && region[idx(x, y - d)] === R_LAND) { cliff[idx(x, y)] = d; break; }
        }
      }
    }
    for (let i = 0; i < W * H; i++) if (cliff[i]) region[i] = R_CLIFF;

    // Steps from the water, for the paint and the flood: land and cliff, 4-neighbour.
    const dist = new Uint8Array(W * H);
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const shore = (r) => r === R_LAND || r === R_CLIFF;
    let queue = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!shore(region[idx(x, y)])) continue;
        if (steps.some(([dx, dy]) => !inside(x + dx, y + dy) || region[idx(x + dx, y + dy)] === R_NONE)) {
          dist[idx(x, y)] = 1;
          queue.push([x, y]);
        }
      }
    }
    let maxD = 1;
    while (queue.length) {
      const next = [];
      for (const [x, y] of queue) {
        for (const [dx, dy] of steps) {
          const nx = x + dx, ny = y + dy;
          if (!inside(nx, ny) || dist[idx(nx, ny)] || !shore(region[idx(nx, ny)])) continue;
          dist[idx(nx, ny)] = dist[idx(x, y)] + 1;
          maxD = Math.max(maxD, dist[idx(nx, ny)]);
          next.push([nx, ny]);
        }
      }
      queue = next;
    }
    // The river next to the shore: a shade, and where the surf breaks.
    const outer = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (region[idx(x, y)] !== R_NONE) continue;
        let d = 9;
        for (let yy = y - 2; yy <= y + 2; yy++) {
          for (let xx = x - 2; xx <= x + 2; xx++) {
            if (inside(xx, yy) && region[idx(xx, yy)] !== R_NONE) d = Math.min(d, Math.max(Math.abs(xx - x), Math.abs(yy - y)));
          }
        }
        if (d <= 2) outer.push({ x, y, d });
      }
    }

    // Paint: grass like the main island's, then the deck, its board and its size.
    const paint = new G.Surface(W, H);
    paint.fill(NONE);
    const base = paint.px;
    const shade = (x, y) => // the deck's shadow, down and to the right
      (x >= ox + DW && x < ox + DW + 2 && y >= oy + 2 && y < oy + DT + 2) || (y >= oy + DT && y < oy + DT + 2 && x >= ox + 2 && x < ox + DW + 2);
    const patch = (x, y) => Math.sin(x * 0.23 + Math.sin(y * 0.13) * 2.2 + seed) * Math.sin(y * 0.19 + Math.sin(x * 0.09) * 1.8 + 1.3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = idx(x, y), r = region[i], d = dist[i];
        if (r === R_LAND) {
          let c = K;
          if (d === 1) c = hash2(x, y, seed + 7) < 0.7 ? S : K;
          else if (shade(x, y)) c = K;
          else if (d === 2) c = hash2(x, y, seed + 8) < 0.25 ? S : G.ditherOn(x, y, 0.5) ? T : K;
          else if (d === 3) c = G.ditherOn(x, y, 0.5) ? T : K;
          else if (patch(x, y) > 0.3 && G.ditherOn(x, y, 0.25)) c = T;
          else if (G.ditherOn(x, y, 0.125)) c = T;
          base[i] = c;
        } else if (r === R_CLIFF) {
          base[i] = cliff[i] === CLIFF ? S : hash2(x, 0, seed + 9) < 0.3 ? T : K;
        }
      }
    }
    const blit = (spr, x, y) => { // onto clear grass only, never the deck or its shadow
      for (let sy = -1; sy <= spr.h; sy++) {
        for (let sx = -1; sx <= spr.w; sx++) {
          const xx = x + sx, yy = y + sy;
          if (!inside(xx, yy) || region[idx(xx, yy)] !== R_LAND || dist[idx(xx, yy)] < 2 || shade(xx, yy)) return;
        }
      }
      paint.blit(spr, x, y);
    };
    for (let k = 0; k < 24; k++) {
      const spr = [G.SPRITES.grassTuftSmall, G.SPRITES.grassTuft, G.SPRITES.grassTuftSmall, G.SPRITES.pebble, G.SPRITES.grassTuft, G.SPRITES.flower][k % 6];
      blit(spr, Math.floor(R() * W), Math.floor(R() * H));
    }
    // A rock on the headland; reeds sway on the near shore (drawn per frame).
    blit(G.SPRITES.rock, Math.round(ox + DW / 2 + Math.cos(head) * (DW / 2 + 9) - 3), Math.round(oy + DT / 2 + Math.sin(head) * (DT / 2 + 7) - 2));
    const reeds = [];
    for (const [anim, along] of [["reedsShort", 0.35], ["reedsTall", 0.62]]) {
      const x = Math.round(W * along);
      let y = H - 1;
      while (y > 0 && region[idx(x, y)] !== R_LAND) y--;
      if (y > oy + DT && R() < 0.8) reeds.push({ anim, x: x - 3, y: y - G.ANIMS[anim].frames[0].h + 2, phase: R() });
    }
    // Deck: lacquer frame with a lit top edge, the kaya, the two lines each way
    // run out to its edges, the size in amber in the bottom frame, the front face.
    const kx = ox + FR, ky = oy + FR;
    for (let y = oy; y < oy + DH; y++) for (let x = ox; x < ox + DW; x++) base[idx(x, y)] = K;
    for (let x = ox + 1; x < ox + DW - 1; x++) if (G.ditherOn(x, oy, 0.5)) base[idx(x, oy)] = S;
    for (let y = ky; y < ky + KS; y++) for (let x = kx; x < kx + KS; x++) base[idx(x, y)] = A;
    const n0x = kx + KM, n0y = ky + KM;
    for (let t = 0; t < KS; t++) {
      base[idx(kx + t, n0y)] = K; base[idx(kx + t, n0y + SP)] = K;
      base[idx(n0x, ky + t)] = K; base[idx(n0x + SP, ky + t)] = K;
    }
    const label = String(size), lw = G.textWidth(G.FONT_BIG, label);
    G.drawText(paint, G.FONT_BIG, label, ox + ((DW - lw) >> 1), ky + KS + 2, A);
    for (let y = oy + DH; y < oy + DT; y++) {
      for (let x = ox; x < ox + DW; x++) {
        const fy = y - oy - DH;
        base[idx(x, y)] = fy === 1 && (x - ox) % 14 === 7 ? S : fy === FACE - 1 ? (G.ditherOn(x, y, 0.5) ? S : K) : K;
      }
    }
    const kaya = { x: kx, y: ky, w: KS, h: KS };
    const nodes = SEAT_NODE.map(([c, r]) => ({ x: n0x + c * SP, y: n0y + r * SP }));
    return { W, H, ox, oy, region, dist, maxD, base, kaya, outer, nodes, reeds, cx: ox + DW / 2, cy: oy + DT / 2, size };
  }

  // ---------------------------------------------------------------------------
  // Slots on the river: the water left and right of the main island, under
  // the word and over the lanterns' lane, nearest the main island first
  // ---------------------------------------------------------------------------
  const CELL_W = 80, CELL_H = 92; // the smallest cell an islet and its label fit in
  const WANT_SLOTS = 12; // ten lobbies, and room for two more to rise

  function gridSlots(zones, cw, ch, top, bottom, J) {
    const out = [];
    for (const [x0, x1] of zones) {
      const cols = Math.floor((x1 - x0) / cw), rows = Math.floor((bottom - top) / ch);
      if (cols < 1 || rows < 1) continue;
      const w = (x1 - x0) / cols, h = (bottom - top) / rows;
      for (let c = 0; c < cols; c++) {
        const odd = c % 2 === 1 && rows > 1; // odd columns sit half a row lower, one row fewer
        for (let r = 0; r < rows - (odd ? 1 : 0); r++) {
          out.push({
            x: Math.round(x0 + (c + 0.5) * w + (J() - 0.5) * Math.min(14, w - CELL_W)),
            y: Math.round(top + (r + 0.5 + (odd ? 0.5 : 0)) * h + (J() - 0.5) * Math.min(14, h - CELL_H)),
          });
        }
      }
    }
    return out;
  }

  /**
   * The slots for one river (logo.js GoLogo.geometry(): its width, the main
   * island's box, the lanterns' lane, the fade at each end): the biggest cells
   * that still give WANT_SLOTS, so the islets spread over all the free water.
   */
  function layoutSlots(g) {
    const isleR = g.islandX + g.islandW;
    const top = g.islandTop + 14, bottom = g.laneY - 16;
    const zones = [[g.fade + 4, g.islandX - 4], [isleR + 4, g.W - g.fade - 4]];
    let ch = bottom - top;
    while (ch > CELL_H && gridSlots(zones, Math.max(CELL_W, ch * 0.92), ch, top, bottom, () => 0.5).length < WANT_SLOTS) ch -= 2;
    const slots = gridSlots(zones, Math.max(CELL_W, ch * 0.92), Math.max(CELL_H, ch), top, bottom, rng(7));
    const icx = (g.islandX + isleR) / 2, icy = g.islandTop + g.islandH / 2;
    return slots.sort((a, b) => Math.hypot(a.x - icx, (a.y - icy) * 1.4) - Math.hypot(b.x - icx, (b.y - icy) * 1.4));
  }

  // ---------------------------------------------------------------------------
  // The lobbies as the page knows them, from one GET /tables to the next:
  // rising, waiting, sinking (times in seconds)
  // ---------------------------------------------------------------------------
  const RISE = 1.8, SINK = 4.0, FULL_BEAT = 0.8, LEAVE = 0.45, LAND = 0.26;
  const SEAT_CODE = /^(p|bot:[a-z]{1,16})$/;
  const validLobby = (r) => !!r && typeof r.roomId === "string" && [13, 19, 25].includes(r.size) && Array.isArray(r.seats);
  const codeAt = (seats, i) => (typeof seats[i] === "string" && SEAT_CODE.test(seats[i]) ? seats[i] : null);

  function createLobbies() {
    const tables = new Map(); // roomId -> table
    let seen = false; // a list came in before: a lobby new since then rises

    /** Brings a table's stones in line with the server's seats: new ones land at `landAt`, gone ones fade from `now`. */
    function setSeats(tb, seats, now, landAt) {
      for (let i = 0; i < 4; i++) {
        const want = codeAt(seats, i), have = tb.seats[i];
        const on = have && have.leftAt === null ? have : null;
        if (want && (!on || on.code !== want)) tb.seats[i] = { code: want, at: landAt, leftAt: null };
        else if (!want && on) on.leftAt = now;
      }
    }

    return {
      /** One answer of GET /tables: `rooms` and `started` as the server sent them (null/undefined: not known). */
      sync(rooms, started, now) {
        const list = Array.isArray(rooms) ? rooms.filter(validLobby) : null;
        const just = new Map((Array.isArray(started) ? started : []).filter(validLobby).map((s) => [s.roomId, s]));
        const listed = new Set();
        for (const r of list || []) {
          listed.add(r.roomId);
          let tb = tables.get(r.roomId);
          if (tb && tb.sinkAt !== null) continue; // already going under: let it
          if (!tb) {
            tb = { roomId: r.roomId, size: r.size, seats: [null, null, null, null], phase: seen ? "rise" : "idle", t0: now, sinkAt: null, lanterns: false, slot: -1, isle: buildIslet(seedOf(r.roomId), r.size) };
            tables.set(r.roomId, tb);
            setSeats(tb, r.seats, now, seen ? now + RISE : now - LAND); // the opening list: already seated
          } else {
            setSeats(tb, r.seats, now, tb.phase === "rise" ? Math.max(now, tb.t0 + RISE) : now);
          }
        }
        // Off the list: started (its stones go off as lanterns), or closed (it sinks quietly).
        for (const tb of tables.values()) {
          if (listed.has(tb.roomId) || tb.sinkAt !== null) continue;
          const s = just.get(tb.roomId);
          if (s) {
            setSeats(tb, s.seats, now, now);
            tb.lanterns = true;
            tb.sinkAt = now + FULL_BEAT; // the last stone lands first
          } else {
            tb.lanterns = false;
            tb.sinkAt = now;
          }
        }
        if (list) seen = true;
      },
      /** Moves every table on to `now`. True while anything is still moving (rising, landing, sinking). */
      advance(now) {
        let busy = false;
        for (const tb of tables.values()) {
          if (tb.phase === "rise" && now >= tb.t0 + RISE) tb.phase = "idle";
          if (tb.sinkAt !== null && tb.phase !== "sink" && now >= tb.sinkAt) { tb.phase = "sink"; tb.t0 = tb.sinkAt; }
          tb.seats.forEach((s, i) => {
            if (s && s.leftAt !== null && now >= s.leftAt + LEAVE) tb.seats[i] = null;
          });
          if (tb.phase !== "idle" || tb.sinkAt !== null || tb.seats.some((s) => s && (now < s.at + LAND || s.leftAt !== null))) busy = true;
        }
        for (const [id, tb] of tables) if (tb.phase === "sink" && now >= tb.t0 + SINK) tables.delete(id);
        return busy;
      },
      get: (roomId) => tables.get(roomId),
      all: () => Array.from(tables.values()),
    };
  }

  /** True while a table takes a seat: listed, not rising or going under, and a seat free. */
  function joinable(tb) {
    return tb.phase === "idle" && tb.sinkAt === null && tb.seats.filter((s) => s && s.leftAt === null).length < 4;
  }

  // ---------------------------------------------------------------------------
  // Drawing one islet into the river scene's surface (see-through elsewhere)
  // ---------------------------------------------------------------------------
  const surfWave = (x, y, t) => Math.sin((x + y) * 0.21 - t * 1.9) + 0.6 * Math.sin(x * 0.09 - y * 0.13 + t * 1.3);
  function animFrame(name, t, phase) {
    const a = G.ANIMS[name], n = a.frames.length;
    return a.frames[((Math.floor(t * a.fps + (phase || 0) * n) % n) + n) % n];
  }

  /**
   * Draws `tb` with its board's centre on (cx, cy). `initialOf(code)` names a
   * bot's letter; `mask` marks the kaya (kept out of the lantern light);
   * `lights` collects the lanterns' glow. Sets tb.x0/tb.y0, the islet's corner.
   */
  function drawIslet(surf, tb, cx, cy, now, o) {
    const s = tb.isle;
    const x0 = Math.round(cx - s.cx), y0 = Math.round(cy - s.cy);
    tb.x0 = x0; tb.y0 = y0;
    const t = o.reduced ? 0 : Math.floor(now * 10) / 10; // ambient at the scene's 10 fps
    const e = now - tb.t0;
    // flood: 0 dry .. 1 the shore under; drop: px the deck has sunk
    let flood = 0, drop = 0, rings = -1;
    if (o.reduced) {
      if (tb.phase === "sink") return; // with reduced motion a lobby that goes simply goes
    } else if (tb.phase === "rise") {
      drop = Math.round((1 - ease(clamp01(e / 1.0))) * (DT + 2));
      flood = 1 - ease(clamp01((e - 0.5) / 1.2));
      rings = e;
    } else if (tb.phase === "sink") {
      const lead = tb.lanterns ? 0.7 : 0; // a started table first sends its stones off as lanterns
      flood = ease(clamp01((e - lead) / 1.6));
      drop = Math.round(ease(clamp01((e - lead - 1.0) / 1.4)) * (DT + 2));
      rings = e - lead - 0.6;
    }
    const L = flood * (s.maxD + 1);
    const W = surf.w, out = surf.px;
    const put = (x, y, c) => { const gx = x0 + x, gy = y0 + y; if (gx >= 0 && gy >= 0 && gx < W && gy < surf.h) out[gy * W + gx] = c; };
    const putWater = (x, y, c) => { const gx = x0 + x, gy = y0 + y; if (gx >= 0 && gy >= 0 && gx < W && gy < surf.h && out[gy * W + gx] === NONE) out[gy * W + gx] = c; };

    // land and cliff, flooding from the shore in
    for (let y = 0; y < s.H; y++) {
      for (let x = 0; x < s.W; x++) {
        const i = y * s.W + x, r = s.region[i];
        if (r !== R_LAND && r !== R_CLIFF) continue;
        if (r === R_CLIFF && flood > 0.05) continue;
        const d = s.dist[i];
        if (d <= L) continue;
        if (flood > 0 && d <= L + 1.5 && surfWave(x0 + x, y0 + y, t) > -0.4) put(x, y, C); // the flood's own surf line
        else put(x, y, s.base[i]);
      }
    }
    if (flood < 0.25) for (const rd of s.reeds) surf.blit(animFrame(rd.anim, t, rd.phase), x0 + rd.x, y0 + rd.y);
    // the deck: down it goes, cut off at its old waterline
    const waterY = s.oy + DT;
    for (let y = s.oy; y < waterY; y++) {
      const dy = y + drop;
      if (dy >= waterY) break;
      for (let x = s.ox; x < s.ox + DW; x++) {
        put(x, dy, s.base[y * s.W + x]);
        const gx = x0 + x, gy = y0 + dy;
        if (o.mask && s.kaya.x <= x && x < s.kaya.x + KS && s.kaya.y <= y && y < s.kaya.y + KS && gx >= 0 && gy >= 0 && gx < W && gy < surf.h) o.mask[gy * W + gx] = 1;
      }
    }
    if (drop > 0 && drop < DT + 2) {
      for (let x = s.ox - 2; x < s.ox + DW + 2; x++) if (surfWave(x0 + x, y0 + waterY, t) > -0.6 || x % 3 === 0) put(x, waterY - 1, C);
    }
    // the river by the shore: a shade, and surf breaking on it
    const dry = 1 - clamp01(flood * 3);
    if (dry > 0) {
      for (const p of s.outer) {
        const gx = x0 + p.x, gy = y0 + p.y;
        if (p.d === 1 && surfWave(gx, gy, t) > 0.1 && G.ditherOn(gx, gy, dry)) putWater(p.x, p.y, C);
        else if (G.ditherOn(gx, gy, (p.d === 1 ? 0.5 : 0.25) * dry)) putWater(p.x, p.y, K);
      }
    }
    // rings spreading on the water as it goes under (or comes up)
    if (rings > 0) {
      for (let k = 0; k < 3; k++) {
        const u = (rings - k * 0.45) / 1.8;
        if (u <= 0 || u >= 1) continue;
        const rad = 14 + u * 34, cov = (1 - u) * 0.9;
        for (let a = 0; a < 6.283; a += 0.6 / rad) {
          const x = Math.round(s.cx + Math.cos(a) * rad), y = Math.round(s.cy + DT * 0.2 + Math.sin(a) * rad * 0.55);
          if (G.ditherOn(x0 + x, y0 + y, cov)) putWater(x, y, C);
        }
      }
    }

    // stones
    const decked = drop === 0;
    tb.seats.forEach((seat, i) => {
      if (!seat || now < seat.at) return;
      const n = s.nodes[i], look = SEAT_LOOK[i], st = G.STONES[look];
      const px = x0 + n.x, py = y0 + n.y;
      if (tb.phase === "sink" && tb.lanterns) { // the game started: each stone lifts off as a lantern
        const ls = e - i * 0.15, k = clamp01(ls / 0.45);
        if (k < 1 && decked) drawStone(surf, st.normal, px, py - Math.round(k * 3), seat, look, 1 - k, o);
        const le = ls - 0.15;
        if (le > 0 && le < 3) {
          const lx = Math.round(px + Math.sin(le * 2.2 + i) * 2.5), ly = Math.round(py - 3 - le * 9 - le * le * 2.5);
          const cov = le > 2.2 ? (3 - le) / 0.8 : 1;
          if (o.lights) o.lights.push({ x: lx, y: ly - 1, r: 8, s: 0.55 * cov });
          surf.blitCentered(animFrame("floatLantern", t, i / 4), lx, ly, { coverage: cov });
        }
        return;
      }
      if (!decked) return;
      if (seat.leftAt !== null) { // someone left: their stone fades up off the board
        const k = clamp01((now - seat.leftAt) / LEAVE);
        drawStone(surf, st.normal, px, py - Math.round(k * 4), seat, look, 1 - k, o);
        return;
      }
      const se = o.reduced ? LAND : now - seat.at;
      if (se < 0.18) { // landing: falls in stretched, squashes, settles
        surf.blitCentered(st.icon, px + 1, py + 1, { color: K, coverage: 0.25 + 0.25 * (se / 0.18) });
        surf.blitCentered(st.stretch, px, py - Math.round((1 - se / 0.18) * 10));
      } else if (se < LAND) surf.blitCentered(st.squash, px, py);
      else drawStone(surf, st.normal, px, py, seat, look, 1, o);
    });
    // the seat a click would take, on the islet under the pointer
    if (o.hover === tb.roomId && joinable(tb) && decked) {
      const i = tb.seats.findIndex((x) => !x || x.leftAt !== null);
      const n = s.nodes[i];
      surf.blitCentered(G.STONES[SEAT_LOOK[i]].normal, x0 + n.x, y0 + n.y, { coverage: 0.5 });
      surf.blitCentered(animFrame("reticle", t), x0 + n.x, y0 + n.y);
    }
  }
  function drawStone(surf, spr, x, y, seat, look, cov, o) {
    if (cov <= 0) return;
    if (cov >= 1) surf.blitCentered(spr, x + 1, y + 1, { color: K, coverage: 0.5 });
    surf.blitCentered(spr, x, y, { coverage: cov });
    const letter = cov > 0.5 ? o.initialOf(seat.code) : null;
    if (letter) { // a bot's initial: cream on black, ink on white
      const w = G.textWidth(G.FONT_BIG, letter);
      G.drawText(surf, G.FONT_BIG, letter, x - (w >> 1), y - 3, look === "black" ? C : K);
    }
  }

  return { buildIslet, layoutSlots, createLobbies, joinable, drawIslet, CELL_W, CELL_H, RISE, SINK, SEAT_LOOK, R_NONE };
});

// ---------------------------------------------------------------------------
// On the page: the islets' canvas over the logo's river, their labels, the
// pointer, and window.GoLobbyIslets for main.js (and the GUI tests)
// ---------------------------------------------------------------------------
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  const core = window.GoLobbyIsletsCore, G = window.GoSprites;
  const logo = document.getElementById("logo");
  const wrap = document.getElementById("logo-wrap");
  const lobby = document.getElementById("lobby");
  const captionEl = document.getElementById("lobby-caption");
  if (!core || !G || !logo || !wrap || !window.GoLogo) return;
  const NONE = G.TRANSPARENT;

  const canvas = document.createElement("canvas");
  canvas.id = "lobby-islets";
  canvas.className = "px";
  canvas.setAttribute("aria-hidden", "true");
  const labelsEl = document.createElement("div");
  labelsEl.id = "lobby-islets-labels";
  logo.after(canvas, labelsEl); // under the main island's wrap and the GitHub sign
  const ctx = canvas.getContext("2d");

  const lobbies = core.createLobbies();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const now = () => performance.now() / 1000;
  let slots = [], layoutKey = "", hover = null;
  let surf = null, image = null, mask = null;

  /** A seat's code as a bot's initial (main.js BOT_OPTIONS, as on the main island's columns), or null for a person. */
  function initialOf(code) {
    if (!code || !code.startsWith("bot:")) return null;
    const o = typeof BOT_OPTIONS !== "undefined" ? BOT_OPTIONS.find((b) => b.id === code.slice(4)) : null;
    return o ? o.name[0] : "?";
  }
  const botName = (code) => {
    const o = typeof BOT_OPTIONS !== "undefined" ? BOT_OPTIONS.find((b) => b.id === code.slice(4)) : null;
    return o ? o.name : "a bot";
  };
  const seated = (tb) => tb.seats.filter((s) => s && s.leftAt === null);

  /** "1 player and Ko (bot)": who waits at a lobby, counted, never named. */
  function whoWaits(tb) {
    const here = seated(tb), people = here.filter((s) => s.code === "p").length;
    const parts = people ? [`${people} player${people === 1 ? "" : "s"}`] : [];
    for (const s of here) if (s.code !== "p") parts.push(`${botName(s.code)} (bot)`);
    return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  }
  function describe(tb) {
    const free = 4 - seated(tb).length, size = `${tb.size}×${tb.size}`;
    return `the ${size} lobby: ${whoWaits(tb)} waiting, ${free} seat${free === 1 ? "" : "s"} free`;
  }
  function captionFor(tb) {
    const size = `${tb.size}×${tb.size}`;
    if (tb.phase === "rise") return `A lobby just opened at ${size}.`;
    if (tb.sinkAt !== null) return tb.lanterns ? `The ${size} lobby is full: its game is starting.` : `The ${size} lobby closed.`;
    const bots = typeof pickedTotal === "function" && pickedTotal() > 0 ? " Your picked bots stay here, for a table of your own." : "";
    return `${describe(tb).slice("the ".length)}. Click to join them.${bots}`;
  }

  // ---- layout: slots on this river, a slot per table, nearest the main island first ----
  function layout() {
    const g = window.GoLogo.geometry();
    if (!g) return false;
    const key = `${g.W}x${g.H}@${g.islandX}`;
    if (key !== layoutKey) {
      layoutKey = key;
      slots = core.layoutSlots(g);
      for (const tb of lobbies.all()) tb.slot = -1; // a new river: every islet takes a slot anew
      surf = new G.Surface(g.W, g.H);
      canvas.width = g.W;
      canvas.height = g.H;
      image = ctx.createImageData(g.W, g.H);
      mask = new Uint8Array(g.W * g.H);
    }
    const used = new Set(lobbies.all().map((tb) => tb.slot).filter((s) => s >= 0));
    for (const tb of lobbies.all()) {
      if (tb.slot >= 0) continue;
      const free = slots.findIndex((_, i) => !used.has(i));
      if (free < 0) continue; // more lobbies than water: the nearest ones show, the presence line counts them all
      tb.slot = free;
      used.add(free);
    }
    return true;
  }

  // ---- labels: "Lobby n/4" buttons over the islets ----
  const labelOf = new Map(); // roomId -> button
  function placeLabels(t) {
    const live = new Set();
    for (const tb of lobbies.all()) {
      if (tb.slot < 0 || tb.x0 === undefined) continue;
      live.add(tb.roomId);
      let el = labelOf.get(tb.roomId);
      if (!el) {
        el = document.createElement("button");
        el.type = "button";
        el.className = "islet-label";
        el.dataset.room = tb.roomId;
        el.addEventListener("click", () => join(tb.roomId));
        el.addEventListener("pointerenter", () => setHover(tb.roomId));
        el.addEventListener("focus", () => setHover(tb.roomId));
        el.addEventListener("blur", () => setHover(null));
        labelsEl.append(el);
        labelOf.set(tb.roomId, el);
      }
      const e = t - tb.t0, n = tb.seats.filter((s) => s && s.leftAt === null && s.at <= t).length;
      const open = core.joinable(tb), hot = open && hover === tb.roomId;
      let word = hot ? "Join" : "Lobby", seats = `${n}/4`, opacity = 1;
      if (tb.phase === "rise") { word = "New lobby"; seats = ""; opacity = reduced.matches ? 1 : clamp((e - core.RISE * 0.5) / (core.RISE * 0.5)); }
      else if (tb.sinkAt !== null && !tb.lanterns) { word = "Closed"; seats = ""; opacity = tb.phase === "sink" ? 1 - clamp(e / 0.5) : 1; }
      else if (tb.sinkAt !== null) { word = "Starting"; seats = "4/4"; opacity = tb.phase === "sink" ? 1 - clamp((e - 0.5) / 0.6) : 1; }
      const key = `${word}|${seats}`;
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        el.replaceChildren(word, ...(seats ? [" ", Object.assign(document.createElement("span"), { className: "seats", textContent: seats })] : []));
      }
      const name = open ? `Join ${describe(tb)}` : `${word}: the ${tb.size}×${tb.size} lobby`;
      if (el.getAttribute("aria-label") !== name) el.setAttribute("aria-label", name);
      el.disabled = !open;
      el.classList.toggle("hot", hot);
      el.style.opacity = String(Math.round(opacity * 100) / 100);
      el.style.left = `${((tb.x0 + tb.isle.cx) / surf.w) * 100}%`;
      el.style.top = `${((tb.y0 + tb.isle.oy - 3) / surf.h) * 100}%`; // on the grass over the deck, out over the water
    }
    for (const [id, el] of labelOf) {
      if (live.has(id)) continue;
      if (el === document.activeElement) el.blur();
      el.remove();
      labelOf.delete(id);
    }
  }
  const clamp = (v) => Math.max(0, Math.min(1, v));

  // ---- drawing ----
  let drawnEmpty = false;
  function render(t) {
    if (!layout()) return false;
    const busy = lobbies.advance(t);
    const shown = lobbies.all().filter((tb) => tb.slot >= 0);
    if (!shown.length && drawnEmpty) { placeLabels(t); return busy; } // nothing on the water, and the canvas says so already
    surf.fill(NONE);
    mask.fill(0);
    const lights = [];
    for (const tb of shown) {
      const slot = slots[tb.slot];
      core.drawIslet(surf, tb, slot.x, slot.y, t, { initialOf, mask, lights, hover, reduced: reduced.matches });
    }
    if (lights.length) { // lantern light on the islets only: never the kaya, and the river is logo.js's canvas
      for (let i = 0; i < mask.length; i++) if (surf.px[i] === NONE) mask[i] = 1;
      for (const l of lights) surf.ramp(G.LIGHT, l.x, l.y, l.r, l.s, 1, mask);
    }
    surf.toRGBA(image.data);
    for (let i = 0; i < surf.px.length; i++) if (surf.px[i] === NONE) image.data[i * 4 + 3] = 0;
    ctx.putImageData(image, 0, 0);
    drawnEmpty = !shown.length;
    placeLabels(t);
    return busy;
  }

  // At the scene's ambient 10 fps, and 30 while something moves; nothing while the lobby is hidden.
  let last = 0, moving = false;
  function tick(ms) {
    requestAnimationFrame(tick);
    if (lobby.hidden || document.hidden) return;
    if (ms - last < (moving ? 33 : 100)) return;
    last = ms;
    moving = render(now());
  }
  requestAnimationFrame(tick);

  // ---- pointer: the islet under it, its caption, a click joins ----
  function isletAt(evt) {
    if (!surf) return null;
    const rect = logo.getBoundingClientRect();
    const sx = Math.floor(((evt.clientX - rect.left) * surf.w) / rect.width), sy = Math.floor(((evt.clientY - rect.top) * surf.h) / rect.height);
    return lobbies.all().find((tb) => {
      if (tb.slot < 0 || tb.x0 === undefined || tb.phase === "sink") return false;
      const x = sx - tb.x0, y = sy - tb.y0, s = tb.isle;
      return x >= 0 && y >= 0 && x < s.W && y < s.H && s.region[y * s.W + x] !== core.R_NONE;
    }) || null;
  }
  function setHover(roomId) {
    if (roomId === hover) return;
    const had = hover !== null;
    hover = roomId;
    const tb = roomId && lobbies.get(roomId);
    wrap.style.cursor = tb && core.joinable(tb) ? "pointer" : "";
    if (tb) captionEl.textContent = captionFor(tb);
    else if (had && window.GoLobbyIsland && window.GoLobbyIsland.refreshCaption) window.GoLobbyIsland.refreshCaption(); // the main island's caption back
    if (!moving) render(now()); // the ghost stone and "Join" at once, not at the next ambient frame
  }
  const elsewhere = (evt) => evt.target.closest && evt.target.closest("#lobby-board-wrap, #github-link, .islet-label");
  wrap.addEventListener("pointermove", (evt) => {
    if (evt.target.closest && evt.target.closest(".islet-label")) return; // the label says which islet itself
    if (elsewhere(evt)) return setHover(null);
    setHover(isletAt(evt)?.roomId ?? null);
  });
  wrap.addEventListener("pointerleave", () => setHover(null));
  wrap.addEventListener("click", (evt) => {
    if (elsewhere(evt)) return;
    const tb = isletAt(evt);
    if (tb) join(tb.roomId);
  });
  function join(roomId) {
    const tb = lobbies.get(roomId);
    if (!tb || !core.joinable(tb) || typeof joinLobby !== "function") return;
    joinLobby(roomId);
  }

  window.GoLobbyIslets = {
    /** One answer of GET /tables (main.js pollTables); null when the server can't be asked. */
    sync(rooms, started) {
      lobbies.sync(rooms, started, now());
      if (!moving && !lobby.hidden) moving = render(now());
    },
    /** What the river shows, for the GUI tests: each lobby, its phase, seats, stones and label. */
    list() {
      return lobbies.all().map((tb) => ({
        roomId: tb.roomId,
        size: tb.size,
        phase: tb.phase,
        lanterns: tb.lanterns,
        seats: tb.seats.map((s) => (s && s.leftAt === null ? s.code : null)),
        stones: tb.seats.map((s, seat) => (s && s.leftAt === null ? { seat, letter: initialOf(s.code) } : null)).filter(Boolean),
        label: labelOf.get(tb.roomId)?.textContent ?? null,
      }));
    },
  };
})();
