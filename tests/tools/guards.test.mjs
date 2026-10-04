// The commit checks themselves (tests/lib/floor-guard.mjs, red-first.mjs), each
// run against a scratch git repository holding a copy of tests/lib.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TESTS } from "../lib/paths.mjs";

// The pre-commit hook runs this tier, and git hands its hooks GIT_DIR and
// GIT_INDEX_FILE (absolute paths in a linked worktree, and for a partial commit),
// GIT_AUTHOR_* and GIT_CONFIG_PARAMETERS. Inherited, they point a scratch repo's
// git, and the guards run against it, at the repository being committed: on
// 2026-10-03 the `git init` and `git config` below rewrote its .git/config
// (core.bare = true). Every git and guard run here gets this environment instead.

/** The environment without any GIT_* variable: git as a plain shell runs it. */
const withoutGitEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/i.test(k)));

/** A repo with one commit: a source file, a test file, CONSTRAINTS.md and pending.json. */
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gocalypse-guards-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: withoutGitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "master");
  git("config", "user.email", "test@example.org");
  git("config", "user.name", "Guard Test");
  git("config", "core.autocrlf", "false");
  fs.cpSync(path.join(TESTS, "lib"), path.join(dir, "tests", "lib"), { recursive: true });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  write(".constraintsignore", "tests/lib/**\n");
  write("server/src/rules/thing.ts", "export const answer = () => 42;\n");
  write("server/src/rules/thing.test.ts", 'test("the answer is 42", () => {\n  assert.equal(answer(), 42);\n  assert.ok(true);\n});\n');
  write("CONSTRAINTS.md", "# Constraints\n\n| Dimension | Rule |\n|---|---|\n| Coverage | changed lines >= 80% |\n");
  write("tests/pending.json", JSON.stringify({ pending: [] }, null, 2));
  write("README.md", "hello\n");
  git("add", "-A");
  git("commit", "-q", "-m", "start");

  const run = (tool, message = "a change", extra = []) => {
    fs.writeFileSync(path.join(dir, "MSG"), message);
    const r = spawnSync(process.execPath, [path.join(dir, "tests", "lib", `${tool}.mjs`), ...extra, ...(extra.length ? [] : ["--staged", "--msg", "MSG"])], {
      cwd: dir,
      env: withoutGitEnv(),
      encoding: "utf8",
    });
    return { code: r.status, out: r.stdout + r.stderr };
  };
  return {
    dir,
    git,
    write,
    append: (rel, text) => fs.appendFileSync(path.join(dir, rel), text),
    stage: () => git("add", "-A"),
    commit: (m) => git("commit", "-q", "--no-verify", "-m", m),
    floor: (msg, extra) => run("floor-guard", msg, extra),
    redFirst: (msg, extra) => run("red-first", msg, extra),
    done: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function scenario(fn) {
  return () => {
    const r = repo();
    try {
      fn(r);
    } finally {
      r.done();
    }
  };
}

const pendingWith = (...names) => JSON.stringify({ pending: names.map((test) => ({ test, feature: "x" })) }, null, 2);

// ---- floor guard ---------------------------------------------------------------------------

test("floor guard: an honest change is clean", scenario((r) => {
  r.write("server/src/rules/thing.ts", "export const answer = () => 41 + 1;\n");
  r.stage();
  assert.equal(r.floor().code, 0);
}));

test("floor guard: a skipped or .only test is a test made easier", scenario((r) => {
  r.append("server/src/rules/thing.test.ts", 'test.skip("later", () => {});\n');
  r.stage();
  const res = r.floor();
  assert.equal(res.code, 1);
  assert.match(res.out, /test-made-easier/);
}));

test("floor guard: an assertion taken out of a test that stays is caught", scenario((r) => {
  r.write("server/src/rules/thing.test.ts", 'test("the answer is 42", () => {\n  assert.ok(true);\n});\n');
  r.stage();
  const res = r.floor();
  assert.equal(res.code, 1);
  assert.match(res.out, /assertion-removed/);
}));

test("floor guard: an assertion merely moved within its file is not", scenario((r) => {
  r.write("server/src/rules/thing.test.ts", 'test("the answer is 42", () => {\n  assert.ok(true);\n  assert.equal(answer(), 42);\n});\n');
  r.stage();
  assert.equal(r.floor().code, 0);
}));

test("floor guard: a deleted test file is caught", scenario((r) => {
  fs.rmSync(path.join(r.dir, "server/src/rules/thing.test.ts"));
  r.stage();
  assert.match(r.floor().out, /test-deleted/);
}));

test("floor guard: a suppression or an empty catch in code is caught, the same words in prose are not", scenario((r) => {
  r.append("server/src/rules/thing.ts", "// @ts-ignore\ntry { answer(); } catch {}\n");
  r.append("README.md", "We never use @ts-ignore or catch {} -- see CONSTRAINTS.md. TODO is banned too.\n");
  r.stage();
  const res = r.floor();
  assert.equal(res.code, 1);
  assert.match(res.out, /silenced-checker\] server/);
  assert.match(res.out, /unfinished-work\] server/);
  assert.doesNotMatch(res.out, /README/);
}));

test("floor guard: listing an existing test as pending is caught; a new one is fine", scenario((r) => {
  r.write("tests/pending.json", pendingWith("the answer is 42"));
  r.stage();
  const res = r.floor();
  assert.equal(res.code, 1);
  assert.match(res.out, /existing test listed as pending/);
  r.write("tests/pending.json", pendingWith("a brand new test"));
  r.stage();
  assert.equal(r.floor().code, 0);
}));

test("floor guard: a loosened threshold in CONSTRAINTS.md is caught, a tightened one is not", scenario((r) => {
  r.write("CONSTRAINTS.md", "# Constraints\n\n| Dimension | Rule |\n|---|---|\n| Coverage | changed lines >= 70% |\n");
  r.stage();
  assert.match(r.floor().out, /threshold-loosened/);
  r.write("CONSTRAINTS.md", "# Constraints\n\n| Dimension | Rule |\n|---|---|\n| Coverage | changed lines >= 90% |\n");
  r.stage();
  assert.equal(r.floor().code, 0);
}));

test("floor guard: a new line in an existing .constraintsignore is an exception, and loud", scenario((r) => {
  r.append(".constraintsignore", "server/**\n");
  r.stage();
  assert.match(r.floor().out, /new-exception/);
}));

test("floor guard: a Constraint-Exception trailer lets a finding through, printed", scenario((r) => {
  r.append("server/src/rules/thing.test.ts", 'test.skip("later", () => {});\n');
  r.stage();
  const res = r.floor("Park a flaky test\n\nConstraint-Exception: upstream bug #12, back by Friday\n");
  assert.equal(res.code, 0);
  assert.match(res.out, /let through by Constraint-Exception/);
  assert.match(res.out, /upstream bug #12/);
}));

test("floor guard --range: each commit is judged with its own trailers", scenario((r) => {
  r.git("branch", "base");
  r.append("server/src/rules/thing.test.ts", 'test.skip("one", () => {});\n');
  r.stage();
  r.commit("excused\n\nConstraint-Exception: reasons");
  assert.equal(r.floor(undefined, ["--range", "base"]).code, 0);
  r.append("server/src/rules/thing.test.ts", 'test.skip("two", () => {});\n');
  r.stage();
  r.commit("sneaked in with --no-verify");
  const res = r.floor(undefined, ["--range", "base"]);
  assert.equal(res.code, 1);
  assert.match(res.out, /sneaked in/);
}));

// ---- red first -------------------------------------------------------------------------------

test("red first: shipped code changed without any test is refused", scenario((r) => {
  r.write("server/src/rules/thing.ts", "export const answer = () => 43;\n");
  r.stage();
  const res = r.redFirst();
  assert.equal(res.code, 1);
  assert.match(res.out, /no test changed/);
}));

test("red first: Test-Exempt lets a refactor through, with its reason", scenario((r) => {
  r.write("server/src/rules/thing.ts", "export const answer = (): number => 42;\n");
  r.stage();
  const res = r.redFirst("Type the answer\n\nTest-Exempt: types only, behaviour unchanged\n");
  assert.equal(res.code, 0);
  assert.match(res.out, /types only/);
}));

test("red first: new tests arriving with the code they test are refused", scenario((r) => {
  r.write("server/src/rules/thing.ts", "export const answer = () => 42;\nexport const twice = () => 84;\n");
  r.append("server/src/rules/thing.test.ts", 'test("twice the answer", () => {\n  assert.equal(twice(), 84);\n});\n');
  r.stage();
  const res = r.redFirst();
  assert.equal(res.code, 1);
  assert.match(res.out, /twice the answer/);
}));

test("red first: the two-step way passes -- tests listed pending first, then the code", scenario((r) => {
  r.append("server/src/rules/thing.test.ts", 'test("twice the answer", () => {\n  assert.equal(twice(), 84);\n});\n');
  r.write("tests/pending.json", pendingWith("twice the answer"));
  r.stage();
  assert.equal(r.redFirst().code, 0, "step 1: tests only");
  assert.equal(r.floor().code, 0);
  r.commit("tests for twice, pending");
  r.write("server/src/rules/thing.ts", "export const answer = () => 42;\nexport const twice = () => 84;\n");
  r.write("tests/pending.json", pendingWith());
  r.stage();
  assert.equal(r.redFirst().code, 0, "step 2: the code, and the list cleared");
}));

test("red first: changes outside shipped code are not its business", scenario((r) => {
  r.append("README.md", "more\n");
  r.write("tests/lib/extra.mjs", "export {};\n");
  r.stage();
  assert.equal(r.redFirst().code, 0);
}));

test("both guards leave a merge commit to the commits it brings in", scenario((r) => {
  r.git("checkout", "-q", "-b", "side");
  r.append("server/src/rules/thing.test.ts", 'test.skip("excused", () => {});\n');
  r.stage();
  r.commit("excused\n\nConstraint-Exception: reasons");
  r.git("checkout", "-q", "master");
  r.git("merge", "--no-ff", "--no-commit", "side");
  assert.equal(r.floor("Merge side").code, 0);
  assert.equal(r.redFirst("Merge side").code, 0);
}));

test("a commit is judged by the rules its parent had: the one bringing the guards in is not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gocalypse-guards-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, env: withoutGitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    git("init", "-q", "-b", "master");
    git("config", "user.email", "test@example.org");
    git("config", "user.name", "Guard Test");
    fs.mkdirSync(path.join(dir, "web"));
    fs.writeFileSync(path.join(dir, "web", "main.js"), "let x = 1;\n");
    git("add", "-A");
    git("commit", "-q", "-m", "before any gate");
    fs.cpSync(path.join(TESTS, "lib"), path.join(dir, "tests", "lib"), { recursive: true });
    fs.writeFileSync(path.join(dir, "web", "main.js"), "let x = 2; // TODO\n");
    git("add", "-A");
    for (const tool of ["floor-guard", "red-first"]) {
      const r = spawnSync(process.execPath, [path.join(dir, "tests", "lib", `${tool}.mjs`), "--staged"], { cwd: dir, env: withoutGitEnv(), encoding: "utf8" });
      assert.equal(r.status, 0, `${tool}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout, /before this check existed/);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- run from a hook -------------------------------------------------------------------------
//
// The scenarios above, run with a hook's environment (see withoutGitEnv), must
// neither read nor write the repository being committed.

/** A repository with a linked worktree, standing in for the one a hook is called from. */
function hostRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gocalypse-host-"));
  const main = path.join(root, "main"), wt = path.join(root, "wt"), hooks = path.join(root, "hooks");
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: withoutGitEnv(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  fs.mkdirSync(main);
  git(main, "init", "-q", "-b", "master");
  git(main, "config", "user.email", "host@example.org");
  git(main, "config", "user.name", "Host");
  fs.writeFileSync(path.join(main, "host.txt"), "host\n");
  git(main, "add", "-A");
  git(main, "commit", "-q", "--no-verify", "-m", "host");
  git(main, "worktree", "add", "-q", "-b", "side", wt);
  // A -c core.hooksPath on the host's commit reaches its hooks in GIT_CONFIG_PARAMETERS.
  fs.mkdirSync(hooks);
  fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n");
  const sha1 = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");
  return {
    main,
    wt,
    wtGitDir: git(wt, "rev-parse", "--absolute-git-dir").trim(),
    hookEnv: (env) => ({ GIT_PREFIX: "", GIT_AUTHOR_NAME: "Hook Author", GIT_AUTHOR_EMAIL: "hook@example.org", GIT_CONFIG_PARAMETERS: `'core.hooksPath'='${hooks.replace(/\\/g, "/")}'`, ...env }),
    /** What a stray git command would change: the shared config, every ref, the hook's index. */
    state: (index) => ({ config: fs.readFileSync(path.join(main, ".git", "config"), "utf8"), refs: git(main, "for-each-ref", "--format=%(refname) %(objectname)"), index: sha1(index) }),
    done: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/**
 * Runs three of the scenarios above in a child test run, from `cwd`, with a hook's
 * `env`: one per path git takes here -- repo(), a guard seeing what is staged, and
 * the test with its own scratch repo.
 */
function scenariosUnder(env, cwd) {
  const pattern = "^(floor guard: an honest change is clean|floor guard: a skipped or \\.only test|a commit is judged by the rules its parent had)";
  // NODE_TEST_CONTEXT would tell the child it runs inside this test and make it run nothing.
  const { NODE_TEST_CONTEXT, ...plain } = withoutGitEnv();
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", `--test-name-pattern=${pattern}`, fileURLToPath(import.meta.url)], {
    cwd,
    env: { ...plain, ...env },
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("hook in a linked worktree: the guard scenarios pass and leave the host's config, refs and index alone", () => {
  const h = hostRepo();
  try {
    const index = path.join(h.wtGitDir, "index");
    const before = h.state(index);
    const res = scenariosUnder(h.hookEnv({ GIT_DIR: h.wtGitDir, GIT_INDEX_FILE: index }), h.wt);
    assert.deepEqual(h.state(index), before, "the host repository changed");
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /^# pass 3$/m);
  } finally {
    h.done();
  }
});

test("hook on a partial commit: the guard scenarios pass and leave the commit's own index alone", () => {
  const h = hostRepo();
  try {
    const index = path.join(h.main, ".git", "next-index-4242.lock");
    fs.copyFileSync(path.join(h.main, ".git", "index"), index);
    const before = h.state(index);
    const res = scenariosUnder(h.hookEnv({ GIT_INDEX_FILE: index }), h.main);
    assert.deepEqual(h.state(index), before, "the host repository changed");
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /^# pass 3$/m);
  } finally {
    h.done();
  }
});
