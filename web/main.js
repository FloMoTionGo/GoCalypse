// Minimal GoCalypse client: connects to the Colyseus "go_custom" room and
// renders whatever state it receives. No build step — plain browser JS.

// Labels for known powerup ids. Must match the ids registered in
// server/src/powerups/definitions.ts; unknown ids still work, just show raw.
const POWERUP_INFO = {
  bomb: { name: "Bomb", description: "Clear a 3x3 area" },
  remove_stone: { name: "Snipe", description: "Remove one enemy stone" },
};

const PLAYER_COLORS = ["", "#e05252", "#4f8ff0", "#4fd17a", "#f0c94f"];

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

joinButton.addEventListener("click", connect);
cancelTargetButton.addEventListener("click", () => setSelectedPowerup(null));

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

  room.send("move", { x, y });
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

function drawStone(x, y, color, alpha = 1) {
  const cx = pointToPixel(x);
  const cy = pointToPixel(y);
  const r = BOARD_SPACING / 2 - 2;

  boardCtx.save();
  boardCtx.globalAlpha = alpha;

  const gradient = boardCtx.createRadialGradient(cx - r * 0.35, cy - r * 0.35, r * 0.1, cx, cy, r);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.15, color);
  gradient.addColorStop(1, color);

  boardCtx.beginPath();
  boardCtx.arc(cx, cy, r, 0, Math.PI * 2);
  boardCtx.fillStyle = gradient;
  boardCtx.fill();
  boardCtx.lineWidth = 1;
  boardCtx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  boardCtx.stroke();

  boardCtx.restore();
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

  // Stones.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = lastState.board[y * size + x];
      if (value !== 0) drawStone(x, y, PLAYER_COLORS[value]);
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
      drawStone(hoverPoint.x, hoverPoint.y, PLAYER_COLORS[me.color], 0.45);
    }
  }
}

function renderPlayers(players, turnIndex, myIndex) {
  playersEl.innerHTML = "";
  players.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "player-row";
    if (index === turnIndex) row.classList.add("current");
    if (!player.connected) row.classList.add("disconnected");

    const swatch = document.createElement("span");
    swatch.className = `swatch p${player.color}`;
    swatch.style.background = `var(--p${player.color})`;

    const name = document.createElement("span");
    name.textContent = player.name + (index === myIndex ? " (you)" : "");

    const score = document.createElement("span");
    score.className = "score";
    score.textContent = player.score;

    row.append(swatch, name, score);
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
