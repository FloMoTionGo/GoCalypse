// GoCalypse replays on screen: the home screen's Replays dialog (#replays in
// index.html). The list asks the game server for its saved games
// (GET /history, server/src/history/routes.ts), filtered by the days they
// ended; picking one fetches it whole (GET /history/:id) and plays it back on a
// pixel scene of its own. The sums are in replay.js (window.GoReplay); this
// file only wires them to the page. Loaded after main.js, whose globals it
// shares (serverEndpoint, devicePx, isOutside), so every name here starts
// with "replay".

const replays = {
  games: [], // the summaries on show
  record: null, // the game in the viewer
  steps: [], // GoReplay.decode(record)
  player: GoReplay.createPlayer(0),
  scene: null,
  imageData: null,
  request: 0, // the newest list request; older answers are dropped
  lastTime: 0, // performance.now() of the last frame drawn
};
const REPLAY_LIST_LIMIT = 200;
const REPLAY_FPS = 15; // the scene's water and lanterns still move; the stones only on a step
const REPLAY_CHROME_H = 330; // CSS px of the dialog around the board: margins, title, controls, event line

const replaysEl = document.getElementById("replays");
const replayListPaneEl = document.getElementById("replays-list-pane");
const replayViewerEl = document.getElementById("replays-viewer");
const replayFromEl = document.getElementById("replays-from");
const replayToEl = document.getElementById("replays-to");
const replayStatusEl = document.getElementById("replays-status");
const replayListEl = document.getElementById("replays-list");
const replayBoardEl = document.getElementById("replay-board");
const replayBoardCtx = replayBoardEl.getContext("2d");
const replaySliderEl = document.getElementById("replay-slider");
const replaySpeedEl = document.getElementById("replay-speed");
const replayPlayEl = document.getElementById("replay-play");

function replayStatus(text, isError = false) {
  replayStatusEl.textContent = text;
  replayStatusEl.classList.toggle("error", isError);
}

function replayServer() {
  return GoReplay.httpBase(serverEndpoint());
}

// ---- the list ------------------------------------------------------------------------

function openReplays() {
  showReplayList();
  if (!replaysEl.open) replaysEl.showModal();
  loadReplayList();
}

function showReplayList() {
  replays.player.pause();
  replayViewerEl.hidden = true;
  replayListPaneEl.hidden = false;
}

async function loadReplayList() {
  const request = ++replays.request;
  const range = GoReplay.dayRange(replayFromEl.value, replayToEl.value);
  replayStatus("Loading games...");
  try {
    const res = await fetch(`${replayServer()}/history${GoReplay.listQuery(range, REPLAY_LIST_LIMIT)}`);
    if (!res.ok) throw new Error(`the server answered ${res.status}`);
    const { games, total } = await res.json();
    if (request !== replays.request) return; // the filter changed while this was on its way
    replays.games = games;
    renderReplayList(games);
    const filtered = range.from !== undefined || range.to !== undefined;
    if (total === 0) replayStatus(filtered ? "No games on these days." : "No games yet: every game played to its end shows up here.");
    else if (total > games.length) replayStatus(`The newest ${games.length} of ${total} games`);
    else replayStatus(`${total} game${total === 1 ? "" : "s"}`);
  } catch (err) {
    if (request !== replays.request) return;
    replays.games = [];
    renderReplayList([]);
    replayStatus(`Could not load the games (${err.message || err}). Is the server in the Server field up?`, true);
  }
}

function renderReplayList(games) {
  replayListEl.replaceChildren(
    ...games.map((game) => {
      const words = GoReplay.describeGame(game);
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "replay-item";
      button.dataset.id = game.id;
      for (const [cls, text] of [["when", words.when], ["who", words.players], ["detail", words.detail]]) {
        const span = document.createElement("span");
        span.className = cls;
        span.textContent = text;
        button.append(span);
      }
      button.addEventListener("click", () => openReplay(game.id));
      item.append(button);
      return item;
    })
  );
}

function pickPreset(name) {
  const { from, to } = GoReplay.presetRange(name);
  replayFromEl.value = from;
  replayToEl.value = to;
  loadReplayList();
}

// ---- the viewer ----------------------------------------------------------------------

async function openReplay(id) {
  replayStatus("Loading the game...");
  try {
    const res = await fetch(`${replayServer()}/history/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(res.status === 404 ? "it is no longer on the server" : `the server answered ${res.status}`);
    showReplay(await res.json());
  } catch (err) {
    replayStatus(`Could not load that game: ${err.message || err}.`, true);
  }
}

function showReplay(record) {
  replays.record = record;
  replays.steps = GoReplay.decode(record);
  replays.player = GoReplay.createPlayer(replays.steps.length);
  replays.player.speed = Number(replaySpeedEl.value) || 2;
  if (!replays.scene || replays.scene.layout.size !== record.size) {
    replays.scene = GoPixelScene.createScene({ size: record.size });
    replayBoardEl.width = replays.scene.width;
    replayBoardEl.height = replays.scene.height;
    replays.imageData = replayBoardCtx.createImageData(replays.scene.width, replays.scene.height);
  }
  const words = GoReplay.describeGame(record);
  document.getElementById("replay-title").textContent = `${words.when} · ${words.detail}`;
  replaySliderEl.max = String(Math.max(0, replays.steps.length - 1));
  replayListPaneEl.hidden = true;
  replayViewerEl.hidden = false;
  sizeReplayCanvas();
  renderReplayStep();
  drawReplay(performance.now());
  replayBoardEl.focus();
}

/**
 * The largest whole number of device pixels per scene pixel that fits the
 * dialog, so every sprite pixel stays crisp (as sizeCanvas does for the game).
 */
function sizeReplayCanvas() {
  const scene = replays.scene;
  if (!scene || replayViewerEl.hidden) return;
  const dpr = devicePx();
  const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
  const stage = document.getElementById("replay-stage");
  const side = document.getElementById("replay-side");
  const wide = getComputedStyle(stage).flexDirection === "row";
  // The standings take what the board leaves (flex: 1), so count only their min-width.
  const availW = Math.max(120, stage.clientWidth - (wide ? parseFloat(getComputedStyle(side).minWidth) + 16 : 0));
  const availH = Math.max(120, window.innerHeight / z - REPLAY_CHROME_H);
  let scale = 1;
  for (let s = 8; s > 1; s--) {
    if ((scene.width * s) / dpr <= availW && (scene.height * s) / dpr <= availH) {
      scale = s;
      break;
    }
  }
  replayBoardEl.style.width = `${(scene.width * scale) / dpr}px`;
  replayBoardEl.style.height = `${(scene.height * scale) / dpr}px`;
}

function renderReplayStep() {
  const { player, steps, record } = replays;
  const step = steps[player.index];
  if (!step) return;
  document.getElementById("replay-step").textContent = `Step ${player.index + 1} of ${steps.length} · turn ${step.turnCount}`;
  document.getElementById("replay-event").textContent = step.event;
  replaySliderEl.value = String(player.index);
  document.getElementById("replay-first").disabled = player.index === 0;
  document.getElementById("replay-back").disabled = player.index === 0;
  document.getElementById("replay-fwd").disabled = player.atEnd();
  document.getElementById("replay-last").disabled = player.atEnd();
  replayPlayEl.setAttribute("aria-label", player.playing ? "Pause" : "Play");
  replayPlayEl.textContent = player.playing ? "❚❚" : "▶";

  // The final standings, with each player's captures so far.
  const byColor = record.players.slice().sort((a, b) => a.color - b.color);
  const captured = new Map(byColor.map((p, i) => [p, step.captures[i] || 0]));
  const places = GoReplay.standings(record.players);
  const ordered = record.players.some((p) => p.place > 0) ? record.players.slice().sort((a, b) => a.place - b.place || a.color - b.color) : byColor;
  document.getElementById("replay-players").replaceChildren(
    ...ordered.map((p, i) => {
      const li = document.createElement("li");
      li.className = p.place === 1 ? "winner" : "";
      const place = document.createElement("span");
      place.className = "place";
      place.textContent = places[i].place;
      const name = document.createElement("span");
      name.className = "name";
      name.textContent = p.bot ? `${p.name} (bot)` : p.name;
      const caps = document.createElement("span");
      caps.className = "caps";
      caps.textContent = `${captured.get(p)} captured`;
      li.append(place, " ", name, caps);
      return li;
    })
  );
}

function drawReplay(now) {
  const { scene, steps, player, record } = replays;
  const step = steps[player.index];
  if (!scene || !step) return;
  scene.render({
    time: now / 1000,
    board: step.board,
    lastMove: step.lastMove,
    overlays: step.overlays,
    effects: [],
    myColor: 0,
    turnCount: step.turnCount,
    roundLength: record.players.length,
    round: Math.floor(step.turnCount / Math.max(1, record.players.length)) + 1,
    stormUntil: 0,
    reducedMotion: reducedMotion(),
  });
  replays.imageData.data.set(scene.rgba);
  replayBoardCtx.putImageData(replays.imageData, 0, 0);
}

function replayLoop(now) {
  requestAnimationFrame(replayLoop);
  if (!replaysEl.open || replayViewerEl.hidden) {
    replays.lastTime = now;
    return;
  }
  const dt = now - replays.lastTime;
  if (dt < 1000 / REPLAY_FPS) return;
  replays.lastTime = now;
  if (replays.player.tick(Math.min(dt, 1000))) renderReplayStep();
  drawReplay(now);
}

function replaySeek(i) {
  replays.player.seek(i);
  renderReplayStep();
  drawReplay(performance.now());
}

function replayToggle() {
  replays.player.toggle();
  replays.lastTime = performance.now();
  renderReplayStep();
}

// ---- wiring ----------------------------------------------------------------------------

document.getElementById("home-replays").addEventListener("click", openReplays);
document.getElementById("replays-close").addEventListener("click", () => replaysEl.close());
document.getElementById("replay-back-list").addEventListener("click", () => {
  showReplayList();
  if (!replays.games.length) loadReplayList();
});
replaysEl.addEventListener("close", () => replays.player.pause());
// As the other dialogs: a click on the backdrop closes it.
replaysEl.addEventListener("click", (evt) => {
  if (evt.target === replaysEl && isOutside(replaysEl, evt)) replaysEl.close();
});
replayFromEl.addEventListener("change", loadReplayList);
replayToEl.addEventListener("change", loadReplayList);
for (const button of document.querySelectorAll("#replays-presets button[data-preset]")) {
  button.addEventListener("click", () => pickPreset(button.dataset.preset));
}
document.getElementById("replay-first").addEventListener("click", () => replaySeek(0));
document.getElementById("replay-back").addEventListener("click", () => replaySeek(replays.player.index - 1));
document.getElementById("replay-fwd").addEventListener("click", () => replaySeek(replays.player.index + 1));
document.getElementById("replay-last").addEventListener("click", () => replaySeek(replays.steps.length - 1));
replayPlayEl.addEventListener("click", replayToggle);
replaySliderEl.addEventListener("input", () => replaySeek(Number(replaySliderEl.value)));
replaySpeedEl.addEventListener("change", () => (replays.player.speed = Number(replaySpeedEl.value) || 2));
// Keys while the viewer is open. The page's own keys (recall) stand aside while any dialog is open.
replaysEl.addEventListener("keydown", (evt) => {
  if (replayViewerEl.hidden || evt.altKey || evt.ctrlKey || evt.metaKey) return;
  const tag = evt.target && evt.target.tagName;
  if (tag === "INPUT" || tag === "SELECT") return; // the slider and the speed take their own keys
  const { index } = replays.player;
  if (evt.key === "ArrowLeft") replaySeek(index - 1);
  else if (evt.key === "ArrowRight") replaySeek(index + 1);
  else if (evt.key === "Home") replaySeek(0);
  else if (evt.key === "End") replaySeek(replays.steps.length - 1);
  else if (evt.key === " " && tag !== "BUTTON") replayToggle(); // a button's own Space is its click
  else return;
  evt.preventDefault();
});
window.addEventListener("resize", sizeReplayCanvas);
requestAnimationFrame(replayLoop);
