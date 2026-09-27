// GoCalypse lobby board: the home screen's bot menu and Join button, played as
// a Go board on a grassy island in the logo's lantern river. Each bot kind is a
// column, marked by its initial in the top frame like a board's coordinates
// (hover them for the bot's name and what it does), with its Night Market
// appetite as lanterns under them. Each row is a seat, P2 to P4, in the left
// frame (you are P1, on the nameplate): a black stone seats that column's bot there, a
// white stone captures it again. A black stone on Start joins. The name is
// written on a nameplate set into the frame above the kaya, over the bots.
//
// The island is drawn on its own transparent canvas at twice the logo's pixel
// size; logo.js lays it over the river, which it draws round the island's
// outline (window.GoLobbyIsland). Loaded after main.js and before logo.js.
//
// Drives main.js through its globals (BOT_OPTIONS, botPicks, changePick,
// pickedTotal, MAX_BOTS, joinButton, lobbyStatus), so the picks, the join flow
// and the welcome dialog's bot menu stay exactly as they were.
(function () {
  "use strict";
  const G = window.GoSprites;
  const PS = window.GoPixelScene;
  const canvas = document.getElementById("lobby-board");
  const wrap = document.getElementById("lobby-board-wrap");
  const labelsEl = document.getElementById("lobby-board-labels");
  const plateEl = document.getElementById("name-plate");
  const captionEl = document.getElementById("lobby-caption");
  const announceEl = document.getElementById("lobby-announce"); // polite live region: seat changes and refusals
  const lobby = document.getElementById("lobby");
  if (!G || !PS || !canvas || typeof BOT_OPTIONS === "undefined") return;
  const { K, C, A, T, S } = G.INDEX;
  const NONE = G.TRANSPARENT;
  const ANIMS = G.ANIMS;

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

  // ---------------------------------------------------------------------------
  // Layout (native px). Spacing matches the game board, so its stones and
  // placement / capture effects fit as they are.
  // ---------------------------------------------------------------------------
  const SP = PS.SPACING;
  const SEATS = MAX_BOTS; // one row per seat a bot can take: Player 2 to 4
  const COLS = BOT_OPTIONS.length; // one column per bot kind
  const ROWS = SEATS + 2; // the seats, an empty line, then Start
  const START_ROW = ROWS - 1, START_COL = (COLS - 1) >> 1;
  const KAYA_MARGIN = 6;
  const FRAME_TOP = 38, FRAME_LEFT = 38, FRAME_RIGHT = 16, FRAME_BOTTOM = 12; // the top holds your nameplate, then the bot initials and lamps
  const FRONT = 5; // the deck's front face
  const CLIFF = 3; // earth face under the island's near shore

  const kayaW = (COLS - 1) * SP + 2 * KAYA_MARGIN, kayaH = (ROWS - 1) * SP + 2 * KAYA_MARGIN;
  const boardW = FRAME_LEFT + kayaW + FRAME_RIGHT, boardH = FRAME_TOP + kayaH + FRAME_BOTTOM;
  const deckH = boardH + FRONT;

  // The island: every point within a wobbly, saw-toothed margin of the deck.
  // Low sines make the outline wonky, a headland (bottom left, with the stone
  // lantern) and a cove (top right) break the box; teeth of random height make
  // the shore jagged.
  const bump = (a, at, width) => { const d = Math.atan2(Math.sin(a - at), Math.cos(a - at)) / width; return Math.exp(-d * d); };
  function shoreMargin(x, y) {
    const a = Math.atan2(y - deckH / 2, x - boardW / 2);
    let m = 14 + 5 * Math.sin(2 * a + 0.7) + 3.4 * Math.sin(3 * a + 2.1) + 2 * Math.sin(7 * a + 4.2) + 1 * Math.sin(13 * a + 1);
    m += 16 * bump(a, 2.35, 0.2) - 4 * bump(a, -0.75, 0.16) + 6 * bump(a, -2.2, 0.22) + 5 * bump(a, 0.35, 0.3);
    const u = ((a + Math.PI) / (2 * Math.PI)) * 150, q = Math.floor(u);
    m += (1 - Math.abs(2 * (u - q) - 1)) * (0.8 + hash2(q % 150, 0, 3) * 3.4) - 1.6;
    return Math.max(8, m);
  }
  function landRel(x, y) {
    const dx = x < 0 ? -x : x >= boardW ? x - boardW + 1 : 0;
    const dy = y < 0 ? -y : y >= deckH ? y - deckH + 1 : 0;
    return Math.hypot(dx, dy) < shoreMargin(x, y);
  }
  // Canvas = the island's bounding box, cliff included.
  let minX = 0, minY = 0, maxX = boardW - 1, maxY = deckH - 1;
  for (let y = -40; y < deckH + 40; y++) {
    for (let x = -40; x < boardW + 40; x++) {
      if (!landRel(x, y)) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y + CLIFF > maxY) maxY = y + CLIFF;
    }
  }
  const boardX = -minX, boardY = -minY;
  const W = maxX - minX + 1, H = maxY - minY + 1;
  const kayaX = boardX + FRAME_LEFT, kayaY = boardY + FRAME_TOP;
  const gridX = kayaX + KAYA_MARGIN, gridY = kayaY + KAYA_MARGIN;
  const boardRight = boardX + boardW, boardBottom = boardY + boardH, frontBottom = boardBottom + FRONT;
  const PLATE = { x: kayaX, y: boardY + 6, w: kayaW, h: 13 }; // P1, at the top of the frame over the bots
  const LAMP_Y = kayaY - 5; // the lamps' row in the top frame, under the bot names
  const NAME_Y = kayaY - 9; // foot of the bot initials
  const px = (col) => gridX + col * SP, py = (row) => gridY + row * SP;
  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  // ---------------------------------------------------------------------------
  // Static layer: island (grass, shore, cliff), the deck with its frame, kaya,
  // grid, lamps, plate. Everything off the island stays transparent.
  // ---------------------------------------------------------------------------
  const R_NONE = 0, R_LAND = 1, R_CLIFF = 2, R_DECK = 3;
  const GRASS_TALL = G.sprite("isleGrassTall", ["T...T", "T.T.T", ".TTT."]);
  const region = new Uint8Array(W * H);
  const base = new G.Surface(W, H);
  base.fill(NONE);
  const inDeck = (x, y) => x >= boardX && x < boardRight && y >= boardY && y < frontBottom;
  (function buildStatic() {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (inDeck(x, y)) region[idx(x, y)] = R_DECK;
        else if (landRel(x - boardX, y - boardY)) region[idx(x, y)] = R_LAND;
      }
    }
    // Cliff: the island's near shore shows its earth face down to the water.
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

    const isLand = (x, y) => inside(x, y) && region[idx(x, y)] >= R_LAND && region[idx(x, y)] !== R_CLIFF;
    function toShore(x, y, max) {
      for (let d = 1; d <= max; d++) {
        for (let k = -d; k <= d; k++) {
          if (!isLand(x + k, y - d) || !isLand(x + k, y + d) || !isLand(x - d, y + k) || !isLand(x + d, y + k)) return d;
        }
      }
      return max + 1;
    }
    // Grass: teal on the night earth, a lit rim along the shore, patches inland.
    const patch = (x, y) => Math.sin(x * 0.19 + Math.sin(y * 0.11) * 2.2) * Math.sin(y * 0.16 + Math.sin(x * 0.07) * 1.8 + 1.3);
    const shade = (x, y) => // the deck's shadow falls down and to the right
      (x >= boardRight && x < boardRight + 3 && y >= boardY + 3 && y < frontBottom + 3) ||
      (y >= frontBottom && y < frontBottom + 3 && x >= boardX + 3 && x < boardRight + 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const r = region[idx(x, y)];
        if (r === R_LAND) {
          const d = toShore(x, y, 3);
          let c = K;
          // a rocky slate lip on the water, then a band of grass, then lawn in patches
          if (d === 1) c = hash2(x, y, 7) < 0.7 ? S : K;
          else if (shade(x, y)) c = K;
          else if (d === 2) c = hash2(x, y, 8) < 0.25 ? S : G.ditherOn(x, y, 0.5) ? T : K;
          else if (d === 3) c = G.ditherOn(x, y, 0.5) ? T : K;
          else {
            const p = patch(x, y);
            if (p > 0.5 && G.ditherOn(x, y, 0.25)) c = T;
            else if (p > 0.1 && G.ditherOn(x, y, 0.125)) c = T;
          }
          base.px[idx(x, y)] = c;
        } else if (r === R_CLIFF) {
          // earth face, wet and catching the light at the waterline
          const d = cliff[idx(x, y)];
          base.px[idx(x, y)] = d === CLIFF || (d === CLIFF - 1 && G.ditherOn(x, y, 0.5)) ? S : d === 1 && hash2(x, 0, 9) < 0.3 ? T : K;
        }
      }
    }
    // Tufts, flowers and pebbles over the grass, clear of the deck and its shadow.
    const clear = (x0, y0, w, h) => {
      for (let y = y0 - 1; y <= y0 + h; y++) {
        for (let x = x0 - 1; x <= x0 + w; x++) {
          if (!inside(x, y) || region[idx(x, y)] !== R_LAND || shade(x, y)) return false;
        }
      }
      return true;
    };
    for (let gy = 0; gy * 4 < H; gy++) {
      for (let gx = 0; gx * 6 < W; gx++) {
        const x = gx * 6 + Math.floor(hash2(gx, gy, 21) * 4), y = gy * 4 + Math.floor(hash2(gx, gy, 22) * 3);
        const roll = hash2(gx, gy, 23);
        const spr = roll < 0.04 ? G.SPRITES.flower : roll < 0.07 ? G.SPRITES.pebble : roll < 0.32 ? GRASS_TALL
          : roll < 0.62 ? G.SPRITES.grassTuft : roll < 0.82 ? G.SPRITES.grassTuftSmall : null;
        if (spr && clear(x, y, spr.w, spr.h)) base.blit(spr, x, y);
      }
    }
    // A rock or two on the shore.
    for (const [x, y] of [[boardX - 9, boardY + 30], [boardRight + 4, frontBottom - 30], [boardX + 20, frontBottom + 5]]) {
      const rx = x + (G.SPRITES.rock.w >> 1), ry = y + G.SPRITES.rock.h - 1;
      if (inside(rx, ry) && region[idx(rx, ry)] === R_LAND) base.blit(G.SPRITES.rock, x, y);
    }

    // Deck: dark lacquer frame, slate rim light on the top and left, front edge catching light.
    base.rect(boardX, boardY, boardW, boardH, K);
    const bx1 = boardRight - 1, by1 = boardBottom - 1;
    for (let x = boardX + 1; x < bx1; x++) { base.set(x, boardY + 1, S); base.set(x, by1, S); }
    for (let y = boardY + 1; y < by1; y++) base.set(boardX + 1, y, S);
    // Front face: shadowed planks with slate seams.
    for (let y = boardBottom; y < frontBottom; y++) {
      for (let x = boardX; x < boardRight; x++) {
        const fy = y - boardBottom;
        base.set(x, y, fy >= 1 && fy <= 3 && (x - boardX) % 19 === 9 ? S : fy === 2 && (x - boardX) % 19 === 0 ? T : K);
      }
    }
    // Kaya, grid, and a hoshi on Start.
    base.rect(kayaX, kayaY, kayaW, kayaH, A);
    for (let c = 0; c < COLS; c++) for (let y = py(0); y <= py(ROWS - 1); y++) base.set(px(c), y, K);
    for (let r = 0; r < ROWS; r++) for (let x = px(0); x <= px(COLS - 1); x++) base.set(x, py(r), K);
    base.blitCentered(G.SPRITES.hoshi, px(START_COL), py(START_ROW));
    // Lamps in the top frame, three under each bot's initials: how much of the Night Market it uses.
    BOT_OPTIONS.forEach((o, c) => {
      for (let i = 0; i < 3; i++) {
        const lx = px(c) + (i - 1) * 4, ly = LAMP_Y;
        if (i < o.items) {
          base.set(lx, ly, C);
          base.set(lx - 1, ly, A); base.set(lx + 1, ly, A); base.set(lx, ly - 1, A); base.set(lx, ly + 1, A);
        } else base.set(lx, ly, S);
      }
    });
    // Nameplate: a kaya tag set into the frame, ink rim, a lit top edge.
    base.rect(PLATE.x, PLATE.y, PLATE.w, PLATE.h, K);
    base.rect(PLATE.x + 1, PLATE.y + 1, PLATE.w - 2, PLATE.h - 2, A);
    for (let x = PLATE.x + 2; x < PLATE.x + PLATE.w - 2; x++) if (G.ditherOn(x, PLATE.y + 1, 0.5)) base.set(x, PLATE.y + 1, C);
  })();
  const noLight = new Uint8Array(W * H);
  for (let y = kayaY; y < kayaY + kayaH; y++) for (let x = kayaX; x < kayaX + kayaW; x++) noLight[idx(x, y)] = 1;

  // ---------------------------------------------------------------------------
  // Ambient life on the island: reeds on the shore, fireflies over the grass
  // ---------------------------------------------------------------------------
  const r = rng(5);
  const shoreAt = (x, fromBottom) => { // the last land pixel of column x, from below or above
    if (fromBottom) { for (let y = H - 1; y >= 0; y--) if (region[idx(x, y)] === R_LAND) return y; }
    else { for (let y = 0; y < H; y++) if (region[idx(x, y)] === R_LAND) return y; }
    return -1;
  };
  const reeds = [];
  for (const [fx, bottom, anim] of [[0.08, true, "reedsTall"], [0.16, true, "reedsShort"], [0.9, true, "reedsTall"], [0.12, false, "reedsShort"], [0.86, false, "reedsShort"]]) {
    const x = Math.round(W * fx), y = shoreAt(x, bottom);
    if (y >= 0) reeds.push({ anim, x: x - 3, y: y - ANIMS[anim].frames[0].h + (bottom ? 1 : 4), phase: r() * 3 });
  }
  // The stone lantern on the headland: its tip is the land furthest out that way.
  const toro = (() => {
    const f0 = ANIMS.toro.frames[0], ux = Math.cos(2.35), uy = Math.sin(2.35);
    let best = -Infinity, tx = 0, ty = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const along = (x - W / 2) * ux + (y - H / 2) * uy;
        if (region[idx(x, y)] === R_LAND && along > best) { best = along; tx = x; ty = y; }
      }
    }
    return { x: Math.round(tx - ux * 12 - f0.w / 2), y: Math.round(ty - uy * 10 - f0.h) };
  })();
  const fireflies = [
    [boardX - 6, boardY + 50, 3, 20], [boardRight + 6, boardY + 70, 3, 24], [boardX + boardW * 0.35, frontBottom + 6, 22, 2], [boardX + boardW * 0.7, boardY - 6, 20, 2],
  ].map(([cx, cy, ax, ay]) => ({ cx, cy, ax, ay, fx: 0.25 + r() * 0.35, fy: 0.3 + r() * 0.4, p1: r() * 6.28, p2: r() * 6.28, period: 3 + r() * 3, phase: r() }));

  function animFrame(name, t, phase) {
    const a = ANIMS[name], n = a.frames.length;
    return a.frames[((Math.floor(t * a.fps + (phase || 0) * n) % n) + n) % n];
  }

  // ---------------------------------------------------------------------------
  // Play state: stones mirror main.js's bot picks, one stone per seat (row)
  // ---------------------------------------------------------------------------
  const seated = BOT_OPTIONS.map(() => []); // per bot (column): the seats (rows) holding its black stone, oldest first
  const ownerOf = (seat) => seated.findIndex((have) => have.includes(seat));
  let startStone = false, startAt = 0;
  let effects = [];
  let hover = null; // {col, row} under the pointer
  let cursor = { col: 0, row: 0 }; // keyboard point, shown while the board has focus
  let keyboard = false;
  let message = null, messageUntil = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const now = () => performance.now() / 1000;

  /** Brings the stones in line with the picks (joining clears them; the welcome menu shares them). */
  function reconcile(time) {
    BOT_OPTIONS.forEach((o, col) => {
      const want = botPicks.get(o.id) || 0, have = seated[col];
      while (have.length > want) have.pop();
      for (let s = 0; have.length < want && s < SEATS; s++) if (ownerOf(s) < 0) have.push(s);
    });
    // The Start stone stays while the join is under way, and goes when it failed or we are back.
    if (startStone && !joinButton.disabled && time - startAt > 0.6) startStone = false;
  }

  function say(text) {
    message = text;
    messageUntil = now() + 4;
    updateCaption();
    announce(text);
  }
  /** Tells screen readers what just happened (the caption itself follows the pointer, so it stays quiet). */
  function announce(text) {
    if (!announceEl) return;
    announceEl.textContent = "";
    requestAnimationFrame(() => { announceEl.textContent = text; });
  }

  function capture(col, row, time) {
    const have = seated[col];
    have.splice(have.indexOf(row), 1);
    changePick(BOT_OPTIONS[col].id, -1);
    effects.push(PS.captureEffect(col, row, 1, time));
  }

  function act(point, color) {
    if (!point) return;
    const time = now();
    if (point.row === START_ROW) {
      if (color === "white") return say("A white stone takes a bot off. Play black on Start to begin.");
      if (joinButton.disabled || startStone) return say(lobbyStatus.textContent || "Hold on a moment...");
      startStone = true;
      startAt = time;
      effects.push(PS.placeEffect(START_COL, START_ROW, 1, time));
      setTimeout(() => joinButton.click(), reduced.matches ? 0 : 320);
      return updateCaption();
    }
    const o = BOT_OPTIONS[point.col], have = seated[point.col];
    if (have.includes(point.row) || color === "white") {
      // White captures: the stone clicked, or the column's newest one.
      const seat = have.includes(point.row) ? point.row : have[have.length - 1];
      if (seat === undefined) return say(`No ${o.name} on the board to take off.`);
      capture(point.col, seat, time);
      announce(`${o.name} taken off ${seatName(seat)}.`);
      return updateCaption();
    }
    // Black on a seat another bot holds: that bot is captured and this one takes the seat.
    const other = ownerOf(point.row);
    if (other >= 0) capture(other, point.row, time);
    const replaced = other >= 0 ? ` ${BOT_OPTIONS[other].name} taken off.` : "";
    if (pickedTotal() >= MAX_BOTS) return say(`${MAX_BOTS} bots at most. Capture one with a white stone first.`);
    have.push(point.row);
    changePick(o.id, 1);
    effects.push(PS.placeEffect(point.col, point.row, 1, time));
    announce(`${o.name} seated as ${seatName(point.row)}.${replaced}`);
    updateCaption();
  }

  // ---------------------------------------------------------------------------
  // Caption under the scene: what the point under the pointer does
  // ---------------------------------------------------------------------------
  const touch = window.matchMedia("(pointer: coarse)");
  const seatName = (seat) => `Player ${seat + 2}`;
  function startText() {
    const n = pickedTotal();
    if (n === 0) return "Start: play a black stone here to join a table with other players.";
    const open = 3 - n; // four seats, one of them yours
    return `Start with ${n} bot${n === 1 ? "" : "s"}: play a black stone here.` +
      (open > 0 ? ` ${open === 1 ? "One seat stays" : `${open} seats stay`} open for other players.` : "");
  }
  function updateCaption() {
    let text;
    const p = keyboard ? cursor : hover;
    if (message && now() < messageUntil) text = message;
    else if (p && p.row === START_ROW) text = startText();
    else if (p) {
      const o = BOT_OPTIONS[p.col];
      text = `${o.name} as ${seatName(p.row)}, ${o.kind.toLowerCase()} (${o.itemsLabel.toLowerCase()}): ${o.desc}`;
    } else {
      const n = pickedTotal();
      text = (touch.matches
        ? "You are Player 1. Tap a bot's column in a seat's row to put that bot there, tap its stone to take it off, then tap Start."
        : "You are Player 1. A black stone (left click) seats a column's bot as that row's player, a white stone (right click) takes it off. Then play on Start.");
      if (n) text = `${n} of ${MAX_BOTS} bots seated. ` + text;
    }
    if (captionEl.textContent !== text) captionEl.textContent = text;
    for (const el of labelsEl.children) {
      const row = el.dataset.row === undefined ? -1 : Number(el.dataset.row);
      const col = el.dataset.col === undefined ? -1 : Number(el.dataset.col);
      el.classList.toggle("hot", !!p && (p.row === row || (p.row !== START_ROW && p.col === col)));
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  const surf = new G.Surface(W, H);
  const ctx = canvas.getContext("2d");
  canvas.width = W;
  canvas.height = H;
  const image = ctx.createImageData(W, H);

  function render(real) {
    const t = reduced.matches ? 0 : Math.floor(real * 10) / 10; // ambient at the scene's 10 fps
    surf.copyFrom(base);
    for (const rd of reeds) surf.blit(animFrame(rd.anim, t, rd.phase / 3), rd.x, rd.y);
    const toroFrame = Math.floor(t * ANIMS.toro.fps) % ANIMS.toro.frames.length;
    const toroSpr = ANIMS.toro.frames[toroFrame];
    surf.ramp(G.LIGHT, toro.x + (toroSpr.w >> 1), toro.y + 9, 15 + (toroFrame === 1 ? 2 : 0), 0.55, 1, noLight);
    surf.blit(G.SPRITES.rock, toro.x - 3, toro.y + toroSpr.h - 4);
    surf.blit(toroSpr, toro.x, toro.y);

    // stones: shadows first, then the stones, skipping any a placement is still dropping
    const busy = new Set(effects.filter((e) => e.kind === "place" && !PS.effectDone(e, real, reduced.matches)).map((e) => `${e.x},${e.y}`));
    const stones = [];
    seated.forEach((have, col) => have.forEach((row) => stones.push({ col, row })));
    if (startStone) stones.push({ col: START_COL, row: START_ROW });
    const black = G.STONES.black.normal, white = G.STONES.white.normal;
    for (const s of stones) {
      if (!busy.has(`${s.col},${s.row}`)) surf.blitCentered(black, px(s.col) + 1, py(s.row) + 1, { color: K, coverage: 0.5 });
    }
    for (const s of stones) if (!busy.has(`${s.col},${s.row}`)) surf.blitCentered(black, px(s.col), py(s.row));

    // the point under the pointer (or the keyboard cursor): the stone a click would play
    const p = keyboard ? cursor : hover;
    if (p) {
      const col = p.row === START_ROW ? START_COL : p.col;
      const taken = p.row < SEATS ? seated[col].includes(p.row) : startStone;
      const ghost = taken ? white : black;
      if (!(p.row === START_ROW && startStone)) surf.blitCentered(ghost, px(col), py(p.row), { coverage: taken ? 0.75 : 0.5 });
      if (keyboard) surf.blitCentered(animFrame("reticle", t), px(col), py(p.row));
    }
    // Start invites a stone: the game's target reticle breathing on the star point while it is free.
    if (!startStone && !keyboard) surf.blitCentered(animFrame("reticle", t), px(START_COL), py(START_ROW));

    // effects in flight: stones landing, captured stones floating off as lanterns
    effects = effects.filter((e) => !PS.effectDone(e, real, reduced.matches));
    for (const e of effects) {
      const glow = PS.drawEffect(surf, e, real - e.start, px(e.x), py(e.y), reduced.matches);
      if (glow) surf.ramp(G.LIGHT, glow.x, glow.y, glow.r, 0.6, 1, noLight);
    }

    // fireflies over the grass
    for (const ff of fireflies) {
      const u = frac(t / ff.period + ff.phase);
      const frame = u < 0.3 ? -1 : u < 0.55 ? 0 : u < 0.62 ? 1 : u < 0.8 ? 2 : u < 0.88 ? 1 : 3;
      if (frame < 0) continue;
      const x = Math.round(ff.cx + ff.ax * Math.sin(t * ff.fx + ff.p1)), y = Math.round(ff.cy + ff.ay * Math.sin(t * ff.fy + ff.p2));
      if (frame === 2) surf.ramp(G.LIGHT, x, y, 3.5, 0.7, 1, noLight);
      surf.blitCentered(ANIMS.firefly.frames[frame], x, y);
    }

    // off the island stays see-through, so the river shows
    surf.toRGBA(image.data);
    for (let i = 0; i < W * H; i++) if (surf.px[i] === NONE) image.data[i * 4 + 3] = 0;
    ctx.putImageData(image, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // Labels over the frame (seats, names, market, Start, P1) and the nameplate's input
  // ---------------------------------------------------------------------------
  function addLabel(text, row, y, cls) {
    const el = document.createElement("span");
    el.className = "board-label" + (cls ? " " + cls : "");
    el.textContent = text;
    if (row !== null) el.dataset.row = String(row);
    el.style.top = `${(y / H) * 100}%`;
    el.style.right = `${((W - kayaX + 5) / W) * 100}%`;
    labelsEl.appendChild(el);
    return el;
  }
  /** A bot's initial over its column. Hovering them shows its name and what it does in a tip on the kaya. */
  function addBotLabel(o, col) {
    const el = document.createElement("span");
    el.className = "board-label bot" + (col === 0 ? " tip-start" : col === COLS - 1 ? " tip-end" : "");
    el.dataset.col = String(col);
    el.dataset.id = o.id;
    const tip = document.createElement("span");
    tip.className = "bot-tip";
    const name = document.createElement("b");
    name.textContent = o.name;
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = `${o.kind} · ${o.itemsLabel}`;
    tip.append(name, kind, o.desc);
    el.append(o.name.slice(0, 1), tip); // the names are Go terms with distinct first letters
    el.style.left = `${((px(col) + 0.5) / W) * 100}%`;
    el.style.top = `${((NAME_Y + 1) / H) * 100}%`;
    labelsEl.appendChild(el);
    return el;
  }
  BOT_OPTIONS.forEach((o, col) => addBotLabel(o, col));
  for (let s = 0; s < SEATS; s++) addLabel(`P${s + 2}`, s, py(s) + 0.5);
  addLabel("Bots", null, NAME_Y + 1, "bots-head");
  addLabel("Item buys", null, LAMP_Y + 0.5, "market").title = "How often each bot buys Night Market items: 0 to 3 lit lanterns";
  addLabel("Start", START_ROW, py(START_ROW) + 0.5, "start");
  addLabel("P1", null, PLATE.y + PLATE.h / 2, "name");
  Object.assign(plateEl.style, {
    left: `${(PLATE.x / W) * 100}%`,
    top: `${(PLATE.y / H) * 100}%`,
    width: `${(PLATE.w / W) * 100}%`,
    height: `${(PLATE.h / H) * 100}%`,
  });

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function pointAt(evt) {
    const rect = canvas.getBoundingClientRect();
    const nx = ((evt.clientX - rect.left) * W) / rect.width, ny = ((evt.clientY - rect.top) * H) / rect.height;
    const col = Math.round((nx - gridX) / SP), row = Math.round((ny - gridY) / SP);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS || row === SEATS) return null;
    if (Math.abs(nx - px(col)) > SP / 2 || Math.abs(ny - py(row)) > SP / 2) return null;
    return { col: row === START_ROW ? START_COL : col, row };
  }
  canvas.addEventListener("pointermove", (evt) => {
    keyboard = false;
    const next = pointAt(evt);
    if (!next || !hover || next.row !== hover.row || next.col !== hover.col) message = null; // a new point: its own caption
    hover = next;
    canvas.style.cursor = hover ? "pointer" : "";
    updateCaption();
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    updateCaption();
  });
  canvas.addEventListener("pointerdown", (evt) => {
    if (evt.button !== 0 && evt.button !== 2) return;
    keyboard = false;
    act(pointAt(evt), evt.button === 2 ? "white" : "black");
  });
  canvas.addEventListener("contextmenu", (evt) => evt.preventDefault());
  canvas.addEventListener("keydown", (evt) => {
    const k = evt.key;
    const move = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[k];
    if (move) {
      evt.preventDefault();
      keyboard = true;
      let row = cursor.row + move[1];
      if (row === SEATS) row += move[1]; // hop the empty line
      row = Math.max(0, Math.min(START_ROW, row));
      const col = row === START_ROW ? START_COL : Math.max(0, Math.min(COLS - 1, (cursor.row === START_ROW && move[1] ? START_COL : cursor.col) + move[0]));
      cursor = { col, row };
      updateCaption();
      announce(captionEl.textContent); // the keyboard's point, read out as it moves
    } else if (k === "Enter" || k === " ") {
      evt.preventDefault();
      keyboard = true;
      act(cursor, "black");
    } else if (k === "Delete" || k === "Backspace" || k === "x") {
      evt.preventDefault();
      keyboard = true;
      act(cursor, "white");
    }
  });
  canvas.addEventListener("focus", () => { keyboard = canvas.matches(":focus-visible"); updateCaption(); });
  canvas.addEventListener("blur", () => { keyboard = false; updateCaption(); });

  // For logo.js, which lays the island in its river and sizes it (wrap's --np),
  // and for tests: the island's outline and the board's points in native px.
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) solid[i] = region[i] !== R_NONE ? 1 : 0;
  window.GoLobbyIsland = { W, H, solid, wrap, point: (col, row) => ({ x: px(col), y: py(row) }), cols: COLS, startRow: START_ROW };
  updateCaption();

  function tick() {
    requestAnimationFrame(tick);
    if (lobby.hidden || document.hidden) return;
    const time = now();
    reconcile(time);
    if (message && time >= messageUntil) { message = null; updateCaption(); }
    render(time);
  }
  requestAnimationFrame(tick);
})();
