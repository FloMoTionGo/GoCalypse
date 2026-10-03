// Live test harness: a real GoCalypse server on a free port with its own data
// folder, a static server for web/, and a headless Edge/Chrome driven over the
// DevTools protocol. No dependencies beyond Node and colyseus.js.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { SERVER_BUILD, TESTS, WEB } from "./paths.mjs";

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `fn` (sync or async) until it returns something truthy; throws with `label` after `ms`. */
export async function until(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await wait(100);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${label}${last instanceof Error ? ` (last error: ${last.message})` : ""}`);
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

export function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gocalypse-${label}-`));
}

// ---- the game server -------------------------------------------------------------

/**
 * Starts server/build/index.js on a free port. `dataDir` holds its snapshots;
 * pass the same one to a second start to test a restart. The log is kept for
 * failure messages (server.log()).
 */
export async function startServer({ dataDir = tempDir("data"), port } = {}) {
  const entry = path.join(SERVER_BUILD, "index.js");
  if (!fs.existsSync(entry)) throw new Error(`${entry} is missing: build the server first (node tests/run.mjs builds it)`);
  port = port || (await freePort());
  let log = "";
  const child = spawn(process.execPath, [entry], {
    cwd: path.dirname(SERVER_BUILD),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const exited = new Promise((r) => child.on("exit", r));
  const httpUrl = `http://127.0.0.1:${port}`;
  try {
    await until(async () => (await fetch(`${httpUrl}/healthz`)).ok, 15000, `the server on port ${port}`);
  } catch (err) {
    child.kill();
    throw new Error(`${err.message}\n--- server log ---\n${log}`);
  }
  return {
    port,
    dataDir,
    http: httpUrl,
    ws: `ws://127.0.0.1:${port}`,
    log: () => log,
    /** Stops the process the hard way, as a crash or a machine stop would. */
    async stop() {
      if (child.exitCode === null) child.kill("SIGKILL");
      await exited;
    },
  };
}

// ---- Colyseus clients ------------------------------------------------------------

const require = createRequire(path.join(TESTS, "package.json"));

export function colyseus() {
  try {
    return require("colyseus.js");
  } catch {
    throw new Error("colyseus.js is missing: run `npm install` in tests/");
  }
}

/**
 * Leaves a room without waiting on it for ever: leave() never settles on a
 * socket that was already dropped, which would keep a test file alive.
 */
export async function leaveQuietly(room, ms = 1000) {
  try {
    await Promise.race([Promise.resolve(room.leave(true)), wait(ms)]);
  } catch {
    /* already gone */
  }
  try {
    room.connection?.close();
  } catch {
    /* already closed */
  }
}

// ---- the web client ---------------------------------------------------------------

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };

/** Serves web/ on a free port, as GitHub Pages would. */
export async function startWeb() {
  const port = await freePort();
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split(/[?#]/)[0]);
    if (rel === "/favicon.ico") return res.writeHead(204).end();
    const file = path.join(WEB, rel === "/" ? "index.html" : rel);
    if (!file.startsWith(WEB)) return res.writeHead(403).end();
    fs.readFile(file, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(data);
    });
  });
  await new Promise((r) => server.listen(port, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

// ---- the browser --------------------------------------------------------------------

function browserPath() {
  if (process.env.GOCALYPSE_BROWSER) return process.env.GOCALYPSE_BROWSER;
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
        ]
      : process.platform === "darwin"
      ? ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/microsoft-edge", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const found = candidates.find((c) => fs.existsSync(c));
  if (!found) throw new Error("no Edge or Chrome found: set GOCALYPSE_BROWSER to a Chromium-based browser");
  return found;
}

/** The colyseus.js the page loads from a CDN, served from tests/node_modules instead: offline, and pinned. */
function localColyseusBundle() {
  const file = path.join(path.dirname(require.resolve("colyseus.js/package.json")), "dist", "colyseus.js");
  return fs.readFileSync(file).toString("base64");
}

/**
 * Starts a headless browser with a throwaway profile and attaches to its page.
 * Every console error, uncaught exception and failed request on the page is
 * collected in `problems` (the clean-console rule: a GUI test fails on them).
 */
export async function launchBrowser({ width = 1400, height = 1000 } = {}) {
  const profile = tempDir("browser");
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`,
    // Keep the page visible and its timers running: Windows occlusion can mark a
    // headless window hidden (requestAnimationFrame stops), and a fresh profile
    // otherwise syncs the account's extensions, whose tabs push the page back.
    "--disable-extensions", "--disable-sync", "--no-first-run", "--no-default-browser-check",
    "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
  ];
  if (process.platform === "linux") args.push("--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage");
  const child = spawn(browserPath(), [...args, "about:blank"], { stdio: "ignore", detached: process.platform !== "win32" });

  const portFile = path.join(profile, "DevToolsActivePort");
  const cdpPort = await until(() => fs.existsSync(portFile) && Number(fs.readFileSync(portFile, "utf8").split("\n")[0]), 20000, "the browser's DevTools port");
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${cdpPort}/json`)).json()).find((t) => t.type === "page"), 10000, "a page target");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  const problems = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(`${p.method}: ${msg.error.message}`)) : p.resolve(msg.result);
      return;
    }
    for (const fn of listeners.get(msg.method) || []) fn(msg.params);
  };
  const cdp = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }));
  };
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);

  on("Runtime.exceptionThrown", (p) => problems.push(`uncaught: ${p.exceptionDetails.exception?.description || p.exceptionDetails.text}`));
  on("Runtime.consoleAPICalled", (p) => {
    if (p.type === "error" || p.type === "assert") problems.push(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description).join(" ")}`);
  });
  on("Log.entryAdded", (p) => {
    if (p.entry.level === "error") problems.push(`log: ${p.entry.text} ${p.entry.url || ""}`.trim());
  });
  const bundle = localColyseusBundle();
  on("Fetch.requestPaused", (p) =>
    cdp("Fetch.fulfillRequest", {
      requestId: p.requestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/javascript" }],
      body: bundle,
    }).catch(() => {})
  );

  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Log.enable");
  await cdp("Fetch.enable", { patterns: [{ urlPattern: "*cdn.jsdelivr.net/npm/colyseus.js*" }] });
  await cdp("Page.bringToFront");

  /** Evaluates an expression in the page; promises are awaited, the value comes back as JSON. */
  async function ev(expression) {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`in page: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}\n  for: ${expression.slice(0, 200)}`);
    return r.result.value;
  }

  return {
    cdp,
    on,
    ev,
    problems,
    /** Waits for a page expression to be truthy. */
    waitFor: (expression, ms = 15000, label = expression) => until(() => ev(expression), ms, label),
    async load(url) {
      await cdp("Page.navigate", { url });
      await until(() => ev("document.readyState === 'complete'"), 20000, `load of ${url}`);
    },
    /** A real mouse click at page coordinates (left, or right for the context menu). */
    async click(x, y, button = "left") {
      for (const type of ["mousePressed", "mouseReleased"]) {
        await cdp("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
      }
    },
    async key(key, code = key) {
      for (const type of ["keyDown", "keyUp"]) await cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: KEYCODES[key] || 0 });
    },
    async screenshot(file) {
      const { data } = await cdp("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(data, "base64"));
    },
    async close() {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      killBrowser(child, profile);
    },
  };
}

const KEYCODES = { Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, End: 35 };

/** The launcher alone exits early on Windows and leaves the browser alive, so every process of the profile goes. */
function killBrowser(child, profile) {
  if (process.platform === "win32") {
    try {
      execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`,
      ]);
    } catch {
      /* best effort: the profile is unique, a straggler harms nothing */
    }
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    /* Windows may still hold a file for a moment */
  }
}

// ---- one game page against one server ----------------------------------------------

/**
 * The usual GUI test set-up: a server, web/ served, a browser. `page(hash)`
 * opens index.html with these hash parameters against this server.
 */
export async function gameRig() {
  const server = await startServer();
  const web = await startWeb();
  const browser = await launchBrowser();
  return {
    server,
    web,
    browser,
    url(params = {}) {
      const hash = new URLSearchParams({ server: server.ws, ...params });
      return `${web.url}/index.html#${hash}`;
    },
    async close() {
      await browser.close();
      await web.close();
      await server.stop();
    },
  };
}
