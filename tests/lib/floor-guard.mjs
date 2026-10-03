#!/usr/bin/env node
// Floor guard: the CONSTRAINTS.md floor, enforced on a change. Adapted from the
// constraint-driven-development skill's reference (references/floor-guard.md),
// same contract:
//   exit 0 clean, 1 a floor violation, 2 the guard could not run (never read as clean).
// Tightening the bar is silent; loosening it is loud.
//
//   node tests/lib/floor-guard.mjs [--staged [--msg <file>] | --base <ref> | --range <ref>]
//
// A commit message trailer `Constraint-Exception: <reason>` lets that commit's
// findings through as warnings: the reason stays in the history.
import fs from "node:fs";
import path from "node:path";
import { atBase, diffLines, filesAtBase, git, isTestPath, setsFromArgs, testNames } from "./git.mjs";
import { ROOT } from "./paths.mjs";

const TOOL = "floor-guard";
const gitDir = git(["rev-parse", "--git-dir"])?.trim();
if (!gitDir) {
  console.error(`${TOOL}: not inside a git work tree`);
  process.exit(2);
}
// A merge commit being made brings in commits that were each judged on their
// own (with their own trailers); judging their sum again would lose those.
if (!process.argv.includes("--range") && !process.argv.includes("--base") && fs.existsSync(path.resolve(ROOT, gitDir, "MERGE_HEAD"))) {
  console.log(`${TOOL}: merge commit, its commits were judged one by one`);
  process.exit(0);
}

// Paths the guard skips, one glob per line in .constraintsignore (the guard's
// own pattern lists would flag themselves). Changing that file is a finding.
const IGNORE_FILE = ".constraintsignore";
const globRe = (g) =>
  new RegExp("^" + g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "$");
const ignoreSrc = fs.existsSync(path.join(ROOT, IGNORE_FILE)) ? fs.readFileSync(path.join(ROOT, IGNORE_FILE), "utf8") : "";
const ignored = ignoreSrc.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map(globRe);
const skip = (f) => ignored.some((re) => re.test(f));

// 1. A silenced checker.
const SUPPRESSIONS = /@ts-ignore|@ts-nocheck|@ts-expect-error|eslint-disable|biome-ignore|istanbul ignore|c8 ignore|nosemgrep|gitleaks:allow|Stryker disable/;
// 4. Unfinished work.
const STUBS = /throw new (Error|NotImplemented)\(.*[Nn]ot implemented|catch\s*\(\w*\)\s*\{\s*\}|catch\s*\{\s*\}|\bTODO\b|\bFIXME\b/;
// 2. A test made easier: skipped, todo'd, or narrowed to .only.
const SKIPS = /\b(test|it|describe)\.(skip|todo|only)\b|\bxit\(|\bxdescribe\(|\{\s*(skip|todo|only)\s*:\s*(true|["'`])/;
// Code only: prose (CONSTRAINTS.md, the READMEs) names these patterns to explain them.
const isCode = (f) => /\.(ts|js|mjs|cjs|html|css|ya?ml|sh)$/.test(f) || f.startsWith(".githooks/");
const isConstraints = (f) => /(^|\/)CONSTRAINTS\.md$/.test(f);
const PENDING = "tests/pending.json";

function check(set) {
  const { added, removed, deleted } = diffLines(TOOL, set);
  const findings = [];
  const flag = (rule, file, text) => findings.push({ rule, file, text: String(text).trim().slice(0, 140) });

  for (const { file, text } of added) {
    if (skip(file)) continue;
    if (isCode(file) && SUPPRESSIONS.test(text)) flag("silenced-checker", file, text);
    if (isCode(file) && STUBS.test(text)) flag("unfinished-work", file, text);
    if (isTestPath(file) && SKIPS.test(text)) flag("test-made-easier", file, text);
    if (isConstraints(file) && /^\| *(W|E)\d+ *\|/.test(text)) flag("new-exception", file, text);
  }
  if (atBase(set, IGNORE_FILE) !== null) {
    for (const { file, text } of added) if (file === IGNORE_FILE && text.trim() && !text.trim().startsWith("#")) flag("new-exception", file, text);
  }

  // 2b. A test file deleted, or an assertion removed from a test file that stays.
  for (const f of deleted) if (/\.test\.(ts|mjs|js)$/.test(f) && !skip(f)) flag("test-deleted", f, "file deleted");
  for (const { file, text } of removed) {
    if (skip(file) || !isTestPath(file) || deleted.includes(file)) continue;
    if (/\bassert\b|\bexpect\(|\.should\b/.test(text)) {
      // An assertion moved within the same file (re-indented, reordered) is not removed.
      if (!added.some((a) => a.file === file && a.text.trim() === text.trim())) flag("assertion-removed", file, text);
    }
  }

  // 2c. tests/pending.json is for tests written ahead of their feature. Listing a
  // test that already existed hides a red test by calling it "pending".
  const names = (src) => {
    try {
      return new Set((JSON.parse(src || "{}").pending || []).map((p) => p.test));
    } catch {
      return new Set();
    }
  };
  const before = names(atBase(set, PENDING));
  const newlyPending = [...names(set.show(PENDING))].filter((n) => !before.has(n));
  if (newlyPending.length) {
    const existing = new Set();
    for (const f of filesAtBase(set).filter((f) => /\.test\.(ts|mjs|js)$/.test(f))) for (const n of testNames(atBase(set, f) || "")) existing.add(n);
    for (const n of newlyPending) if (existing.has(n)) flag("test-made-easier", PENDING, `an existing test listed as pending: "${n}"`);
  }

  // 1b/2d. A rule in CONSTRAINTS.md weakened or removed (as in the reference implementation).
  const ruleKey = (t) => {
    const s = t.trim();
    if (s.startsWith("|")) return s.split("|").map((c) => c.trim()).filter(Boolean)[0] ?? "";
    if (/^[-*] /.test(s)) return s.slice(2).split(":")[0].trim();
    return null;
  };
  const isException = (t) => /^\| *(W|E)\d+ *\|/.test(t.trim());
  const MIN_BEFORE = /(>=|>|≥|at least|minimum|\bmin\b|no less than|not fall|not drop)\s*$/;
  const MAX_BEFORE = /(<=|<|≤|at most|maximum|\bmax\b|no more than|under|below|not grow|not exceed)\s*$/;
  const MIN_AFTER = /^\s*\S*\s*(or more|or higher|must not fall|must not drop)/;
  const MAX_AFTER = /^\s*\S*\s*(or less|or lower|must not grow|must not exceed)/;
  const thresholds = (t) => {
    const out = [], re = /\d+(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(t))) {
      const b = t.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
      const a = t.slice(m.index + m[0].length, m.index + m[0].length + 40).toLowerCase();
      const dir = MIN_BEFORE.test(b) || MIN_AFTER.test(a) ? "min" : MAX_BEFORE.test(b) || MAX_AFTER.test(a) ? "max" : null;
      out.push({ n: Number(m[0]), dir });
    }
    return out;
  };
  const removedRules = removed.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
  const addedRules = added.filter((l) => isConstraints(l.file) && ruleKey(l.text) !== null);
  for (const r of removedRules) {
    const a = addedRules.find((x) => ruleKey(x.text) === ruleKey(r.text));
    if (!a) {
      if (!isException(r.text)) flag("rule-removed", r.file, r.text);
      continue;
    }
    const was = thresholds(r.text), now = thresholds(a.text);
    let verdict = null;
    for (const dir of ["min", "max", null]) {
      const w = was.filter((x) => x.dir === dir), n = now.filter((x) => x.dir === dir);
      w.forEach((b, i) => {
        if (verdict) return;
        if (!n[i]) verdict = "threshold-removed";
        else if (n[i].n === b.n) return;
        else if (dir === "min" ? n[i].n < b.n : dir === "max" ? n[i].n > b.n : true) verdict = dir ? "threshold-loosened" : "threshold-changed";
      });
    }
    if (verdict) flag(verdict, r.file, `${r.text}  ->  ${a.text}`);
  }
  return findings;
}

// ---- verdict -------------------------------------------------------------------------------
let blocked = false;
for (const set of setsFromArgs(TOOL)) {
  const findings = check(set);
  if (findings.length === 0) {
    console.log(`${TOOL}: clean (${set.label})`);
    continue;
  }
  const exception = set.trailers["Constraint-Exception"];
  const out = exception ? console.log : console.error;
  out(`${TOOL}: ${findings.length} floor ${exception ? "finding(s), let through by Constraint-Exception" : "violation(s)"} (${set.label}):`);
  for (const f of findings) out(`  [${f.rule}] ${f.file}: ${f.text}`);
  if (exception) out(`  Constraint-Exception: ${exception}`);
  else blocked = true;
}
if (blocked) {
  console.error(
    "\nEach is a move that lowers the bar. Fix the change, or -- if it is right -- say why in the commit\n" +
      "message with a trailer line `Constraint-Exception: <reason>` (see CONSTRAINTS.md)."
  );
  process.exit(1);
}
process.exit(0);
