#!/usr/bin/env node
// Dependency audit (CONSTRAINTS.md, "Security: deps"): nothing at high or above
// in what the server ships with, by `npm audit`. A package may be let through
// only by a row of the Exceptions table in CONSTRAINTS.md whose Rule is
// `deps-high`, whose Path names the package, and whose Expires date is still
// ahead. Exit 0 ok, 1 a finding, 2 the audit could not run.
//
//   node tests/lib/audit.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT, SERVER } from "./paths.mjs";

// One fixed command string through the shell: npm is npm.cmd on Windows.
const npm = spawnSync("npm audit --omit=dev --json", { cwd: SERVER, encoding: "utf8", shell: true, maxBuffer: 16 * 1024 * 1024 });
let report;
try {
  report = JSON.parse(npm.stdout);
} catch {
  console.error(`audit: npm audit gave no report (exit ${npm.status}):\n${npm.stderr}`);
  process.exit(2);
}
if (report.error) {
  console.error(`audit: npm audit failed: ${report.error.summary || JSON.stringify(report.error)}`);
  process.exit(2);
}

// | W1 | deps-high | nanoid (via colyseus) | reason | owner | 2027-01-01 |
const today = new Date().toISOString().slice(0, 10);
const rows = fs
  .readFileSync(path.join(ROOT, "CONSTRAINTS.md"), "utf8")
  .split("\n")
  .filter((l) => /^\| *W\d+ *\|/.test(l))
  .map((l) => l.split("|").map((c) => c.trim()).filter(Boolean))
  .filter((c) => c[1] === "deps-high")
  .map(([id, , target, reason, owner, expires]) => ({ id, pkg: target.split(/\s/)[0], reason, owner, expires }));

let bad = 0;
for (const [name, v] of Object.entries(report.vulnerabilities || {})) {
  if (v.severity !== "high" && v.severity !== "critical") continue;
  const ex = rows.find((r) => r.pkg === name);
  if (ex && ex.expires >= today) {
    console.log(`audit: ${name} (${v.severity}) let through by ${ex.id} until ${ex.expires}: ${ex.reason}`);
    continue;
  }
  bad++;
  console.error(`audit: ${name} is ${v.severity}${ex ? `, and exception ${ex.id} expired on ${ex.expires}` : ""}; fix: ${JSON.stringify(v.fixAvailable)}`);
}
if (bad) process.exit(1);
console.log("audit: nothing at high or above beyond tracked exceptions");
