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
const walletEl = document.getElementById("wallet");
const satchelItemsEl = document.getElementById("satchel-items");
const satchelCountEl = document.getElementById("satchel-count");
const targetingHintEl = document.getElementById("targeting-hint");
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
  setTimeout(connect, Number(hashParams.get("delay")) || 0);
}

joinButton.addEventListener("click", connect);
boardEl.addEventListener("mousemove", (evt) => (hoverPoint = eventPoint(evt)));
boardEl.addEventListener("mouseleave", () => (hoverPoint = null));
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

async function connect() {
  const endpoint = serverInput.value.trim() || "ws://localhost:2567";
  const name = nameInput.value.trim();
  const bots = pickedIds();

  joinButton.disabled = true;
  setLobbyStatus("Connecting...", false);

  try {
    const client = new Colyseus.Client(endpoint);
    const options = name ? { name } : {};
    // Bringing bots means a table of your own; without them you are matched with
    // whoever is already waiting.
    room = bots.length ? await client.create(ROOM_NAME, options) : await client.joinOrCreate(ROOM_NAME, options);

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
    turn: turnCount + 1, // the boat's sign: the turn now being played
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

/** Right click places the gray or transparent stone -- or cancels powerup targeting. */
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
    .filter((e) => e.kind === "lily" || e.kind === "ward" || e.kind === "drift" || e.kind === "fire")
    .map((e) => ({ kind: e.kind, x: e.x, y: e.y, owner: e.owner, until: e.until }));
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
  if (myPlayer) {
    const [baseName, otherName] = LOOK_NAMES[myPlayer.color] || LOOK_NAMES[1];
    boardHintEl.textContent = `Left click: your ${baseName} stone · Right click: your ${otherName} stone`;
  }
  lastEventEl.textContent = state.lastEvent || "";

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
  document.getElementById("welcome-economy").textContent =
    `You earn fireflies: 3 for every stone you place and 5 for every stone you capture. ` +
    `If someone's item removes one of your stones, you get 3 back. ` +
    `Once you've placed ${state.shopAfter} stones, the Night Market opens in the sidebar. It stocks five items a night, ` +
    `only one of them a powerful one. Your satchel holds ${state.satchelLimit} items and just ${state.powerfulLimit} powerful item at a time. ` +
    `Buying doesn't use your turn; using an item does: pick it in your Satchel, then click a point on the board (right click cancels).`;

  // Mirrors STORM_TARGET / STORM_DIE_FACES in server/src/rules/storm.ts; `every` is synced from the room.
  document.getElementById("welcome-weather").textContent =
    `Every ${state.storm.every} turns a D20 is rolled behind the clouds, plus 1 for every calm roll since the last ` +
    `storm. At 20 or more a thunderstorm breaks: the night darkens, rain sweeps the board for ten seconds and up to ` +
    `three bolts come down on random points. Whatever stands there catches fire and burns away three rounds later, ` +
    `and nobody can play on a burning point until the fire goes out. A fainter storm hangs over the river for all ` +
    `three rounds; your stones keep their colors throughout. The forecast in the sidebar (unlikely, likely, very likely) ` +
    `shows how good the next roll's chance is: it starts at 5% and grows 5% with every calm roll.`;

  // Mirrors areaScore / finalResults in server/src/rules/endgame.ts.
  document.getElementById("welcome-scoring").textContent =
    `You play ${base} with ${pattern}, so your score is the lower of the ${base} total and the ${pattern} total; ` +
    `the higher one only breaks ties. Players who also hold ${base} share the ${base} total, ` +
    `and players who also hold ${pattern} share the ${pattern} total.`;

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

    // The lower total is the score; the higher one is only the tie-break.
    const side = (label, area) => {
      const cell = document.createElement("span");
      cell.className = "side" + (area === player.finalScore ? " low" : "");
      cell.textContent = `${label} ${area}`;
      return cell;
    };

    const score = document.createElement("span");
    score.className = "final";
    score.textContent = String(player.finalScore);

    row.append(place, who, side(baseName, player.baseArea), side(patternName, player.patternArea), score);
    table.appendChild(row);
  }

  if (!resultEl.open) resultEl.showModal();
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
    players.map((p) => [p.name, p.color, p.connected, p.bot, p.score, p.fireflies, p.finalScore, p.place]),
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

      const top = document.createElement("span");
      top.className = "top";
      top.append(name, fireflies(player.fireflies), score);
      const look = document.createElement("span");
      look.className = "look";
      look.textContent = `${baseName} + ${otherName}`;
      const info = document.createElement("span");
      info.className = "info";
      info.append(top, look);

      row.append(swatches, info);
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
    ? "Five stalls tonight."
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
