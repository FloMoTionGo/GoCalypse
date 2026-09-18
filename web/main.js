// Minimal GoCalypse client: connects to the Colyseus "go_custom" room and
// renders whatever state it receives. No build step — plain browser JS.

// Labels for known powerup ids. Must match the ids registered in
// server/src/powerups/definitions.ts; unknown ids still work, just show raw.
const POWERUP_INFO = {
  bomb: { name: "Bomb", description: "Clear a 3x3 area" },
  remove_stone: { name: "Snipe", description: "Remove one enemy stone" },
};

// Each player has a fixed identity along two axes (matches
// server/src/rules/goRules.ts): a base tone (black/white) and a pattern
// (dots/stripes) -- 1 = black+dots, 2 = white+dots, 3 = black+stripes,
// 4 = white+stripes. But a stone only ever commits to ONE axis, chosen per
// move: left click places a solid stone in the player's base color; right
// click places a grey stone in the player's pattern instead. Board codes:
// 1-4 = that player's base-axis (solid) stone, 5-8 (player + 4) = that
// player's pattern-axis (grey) stone.
const BLACK = "#1c1c1c";
const WHITE = "#f2efe6";
const GREY = "#8a8a8a";
const GREY_MARK = "#3f3f3f";
const STONE_STYLES = [
  null,
  { base: BLACK, mark: null, pattern: null }, // 1: player 1, base axis -> solid black
  { base: WHITE, mark: null, pattern: null }, // 2: player 2, base axis -> solid white
  { base: BLACK, mark: null, pattern: null }, // 3: player 3, base axis -> solid black
  { base: WHITE, mark: null, pattern: null }, // 4: player 4, base axis -> solid white
  { base: GREY, mark: GREY_MARK, pattern: "dots" }, // 5: player 1, pattern axis -> grey dots
  { base: GREY, mark: GREY_MARK, pattern: "dots" }, // 6: player 2, pattern axis -> grey dots
  { base: GREY, mark: GREY_MARK, pattern: "stripes" }, // 7: player 3, pattern axis -> grey stripes
  { base: GREY, mark: GREY_MARK, pattern: "stripes" }, // 8: player 4, pattern axis -> grey stripes
];

function patternCode(playerColor) {
  return playerColor + 4;
}

const BOARD_MARGIN = 26;
const BOARD_SPACING = 32;

const lobbyEl = document.getElementById("lobby");
const gameEl = document.getElementById("game");
const serverInput = document.getElementById("server-input");
const nameInput = document.getElementById("name-input");
const joinButton = document.getElementById("join-button");
const lobbyStatus = document.getElementById("lobby-status");

const roomStatusEl = document.getElementById("room-status");
const turnIndicatorEl = document.getElementById("turn-indicator");
const boardEl = document.getElementById("board");
const lastEventEl = document.getElementById("last-event");
const playersEl = document.getElementById("players");
const powerupButtonsEl = document.getElementById("powerup-buttons");
const targetingHintEl = document.getElementById("targeting-hint");
const cancelTargetButton = document.getElementById("cancel-target");

const boardCtx = boardEl.getContext("2d");

let room = null;
let boardSize = null;
let selectedPowerup = null;
let lastState = null;
let myPlayer = null;
let hoverPoint = null; // {x, y} intersection under the mouse, or null

boardEl.addEventListener("mousemove", onBoardMouseMove);
boardEl.addEventListener("mouseleave", () => {
  hoverPoint = null;
  drawBoard();
});
boardEl.addEventListener("click", onBoardClick);
boardEl.addEventListener("contextmenu", onBoardRightClick);

joinButton.addEventListener("click", connect);
cancelTargetButton.addEventListener("click", () => setSelectedPowerup(null));

// A URL hash lets debug.html drive this page from inside an <iframe>
// (prefill + auto-join) without touching the normal manual-join flow. Using
// the hash rather than a query string matters: some static hosts (e.g.
// `npx serve`, via its default clean-URL redirect) 301 "/index.html?..." to
// "/index" and drop the query string entirely. A hash is never sent to the
// server, so no host's redirect/rewrite rules can touch it.
{
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has("server")) serverInput.value = params.get("server");
  if (params.has("name")) nameInput.value = params.get("name");
  if (params.has("autojoin")) {
    const delay = Number(params.get("delay")) || 0;
    setTimeout(connect, delay);
  }
}

async function connect() {
  const endpoint = serverInput.value.trim() || "ws://localhost:2567";
  const name = nameInput.value.trim();

  joinButton.disabled = true;
  setLobbyStatus("Connecting...", false);

  try {
    const client = new Colyseus.Client(endpoint);
    room = await client.joinOrCreate("go_custom", name ? { name } : {});

    room.onStateChange((state) => render(state));
    room.onLeave((code) => {
      setLobbyStatus(`Disconnected (code ${code}). Refresh to reconnect.`, true);
      gameEl.hidden = true;
      lobbyEl.hidden = false;
      joinButton.disabled = false;
    });
    room.onError((code, message) => {
      setLobbyStatus(`Room error ${code}: ${message || ""}`, true);
    });

    lobbyEl.hidden = true;
    gameEl.hidden = false;
  } catch (err) {
    console.error(err);
    setLobbyStatus(`Failed to join: ${err.message || err}`, true);
    joinButton.disabled = false;
  }
}

function setLobbyStatus(text, isError) {
  lobbyStatus.textContent = text;
  lobbyStatus.classList.toggle("error", !!isError);
}

function ensureBoard(size) {
  if (boardSize === size) return;
  boardSize = size;

  const cssSize = BOARD_MARGIN * 2 + (size - 1) * BOARD_SPACING;
  const dpr = window.devicePixelRatio || 1;
  boardEl.style.width = `${cssSize}px`;
  boardEl.style.height = `${cssSize}px`;
  boardEl.width = cssSize * dpr;
  boardEl.height = cssSize * dpr;
  boardCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** Standard-ish hoshi (star point) layout, generalized to arbitrary odd board sizes. */
function starPoints(size) {
  if (size < 9) return [];
  const edge = size >= 13 ? 3 : 2;
  const far = size - 1 - edge;
  if (edge >= far) return [];

  const isOdd = size % 2 === 1;
  const mid = isOdd ? (size - 1) / 2 : null;
  // Large boards (19x19-style) get the full 3x3 hoshi grid; smaller ones
  // (13x13, 9x9-style) traditionally only mark the 4 corners + tengen.
  const useFullGrid = size >= 17 && mid !== null;
  const coords = useFullGrid ? [edge, mid, far] : [edge, far];

  const points = [];
  for (const px of coords) {
    for (const py of coords) {
      points.push({ x: px, y: py });
    }
  }
  if (isOdd && !useFullGrid) {
    points.push({ x: mid, y: mid }); // tengen
  }
  return points;
}

function pointToPixel(i) {
  return BOARD_MARGIN + i * BOARD_SPACING;
}

function pixelToPoint(px, size) {
  const raw = Math.round((px - BOARD_MARGIN) / BOARD_SPACING);
  return Math.min(size - 1, Math.max(0, raw));
}

function eventToIntersection(evt) {
  const rect = boardEl.getBoundingClientRect();
  const x = pixelToPoint(evt.clientX - rect.left, boardSize);
  const y = pixelToPoint(evt.clientY - rect.top, boardSize);
  return { x, y };
}

function onBoardMouseMove(evt) {
  if (!lastState) return;
  hoverPoint = eventToIntersection(evt);
  drawBoard();
}

function onBoardClick(evt) {
  if (!room || !lastState) return;
  const { x, y } = eventToIntersection(evt);

  if (selectedPowerup) {
    room.send("usePowerup", { id: selectedPowerup, target: { x, y } });
    setSelectedPowerup(null);
    return;
  }

  room.send("move", { x, y, axis: "base" });
}

/** Right click always places the player's pattern (grey) stone -- powerups stay left-click only. */
function onBoardRightClick(evt) {
  evt.preventDefault();
  if (!room || !lastState) return;
  const { x, y } = eventToIntersection(evt);
  room.send("move", { x, y, axis: "pattern" });
}

function setSelectedPowerup(id) {
  selectedPowerup = id;
  targetingHintEl.hidden = !id;
  boardEl.classList.toggle("targeting", !!id);
  document.querySelectorAll(".powerup-button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.id === id);
  });
}

function render(state) {
  ensureBoard(state.size);
  lastState = state;

  const players = Array.from(state.players);
  const me = players.find((p) => p.sessionId === room.sessionId);
  const myIndex = players.indexOf(me);
  const isMyTurn = myIndex !== -1 && myIndex === state.turnIndex;
  myPlayer = me || null;

  renderStatus(state, players, isMyTurn);
  boardEl.classList.toggle("my-turn", isMyTurn && !selectedPowerup);
  drawBoard();
  renderPlayers(players, state.turnIndex, myIndex);
  renderPowerups(me, isMyTurn);

  lastEventEl.textContent = state.lastEvent || "";
}

function renderStatus(state, players, isMyTurn) {
  const statusLabel = {
    waiting: `Waiting for players (${players.length}/4)...`,
    playing: "Game in progress",
    finished: "Game finished",
  }[state.status] || state.status;
  roomStatusEl.textContent = statusLabel;

  if (state.status !== "playing") {
    turnIndicatorEl.textContent = "";
    return;
  }

  const current = players[state.turnIndex];
  turnIndicatorEl.textContent = isMyTurn ? "Your turn" : `${current ? current.name : "?"}'s turn`;
  turnIndicatorEl.classList.toggle("my-turn", isMyTurn);
}

function paintDots(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  const dotR = r * 0.15;
  const offset = r * 0.48;
  const positions = [
    [0, 0],
    [offset, offset],
    [-offset, offset],
    [offset, -offset],
    [-offset, -offset],
  ];
  for (const [dx, dy] of positions) {
    ctx.beginPath();
    ctx.arc(cx + dx, cy + dy, dotR, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintStripes(ctx, cx, cy, r, color) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = color;
  ctx.lineWidth = r * 0.42;
  for (const offset of [-r * 0.7, 0, r * 0.7]) {
    ctx.beginPath();
    ctx.moveTo(-r * 1.5, offset);
    ctx.lineTo(r * 1.5, offset);
    ctx.stroke();
  }
  ctx.restore();
}

/** Paints one stone (base tone + dots/stripes + glossy highlight) centered at (cx, cy) with radius r. */
function paintStoneStyle(ctx, cx, cy, r, style) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = style.base;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

  if (style.pattern === "dots") paintDots(ctx, cx, cy, r, style.mark);
  else if (style.pattern === "stripes") paintStripes(ctx, cx, cy, r, style.mark);

  const gloss = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r);
  gloss.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  gloss.addColorStop(0.35, "rgba(255, 255, 255, 0.08)");
  gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
  ctx.stroke();
}

function drawStone(x, y, colorIndex, alpha = 1) {
  const cx = pointToPixel(x);
  const cy = pointToPixel(y);
  const r = BOARD_SPACING / 2 - 2;

  boardCtx.save();
  boardCtx.globalAlpha = alpha;
  paintStoneStyle(boardCtx, cx, cy, r, STONE_STYLES[colorIndex]);
  boardCtx.restore();
}

/**
 * Preview stone for hovering before a move: left half shows the solid
 * base-color option (left click), right half shows the grey pattern option
 * (right click), split down the middle so both choices are visible at once.
 */
function paintSplitPreview(ctx, cx, cy, r, baseStyle, patternStyle) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  ctx.fillStyle = baseStyle.base;
  ctx.fillRect(cx - r, cy - r, r, r * 2);

  ctx.fillStyle = patternStyle.base;
  ctx.fillRect(cx, cy - r, r, r * 2);

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx, cy - r, r, r * 2);
  ctx.clip();
  if (patternStyle.pattern === "dots") paintDots(ctx, cx, cy, r, patternStyle.mark);
  else if (patternStyle.pattern === "stripes") paintStripes(ctx, cx, cy, r, patternStyle.mark);
  ctx.restore();

  const gloss = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.05, cx, cy, r);
  gloss.addColorStop(0, "rgba(255, 255, 255, 0.55)");
  gloss.addColorStop(0.35, "rgba(255, 255, 255, 0.08)");
  gloss.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gloss;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();

  ctx.restore();

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
  ctx.stroke();
}

function drawSplitPreview(x, y, playerColor, alpha) {
  const cx = pointToPixel(x);
  const cy = pointToPixel(y);
  const r = BOARD_SPACING / 2 - 2;

  boardCtx.save();
  boardCtx.globalAlpha = alpha;
  paintSplitPreview(boardCtx, cx, cy, r, STONE_STYLES[playerColor], STONE_STYLES[patternCode(playerColor)]);
  boardCtx.restore();
}

const swatchIconCache = new Map();

/** A small canvas-rendered PNG data URL of a stone style, for sidebar swatches. */
function stoneStyleIcon(colorIndex, size = 16) {
  if (swatchIconCache.has(colorIndex)) return swatchIconCache.get(colorIndex);

  const icon = document.createElement("canvas");
  icon.width = size;
  icon.height = size;
  const ctx = icon.getContext("2d");
  paintStoneStyle(ctx, size / 2, size / 2, size / 2 - 1, STONE_STYLES[colorIndex]);

  const url = icon.toDataURL();
  swatchIconCache.set(colorIndex, url);
  return url;
}

function drawBoard() {
  const me = myPlayer;
  if (!lastState) return;
  const size = lastState.size;
  const cssSize = BOARD_MARGIN * 2 + (size - 1) * BOARD_SPACING;

  // Wooden background (kaya-style gradient).
  const woodGradient = boardCtx.createLinearGradient(0, 0, cssSize, cssSize);
  woodGradient.addColorStop(0, "#e8c583");
  woodGradient.addColorStop(0.5, "#dcb35c");
  woodGradient.addColorStop(1, "#cf9f48");
  boardCtx.fillStyle = woodGradient;
  boardCtx.fillRect(0, 0, cssSize, cssSize);

  // Grid lines.
  boardCtx.strokeStyle = "#2a1b0a";
  boardCtx.lineWidth = 1;
  const last = size - 1;
  for (let i = 0; i < size; i++) {
    const p = pointToPixel(i);

    boardCtx.beginPath();
    boardCtx.moveTo(pointToPixel(0), p);
    boardCtx.lineTo(pointToPixel(last), p);
    boardCtx.stroke();

    boardCtx.beginPath();
    boardCtx.moveTo(p, pointToPixel(0));
    boardCtx.lineTo(p, pointToPixel(last));
    boardCtx.stroke();
  }

  // Star points (hoshi) and tengen.
  boardCtx.fillStyle = "#2a1b0a";
  for (const point of starPoints(size)) {
    boardCtx.beginPath();
    boardCtx.arc(pointToPixel(point.x), pointToPixel(point.y), 3.5, 0, Math.PI * 2);
    boardCtx.fill();
  }

  // Coordinate labels (0-indexed, matching the {x, y} the client/server
  // protocol actually uses) -- for reporting exact positions, not display.
  // The hovered column/row is skipped here and drawn later as a highlighted
  // label instead, so the plain label never shows through behind it.
  boardCtx.fillStyle = "#2a1b0a";
  boardCtx.font = "10px monospace";
  boardCtx.textBaseline = "middle";
  boardCtx.textAlign = "center";
  for (let i = 0; i < size; i++) {
    if (hoverPoint && i === hoverPoint.x) continue;
    boardCtx.fillText(String(i), pointToPixel(i), BOARD_MARGIN / 2);
  }
  boardCtx.textAlign = "right";
  for (let i = 0; i < size; i++) {
    if (hoverPoint && i === hoverPoint.y) continue;
    boardCtx.fillText(String(i), BOARD_MARGIN - 6, pointToPixel(i));
  }

  // Stones.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = lastState.board[y * size + x];
      if (value !== 0) drawStone(x, y, value);
    }
  }

  // Hover preview: ghost stone for a move, or a target ring for a powerup.
  if (hoverPoint) {
    const idx = hoverPoint.y * size + hoverPoint.x;
    const occupied = lastState.board[idx] !== 0;

    if (selectedPowerup) {
      const cx = pointToPixel(hoverPoint.x);
      const cy = pointToPixel(hoverPoint.y);
      boardCtx.beginPath();
      boardCtx.arc(cx, cy, BOARD_SPACING / 2 - 1, 0, Math.PI * 2);
      boardCtx.strokeStyle = "#4fa3ff";
      boardCtx.lineWidth = 2;
      boardCtx.stroke();
    } else if (me && !occupied && boardEl.classList.contains("my-turn")) {
      drawSplitPreview(hoverPoint.x, hoverPoint.y, me.color, 0.55);
    }

    // Highlight the hovered column/row's coordinate label so the exact
    // {x, y} is unambiguous before you click.
    boardCtx.save();
    boardCtx.fillStyle = "#4fa3ff";
    boardCtx.font = "bold 15px monospace";
    boardCtx.textBaseline = "middle";
    boardCtx.textAlign = "center";
    boardCtx.fillText(String(hoverPoint.x), pointToPixel(hoverPoint.x), BOARD_MARGIN / 2);
    boardCtx.textAlign = "right";
    boardCtx.fillText(String(hoverPoint.y), BOARD_MARGIN - 6, pointToPixel(hoverPoint.y));
    boardCtx.restore();
  }
}

function renderPlayers(players, turnIndex, myIndex) {
  playersEl.innerHTML = "";
  players.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "player-row";
    if (index === turnIndex) row.classList.add("current");
    if (!player.connected) row.classList.add("disconnected");

    const swatches = document.createElement("span");
    swatches.className = "swatch-pair";
    swatches.title = "Left click: solid color · Right click: grey pattern";

    const baseSwatch = document.createElement("span");
    baseSwatch.className = "swatch";
    baseSwatch.style.backgroundImage = `url(${stoneStyleIcon(player.color)})`;

    const patternSwatch = document.createElement("span");
    patternSwatch.className = "swatch";
    patternSwatch.style.backgroundImage = `url(${stoneStyleIcon(patternCode(player.color))})`;

    swatches.append(baseSwatch, patternSwatch);

    const name = document.createElement("span");
    name.textContent = player.name + (index === myIndex ? " (you)" : "");

    const score = document.createElement("span");
    score.className = "score";
    score.textContent = player.score;

    row.append(swatches, name, score);
    playersEl.appendChild(row);
  });
}

function renderPowerups(me, isMyTurn) {
  powerupButtonsEl.innerHTML = "";
  if (!me) return;

  Array.from(me.powerups).forEach((id) => {
    const info = POWERUP_INFO[id] || { name: id, description: "" };
    const button = document.createElement("button");
    button.className = "powerup-button";
    button.dataset.id = id;
    button.textContent = `${info.name}`;
    button.title = info.description;
    button.disabled = !isMyTurn;
    button.classList.toggle("active", selectedPowerup === id);
    button.addEventListener("click", () => {
      setSelectedPowerup(selectedPowerup === id ? null : id);
    });
    powerupButtonsEl.appendChild(button);
  });
}
