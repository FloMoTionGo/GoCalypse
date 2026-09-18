// Minimal GoCalypse client: connects to the Colyseus "go_custom" room and
// renders whatever state it receives. No build step — plain browser JS.

// Labels for known powerup ids. Must match the ids registered in
// server/src/powerups/definitions.ts; unknown ids still work, just show raw.
const POWERUP_INFO = {
  bomb: { name: "Bomb", description: "Clear a 3x3 area" },
  remove_stone: { name: "Snipe", description: "Remove one enemy stone" },
};

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

let room = null;
let boardSize = null;
let selectedPowerup = null;

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
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${size}, 28px)`;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = String(x);
      cell.dataset.y = String(y);
      cell.addEventListener("click", () => onCellClick(x, y));
      boardEl.appendChild(cell);
    }
  }
}

function onCellClick(x, y) {
  if (!room) return;

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

  const players = Array.from(state.players);
  const me = players.find((p) => p.sessionId === room.sessionId);
  const myIndex = players.indexOf(me);
  const isMyTurn = myIndex !== -1 && myIndex === state.turnIndex;

  renderStatus(state, players, isMyTurn);
  renderBoard(state, players, isMyTurn);
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

function renderBoard(state, players, isMyTurn) {
  boardEl.classList.toggle("my-turn", isMyTurn && !selectedPowerup);

  const colorClass = ["", "p1", "p2", "p3", "p4"];
  const size = state.size;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const value = state.board[idx];
      const cell = boardEl.children[idx];
      const existingStone = cell.querySelector(".stone");

      if (value === 0) {
        if (existingStone) existingStone.remove();
      } else {
        const stone = existingStone || document.createElement("div");
        stone.className = `stone ${colorClass[value]}`;
        if (!existingStone) cell.appendChild(stone);
      }
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
