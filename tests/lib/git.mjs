// Git plumbing shared by the commit checks (floor-guard.mjs, red-first.mjs).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./paths.mjs";

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Runs git in the repo; null when it fails (callers must never read null as "clean"). */
export function git(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

export function bail(tool, msg) {
  console.error(`${tool}: ${msg}`);
  process.exit(2);
}

// ---- change sets: what is judged, and against what ---------------------------------------
//
// A change set is { base, diffArgs, show(file), label, trailers }:
//   base      the commit it is measured against (atBase reads files there)
//   diffArgs  the git diff arguments that produce it
//   show      a file as the change leaves it
//   trailers  the commit message's trailer lines (Test-Exempt:, Constraint-Exception:)

/** The commit being made: what is staged, against HEAD (or nothing, for a first commit). */
function stagedSet(argv) {
  const head = git(["rev-parse", "--verify", "-q", "HEAD"])?.trim();
  const base = head || EMPTY_TREE;
  return { base, diffArgs: ["--cached", base], show: (file) => git(["show", `:${file}`]), label: "staged changes", trailers: trailers(argv) };
}

/** HEAD against its merge base with <ref>, as one change. */
function baseSet(tool, ref) {
  const base = git(["merge-base", ref, "HEAD"])?.trim();
  if (!base) bail(tool, `no merge base with ${ref}`);
  return { base, diffArgs: [base, "HEAD"], show: (file) => git(["show", `HEAD:${file}`]), label: `${ref}...HEAD`, trailers: {} };
}

/**
 * Every commit after <ref> up to HEAD, oldest first, each judged on its own with
 * its own message's trailers -- so commits made with --no-verify are caught by
 * CI and pre-push. Merge commits are left out: their parents were judged.
 */
function rangeSets(tool, ref) {
  const base = git(["merge-base", ref, "HEAD"])?.trim();
  if (!base) bail(tool, `no merge base with ${ref}`);
  const list = git(["rev-list", "--reverse", "--no-merges", `${base}..HEAD`]);
  if (list === null) bail(tool, `could not list the commits after ${ref}`);
  return list
    .split("\n")
    .filter(Boolean)
    .map((sha) => ({
      base: `${sha}^`,
      diffArgs: [`${sha}^`, sha],
      show: (file) => git(["show", `${sha}:${file}`]),
      label: `${sha.slice(0, 8)} ${(git(["log", "-1", "--format=%s", sha]) || "").trim()}`,
      trailers: parseTrailers(git(["log", "-1", "--format=%B", sha]) || ""),
    }));
}

/**
 * The change sets a guard judges, from its arguments:
 *   --staged (default)  the commit being made, trailers from --msg <file>
 *   --base <ref>        HEAD against its merge base with <ref>, as one change
 *   --range <ref>       each commit after <ref>, one by one, with its own trailers
 */
export function setsFromArgs(tool, argv = process.argv) {
  const r = argv.indexOf("--range");
  const b = argv.indexOf("--base");
  const sets = r > -1 ? rangeSets(tool, argv[r + 1]) : b > -1 ? [baseSet(tool, argv[b + 1])] : [stagedSet(argv)];
  // A commit is judged by the rules its parent had: history from before this
  // check existed (and the commit that brings it) is not held to it.
  return sets.filter((set) => {
    const ruled = git(["cat-file", "-e", `${set.base}:tests/lib/${tool}.mjs`]) !== null;
    if (!ruled) console.log(`${tool}: ${set.label} -- before this check existed, not judged`);
    return ruled;
  });
}

/** Files changed, with their status letter (A, M, D...). */
export function changedFiles(tool, set) {
  const out = git(["diff", "--name-status", "--no-renames", ...set.diffArgs]);
  if (out === null) bail(tool, `could not list changed files (${set.label})`);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [status, file] = l.split("\t");
      return { status: status[0], file: file.replace(/\\/g, "/") };
    });
}

/** Added and removed lines per file, and the files deleted, from a zero-context diff. */
export function diffLines(tool, set) {
  const diff = git(["diff", "--unified=0", "--no-renames", ...set.diffArgs]);
  if (diff === null) bail(tool, `could not diff (${set.label})`);
  const added = [], removed = [], deleted = [];
  const pathOf = (s) => s.replace(/^[ab]\//, "");
  let file = "", oldFile = "", inHeader = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff ")) inHeader = true;
    else if (line.startsWith("@@")) inHeader = false;
    else if (inHeader) {
      if (line.startsWith("--- ")) oldFile = pathOf(line.slice(4));
      else if (line.startsWith("+++ ")) {
        const newFile = pathOf(line.slice(4));
        file = newFile === "/dev/null" ? oldFile : newFile;
        if (newFile === "/dev/null") deleted.push(file);
      }
    } else if (line.startsWith("+")) added.push({ file, text: line.slice(1) });
    else if (line.startsWith("-")) removed.push({ file, text: line.slice(1) });
  }
  return { added, removed, deleted };
}

/** A file as it was in the base commit, or null if it didn't exist there. */
export function atBase(set, file) {
  return git(["show", `${set.base}:${file}`]);
}

/** Every file in the base commit. */
export function filesAtBase(set) {
  return (git(["ls-tree", "-r", "--name-only", set.base]) || "").split("\n").filter(Boolean);
}

// ---- what kind of file is this --------------------------------------------------------------

/** Test code: test files, the room testkit, anything under tests/. */
export const isTestPath = (f) => /\.(test|spec)\.(ts|js|mjs|cjs)$/.test(f) || /\.testkit\.ts$/.test(f) || f.startsWith("tests/");
/** Shipped behaviour: the server's sources and the web client. */
export const isSourcePath = (f) => !isTestPath(f) && (/^server\/src\/.*\.ts$/.test(f) || /^web\/.*\.(js|html|css)$/.test(f));

// ---- test names and commit messages ----------------------------------------------------------

/** The names of test(...) / it(...) cases declared in a test file's source. Template names come back as written. */
export function testNames(source) {
  const names = [];
  const re = /\b(?:test|it)\(\s*(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let m;
  while ((m = re.exec(source))) names.push(m[2].replace(/\\(["'`\\])/g, "$1"));
  return names;
}

/** Trailer lines of a commit message: { "Test-Exempt": "reason", ... }. */
export function parseTrailers(message) {
  const out = {};
  for (const line of message.split("\n")) {
    const m = /^([A-Z][A-Za-z-]+):\s*(\S.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** The trailers of the commit message file named by --msg (the commit-msg hook). */
export function trailers(argv = process.argv) {
  const i = argv.indexOf("--msg");
  if (i < 0) return {};
  const file = argv[i + 1];
  if (!file || !fs.existsSync(path.resolve(ROOT, file))) return {};
  return parseTrailers(fs.readFileSync(path.resolve(ROOT, file), "utf8"));
}
