#!/usr/bin/env node
// GoCalypse test runner: every tier, judged against tests/pending.json.
//
//   node tests/run.mjs [quick | full | <tier> ...] [--grep <pattern>] [--reporter spec|dot] [--gate]
//
// Tiers (granular, each runnable alone):
//   server       server/src/**/*.test.ts: rules, bots, items, rooms, persistence (unit)
//   web          tests/web/*.test.mjs: sprites.js and pixelScene.js in Node (unit)
//   web-slow     tests/web/*.slow.test.mjs: exhaustive render checks (storm grey)
//   integration  tests/integration: a real server over HTTP and WebSockets
//   gui          tests/gui: index.html in headless Edge/Chrome against a real server
//   tools        tests/tools: the commit checks themselves (floor guard, red first)
// Profiles: quick = server + web + tools; full = every tier (default).
//
// A test named in tests/pending.json is one written ahead of its feature: it
// must FAIL (red), and the run says so. Once it passes, the run fails until the
// entry is taken off the list -- the feature is done. Everything else must pass,
// and nothing may be skipped.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, SERVER, TESTS } from "./lib/paths.mjs";

const TIERS = {
  server: { cwd: SERVER, files: () => listTests(path.join(SERVER, "build"), (f) => f.endsWith(".test.js")), args: [] },
  web: { cwd: ROOT, files: () => listTests(path.join(TESTS, "web"), (f) => f.endsWith(".test.mjs") && !f.endsWith(".slow.test.mjs")), args: [] },
  "web-slow": { cwd: ROOT, files: () => listTests(path.join(TESTS, "web"), (f) => f.endsWith(".slow.test.mjs")), args: [] },
  integration: { cwd: ROOT, files: () => listTests(path.join(TESTS, "integration"), (f) => f.endsWith(".test.mjs")), args: ["--test-timeout=240000"], deps: true },
  gui: { cwd: ROOT, files: () => listTests(path.join(TESTS, "gui"), (f) => f.endsWith(".test.mjs")), args: ["--test-timeout=300000", "--test-concurrency=2"], deps: true },
  tools: { cwd: ROOT, files: () => listTests(path.join(TESTS, "tools"), (f) => f.endsWith(".test.mjs")), args: [] },
};
const PROFILES = { quick: ["server", "web", "tools"], full: Object.keys(TIERS) };

// ---- arguments ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv.splice(i, 2)[1] : undefined;
};
const grep = opt("--grep");
const reporter = opt("--reporter") || "spec";
const gate = argv.includes("--gate") ? (argv.splice(argv.indexOf("--gate"), 1), true) : false;
const asked = argv.length ? argv : ["full"];
const tiers = [];
for (const a of asked) {
  const list = PROFILES[a] || (TIERS[a] ? [a] : null);
  if (!list) {
    console.error(`unknown tier or profile "${a}": ${[...Object.keys(PROFILES), ...Object.keys(TIERS)].join(", ")}`);
    process.exit(2);
  }
  for (const t of list) if (!tiers.includes(t)) tiers.push(t);
}
const profile = asked.length === 1 && PROFILES[asked[0]] ? asked[0] : tiers.join("+");

function listTests(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...listTests(p, keep));
    else if (keep(e.name)) out.push(p);
  }
  return out.sort();
}

const line = (s = "") => console.log(s);
const bar = (title) => line(`\n=== ${title} ${"=".repeat(Math.max(3, 70 - title.length))}`);

// ---- prerequisites -----------------------------------------------------------------------
function need(dir, what) {
  if (!fs.existsSync(path.join(dir, "node_modules"))) {
    console.error(`missing ${path.relative(ROOT, dir)}/node_modules: run \`npm ci\` in ${path.relative(ROOT, dir) || "."} (${what})`);
    process.exit(2);
  }
}
need(SERVER, "the server and its compiler");
if (tiers.some((t) => TIERS[t].deps)) need(TESTS, "colyseus.js for the live tiers");

bar("build: server (tsc)");
const t0 = Date.now();
// Stale tests first: a test file deleted from src must not live on in build/.
// (Only test output goes: a server started from build/ elsewhere keeps running.)
for (const f of listTests(path.join(SERVER, "build"), (n) => /\.(test|testkit)\.js(\.map)?$/.test(n))) fs.rmSync(f, { force: true });
const tsc = spawnSync(process.execPath, [path.join(SERVER, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], { cwd: SERVER, stdio: "inherit" });
if (tsc.status !== 0) {
  console.error("\nThe server does not compile: nothing else runs until it does.");
  process.exit(1);
}
line(`ok (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

// ---- run the tiers -----------------------------------------------------------------------
const collector = pathToFileURL(path.join(TESTS, "lib", "collect.mjs")).href;
const results = [];
const summary = [];

function runTier(name) {
  const tier = TIERS[name];
  const files = tier.files();
  if (files.length === 0) return Promise.resolve({ name, files: 0, ms: 0, crashed: false });
  const out = path.join(os.tmpdir(), `gocalypse-results-${process.pid}-${name}.jsonl`);
  fs.rmSync(out, { force: true });
  const args = [
    "--test",
    `--test-reporter=${reporter}`,
    "--test-reporter-destination=stdout",
    `--test-reporter=${collector}`,
    `--test-reporter-destination=${out}`,
    ...tier.args,
    ...(grep ? [`--test-name-pattern=${grep}`] : []),
    ...files,
  ];
  bar(`${name}: ${files.length} file${files.length === 1 ? "" : "s"}`);
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { cwd: tier.cwd, stdio: ["ignore", "inherit", "inherit"] });
    child.on("exit", (code) => {
      const lines = fs.existsSync(out) ? fs.readFileSync(out, "utf8").split("\n").filter(Boolean) : [];
      fs.rmSync(out, { force: true });
      for (const l of lines) results.push({ tier: name, ...JSON.parse(l) });
      // A run that failed without reporting a failure crashed outside any test.
      const crashed = code !== 0 && !lines.some((l) => JSON.parse(l).status === "fail");
      resolve({ name, files: files.length, ms: Date.now() - start, crashed });
    });
  });
}

for (const name of tiers) summary.push(await runTier(name));

// ---- judge against pending.json ------------------------------------------------------------
const pendingFile = path.join(TESTS, "pending.json");
let pending = [];
try {
  pending = JSON.parse(fs.readFileSync(pendingFile, "utf8")).pending || [];
} catch (err) {
  console.error(`tests/pending.json is unreadable: ${err.message}`);
  process.exit(2);
}
const pendingByName = new Map(pending.map((p) => [p.test, p]));

const failures = [], red = [], greenTooEarly = [], skipped = [];
for (const r of results) {
  const p = pendingByName.get(r.name);
  if (r.skipped) skipped.push(r);
  else if (p && r.status === "fail") red.push({ ...r, feature: p.feature });
  else if (p && r.status === "pass") greenTooEarly.push({ ...r, feature: p.feature });
  else if (r.status === "fail") failures.push(r);
}
const fullRun = !grep && Object.keys(TIERS).every((t) => tiers.includes(t));
const seen = new Set(results.map((r) => r.name));
const unknownPending = pending.filter((p) => !seen.has(p.test) && (fullRun || (p.tier && tiers.includes(p.tier) && !grep)));

// ---- report ------------------------------------------------------------------------------
bar(`summary: ${profile}`);
for (const s of summary) {
  const rs = results.filter((r) => r.tier === s.name);
  const count = (st) => rs.filter((r) => r.status === st && !pendingByName.has(r.name)).length;
  const reds = rs.filter((r) => pendingByName.has(r.name) && r.status === "fail").length;
  line(
    `  ${s.name.padEnd(12)} ${String(count("pass")).padStart(4)} passed  ${String(count("fail")).padStart(3)} failed` +
      `${reds ? `  ${reds} red (pending)` : ""}  ${(s.ms / 1000).toFixed(1).padStart(6)} s${s.crashed ? "  CRASHED" : ""}`
  );
}
if (red.length) {
  line(`\n  Red as expected -- written ahead of their feature (tests/pending.json):`);
  for (const r of red) line(`    [${r.feature}] ${r.name}${r.error ? `\n        ${r.error}` : ""}`);
}
const bad = [];
if (failures.length) bad.push(`${failures.length} test(s) failed:\n${failures.map((r) => `    [${r.tier}] ${r.name}${r.error ? `\n        ${r.error}` : ""}`).join("\n")}`);
if (greenTooEarly.length)
  bad.push(
    `${greenTooEarly.length} pending test(s) now pass -- the feature is in. Take them off tests/pending.json:\n` +
      greenTooEarly.map((r) => `    [${r.feature}] ${r.name}`).join("\n")
  );
if (skipped.length) bad.push(`${skipped.length} test(s) skipped or todo: not allowed, list a test ahead of its feature in tests/pending.json instead:\n${skipped.map((r) => `    ${r.name}`).join("\n")}`);
if (unknownPending.length) bad.push(`tests/pending.json names test(s) that don't exist:\n${unknownPending.map((p) => `    ${p.test}`).join("\n")}`);
const crashed = summary.filter((s) => s.crashed);
if (crashed.length) bad.push(`tier(s) crashed outside any test: ${crashed.map((s) => s.name).join(", ")}`);
if (results.length === 0 && tiers.length) bad.push("no tests ran at all");

if (bad.length) {
  line(`\n  FAILED`);
  for (const b of bad) line(`  - ${b}`);
  process.exit(1);
}
line(`\n  ALL GREEN${red.length ? ` (${red.length} red by design, pending their feature)` : ""}`);

// A full gate run over exactly what is staged is remembered by its tree, so the
// pre-push hook need not run it again for the same content.
if (gate && profile === "full") {
  const unstaged = spawnSync("git", ["diff", "--quiet"], { cwd: ROOT }).status !== 0;
  const tree = spawnSync("git", ["write-tree"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim();
  const gitDir = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim();
  if (!unstaged && tree && gitDir) fs.writeFileSync(path.resolve(ROOT, gitDir, "gocalypse-gate-green"), tree + "\n");
  else if (unstaged) line("  (unstaged changes: this run tested the working tree, not just the commit)");
}
process.exit(0);
