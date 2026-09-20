// GoCalypse client: connects to a Colyseus room and renders its state as the
// pixel lantern-river scene (sprites.js + pixelScene.js). No build step.
//
// Board codes (see server/src/rules/goRules.ts): 1-4 a player's solid
// base-axis stone, 5-8 (player + 4) their grey pattern-axis stone, 9 driftwood.
// Left click places the solid stone, right click the grey pattern stone.

const G = window.GoSprites;
const P = window.GoPixelScene;

const MIN_SCALE = 1; // native pixel -> device pixels; the real scale fits the window
const MAX_SCALE = 6;
const FRAME_INTERVAL = 1 / 30;

const lobbyEl = document.getElementById("lobby");
const gameEl = document.getElementById("game");
const serverInput = document.getElementById("server-input");
const nameInput = document.getElementById("name-input");
const joinButton = document.getElementById("join-button");
const lobbyStatus = document.getElementById("lobby-status");

const roomStatusEl = document.getElementById("room-status");
const turnIndicatorEl = document.getElementById("turn-indicator");
const boardEl = document.getElementById("board");
const noticeEl = document.getElementById("notice");
const lastEventEl = document.getElementById("last-event");
const playersEl = document.getElementById("players");
const walletEl = document.getElementById("wallet");
const satchelItemsEl = document.getElementById("satchel-items");
const satchelCountEl = document.getElementById("satchel-count");
const stonesButton = document.getElementById("stones-button");
const targetingHintEl = document.getElementById("targeting-hint");
const marketStatusEl = document.getElementById("market-status");
const marketItemsEl = document.getElementById("market-items");
const helpButton = document.getElementById("help-button");
const welcomeEl = document.getElementById("welcome");
const welcomeCloseButton = document.getElementById("welcome-close");

const boardCtx = boardEl.getContext("2d");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
const clock = () => performance.now() / 1000;

let room = null;
let lastState = null;
let myPlayer = null;
let isMyTurn = false;
let selectedPowerup = null;
let hoverPoint = null; // {x, y} intersection under the mouse, or null

let scene = null;
let imageData = null;
let board = null; // latest board as a plain array
let overlays = []; // lily pads, wards and lightning fires: [{kind, x, y, owner, until}]
let effects = []; // animations in flight
let lastMove = null;
let lastActionSeq = null;
let lastFrameAt = 0;
let noticeTimer = null;
let welcomeChecked = false;
let storm = null; // {start, seq, strikes: [{x, y}]} while a thunderstorm plays
let lastStormSeq = null;
let turnCount = 0;
let roundLength = 0;
let stormUntil = 0; // turnCount when the current storm's fires go out; stones stay blacked out until then

// A URL hash lets debug.html drive this page from inside an <iframe>
// (prefill, auto-join, debug room) without touching the manual-join flow.
// The hash (not a query string) survives static hosts that 301-redirect
// "/index.html?..." to "/index" and drop the query (e.g. `npx serve`).
const hashParams = new URLSearchParams(location.hash.slice(1));
const ROOM_NAME = hashParams.get("room") === "go_debug" ? "go_debug" : "go_custom";
if (hashParams.has("server")) serverInput.value = hashParams.get("server");
if (hashParams.has("name")) nameInput.value = hashParams.get("name");
if (hashParams.has("autojoin")) {
  setTimeout(connect, Number(hashParams.get("delay")) || 0);
}

// Pattern stones come in four see-through designs (sprites.js), Plain by
// default. Pick one with #stones=plain|glass|paper|wash, or cycle them from
// the header to compare in play.
if (hashParams.has("stones")) G.setPatternStyle(hashParams.get("stones"));
updateStonesButton();
stonesButton.addEventListener("click", () => {
  const ids = G.PATTERN_STYLE_IDS;
  G.setPatternStyle(ids[(ids.indexOf(G.getPatternStyle()) + 1) % ids.length]);
  // Sidebar icons are cached as data URLs, and every panel caches what it drew.
  spriteUrlCache.clear();
  for (const el of [playersEl, satchelItemsEl, marketItemsEl]) delete el.dataset.sig;
  updateStonesButton();
  if (lastState) {
    renderSidebar(lastState);
    if (welcomeEl.open) openWelcome(lastState);
  }
});

function updateStonesButton() {
  const style = G.PATTERN_STYLES[G.getPatternStyle()];
  stonesButton.textContent = `Stones: ${style.label}`;
  stonesButton.title = `${style.note} Click for the next design.`;
}

joinButton.addEventListener("click", connect);
boardEl.addEventListener("mousemove", (evt) => (hoverPoint = eventPoint(evt)));
boardEl.addEventListener("mouseleave", () => (hoverPoint = null));
boardEl.addEventListener("click", onBoardClick);
boardEl.addEventListener("contextmenu", onBoardRightClick);
window.addEventListener("resize", sizeCanvas);
helpButton.addEventListener("click", () => lastState && openWelcome(lastState));
welcomeCloseButton.addEventListener("click", () => welcomeEl.close());
// The modal's backdrop swallows clicks, so a click outside the window closes
// it without also placing a stone on the board underneath.
welcomeEl.addEventListener("click", (evt) => {
  if (evt.target === welcomeEl && isOutside(welcomeEl, evt)) welcomeEl.close();
});
welcomeEl.addEventListener("contextmenu", (evt) => {
  if (evt.target !== welcomeEl || !isOutside(welcomeEl, evt)) return;
  evt.preventDefault();
  welcomeEl.close();
});
welcomeEl.addEventListener("close", markWelcomeSeen); // also fires for Esc
requestAnimationFrame(frame);

async function connect() {
  const endpoint = serverInput.value.trim() || "ws://localhost:2567";
  const name = nameInput.value.trim();

  joinButton.disabled = true;
  setLobbyStatus("Connecting...", false);

  try {
    const client = new Colyseus.Client(endpoint);
    room = await client.joinOrCreate(ROOM_NAME, name ? { name } : {});

    room.onStateChange((state) => onState(state));
    room.onMessage("notice", (text) => showNotice(text));
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

function showNotice(text) {
  noticeEl.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (noticeEl.textContent = ""), 4000);
}

// ---- scene & canvas -----------------------------------------------------------

function ensureScene(size) {
  if (scene && scene.layout.size === size) return;
  scene = P.createScene({ size });
  boardEl.width = scene.width;
  boardEl.height = scene.height;
  imageData = boardCtx.createImageData(scene.width, scene.height);
  sizeCanvas();
}

/**
 * Make the scene as large as it can be while the whole page still fits on one
 * screen: the largest whole number of device pixels per native pixel that
 * leaves room for the sidebar and the lines under the board. Whole device
 * pixels (not CSS pixels) keep every sprite pixel crisp on fractional-DPI
 * displays.
 */
function sizeCanvas() {
  if (!scene) return;
  const dpr = window.devicePixelRatio || 1;
  const sidebar = document.getElementById("sidebar");
  const body = document.getElementById("game-body");
  const gap = 20;
  const sideW = sidebar ? sidebar.getBoundingClientRect().width : 220;
  const bodyLeft = body ? body.getBoundingClientRect().left : 16;
  const availW = Math.max(120, window.innerWidth - bodyLeft * 2 - sideW - gap);
  // Room for the header above and the hint / notice / last-event lines below.
  const top = body ? body.getBoundingClientRect().top : 60;
  const availH = Math.max(120, window.innerHeight - top - 78);

  const scale = Math.min(
    MAX_SCALE,
    Math.max(MIN_SCALE, Math.floor(Math.min((availW * dpr) / scene.width, (availH * dpr) / scene.height)))
  );
  boardEl.style.width = `${(scene.width * scale) / dpr}px`;
  boardEl.style.height = `${(scene.height * scale) / dpr}px`;
}

function reducedMotion() {
  return reducedMotionQuery.matches;
}

function frame() {
  requestAnimationFrame(frame);
  if (!scene || !board) return;
  const now = clock();
  if (now - lastFrameAt < FRAME_INTERVAL) return;
  lastFrameAt = now;

  const reduced = reducedMotion();
  effects = P.pruneEffects(effects, now, reduced);
  if (storm && now - storm.start >= P.STORM_SECONDS) storm = null;
  scene.render({
    time: now,
    board,
    hover: hoverPoint,
    hoverKind: hoverKind(),
    myColor: myPlayer ? myPlayer.color : 0,
    lastMove,
    effects,
    overlays,
    storm,
    turnCount,
    roundLength,
    stormUntil,
    reducedMotion: reduced,
  });
  imageData.data.set(scene.rgba);
  boardCtx.putImageData(imageData, 0, 0);
}

function lilyOwnerAt(x, y) {
  const pad = overlays.find((o) => o.kind === "lily" && o.x === x && o.y === y);
  return pad ? pad.owner : 0;
}

function burningAt(x, y) {
  return overlays.some((o) => o.kind === "fire" && o.x === x && o.y === y);
}

/** What the hovered point shows: a powerup reticle, the split stone preview, or just the coordinates. */
function hoverKind() {
  if (!hoverPoint) return "none";
  if (selectedPowerup) return "target";
  if (!isMyTurn || !myPlayer) return "none";
  if (burningAt(hoverPoint.x, hoverPoint.y)) return "none"; // nothing can be played into a fire
  const owner = lilyOwnerAt(hoverPoint.x, hoverPoint.y);
  return owner && owner !== myPlayer.color ? "none" : "stone";
}

// ---- input ------------------------------------------------------------------------

function eventPoint(evt) {
  if (!scene) return null;
  const rect = boardEl.getBoundingClientRect();
  const nx = ((evt.clientX - rect.left) * scene.width) / rect.width;
  const ny = ((evt.clientY - rect.top) * scene.height) / rect.height;
  return scene.nativeToPoint(nx, ny);
}

function onBoardClick(evt) {
  if (!room || !lastState) return;
  const p = eventPoint(evt);
  if (!p) return;

  if (selectedPowerup) {
    room.send("usePowerup", { id: selectedPowerup, target: p });
    setSelectedPowerup(null);
    return;
  }
  room.send("move", { x: p.x, y: p.y, axis: "base" });
}

/** Right click places the grey pattern stone -- or cancels powerup targeting. */
function onBoardRightClick(evt) {
  evt.preventDefault();
  if (!room || !lastState) return;
  if (selectedPowerup) {
    setSelectedPowerup(null);
    return;
  }
  const p = eventPoint(evt);
  if (!p) return;
  room.send("move", { x: p.x, y: p.y, axis: "pattern" });
}

function setSelectedPowerup(id) {
  selectedPowerup = id;
  boardEl.classList.toggle("targeting", !!id);
  const item = id && marketItem(id);
  targetingHintEl.hidden = !id;
  targetingHintEl.textContent = item ? `Pick a point for ${item.name} -- right click to cancel.` : "";
  if (lastState) renderSidebar(lastState);
}

// ---- state --------------------------------------------------------------------------

function onState(state) {
  lastState = state;
  ensureScene(state.size);

  const nextBoard = Array.from(state.board);
  const nextOverlays = Array.from(state.effects)
    .filter((e) => e.kind === "lily" || e.kind === "ward" || e.kind === "fire")
    .map((e) => ({ kind: e.kind, x: e.x, y: e.y, owner: e.owner, until: e.until }));
  const action = state.action;
  const actionChanged = lastActionSeq !== null && action.seq !== lastActionSeq;
  turnCount = state.turnCount;
  roundLength = state.players.length;
  // Synced, not derived from the ~10s cloudburst animation: a client that
  // joins mid-storm gets the blacked-out stones without ever seeing the flash.
  stormUntil = state.storm.until;

  // A fresh die roll of 6: the sky opens. Only a change in seq starts the
  // animation, so joining mid-match never replays an old storm.
  if (state.storm && lastStormSeq !== null && state.storm.seq !== lastStormSeq) {
    startStorm(state);
  }
  if (state.storm) lastStormSeq = state.storm.seq;

  if (board) {
    const known = new Set(overlays.map(overlayKey));
    const nextKeys = new Set(nextOverlays.map(overlayKey));
    const fresh = nextOverlays.filter((o) => !known.has(overlayKey(o)));
    const gone = overlays.filter((o) => !nextKeys.has(overlayKey(o)));
    const act = actionChanged ? { kind: action.kind, id: action.id, x: action.x, y: action.y } : null;
    effects = effects.concat(P.diffTurn(board, nextBoard, state.size, act, fresh, clock(), gone));
  }
  if ((actionChanged || lastActionSeq === null) && action.kind === "move") {
    lastMove = { x: action.x, y: action.y };
  }
  lastActionSeq = action.seq;
  board = nextBoard;
  overlays = nextOverlays;

  const players = Array.from(state.players);
  myPlayer = players.find((p) => p.sessionId === room.sessionId) || null;
  const myIndex = myPlayer ? players.indexOf(myPlayer) : -1;
  // turnIndex defaults to 0, so without the status check the player in seat
  // 0 would see "your turn" (and the hover preview) while still waiting for
  // players -- before the server will even accept a move.
  isMyTurn = state.status === "playing" && myIndex !== -1 && myIndex === state.turnIndex;
  if (!isMyTurn && selectedPowerup) setSelectedPowerup(null);

  renderStatus(state, players);
  boardEl.classList.toggle("my-turn", isMyTurn && !selectedPowerup);
  renderSidebar(state);
  lastEventEl.textContent = state.lastEvent || "";

  if (!welcomeChecked && myPlayer) {
    welcomeChecked = true;
    if (!hashParams.has("nowelcome") && !welcomeSeen()) openWelcome(state);
  }
}

// ---- welcome screen -------------------------------------------------------------

const WELCOME_KEY = "gocalypse.welcomeSeen";

function welcomeSeen() {
  try {
    return localStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    return false;
  }
}

function markWelcomeSeen() {
  try {
    localStorage.setItem(WELCOME_KEY, "1");
  } catch {
    // Storage blocked (private mode): it will just show again next time.
  }
}

function isOutside(el, evt) {
  const r = el.getBoundingClientRect();
  return evt.clientX < r.left || evt.clientX > r.right || evt.clientY < r.top || evt.clientY > r.bottom;
}

const LOOK_NAMES = { 1: ["black", "dots"], 2: ["white", "dots"], 3: ["black", "stripes"], 4: ["white", "stripes"] };

function stoneChip(code) {
  const chip = document.createElement("span");
  chip.className = "stone-chip";
  chip.append(spriteImg(`stone_big_${code}`, G.stoneSprite(code), 2));
  return chip;
}

function openWelcome(state) {
  const color = myPlayer ? myPlayer.color : 1;
  const [base, pattern] = LOOK_NAMES[color] || LOOK_NAMES[1];

  document.getElementById("welcome-you").textContent =
    `You play ${base} with ${pattern}. Every move, you choose which of the two your stone fights with:`;
  document.getElementById("welcome-base-icon").replaceChildren(stoneChip(color));
  document.getElementById("welcome-pattern-icon").replaceChildren(stoneChip(color + 4));

  // Rates mirror FIREFLIES_PER_MOVE / _PER_CAPTURE / CONSOLATION_PER_STONE in server/src/rooms/GoRoom.ts.
  document.getElementById("welcome-economy").textContent =
    `You earn fireflies: 3 for every stone you place and 5 for every stone you capture. ` +
    `If someone's item removes one of your stones, you get 3 back. ` +
    `Once you've placed ${state.shopAfter} stones, the Night Market opens in the sidebar. It stocks five items a night, ` +
    `only one of them a powerful one. Your satchel holds ${state.satchelLimit} items and just ${state.powerfulLimit} powerful item at a time. ` +
    `Buying doesn't use your turn; using an item does: pick it in your Satchel, then click a point on the board (right click cancels).`;

  document.getElementById("welcome-weather").textContent =
    `Every 20 turns a die is rolled behind the clouds. On a six a thunderstorm breaks: the night goes dark, ` +
    `rain sweeps the board and up to three bolts come down on random points. Whatever stands there catches fire ` +
    `and burns away three rounds later, and nobody can play on a burning point until the fire goes out.`;

  const list = document.getElementById("welcome-powerups");
  list.replaceChildren();
  for (const m of Array.from(state.market)) {
    const row = document.createElement("div");
    row.className = "welcome-item";
    const text = document.createElement("div");
    const title = document.createElement("div");
    title.className = "title";
    const name = document.createElement("span");
    name.textContent = m.name;
    title.append(name, fireflies(m.price));
    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = m.description;
    text.append(title, desc);
    row.append(spriteImg(`icon_${m.id}`, G.powerupIcon(m.id) || G.SPRITES.fireflyIcon, 2), text);
    list.appendChild(row);
  }

  if (!welcomeEl.open) welcomeEl.showModal();
}

function overlayKey(o) {
  return `${o.kind}:${o.x},${o.y}`;
}

/**
 * Start the 10-second cloudburst for the storm in `state`. The server picked
 * the strike points (board indices) when it rolled a 6; the client only plays
 * them out, one bolt at a time, and lights each fire as its bolt lands.
 */
function startStorm(state) {
  const size = state.size;
  const indices = [state.storm.strike0, state.storm.strike1, state.storm.strike2]
    .slice(0, Math.max(0, state.storm.strikes))
    .filter((i) => i >= 0 && i < size * size);
  storm = {
    start: clock(),
    seq: state.storm.seq,
    strikes: indices.map((i) => ({ x: i % size, y: Math.floor(i / size) })),
  };
  showNotice("Thunder overhead -- lightning is coming down on the board.");
}

function renderStatus(state, players) {
  const statusLabel = {
    waiting: `Waiting for players (${players.length}/4)...`,
    playing: "Game in progress",
    finished: "Game finished",
  }[state.status] || state.status;
  roomStatusEl.textContent = statusLabel;

  if (state.status !== "playing") {
    turnIndicatorEl.textContent = "";
    turnIndicatorEl.classList.remove("my-turn");
    return;
  }
  const current = players[state.turnIndex];
  turnIndicatorEl.textContent = isMyTurn ? "Your turn" : `${current ? current.name : "?"}'s turn`;
  turnIndicatorEl.classList.toggle("my-turn", isMyTurn);
}

function marketItem(id) {
  return lastState ? Array.from(lastState.market).find((m) => m.id === id) : null;
}

// ---- sidebar ------------------------------------------------------------------------

const spriteUrlCache = new Map();

/** A palette sprite as a PNG data URL (transparent where the sprite is). */
function spriteUrl(key, spr) {
  if (!spr) return "";
  if (spriteUrlCache.has(key)) return spriteUrlCache.get(key);
  const c = document.createElement("canvas");
  c.width = spr.w;
  c.height = spr.h;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(spr.w, spr.h);
  for (let i = 0; i < spr.px.length; i++) {
    const v = spr.px[i];
    if (v === G.TRANSPARENT) continue;
    const [r, g, b] = G.PALETTE_RGB[v];
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const url = c.toDataURL();
  spriteUrlCache.set(key, url);
  return url;
}

function spriteImg(key, spr, scale) {
  const img = document.createElement("img");
  img.className = "px";
  img.alt = "";
  img.src = spriteUrl(key, spr);
  img.width = spr.w * scale;
  img.height = spr.h * scale;
  return img;
}

function fireflies(amount) {
  const span = document.createElement("span");
  span.className = "ff";
  span.append(spriteImg("firefly", G.SPRITES.fireflyIcon, 2), document.createTextNode(String(amount)));
  return span;
}

/** Rebuild an element only when what it shows changed (keeps buttons stable under the cursor). */
function rebuild(el, signature, build) {
  if (el.dataset.sig === signature) return;
  el.dataset.sig = signature;
  el.replaceChildren();
  build();
}

function renderSidebar(state) {
  renderPlayers(state);
  renderWallet(state);
  renderSatchel(state);
  renderMarket(state);
}

function renderPlayers(state) {
  const players = Array.from(state.players);
  const sig = JSON.stringify([
    state.turnIndex, state.status, myPlayer && myPlayer.sessionId,
    players.map((p) => [p.name, p.color, p.connected, p.score, p.fireflies]),
  ]);
  rebuild(playersEl, sig, () => {
    // Listed by color, which is also the turn order (the synced array is join order).
    const seats = players.map((player, index) => ({ player, index })).sort((a, b) => a.player.color - b.player.color);
    seats.forEach(({ player, index }) => {
      const row = document.createElement("div");
      row.className = "player-row";
      if (state.status === "playing" && index === state.turnIndex) row.classList.add("current");
      if (!player.connected) row.classList.add("disconnected");

      const swatches = document.createElement("span");
      swatches.className = "swatch-pair";
      swatches.title = "Left click: solid color · Right click: grey pattern";
      swatches.append(
        spriteImg(`stone_${player.color}`, G.stoneSprite(player.color, "icon"), 2),
        spriteImg(`stone_${player.color + 4}`, G.stoneSprite(player.color + 4, "icon"), 2)
      );

      const name = document.createElement("span");
      name.className = "name";
      name.textContent = player.name + (room && player.sessionId === room.sessionId ? " (you)" : "");

      const score = document.createElement("span");
      score.className = "score";
      score.title = "Stones captured";
      score.textContent = `${player.score}`;

      row.append(swatches, name, fireflies(player.fireflies), score);
      playersEl.appendChild(row);
    });
  });
}

function renderWallet(state) {
  const amount = myPlayer ? myPlayer.fireflies : 0;
  rebuild(walletEl, String(amount), () => {
    const label = document.createElement("span");
    label.textContent = "Your fireflies";
    const value = fireflies(amount);
    value.classList.add("amount");
    walletEl.append(label, value);
  });
}

/** Removal ("powerful") items the viewing player is carrying right now. */
function powerfulHeld() {
  if (!myPlayer) return 0;
  return Array.from(myPlayer.powerups).filter((id) => {
    const item = marketItem(id);
    return item && item.removal;
  }).length;
}

function renderSatchel(state) {
  const owned = myPlayer ? Array.from(myPlayer.powerups) : [];
  const counts = new Map();
  owned.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  satchelCountEl.textContent = `${owned.length}/${state.satchelLimit}`;
  satchelCountEl.classList.toggle("full", owned.length >= state.satchelLimit);
  const sig = JSON.stringify([Array.from(counts), isMyTurn, selectedPowerup]);
  rebuild(satchelItemsEl, sig, () => {
    if (counts.size === 0) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = "Empty. Buy items at the Night Market.";
      satchelItemsEl.appendChild(p);
      return;
    }
    for (const [id, count] of counts) {
      const item = marketItem(id) || { name: id, description: "" };
      const button = document.createElement("button");
      button.className = "slot";
      button.dataset.id = id;
      button.setAttribute("aria-label", item.name);
      button.title = `${item.name}: ${item.description}`;
      button.disabled = !isMyTurn;
      button.classList.toggle("active", selectedPowerup === id);
      button.append(spriteImg(`icon_${id}`, G.powerupIcon(id) || G.SPRITES.fireflyIcon, 2));
      if (count > 1) {
        const badge = document.createElement("span");
        badge.className = "count";
        badge.textContent = String(count);
        button.append(badge);
      }
      button.addEventListener("click", () => setSelectedPowerup(selectedPowerup === id ? null : id));
      satchelItemsEl.appendChild(button);
    }
  });
}

function renderMarket(state) {
  const me = myPlayer;
  const moves = me ? me.moves : 0;
  const open = !!me && state.status === "playing" && moves >= state.shopAfter;
  const bought = me ? Array.from(me.bought) : [];
  const wallet = me ? me.fireflies : 0;

  const held = me ? Array.from(me.powerups).length : 0;
  const full = held >= state.satchelLimit;
  const powerfulFull = powerfulHeld() >= state.powerfulLimit;

  marketStatusEl.textContent = open
    ? `Five stalls tonight. Your satchel holds ${state.satchelLimit}, and only ${state.powerfulLimit} powerful item at a time.`
    : `Opens after ${state.shopAfter} moves (${Math.min(moves, state.shopAfter)}/${state.shopAfter}).`;

  const items = Array.from(state.market);
  const sig = JSON.stringify([open, wallet, bought, held, powerfulFull, items.map((m) => m.id)]);
  rebuild(marketItemsEl, sig, () => {
    for (const m of items) {
      const soldOut = m.removal && bought.includes(m.id);
      const blocked = full || (m.removal && powerfulFull);
      const button = document.createElement("button");
      button.className = "item";
      button.title = soldOut
        ? `${m.name} has already been bought this match.`
        : full
        ? `Your satchel is full (${state.satchelLimit} items).`
        : m.removal && powerfulFull
        ? `You can only carry ${state.powerfulLimit} powerful item at a time.`
        : m.description;
      button.disabled = !open || soldOut || blocked || wallet < m.price;

      const text = document.createElement("span");
      text.className = "text";
      const title = document.createElement("span");
      title.className = "title";
      const name = document.createElement("span");
      name.textContent = m.name;
      title.append(name, soldOut ? tag("bought") : blocked ? tag("no room") : fireflies(m.price));
      const desc = document.createElement("span");
      desc.className = "desc";
      desc.textContent = m.description;
      text.append(title, desc);

      button.append(spriteImg(`icon_${m.id}`, G.powerupIcon(m.id) || G.SPRITES.fireflyIcon, 2), text);
      button.addEventListener("click", () => room && room.send("buy", { id: m.id }));
      marketItemsEl.appendChild(button);
    }
  });
}

function tag(text) {
  const span = document.createElement("span");
  span.className = "tag";
  span.textContent = text;
  return span;
}
