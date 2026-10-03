#!/usr/bin/env node
// Red first: a change to shipped behaviour (server/src, web/) needs tests, and
// tests for something new must have been committed red, ahead of it, through
// tests/pending.json (see tests/README.md). For each commit judged:
//
//   1. source changed, no test changed            -> refused
//   2. source changed and new test names added    -> refused: commit the tests
//      first, listed in tests/pending.json, so the gate shows them red
//
// Exit 0 ok, 1 refused, 2 could not run. A trailer `Test-Exempt: <reason>` in a
// commit's message lets it through (a pure refactor, a cosmetic CSS tweak); the
// reason stays in the history. A merge commit being made is not checked: its
// commits were.
//
//   node tests/lib/red-first.mjs [--staged [--msg <file>] | --base <ref> | --range <ref>]
import fs from "node:fs";
import path from "node:path";
import { atBase, changedFiles, git, isSourcePath, isTestPath, setsFromArgs, testNames } from "./git.mjs";
import { ROOT } from "./paths.mjs";

const TOOL = "red-first";
const gitDir = git(["rev-parse", "--git-dir"])?.trim();
if (!gitDir) {
  console.error(`${TOOL}: not inside a git work tree`);
  process.exit(2);
}
if (!process.argv.includes("--range") && !process.argv.includes("--base") && fs.existsSync(path.resolve(ROOT, gitDir, "MERGE_HEAD"))) {
  console.log(`${TOOL}: merge commit, not checked`);
  process.exit(0);
}

function check(set) {
  const files = changedFiles(TOOL, set);
  const source = files.filter((f) => isSourcePath(f.file));
  const tests = files.filter((f) => isTestPath(f.file));
  if (source.length === 0) return [];
  const problems = [];
  if (tests.length === 0) {
    problems.push(
      `shipped code changed with no test changed:\n${source.map((f) => `    ${f.file}`).join("\n")}\n` +
        "  Write the test that shows the change (red first: see tests/README.md)."
    );
  }
  const newNames = [];
  for (const { file, status } of tests) {
    if (status === "D" || !/\.test\.(ts|mjs|js)$/.test(file)) continue;
    const before = new Set(testNames(atBase(set, file) || ""));
    for (const n of testNames(set.show(file) || "")) if (!before.has(n)) newNames.push(`${file}: ${n}`);
  }
  if (newNames.length) {
    problems.push(
      `new tests arrive together with the code they test:\n${newNames.map((n) => `    ${n}`).join("\n")}\n` +
        "  Commit them first, listed in tests/pending.json, so the gate proves they are red;\n" +
        "  then implement, take them off the list, and commit the code."
    );
  }
  return problems;
}

let blocked = false;
for (const set of setsFromArgs(TOOL)) {
  const problems = check(set);
  if (problems.length === 0) {
    console.log(`${TOOL}: ok (${set.label})`);
    continue;
  }
  const exempt = set.trailers["Test-Exempt"];
  const out = exempt ? console.log : console.error;
  out(`${TOOL}: ${exempt ? "let through by Test-Exempt" : "refused"} (${set.label})`);
  for (const p of problems) out(`  ${p}`);
  if (exempt) out(`  Test-Exempt: ${exempt}`);
  else blocked = true;
}
if (blocked) {
  console.error("\n  If a change really needs no new test, say why in a commit message trailer: `Test-Exempt: <reason>`.");
  process.exit(1);
}
process.exit(0);
