// GoCalypse client: connects to a Colyseus room and renders its state as the
// pixel lantern-river scene (sprites.js + pixelScene.js). No build step.
//
// Board codes (see server/src/rules/goRules.ts): 1-4 a player's solid
// base-axis stone, 5-8 (player + 4) their gray (players 1-2) or transparent (players 3-4) stone, 9 driftwood.
// Left click places the solid stone, right click the gray or transparent one.

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
const handEl = document.getElementById("hand");
const marketStatusEl = document.getElementById("market-status");
const marketItemsEl = document.getElementById("market-items");
const helpButton = document.getElementById("help-button");
const welcomeEl = document.getElementById("welcome");
const welcomeCloseButton = document.getElementById("welcome-close");
const botsButton = document.getElementById("bots-button");
const passButton = document.getElementById("pass-button");
const resultButton = document.getElementById("result-button");
const resultEl = document.getElementById("result");
const resultCloseButton = document.getElementById("result-close");
const welcomeBotsEl = document.getElementById("welcome-bots");
const welcomeBotsIntroEl = document.getElementById("welcome-bots-intro");
const welcomeBotListEl = document.getElementById("welcome-bot-list");
const welcomeBotsAddButton = document.getElementById("welcome-bots-add");
const welcomeBotsNoteEl = document.getElementById("welcome-bots-note");
const lobbyBotListEl = document.getElementById("lobby-bot-list");
const boardHintEl = document.getElementById("board-hint");
const weatherEl = document.getElementById("weather");

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
// Recall: the last RECALL_STEPS boards before the live one, kept in the browser.
// Anyone can step back to look (bots move fast); nothing is sent to the server.
const RECALL_STEPS = 5;
let history = []; // [{id, seq, board, overlays, lastMove, event, turnCount}], oldest first, live is last (the storm's grey is always judged live)
let nextSnapId = 1;
let viewId = null; // id of the snapshot on screen, or null while live
const recallEl = document.getElementById("recall");
const recallStepsEl = document.getElementById("recall-steps");
let noticeTimer = null;
let welcomeChecked = false;
let resultOpened = false; // the final scores open by themselves once, when the game ends
const botPicks = new Map(); // bot id -> how many of that bot are picked, in the home and welcome screen menus
let closeWelcomeOnStart = false; // the player just seated bots that fill the table
let storm = null; // {start, seq, strikes: [{x, y}]} while a thunderstorm plays
let lastStormSeq = null;
let turnCount = 0;
let roundLength = 0;
let stormUntil = 0; // turnCount when the current storm's fires go out; the lingering weather lasts until then

// A URL hash lets debug.html drive this page from inside an <iframe>
// (prefill, auto-join, debug room) without touching the manual-join flow.
// The hash (not a query string) survives static hosts that 301-redirect
// "/index.html?..." to "/index" and drop the query (e.g. `npx serve`).
const hashParams = new URLSearchParams(location.hash.slice(1));
const ROOM_NAME = hashParams.get("room") === "go_debug" ? "go_debug" : "go_custom";
if (hashParams.has("server")) serverInput.value = hashParams.get("server");
if (hashParams.has("name")) nameInput.value = hashParams.get("name");
if (hashParams.has("autojoin")) {
  joinButton.disabled = true; // connect() is already on its way
  setTimeout(connect, Number(hashParams.get("delay")) || 0);
}

joinButton.addEventListener("click", connect);
boardEl.addEventListener("mousemove", (evt) => (hoverPoint = eventPoint(evt)));
boardEl.addEventListener("mouseleave", () => (hoverPoint = null));
document.getElementById("recall-back").addEventListener("click", () => stepRecall(1));
document.getElementById("recall-fwd").addEventListener("click", () => stepRecall(-1));
document.getElementById("recall-live").addEventListener("click", () => setView(0));
window.addEventListener("keydown", (evt) => {
  if (evt.altKey || evt.ctrlKey || evt.metaKey || document.querySelector("dialog[open]")) return;
  const t = evt.target && evt.target.tagName;
  if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") return;
  if (evt.key === "ArrowLeft") stepRecall(1);
  else if (evt.key === "ArrowRight") stepRecall(-1);
  else if (evt.key === "Escape" && selectedPowerup) setSelectedPowerup(null);
  else if (evt.key === "Escape" || evt.key === "End") setView(0);
  else return;
  evt.preventDefault();
});
boardEl.addEventListener("click", onBoardClick);
boardEl.addEventListener("contextmenu", onBoardRightClick);
window.addEventListener("resize", sizeCanvas);
helpButton.addEventListener("click", () => lastState && openWelcome(lastState));
welcomeCloseButton.addEventListener("click", () => welcomeEl.close());
botsButton.addEventListener("click", () => {
  if (!lastState) return;
  openWelcome(lastState);
  welcomeBotsEl.scrollIntoView({ block: "nearest" });
});
welcomeBotsAddButton.addEventListener("click", seatPickedBots);
passButton.addEventListener("click", () => room && room.send("pass"));
document.getElementById("leave-button").addEventListener("click", () => {
  const playing = lastState && lastState.status === "playing";
  if (playing && !confirm("Leave the game? A random bot takes your seat.")) return;
  leaving = true;
  try {
    sessionStorage.removeItem(PLAYER_KEY_STORE);
  } catch {}
  if (room) room.leave(true);
});
resultButton.addEventListener("click", () => lastState && openResult(lastState));
resultCloseButton.addEventListener("click", () => resultEl.close());
resultEl.addEventListener("click", (evt) => {
  if (evt.target === resultEl && isOutside(resultEl, evt)) resultEl.close();
});
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

// A secret this tab keeps (it survives a refresh, not closing the tab) and shows
// the server on every join. The server ties it to the seat, so a dropped
// connection or a restarted server can hand the same seat back (see /rejoin in
// server/src/index.ts). Debug panels share one origin, hence the name in the key.
const PLAYER_KEY_STORE = `gocalypse.playerKey.${hashParams.get("name") || ""}`;
let memoryKey = "";

function playerKey() {
  try {
    let key = sessionStorage.getItem(PLAYER_KEY_STORE);
    if (!key) sessionStorage.setItem(PLAYER_KEY_STORE, (key = crypto.randomUUID()));
    return key;
  } catch {
    return memoryKey || (memoryKey = crypto.randomUUID()); // storage blocked: rejoin works until refresh
  }
}

function serverEndpoint() {
  return serverInput.value.trim() || "ws://localhost:2567";
}

/**
 * Asks the server for this tab's seat in a game under way and sits back down.
 * False when there is no such game; throws when the server can't be reached.
 */
async function rejoin() {
  const endpoint = serverEndpoint();
  const res = await fetch(`${endpoint.replace(/^ws/, "http")}/rejoin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ playerKey: playerKey() }),
  });
  if (res.status === 404) return false;
  if (!res.ok) throw Object.assign(new Error(`your seat could not be handed back (${res.status}); try again in a moment`), { status: res.status });
  attachRoom(await new Colyseus.Client(endpoint).consumeSeatReservation(await res.json()));
  return true;
}

/** After an unexpected disconnect: keeps knocking (a restarting server takes a few seconds to wake). */
async function rejoinAfterDrop(inGame) {
  for (let attempt = 0; attempt < 10; attempt++) {
    setLobbyStatus(`Disconnected. Reconnecting... (${attempt + 1}/10)`, true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      if (await rejoin()) return;
      if (!inGame) {
        // The server is back but a lobby doesn't survive a restart: start a new one.
        setLobbyStatus("The server restarted. Press Join to start a new lobby.", true);
        joinButton.disabled = false;
        return;
      }
    } catch (err) {
      console.error(err);
    }
  }
  setLobbyStatus("Disconnected. Refresh to reconnect.", true);
  joinButton.disabled = false;
}

let leaving = false;
let lastPasses = null; // null until this room's first state, so a rejoin doesn't flash an old pass
let passFlashAt;

/**
 * Forgets everything the last room left behind. Without this a new game would
 * diff its first board against the old one (a capture for every old stone),
 * replay a storm, step back into the old game's boards and never open Results.
 */
function resetRoomState() {
  lastState = null;
  myPlayer = null;
  isMyTurn = false;
  selectedPowerup = null;
  firstTarget = null;
  boardEl.classList.remove("targeting", "my-turn");
  board = null; // the first state is taken as it stands, not diffed
  overlays = [];
  effects = [];
  lastMove = null;
  lastActionSeq = null;
  history = [];
  viewId = null;
  storm = null;
  lastStormSeq = null;
  turnCount = 0;
  roundLength = 0;
  stormUntil = 0;
  resultOpened = false;
  closeWelcomeOnStart = false;
  lastPasses = null;
  passFlashAt = undefined;
  handBought = null; // a new room: its first state is the satchel as it stands, nothing flies in
  if (resultEl.open) resultEl.close();
  renderRecall();
}

function attachRoom(joined) {
  // A second room (Join pressed while the page-load rejoin was still out): keep
  // the newest, and let the old one go without it touching the screen.
  const previous = room;
  resetRoomState();
  room = joined;
  if (previous && previous !== joined) previous.leave(true);
  // Every handler checks it still belongs to the room on screen.
  const current = () => room === joined;
  room.onStateChange((state) => current() && onState(state));
  room.onMessage("notice", (text) => current() && showNotice(text));
  room.onMessage("reveal", (text) => current() && showNotice(text, 15000));
  room.onLeave((code) => {
    if (!current()) return;
    room = null;
    if (leaving) {
      leaving = false;
      gameEl.hidden = true;
      lobbyEl.hidden = false;
      joinButton.disabled = false;
      setLobbyStatus("You left the game.", false);
      return;
    }
    const inGame = lastState && lastState.status === "playing";
    gameEl.hidden = true;
    lobbyEl.hidden = false;
    joinButton.disabled = true;
    // 1012 = the server is restarting (Fly stops an idle machine); anything else in a lobby stays manual.
    if (inGame || code === 1012) {
      rejoinAfterDrop(inGame);
    } else {
      setLobbyStatus(`Disconnected (code ${code}). Refresh to reconnect.`, true);
      joinButton.disabled = false;
    }
  });
  room.onError((code, message) => {
    if (!current()) return;
    setLobbyStatus(`Room error ${code}: ${message || ""}`, true);
  });

  lobbyEl.hidden = true;
  gameEl.hidden = false;
}

async function connect() {
  const endpoint = serverEndpoint();
  const name = nameInput.value.trim();
  const bots = pickedIds();

  joinButton.disabled = true;
  setLobbyStatus("Connecting...", false);

  try {
    // A refreshed tab goes back to its game rather than starting a new one.
    try {
      if (await rejoin()) return;
    } catch (err) {
      // The server has our game but refused the seat: joining a new lobby would
      // strand the old seat, which a bot then takes. Anything else: join normally.
      if (err.status) throw err;
      console.error(err);
    }

    const client = new Colyseus.Client(endpoint);
    const options = name ? { name, playerKey: playerKey() } : { playerKey: playerKey() };
    // Bringing bots means a table of your own; without them you are matched with
    // whoever is already waiting.
    attachRoom(bots.length ? await client.create(ROOM_NAME, options) : await client.joinOrCreate(ROOM_NAME, options));

    if (bots.length) {
      room.send("addBots", { ids: bots });
      botPicks.clear();
      renderLobbyBots();
    }
  } catch (err) {
    console.error(err);
    setLobbyStatus(`Failed to join: ${err.message || err}`, true);
    joinButton.disabled = false;
  }
}

// Opening the page (or refreshing it) in the middle of a game puts you back at
// the table. Panels that autojoin get the same from connect(). Join waits until
// the answer is in, or a click could open a second room beside the rejoined one.
if (!hashParams.has("autojoin")) {
  joinButton.disabled = true;
  rejoin()
    .catch(() => false)
    .then((found) => {
      if (!found) joinButton.disabled = false;
    });
}

function setLobbyStatus(text, isError) {
  lobbyStatus.textContent = text;
  lobbyStatus.classList.toggle("error", !!isError);
}

/** A pass is easy to miss in the log line: show the pixel PASS sign when the pass count goes up. */
function showPass(state) {
  if (lastPasses !== null && state.status === "playing" && state.passes > lastPasses && /passed/.test(state.lastEvent || "")) {
    passFlashAt = clock();
  }
  lastPasses = state.passes;
}

function showNotice(text, ms = 4000) {
  noticeEl.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (noticeEl.textContent = ""), ms);
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
  // Room for the header above and, below, the row of cards (with the recall strip)
  // and the hint / notice / last-event lines. The cards grow with the board.
  const top = body ? body.getBoundingClientRect().top : 60;
  const availH = Math.max(120, window.innerHeight - top - 66);

  let scale = MIN_SCALE;
  for (let s = MAX_SCALE; s > MIN_SCALE; s--) {
    if ((scene.width * s) / dpr <= availW && (scene.height * s) / dpr + handLayout(s, dpr).height <= availH) {
      scale = s;
      break;
    }
  }
  boardEl.style.width = `${(scene.width * scale) / dpr}px`;
  boardEl.style.height = `${(scene.height * scale) / dpr}px`;
  // One card pixel in CSS px: a whole number of device pixels, so the cards stay as crisp as the board.
  // Set on the root, since a card in flight lives outside the board's column.
  const hand = handLayout(scale, dpr);
  document.documentElement.style.setProperty("--card-px", `${hand.k / dpr}px`);
  // No room for the recall strip beside the cards: it goes under them, so the cards
  // don't jump down when the strip first shows up.
  document.getElementById("board-foot").classList.toggle("stacked", !hand.oneRow);
  hideCardZoom(); // drawn at the old card size
}

// The hand of cards under the board, in card pixels (see #board-foot / #hand in style.css).
const CARD_ROW_GAP = 3; // between the board and the cards
const CARD_GAP = 2; // between two cards
const RECALL_W = 160; // CSS px the recall strip takes beside the cards, its gap included
const RECALL_ROW = 34; // ... or the row it takes under them when the two don't fit side by side

/**
 * For a board at `scale` device pixels per native pixel: `k`, the device pixels
 * per card pixel, and the CSS height the row(s) under the board take. The cards
 * follow the board between 2 and 3 CSS px per card pixel (below that the names
 * can't be read, above it the cards eat the screen), but never grow wider than
 * the board; the recall strip goes under them when there's no room beside.
 */
function handLayout(scale, dpr) {
  const places = (lastState && lastState.satchelLimit) || 5;
  const boardW = (scene.width * scale) / dpr;
  const handW = (k) => ((places * G.CARD_W + (places - 1) * CARD_GAP) * k) / dpr;
  let k = Math.max(1, Math.round(Math.min(3 * dpr, Math.max(2 * dpr, scale))));
  while (k > 1 && handW(k) > boardW) k--;
  const oneRow = handW(k) + RECALL_W <= boardW;
  return { k, oneRow, height: ((G.CARD_H + CARD_ROW_GAP) * k) / dpr + (oneRow ? 0 : RECALL_ROW) };
}

function reducedMotion() {
  return reducedMotionQuery.matches;
}

/**
 * A stone under someone else's mist is not to be seen (nor how it landed) until
 * the mist lifts or the game ends. A fog hides every stone under it from every
 * player, the one who rolled it and the stones' own owners included.
 */
function isVeiled(x, y, code, list = overlays) {
  if (!lastState || lastState.status === "finished") return false;
  const mine = myPlayer ? myPlayer.color : 0;
  return list.some((o) => o.x === x && o.y === y && (o.kind === "fog" || (o.kind === "mist" && o.owner !== mine)));
}

function veiled(cells, list) {
  if (!lastState || lastState.status === "finished") return cells;
  const out = cells.slice();
  for (const o of list) {
    if (o.kind !== "mist" && o.kind !== "fog") continue;
    const i = o.y * lastState.size + o.x;
    if (out[i] && isVeiled(o.x, o.y, out[i], list)) out[i] = 0;
  }
  return out;
}

function frame() {
  requestAnimationFrame(frame);
  if (!scene || !board || gameEl.hidden) return; // nothing on screen to draw
  const now = clock();
  if (now - lastFrameAt < FRAME_INTERVAL) return;
  lastFrameAt = now;

  const reduced = reducedMotion();
  effects = P.pruneEffects(effects, now, reduced);
  if (storm && now - storm.start >= P.STORM_SECONDS) storm = null;
  const snap = viewedSnap();
  // The recall strip must not give away what a fog hides: a fog on the board now covers the older boards too.
  const displayBoard = veiled(
    snap ? snap.board : board,
    snap ? snap.overlays.concat(overlays.filter((o) => o.kind === "fog")) : overlays
  );
  scene.render({
    time: now,
    board: displayBoard,
    hover: snap ? null : hoverPoint,
    hoverKind: hoverKind(),
    myColor: myPlayer ? myPlayer.color : 0,
    lastMove: snap ? snap.lastMove : lastMove,
    effects: snap ? [] : effects.filter((e) => !isVeiled(e.x, e.y, e.code)),
    overlays: snap ? snap.overlays : overlays,
    storm: snap ? null : storm,
    round: roundLength > 0 ? Math.floor((snap ? snap.turnCount : turnCount) / roundLength) + 1 : 1, // the boat's sign: the round being played (one round = one turn each)
    passFlash: passFlashAt,
    fireflies: myPlayer ? myPlayer.fireflies : undefined,
    turnCount: snap ? snap.turnCount : turnCount,
    roundLength,
    // The grey is judged by the live storm, not the one the snapshot saw: a
    // storm on now greys the older boards too (as a fog on now covers them).
    stormTurnCount: turnCount,
    stormUntil,
    reducedMotion: reduced,
    highlightMine: snap ? null : ownStoneHighlight(displayBoard),
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
  if (!hoverPoint || viewId !== null) return "none";
  if (selectedPowerup) return "target";
  if (!isMyTurn || !myPlayer) return "none";
  if (burningAt(hoverPoint.x, hoverPoint.y)) return "none"; // nothing can be played into a fire
  if (overlays.some((o) => o.kind === "fog" && o.x === hoverPoint.x && o.y === hoverPoint.y)) return "none"; // nor into a fog
  // Nor over someone else's mist: the stone under it is taken out of what we
  // draw, so the point would look free. (The mist itself is on show anyway.)
  if (overlays.some((o) => o.kind === "mist" && o.owner !== myPlayer.color && o.x === hoverPoint.x && o.y === hoverPoint.y)) {
    return "none";
  }
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
  if (viewId !== null) return recallBlocked();
  const p = eventPoint(evt);
  if (!p) return;

  if (selectedPowerup) {
    const item = marketItem(selectedPowerup);
    if (item && item.points >= 2 && !firstTarget) {
      // Ferry: first the stone, then the empty point beside it.
      firstTarget = p;
      setTargetingHint();
      return;
    }
    room.send("usePowerup", { id: selectedPowerup, target: firstTarget || p, target2: firstTarget ? p : undefined });
    setSelectedPowerup(null);
    return;
  }
  room.send("move", { x: p.x, y: p.y, axis: "base" });
}

/**
 * Right click places the gray or transparent stone. With a powerup armed it
 * cancels the targeting -- except Seedling, where it plants a seed that grows
 * the gray or transparent stone (Escape cancels that one).
 */
function onBoardRightClick(evt) {
  evt.preventDefault();
  if (!room || !lastState) return;
  if (viewId !== null) return recallBlocked();
  if (selectedPowerup === "seedling") {
    const seedPoint = eventPoint(evt);
    if (!seedPoint) return;
    room.send("usePowerup", { id: selectedPowerup, target: seedPoint, axis: "pattern" });
    setSelectedPowerup(null);
    return;
  }
  if (selectedPowerup) {
    setSelectedPowerup(null);
    return;
  }
  const p = eventPoint(evt);
  if (!p) return;
  room.send("move", { x: p.x, y: p.y, axis: "pattern" });
}

let firstTarget = null; // the first point of a two-point item, once picked

// Items whose target must be one of your own stones -- Ferry and Skiff only for
// their first target, since the second is the empty point you're moving it to.
// Mirrors the ownerOf() check each of these runs server-side in
// server/src/powerups/definitions.ts; keep the two in sync.
const OWN_STONE_TARGET_ITEMS = new Set(["lantern_ward", "turn_lantern", "ferry", "skiff"]);

/** True if board code `code` is a stone this player placed (mirrors ownerOf() in goRules.ts). */
function isMyStoneCode(code, myColor) {
  if (!code || !myColor) return false;
  if (code <= 8) return (code > 4 ? code - 4 : code) === myColor;
  return code >= 10 && code <= 13 && code - 9 === myColor;
}

/** True while the storm greys the stones (its full three rounds): nobody is shown whose stone is whose. */
function stormGreys() {
  return P.stormLinger(turnCount, stormUntil, roundLength) > 0;
}

/**
 * Every point on `boardArr` that's my own stone, while an item that needs one
 * is armed and waiting for it. None while the storm greys the board: arming an
 * item and cancelling it again must not show which grey stones are mine.
 */
function ownStoneHighlight(boardArr) {
  if (!myPlayer || firstTarget || !selectedPowerup || !OWN_STONE_TARGET_ITEMS.has(selectedPowerup)) return null;
  if (stormGreys()) return null;
  const points = [];
  for (let i = 0; i < boardArr.length; i++) {
    if (isMyStoneCode(boardArr[i], myPlayer.color)) points.push(i);
  }
  return points;
}

/**
 * Picks an item from the satchel. Items that need no point (Firefly Jar, Mist,
 * Twin Wick, Stepping Stones) go straight off; the rest wait for a click on the board.
 */
function pickPowerup(id) {
  const item = marketItem(id);
  if (item && item.points === 0) {
    if (room) room.send("usePowerup", { id });
    return;
  }
  setSelectedPowerup(selectedPowerup === id ? null : id);
}

function setSelectedPowerup(id) {
  selectedPowerup = id;
  firstTarget = null;
  boardEl.classList.toggle("targeting", !!id);
  setTargetingHint();
  if (lastState) renderSidebar(lastState);
}

/** The line under the cards: how to aim the armed item, or else what your two clicks play. */
function setTargetingHint() {
  boardHintEl.textContent = targetingText() || stoneHint();
  boardHintEl.classList.toggle("targeting", !!selectedPowerup);
}

function stoneHint() {
  if (!myPlayer) return boardHintEl.textContent;
  const [baseName, otherName] = LOOK_NAMES[myPlayer.color] || LOOK_NAMES[1];
  return myPlayer.twin
    ? "Twin Wick is lit: your next stone fights on both fronts."
    : `Left click: your ${baseName} stone · Right click: your ${otherName} stone` +
      (myPlayer.extra > 0 ? " · Stepping Stones: this move doesn't end your turn" : "");
}

function targetingText() {
  const item = selectedPowerup && marketItem(selectedPowerup);
  if (!item) return "";
  const ownStone = OWN_STONE_TARGET_ITEMS.has(item.id) && !firstTarget;
  const pickOwn = stormGreys()
    ? `${item.name}: pick one of your stones -- the storm hides which are yours -- right click to cancel.`
    : `${item.name}: pick one of your stones, each marked with an ember -- right click to cancel.`;
  return item.id === "seedling"
    ? "Seedling: click for a solid seed, right click for a gray or transparent one -- Esc to cancel."
    : item.points >= 2
    ? firstTarget
      ? `${item.name}: now the empty point to move it to -- right click to cancel.`
      : pickOwn
    : ownStone
    ? pickOwn
    : `Pick a point for ${item.name} -- right click to cancel.`;
}

// ---- recall ---------------------------------------------------------------------------

/** Keep one snapshot per action (a re-sync of the same action just refreshes it). */
function recordHistory(state, action) {
  const snap = {
    id: 0,
    seq: action.seq,
    board,
    overlays,
    lastMove,
    event: state.lastEvent || "",
    turnCount: state.turnCount,
  };
  const last = history[history.length - 1];
  if (last && last.seq === action.seq) {
    snap.id = last.id;
    history[history.length - 1] = snap;
  } else {
    snap.id = nextSnapId++;
    history.push(snap);
    if (history.length > RECALL_STEPS + 1) history.shift();
  }
  if (viewId !== null && viewId < history[0].id) viewId = history[0].id; // fell off the end: stay on the oldest
  if (viewId === history[history.length - 1].id) viewId = null;
  renderRecall();
}

function viewedSnap() {
  return viewId === null ? null : history.find((h) => h.id === viewId) || null;
}

/** Steps behind live for the snapshot on screen (0 = live). */
function viewOffset() {
  return viewId === null ? 0 : history[history.length - 1].id - viewId;
}

function setView(offset) {
  const o = Math.max(0, Math.min(history.length - 1, offset));
  viewId = o === 0 ? null : history[history.length - 1 - o].id;
  renderRecall();
}

function stepRecall(delta) {
  if (history.length > 1) setView(viewOffset() + delta);
}

function recallBlocked() {
  showNotice("You are looking back -- press Live (Esc) to play.");
}

function renderRecall() {
  const back = history.length - 1;
  recallEl.hidden = back < 1;
  const off = viewOffset();
  recallStepsEl.textContent = off === 0 ? "0" : `-${off}`;
  const snap = viewedSnap();
  recallStepsEl.title = snap ? `${off} back: ${snap.event}` : "Moves back from the live board";
  document.getElementById("recall-back").disabled = off >= back;
  document.getElementById("recall-fwd").disabled = off === 0;
  recallEl.classList.toggle("looking", off > 0);
  boardEl.classList.toggle("recalling", off > 0);
}

// ---- state --------------------------------------------------------------------------

/**
 * The board this player is allowed to see. The server sends `seen`: fogged
 * points and rivals' misted stones read 0, and in a storm's grey every player
 * stone reads the grey code (14). My own misted stones come separately, on my
 * own PlayerState (`misted`: index, code pairs), and go back in here. A server
 * from before this change sends only the true `board` (veiled() still hides
 * what it must then).
 */
function visibleBoard(state) {
  if (!state.seen || state.seen.length !== state.size * state.size) return Array.from(state.board);
  const cells = Array.from(state.seen);
  const me = room && Array.from(state.players).find((p) => p.sessionId === room.sessionId);
  const mine = me && me.misted ? Array.from(me.misted) : [];
  for (let i = 0; i + 1 < mine.length; i += 2) cells[mine[i]] = mine[i + 1];
  return cells;
}

function onState(state) {
  lastState = state;
  ensureScene(state.size);

  const nextBoard = visibleBoard(state);
  const nextOverlays = Array.from(state.effects)
    .filter((e) => ["lily", "ward", "drift", "fire", "seed", "mist", "fog"].includes(e.kind))
    .map((e) => ({ kind: e.kind, x: e.x, y: e.y, owner: e.owner, until: e.until, axis: e.axis }));
  const action = state.action;
  const actionChanged = lastActionSeq !== null && action.seq !== lastActionSeq;
  turnCount = state.turnCount;
  roundLength = state.players.length;
  // Synced, not derived from the ~10s cloudburst animation: a client that
  // joins mid-storm gets the lingering weather without ever seeing the flash.
  stormUntil = state.storm.until;

  // A storm breaks: the sky opens. Only a change in seq starts the
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
  recordHistory(state, action);

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
  renderBotMenu(state);
  renderPass(state);
  renderWeather(state);
  setTargetingHint();
  lastEventEl.textContent = state.lastEvent || "";
  showPass(state);

  if (state.status === "finished" && !resultOpened) {
    resultOpened = true;
    openResult(state);
  }

  // Bots that filled the table start the game at once: the player only opened
  // the welcome screen to seat them, so put the board back in front of them.
  if (closeWelcomeOnStart && state.status === "playing") {
    closeWelcomeOnStart = false;
    if (welcomeEl.open) welcomeEl.close();
  }

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

const LOOK_NAMES = { 1: ["black", "gray"], 2: ["white", "gray"], 3: ["black", "transparent"], 4: ["white", "transparent"] };

/** A board stone (code 1..8) at twice its board size. */
function stoneImg(code) {
  return spriteImg(`stone_big_${code}`, G.stoneSprite(code), 2);
}

function stoneChip(code) {
  const chip = document.createElement("span");
  chip.className = "stone-chip";
  chip.append(stoneImg(code));
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
  // Stock and shares are synced per stall (stallCopies / fairShare in server/src/powerups/definitions.ts).
  const stalls = Array.from(state.market);
  const perTier = [1, 2, 3].map((tier) => stalls.filter((m) => m.tier === tier));
  const [cozy, tactical, powerful] = perTier.map((list) => list.find((m) => m.stock > 0));
  const stockText =
    cozy && tactical && powerful
      ? `The whole table shares the stock: ${cozy.stock} copies of each cozy item, ${tactical.stock} of each tactical ` +
        `one and ${powerful.stock === 1 ? "a single" : powerful.stock} powerful one, and nobody may buy more than ` +
        `their share (${cozy.share}, ${tactical.share} and ${powerful.share}). A sold-out stall stays empty for the night. `
      : "";
  document.getElementById("welcome-economy").textContent =
    `You earn fireflies: 3 for every stone you place and 5 for every stone you capture. ` +
    `If someone's item removes one of your stones, you get 3 back. ` +
    `Once you've placed ${state.shopAfter} stones, the Night Market opens in the sidebar. It has ${stalls.length} stalls ` +
    `a night: ${perTier[0].length} cozy, ${perTier[1].length} tactical and ${perTier[2].length} powerful. ` +
    stockText +
    `Your satchel holds ${state.satchelLimit} items: every item you buy flies into it as a card under the board. ` +
    `Buying doesn't use your turn; using an item does: pick its card, then click a point on the board (right click cancels).`;

  // Mirrors STORM_TARGET / STORM_DIE_FACES in server/src/rules/storm.ts; `every` is synced from the room.
  document.getElementById("welcome-weather").textContent =
    `Every ${state.storm.every} turns a D20 is rolled behind the clouds, plus 1 for every calm roll since the last ` +
    `storm. At 20 or more a thunderstorm breaks: the night darkens, rain sweeps the board for ten seconds and up to ` +
    `three bolts come down on random points. Whatever stands there catches fire and burns away three rounds later, ` +
    `and nobody can play on a burning point until the fire goes out. A fainter storm hangs over the river for all ` +
    `three rounds, and for those rounds every stone turns the same grey: the rules still know whose is whose, so remember. The forecast in the sidebar (unlikely, likely, very likely) ` +
    `shows how good the next roll's chance is: it starts at 5% and grows 5% with every calm roll.`;

  // Mirrors territoryScore / finalResults in server/src/rules/endgame.ts.
  document.getElementById("welcome-scoring").textContent =
    `The board is counted the Japanese way: only territory, the empty points your side walls in on its own. ` +
    `A stone is worth nothing in itself, only the ground it surrounds. On top of that you count your ` +
    `prisoners: the stones you captured yourself on that side. ` +
    `You play ${base} with ${pattern}, so your score is the lower of your ${base} total and your ${pattern} total; ` +
    `the higher one only breaks ties. Players who also hold ${base} share the ${base} territory, and players ` +
    `who also hold ${pattern} share the ${pattern} territory -- but prisoners are yours alone, so take the ` +
    `capture rather than leave it to them. Nothing is taken off as dead at the end: capture what should go ` +
    `before you pass.`;

  renderWelcomeBots(state);

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

// ---- bots ---------------------------------------------------------------------------

// The bots a player can bring, on the home screen before joining or on the welcome
// screen while the room waits for its fourth player. `id` is the wire name
// server/src/bots/styles.ts (RECRUITS) answers to, and `name` is the name the seated
// bot takes there (a second one is "Reed 2"). `items` is how much of the Night
// Market it uses, 0 to 3: from Reed, who never buys or uses a thing, to Magpie,
// who spends turns on items whenever one can do anything.
const BOT_OPTIONS = [
  { id: "pure", name: "Reed", kind: "Pure Go", items: 0, itemsLabel: "No powerups",
    desc: "Plays stones and nothing else. Never visits the Night Market." },
  { id: "balanced", name: "Tanuki", kind: "Fighter", items: 1, itemsLabel: "Some powerups",
    desc: "Goes looking for fights, and buys a ward or a removal item when it pays off." },
  { id: "shark", name: "Magpie", kind: "Market shark", items: 3, itemsLabel: "Max powerups",
    desc: "Spends turns on items whenever it can, and shops down the whole list." },
];
const BOT_SEATS = 4; // mirrors MAX_PLAYERS in server/src/rooms/GoRoom.ts
const MAX_BOTS = 3; // mirrors MAX_BOTS there: bots in all, from any mix of kinds (so up to 3 of one kind)

function freeSeats(state) {
  return Math.max(0, BOT_SEATS - state.players.length);
}

/** Bots a table can still take: 3 in all, and never more than the free seats. */
function botRoom(state) {
  const seated = Array.from(state.players).filter((p) => p.bot).length;
  return Math.max(0, Math.min(MAX_BOTS - seated, freeSeats(state)));
}

/** How many bots the open menu may hold: a fresh table on the home screen, the real room in the game. */
function pickCap() {
  return lobbyEl.hidden && lastState ? botRoom(lastState) : MAX_BOTS;
}

function pickedTotal() {
  let n = 0;
  for (const count of botPicks.values()) n += count;
  return n;
}

/** The picks as the wire list the server takes: one id per bot, so two Reeds are "pure" twice. */
function pickedIds() {
  const ids = [];
  for (const option of BOT_OPTIONS) {
    for (let i = 0; i < (botPicks.get(option.id) || 0); i++) ids.push(option.id);
  }
  return ids;
}

/** Bots can be added by someone at the table, before the game starts, while there is room. */
function botMenuAvailable(state) {
  return !!myPlayer && state.status === "waiting" && botRoom(state) > 0;
}

function renderBotMenu(state) {
  botsButton.hidden = !botMenuAvailable(state);
  if (welcomeEl.open) renderWelcomeBots(state);
}

/** One row per bot, built once and then updated in place so a click never loses keyboard focus. */
function buildBotRows(listEl) {
  for (const option of BOT_OPTIONS) {
    const row = document.createElement("div");
    row.className = "bot-option";
    row.dataset.id = option.id;

    const who = document.createElement("div");
    who.className = "who";
    const name = document.createElement("span");
    name.textContent = option.name;
    const kind = document.createElement("span");
    kind.className = "kind";
    kind.textContent = option.kind;
    const lamps = document.createElement("span");
    lamps.className = "lamps";
    lamps.title = `Uses ${option.items === 0 ? "none" : option.items === 3 ? "all" : "some"} of the Night Market`;
    for (let i = 0; i < 3; i++) {
      const lamp = document.createElement("i");
      lamp.className = "lamp" + (i < option.items ? " lit" : "");
      lamps.appendChild(lamp);
    }
    lamps.append(` ${option.itemsLabel}`);
    who.append(name, kind, lamps);

    const desc = document.createElement("div");
    desc.className = "desc";
    desc.textContent = option.desc;

    const body = document.createElement("div");
    body.className = "body";
    body.append(who, desc);

    const stepper = document.createElement("div");
    stepper.className = "stepper";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "step minus";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `One fewer ${option.name}`);
    minus.addEventListener("click", () => changePick(option.id, -1));
    const count = document.createElement("span");
    count.className = "count";
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "step plus";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `One more ${option.name}`);
    plus.addEventListener("click", () => changePick(option.id, 1));
    stepper.append(minus, count, plus);

    row.append(body, stepper);
    listEl.appendChild(row);
  }
}

/** Shows each bot's count and switches off what can't go further: below 0, or past the table's room. */
function updateBotRows(listEl, cap) {
  const total = pickedTotal();
  for (const row of listEl.children) {
    const count = botPicks.get(row.dataset.id) || 0;
    row.querySelector(".count").textContent = String(count);
    row.querySelector(".minus").disabled = count === 0;
    row.querySelector(".plus").disabled = total >= cap;
    row.classList.toggle("picked", count > 0);
  }
}

function changePick(id, delta) {
  if (delta > 0 && pickedTotal() >= pickCap()) return;
  const next = Math.max(0, (botPicks.get(id) || 0) + delta);
  if (next === 0) botPicks.delete(id);
  else botPicks.set(id, next);
  renderLobbyBots();
  if (lastState && welcomeEl.open) renderWelcomeBots(lastState);
}

/** Drops picks the table no longer has room for (someone else seated a bot, or a seat filled). */
function trimPicks(cap) {
  let over = pickedTotal() - cap;
  for (const option of BOT_OPTIONS.slice().reverse()) {
    while (over > 0 && (botPicks.get(option.id) || 0) > 0) {
      botPicks.set(option.id, botPicks.get(option.id) - 1);
      if (botPicks.get(option.id) === 0) botPicks.delete(option.id);
      over -= 1;
    }
  }
}

/** The home screen's menu: bots to bring along before there is a room at all. */
function renderLobbyBots() {
  if (!lobbyBotListEl.firstChild) buildBotRows(lobbyBotListEl);
  updateBotRows(lobbyBotListEl, MAX_BOTS);
  const n = pickedTotal();
  joinButton.textContent = n === 0 ? "Join Game" : `Start with ${n} bot${n === 1 ? "" : "s"}`;
}

function renderWelcomeBots(state) {
  const show = botMenuAvailable(state);
  welcomeBotsEl.hidden = !show;
  if (!show) {
    botPicks.clear();
    return;
  }
  if (!welcomeBotListEl.firstChild) buildBotRows(welcomeBotListEl);

  const room = botRoom(state);
  trimPicks(room);
  updateBotRows(welcomeBotListEl, room);

  welcomeBotsIntroEl.textContent =
    `${state.players.length} of ${BOT_SEATS} seats are taken. Add up to ${room} bot${room === 1 ? "" : "s"}, ` +
    `in any mix: even ${room === 1 ? "one" : room === 2 ? "two" : "three"} of the same kind. ` +
    `They differ in how much of the Night Market they use:`;

  const n = pickedTotal();
  welcomeBotsAddButton.disabled = n === 0;
  welcomeBotsAddButton.textContent = n === 0 ? "Seat bots" : `Seat ${n} bot${n === 1 ? "" : "s"}`;
  const left = freeSeats(state) - n;
  welcomeBotsNoteEl.textContent =
    n === 0 ? "" :
    left === 0 ? "The game starts as soon as they sit down." :
    `${left === 1 ? "1 seat stays" : `${left} seats stay`} open for other players.`;
}

function seatPickedBots() {
  if (!room || !lastState || pickedTotal() === 0) return;
  const ids = pickedIds();
  closeWelcomeOnStart = ids.length >= freeSeats(lastState);
  room.send("addBots", { ids });
  botPicks.clear();
  renderWelcomeBots(lastState);
}

renderLobbyBots();

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
    playing: state.passes > 0 ? `Game in progress · ${state.passes}/${players.length} passed` : "Game in progress",
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

/**
 * The storm forecast: three pips and a word, from the room's synced odds for the
 * next roll (rules/storm.ts), and how many turns away that roll is.
 */
const FORECAST_PIPS = { unlikely: 1, likely: 2, "very likely": 3 };
function renderWeather(state) {
  const s = state.storm;
  const level = s.level in FORECAST_PIPS ? s.level : "unlikely";
  const turnsToRoll = s.every > 0 ? s.every - (state.turnCount % s.every) : 0;
  rebuild(weatherEl, JSON.stringify([level, s.chance, turnsToRoll, state.status]), () => {
    const meter = document.createElement("div");
    meter.className = `meter ${level.replace(" ", "-")}`;
    meter.title = `${s.chance}% chance that the next roll brings a storm`;
    const pips = document.createElement("span");
    pips.className = "pips";
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement("i");
      pip.className = "pip" + (i < FORECAST_PIPS[level] ? " lit" : "");
      pips.appendChild(pip);
    }
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = "Storm";
    const word = document.createElement("span");
    word.className = "level";
    word.textContent = level;
    meter.append(label, pips, word);
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent =
      state.status === "playing"
        ? `Next roll in ${turnsToRoll} turn${turnsToRoll === 1 ? "" : "s"} · ${s.chance}%`
        : `Rolled every ${s.every} turns · ${s.chance}%`;
    weatherEl.append(meter, hint);
  });
}

/** The Pass button lives for as long as the game is on; Results appears once it is over. */
function renderPass(state) {
  passButton.hidden = state.status !== "playing";
  passButton.disabled = !isMyTurn;
  passButton.title =
    `Skip your turn without placing a stone. When all ${state.players.length} players pass in a row, ` +
    `the game ends and is scored.`;
  resultButton.hidden = state.status !== "finished";
}

const ORDINALS = ["1st", "2nd", "3rd", "4th"];

/** The final scores: one row per player, best first, with both of their totals. */
function openResult(state) {
  const players = Array.from(state.players).sort((a, b) => a.place - b.place || a.color - b.color);
  const winners = players.filter((p) => p.place === 1);
  document.getElementById("result-summary").textContent = winners.length
    ? `${winners.map((p) => p.name).join(", ")} ${winners.length === 1 ? "wins" : "share first place"} ` +
      `with ${winners[0].finalScore}.`
    : "";

  const table = document.getElementById("result-table");
  table.replaceChildren();

  const head = document.createElement("div");
  head.className = "result-row head";
  for (const label of ["Place", "Player", "Left click", "Right click", "Score"]) {
    const cell = document.createElement("span");
    cell.textContent = label;
    head.appendChild(cell);
  }
  table.appendChild(head);

  for (const player of players) {
    const [baseName, patternName] = LOOK_NAMES[player.color] || LOOK_NAMES[1];
    const row = document.createElement("div");
    row.className = "result-row" + (player.place === 1 ? " winner" : "");

    const place = document.createElement("span");
    place.textContent = ORDINALS[player.place - 1] || `${player.place}th`;

    const who = document.createElement("span");
    who.className = "who";
    const swatches = document.createElement("span");
    swatches.className = "swatch-pair";
    swatches.append(stoneImg(player.color), stoneImg(player.color + 4));
    const name = document.createElement("span");
    name.className = "name";
    name.textContent =
      player.name + (room && player.sessionId === room.sessionId ? " (you)" : player.bot ? " (bot)" : "");
    who.append(swatches, name);

    // One front: the side's territory plus the prisoners this player took there.
    // The lower of the two totals is the score; the higher one is only the tie-break.
    // Spelled out on its own line (not "10+2") so it's clear at a glance which
    // number is captured stones and which is territory.
    const side = (label, territory, prisoners) => {
      const total = territory + prisoners;
      const cell = document.createElement("span");
      cell.className = "side" + (total === player.finalScore ? " low" : "");
      const totalLine = document.createElement("span");
      totalLine.className = "side-total";
      totalLine.textContent = `${label} ${total}`;
      cell.appendChild(totalLine);
      if (prisoners > 0) {
        const breakdown = document.createElement("span");
        breakdown.className = "side-breakdown";
        breakdown.textContent = `${territory} territory + ${prisoners} captured`;
        cell.appendChild(breakdown);
      }
      cell.title = `${territory} territory + ${prisoners} prisoner${prisoners === 1 ? "" : "s"}`;
      return cell;
    };

    const score = document.createElement("span");
    score.className = "final";
    score.textContent = String(player.finalScore);

    row.append(
      place,
      who,
      side(baseName, player.baseTerritory, player.basePrisoners),
      side(patternName, player.patternTerritory, player.patternPrisoners),
      score
    );
    table.appendChild(row);
  }

  renderResultTerritory(state);

  if (!resultEl.open) resultEl.showModal();
}

// rules/endgame.ts SIDE_CODE (sent as GoState.base/patternTerritoryOwner): 0 none,
// 1 black, 2 white, 3 gray, 4 transparent -- mapped here to a board code sharing
// that look, so G.stoneSprite can draw it.
const TERRITORY_LOOK_CODE = { 1: 1, 2: 2, 3: 5, 4: 7 };

/**
 * Two small board diagrams under the score table -- one per front -- marking
 * which points settled as whose territory. A full-size square is the real
 * stone at that point (so twins and driftwood look like themselves); a small
 * dot is an owner mark on an empty point that side walled in.
 *
 * Needs a server new enough to send baseTerritoryOwner / patternTerritoryOwner;
 * an older one leaves those undefined (see the deploy-skew gotcha in
 * state.md), so this just skips the diagrams rather than showing "undefined".
 */
function renderResultTerritory(state) {
  const container = document.getElementById("result-territory");
  container.replaceChildren();
  if (!state.baseTerritoryOwner || !state.patternTerritoryOwner || !state.baseTerritoryOwner.length) return;

  const board = visibleBoard(state); // the true board: the game is over
  const fronts = [
    ["Base front: black vs white", Array.from(state.baseTerritoryOwner)],
    ["Pattern front: gray vs transparent", Array.from(state.patternTerritoryOwner)],
  ];
  for (const [label, owners] of fronts) {
    const wrap = document.createElement("div");
    wrap.className = "territory-board";
    const caption = document.createElement("div");
    caption.className = "territory-label";
    caption.textContent = label;
    const canvas = territoryBoardCanvas(board, state.size, owners);
    const img = document.createElement("img");
    img.className = "px";
    img.alt = label;
    img.src = canvas.toDataURL();
    img.width = canvas.width * 2;
    img.height = canvas.height * 2;
    wrap.append(caption, img);
    container.appendChild(wrap);
  }
}

/** One point per cell: the real stone if occupied, else a small owner mark if the point settled as territory. */
function territoryBoardCanvas(board, size, owners) {
  const cell = 9; // stones draw at "icon" size (9x9); territory marks ("mini", 7x7) sit centered in the same cell
  const w = size * cell, h = size * cell;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(w, h);
  const [ar, ag, ab] = G.PALETTE_RGB[G.INDEX.A]; // kaya amber background
  for (let i = 0; i < w * h; i++) {
    img.data[i * 4] = ar;
    img.data[i * 4 + 1] = ag;
    img.data[i * 4 + 2] = ab;
    img.data[i * 4 + 3] = 255;
  }
  // Bounds-checked per pixel: driftwood's sprite is wider than a cell, and this
  // keeps it from corrupting neighbouring rows instead of just spilling over them.
  const blit = (spr, ox, oy) => {
    if (!spr) return;
    const dx = ox + ((cell - spr.w) >> 1), dy = oy + ((cell - spr.h) >> 1);
    for (let y = 0; y < spr.h; y++) {
      const py = dy + y;
      if (py < 0 || py >= h) continue;
      for (let x = 0; x < spr.w; x++) {
        const px = dx + x;
        if (px < 0 || px >= w) continue;
        const v = spr.px[y * spr.w + x];
        if (v === G.TRANSPARENT) continue;
        const [r, g, b] = G.PALETTE_RGB[v];
        const di = (py * w + px) * 4;
        img.data[di] = r;
        img.data[di + 1] = g;
        img.data[di + 2] = b;
        img.data[di + 3] = 255;
      }
    }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const code = board[idx];
      if (code) blit(G.pieceSprite(code, "icon"), x * cell, y * cell);
      else if (owners[idx]) blit(G.stoneSprite(TERRITORY_LOOK_CODE[owners[idx]], "mini"), x * cell, y * cell);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
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

/** Rebuild an element only when what it shows changed (keeps buttons stable under the cursor); true if it did. */
function rebuild(el, signature, build) {
  if (el.dataset.sig === signature) return false;
  el.dataset.sig = signature;
  el.replaceChildren();
  build();
  return true;
}

function renderSidebar(state) {
  renderPlayers(state);
  renderMarket(state);
  renderHand(state); // after the market: a card just bought flies out of its stall
}

function renderPlayers(state) {
  const players = Array.from(state.players);
  const sig = JSON.stringify([
    state.turnIndex, state.status, myPlayer && myPlayer.sessionId,
    players.map((p) => [p.name, p.color, p.connected, p.bot, p.passed, p.jar, p.mist, p.twin, p.extra, p.score, p.fireflies, p.finalScore, p.place]),
  ]);
  rebuild(playersEl, sig, () => {
    // Listed by color, which is also the turn order (the synced array is join order).
    const seats = players.map((player, index) => ({ player, index })).sort((a, b) => a.player.color - b.player.color);
    seats.forEach(({ player, index }) => {
      const row = document.createElement("div");
      row.className = "player-row";
      if (state.status === "playing" && index === state.turnIndex) row.classList.add("current");
      if (state.status === "finished" && player.place === 1) row.classList.add("current"); // the winner(s)
      if (!player.connected) row.classList.add("disconnected");
      if (state.status === "playing" && player.passed) row.classList.add("passed");

      // Both of the player's stones at full board size, so black, white, gray and
      // transparent can be told apart at a glance, and named underneath the name.
      const [baseName, otherName] = LOOK_NAMES[player.color] || LOOK_NAMES[1];
      const swatches = document.createElement("span");
      swatches.className = "swatch-pair";
      swatches.title = `Left click: ${baseName} · Right click: ${otherName}`;
      swatches.append(stoneImg(player.color), stoneImg(player.color + 4));

      const name = document.createElement("span");
      name.className = "name";
      name.textContent =
        player.name + (room && player.sessionId === room.sessionId ? " (you)" : player.bot ? " (bot)" : "");

      const score = document.createElement("span");
      score.className = "score";
      const finished = state.status === "finished";
      score.title = finished ? "Final score: the lower of this player's two totals" : "Stones captured";
      score.textContent = `${finished ? player.finalScore : player.score}`;

      // A player's fireflies and what they have lit are their own business (a
      // Kite is how you peek) until the game is over.
      const mine = !!room && player.sessionId === room.sessionId;
      const open = mine || finished;
      const top = document.createElement("span");
      top.className = "top";
      if (open) top.append(name, fireflies(player.fireflies), score);
      else top.append(name, score);
      const flag = document.createElement("span");
      flag.className = "pass-flag";
      flag.textContent = "passed";
      if (state.status === "playing" && player.passed) {
        top.dataset.passed = "1";
      }
      const look = document.createElement("span");
      look.className = "look";
      look.textContent = `${baseName} + ${otherName}`;
      if (top.dataset.passed) look.append(flag);
      // What the player has lit and not yet used: a jar, a mist, a twin wick, a second stone.
      const armed = [];
      if (player.jar > 0) armed.push("jar");
      if (player.mist) armed.push("mist");
      if (player.twin) armed.push("twin");
      if (player.extra > 0) armed.push("+1 stone");
      if (armed.length && state.status === "playing" && mine) {
        const tags = document.createElement("span");
        tags.className = "pass-flag";
        tags.textContent = armed.join(" · ");
        look.append(tags);
      }
      const info = document.createElement("span");
      info.className = "info";
      info.append(top, look);

      row.append(swatches, info);
      playersEl.appendChild(row);
    });
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

// ---- satchel: the hand of item cards under the board ---------------------------------

let handBought = null; // my `bought` count at the last render; null until this room's first state
let armedCard = -1; // hand position of the card picked last (two copies of one item are two cards)
const incoming = new Set(); // hand positions whose card is still flying in from the market

/**
 * The satchel as a hand of portrait cards under the board, one per item held and
 * a dotted place for each free one. A card bought since the last state flies
 * in from its Night Market stall first. Only the buyer sees that: every client
 * draws its own player's hand.
 */
function renderHand(state) {
  const owned = myPlayer ? Array.from(myPlayer.powerups) : [];
  const bought = myPlayer ? myPlayer.bought.length : 0;
  // A purchase appends to both `bought` and `powerups` (GoRoom.applyBuy), so the
  // last `fresh` cards are the ones just bought.
  const fresh = handBought === null ? 0 : Math.max(0, Math.min(owned.length, bought - handBought));
  handBought = myPlayer ? bought : null;
  for (let i = owned.length - fresh; i < owned.length; i++) incoming.add(i); // until flyCard lands it

  const places = Math.max(state.satchelLimit, owned.length);
  const shown = selectedPowerup ? (owned[armedCard] === selectedPowerup ? armedCard : owned.indexOf(selectedPowerup)) : -1;
  handEl.title =
    `Satchel: ${owned.length} of ${state.satchelLimit} items, at most ${state.powerfulLimit} of them powerful. ` +
    `Buy them at the Night Market, and on your turn pick a card to use it.`;
  const sig = JSON.stringify([owned, places, isMyTurn, shown, Array.from(incoming)]);
  const rebuilt = rebuild(handEl, sig, () => {
    for (let i = 0; i < places; i++) {
      if (i >= owned.length) {
        const place = document.createElement("span");
        place.className = "card-place";
        place.append(spriteImg("card_slot", G.cardSlot(), 1));
        handEl.appendChild(place);
        continue;
      }
      const card = itemCard(owned[i]);
      card.dataset.index = String(i);
      card.disabled = !isMyTurn;
      card.classList.toggle("active", i === shown);
      card.classList.toggle("incoming", incoming.has(i));
      card.addEventListener("click", () => pickCard(owned[i], i));
      handEl.appendChild(card);
    }
    if (owned.length === 0) {
      const empty = document.createElement("span");
      empty.className = "hand-empty";
      empty.textContent = "Items you buy land here";
      handEl.appendChild(empty);
    }
  });
  if (rebuilt) refreshCardZoom();
  for (let i = owned.length - fresh; i < owned.length; i++) flyCard(i);
}

/** A card: the pixel card face (sprites.js itemCard) with the item's name and description in its panels. */
function itemCard(id) {
  const item = marketItem(id) || { name: id, description: "", tier: 1 };
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card";
  card.dataset.id = id;
  card.setAttribute("aria-label", `${item.name} (tier ${["", "I", "II", "III"][item.tier] || item.tier}): ${item.description}`);
  card.title = ""; // hovering shows the card enlarged instead; "" also keeps the satchel's tooltip off it
  const name = document.createElement("span");
  name.className = "card-name";
  name.textContent = item.name;
  const text = document.createElement("span");
  text.className = "card-text";
  text.textContent = item.description;
  card.append(spriteImg(`card_${id}_${item.tier}`, G.itemCard(id, item.tier), 1), name, text);
  return card;
}

// ---- a card shown enlarged over the board while the pointer rests on it (or it has keyboard focus)

const CARD_ZOOM = 4;
let zoomedCard = null; // the hand's card on show, or null

/**
 * Shows a copy of `card` at CARD_ZOOM times its size, centred over the board and
 * kept on screen, so its description can be read. It only looks: the pointer
 * passes through it to the hand below.
 */
function showCardZoom(card) {
  if (zoomedCard === card) return;
  hideCardZoom();
  if (!card.isConnected || card.classList.contains("incoming")) return;
  const px = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--card-px")) || 2;
  const b = boardEl.getBoundingClientRect();
  const margin = 8;
  // As large as asked, unless the window is too small for that; whole device pixels per card pixel.
  const dpr = window.devicePixelRatio || 1;
  const fit = Math.min(CARD_ZOOM * px, (window.innerWidth - 2 * margin) / G.CARD_W, (window.innerHeight - 2 * margin) / G.CARD_H);
  const zpx = Math.max(px, Math.floor(fit * dpr) / dpr);
  const w = G.CARD_W * zpx, h = G.CARD_H * zpx;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
  const left = clamp(b.left + (b.width - w) / 2, margin, window.innerWidth - margin - w);
  const top = clamp(b.top + (b.height - h) / 2, margin, window.innerHeight - margin - h);

  const zoom = card.cloneNode(true);
  zoom.classList.remove("active", "landed");
  zoom.classList.add("zoom");
  zoom.disabled = false; // shown bright even off-turn: it's there to be read
  zoom.removeAttribute("aria-label");
  zoom.setAttribute("aria-hidden", "true");
  zoom.tabIndex = -1;
  zoom.style.setProperty("--card-px", `${zpx}px`);
  Object.assign(zoom.style, { left: `${left}px`, top: `${top}px` });
  document.body.appendChild(zoom);
  zoomedCard = card;
}

function hideCardZoom() {
  zoomedCard = null;
  for (const el of document.querySelectorAll(".card.zoom")) el.remove();
}

/** After the hand is rebuilt: show the new card under the pointer (or in focus), if any. */
function refreshCardZoom() {
  if (!zoomedCard) return;
  const under = handEl.querySelector(".card:hover") || handEl.querySelector(".card:focus-visible");
  hideCardZoom();
  if (under) showCardZoom(under);
}

handEl.addEventListener("pointerover", (e) => {
  const card = e.target.closest(".card");
  if (card && e.pointerType !== "touch") showCardZoom(card);
});
handEl.addEventListener("pointerout", (e) => {
  const card = e.target.closest(".card");
  if (card && card === zoomedCard && !card.contains(e.relatedTarget)) hideCardZoom();
});
handEl.addEventListener("focusin", (e) => {
  const card = e.target.closest(".card");
  if (card && card.matches(":focus-visible")) showCardZoom(card);
});
handEl.addEventListener("focusout", () => {
  if (zoomedCard && !zoomedCard.matches(":hover")) hideCardZoom();
});

/** Picking a second copy of the armed item only moves the highlight; picking the same card again disarms it. */
function pickCard(id, index) {
  const other = selectedPowerup === id && armedCard !== index;
  armedCard = index;
  if (other) renderSidebar(lastState);
  else pickPowerup(id);
}

const CARD_FLIGHT_MS = 650;

/**
 * Flies the card at hand position `index` in from its Night Market stall: from
 * the stall's icon, growing to full size and settling from a tilt. The card in
 * the hand stays hidden until it lands.
 */
function flyCard(index) {
  const land = () => {
    incoming.delete(index);
    const card = handEl.querySelector(`.card[data-index="${index}"]`);
    if (card) {
      card.classList.remove("incoming");
      card.classList.add("landed");
    }
  };
  const target = handEl.querySelector(`.card[data-index="${index}"]`);
  // renderMarket builds one button per stall, in state.market order.
  const stall = target && Array.from(lastState.market).findIndex((m) => m.id === target.dataset.id);
  const source = stall >= 0 ? marketItemsEl.children[stall] : null;
  if (!target || !source || reducedMotion() || !target.animate) return land();

  const to = target.getBoundingClientRect();
  const from = (source.querySelector("img") || source).getBoundingClientRect();
  if (!to.width || !from.width) return land();
  const flier = target.cloneNode(true);
  flier.classList.remove("incoming", "active");
  flier.classList.add("flying");
  flier.disabled = false; // the hand's cards are dimmed off-turn; the one in flight shouldn't be
  flier.removeAttribute("title");
  flier.setAttribute("aria-hidden", "true");
  flier.tabIndex = -1;
  Object.assign(flier.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px` });
  document.body.appendChild(flier);

  // Centre to centre, never across the board: first straight down (or up) beside
  // it to the hand's height, then along under the board into its place, the two
  // legs overlapping a little for a rounded corner. The sidebar is always to the
  // right of the board, so the first leg runs in the gap or over the sidebar.
  // All relative to the card's place in the hand, as the transform is.
  const cx = to.left + to.width / 2, cy = to.top + to.height / 2;
  const x0 = from.left + from.width / 2 - cx;
  const y0 = from.top + from.height / 2 - cy;
  const s0 = Math.min(1, from.width / to.width);
  const b = boardEl.getBoundingClientRect();
  const boardBox = { left: b.left - cx, right: b.right - cx, top: b.top - cy, bottom: b.bottom - cy };
  const smooth = (a, z, v) => {
    const k = Math.min(1, Math.max(0, (v - a) / (z - a)));
    return k * k * (3 - 2 * k);
  };
  const frames = [];
  const STEPS = 24;
  for (let k = 0; k <= STEPS; k++) {
    const u = k / STEPS;
    const t = 1 - Math.pow(1 - u, 1.6); // ease out: quick off the stall, gentle into the hand
    const x = x0 * (1 - smooth(0.34, 1, t));
    let y = y0 * (1 - smooth(0, 0.45, t));
    const tilt = -16 * (1 - t) + 7 * Math.sin(Math.PI * t);
    // Half the card's box at a scale, a tilted card's corners included.
    const spread = 1 + Math.abs(Math.sin((tilt * Math.PI) / 180));
    const half = (sc) => (to.width / 2) * sc * spread + 1;
    let scale = s0 + (1 - s0) * smooth(0, 0.6, t);
    // Wherever it is, the card keeps clear of the board: it grows only as far as the
    // gap beside or below the board allows, and at its smallest drops below it.
    const clear = (sc) =>
      x - half(sc) >= boardBox.right || y - half(sc) >= boardBox.bottom ||
      x + half(sc) <= boardBox.left || y + half(sc) <= boardBox.top;
    if (!clear(scale)) {
      const room = Math.max((x - boardBox.right) / half(1), (y - boardBox.bottom) / half(1));
      scale = Math.max(s0, Math.min(scale, room));
      if (!clear(scale)) y = Math.max(y, boardBox.bottom + half(scale));
    }
    frames.push({
      offset: u,
      transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${tilt.toFixed(1)}deg) scale(${scale.toFixed(3)})`,
      opacity: Math.min(1, u * 6),
    });
  }
  const flight = flier.animate(frames, { duration: CARD_FLIGHT_MS, easing: "linear", fill: "forwards" });
  const finish = () => {
    flier.remove();
    land();
  };
  flight.onfinish = finish;
  flight.oncancel = finish;
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

  const items = Array.from(state.market);
  marketStatusEl.textContent = open
    ? `${items.length} stalls tonight, shared by the table.`
    : `Opens after ${state.shopAfter} moves (${Math.min(moves, state.shopAfter)}/${state.shopAfter}).`;

  const sig = JSON.stringify([open, wallet, bought, held, powerfulFull, items.map((m) => [m.id, m.left])]);
  rebuild(marketItemsEl, sig, () => {
    for (const m of items) {
      // Each stall's copies are shared by the table and capped per player (stallCopies / fairShare
      // in server/src/powerups/definitions.ts). A server from before stalls had stock sends none:
      // there only removal items are limited, once each.
      const counted = m.stock > 0;
      const mine = bought.filter((id) => id === m.id).length;
      const soldOut = counted && m.left <= 0;
      const hadShare = counted ? mine >= m.share : m.removal && mine > 0;
      const blocked = full || (m.removal && powerfulFull);
      const button = document.createElement("button");
      button.className = "item";
      button.title = soldOut
        ? `${m.name} is sold out tonight.`
        : hadShare
        ? !counted
          ? `${m.name} has already been bought this match.`
          : m.share === 1
          ? `${m.name} is one to a player, and you've had yours.`
          : `You've bought your share of ${m.name} (${m.share} to a player).`
        : full
        ? `Your satchel is full (${state.satchelLimit} items).`
        : m.removal && powerfulFull
        ? `You can only carry ${state.powerfulLimit} powerful item at a time.`
        : counted
        ? `${m.left} of ${m.stock} left tonight, ${m.share} to a player. ${m.description}`
        : m.description;
      button.disabled = !open || soldOut || hadShare || blocked || wallet < m.price;

      const text = document.createElement("span");
      text.className = "text";
      const title = document.createElement("span");
      title.className = "title";
      const name = document.createElement("span");
      name.textContent = m.name;
      const tier = document.createElement("span");
      tier.className = "tier";
      tier.textContent = ["", "I", "II", "III"][m.tier] || "";
      tier.title = `Tier ${m.tier}`;
      name.append(" ", tier);
      if (counted && !soldOut) {
        const left = document.createElement("span");
        left.className = "left";
        left.classList.toggle("last", m.left === 1);
        left.textContent = `${m.left} left`;
        name.append(" ", left);
      }
      title.append(
        name,
        soldOut ? tag("sold out") : hadShare ? tag("bought") : blocked ? tag("no room") : fireflies(m.price)
      );
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
