import { test } from "node:test";
import assert from "node:assert/strict";

// util/privileges.ts: in its container the server starts as root (the Fly
// volume mounts root-owned), makes DATA_DIR the game user's and becomes that
// user. Loaded at run time, so these show red on their own until the module is in.
function privileges(): any {
  return require("./privileges");
}

/** The system calls as the module sees them: each one only records that it was made. */
function fakeSystem(uid: number | undefined) {
  const calls: string[] = [];
  return {
    calls,
    sys: {
      getuid: uid === undefined ? undefined : () => uid,
      mkdir: (dir: string) => calls.push(`mkdir ${dir}`),
      chown: (dir: string, user: string) => calls.push(`chown ${dir} ${user}`),
      setgid: (user: string) => calls.push(`setgid ${user}`),
      setuid: (user: string) => calls.push(`setuid ${user}`),
    },
  };
}

test("dropping privileges as root makes the data folder the user's, then becomes that user, in that order", () => {
  const { dropPrivileges } = privileges();
  const { calls, sys } = fakeSystem(0);
  assert.equal(dropPrivileges({ user: "node", dataDir: "/data" }, sys), "dropped");
  assert.deepEqual(calls, ["mkdir /data", "chown /data node", "setgid node", "setuid node"]);
});

test("without RUN_AS, or when not root, nothing is touched", () => {
  const { dropPrivileges } = privileges();
  const cases: [string | undefined, number | undefined, string][] = [
    [undefined, 0, "kept"], // no user asked for: stays as started
    ["", 0, "kept"],
    ["node", 1000, "not-root"], // already an ordinary user (a local server)
    ["node", undefined, "not-root"], // no getuid at all (Windows)
  ];
  for (const [user, uid, expected] of cases) {
    const { calls, sys } = fakeSystem(uid);
    assert.equal(dropPrivileges({ user, dataDir: "/data" }, sys), expected, `user ${JSON.stringify(user)}, uid ${uid}`);
    assert.deepEqual(calls, [], `user ${JSON.stringify(user)}, uid ${uid}`);
  }
});
