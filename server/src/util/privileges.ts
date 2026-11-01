import { execFileSync } from "child_process";
import fs from "fs";

/**
 * The container starts the server as root: the Fly volume at DATA_DIR mounts
 * root-owned, so nobody else could write to it. With RUN_AS set (the
 * Dockerfile sets it to `node`) the server makes that folder the user's and
 * then becomes that user, before it opens a port or a file. Without RUN_AS, or
 * when it isn't root (a local server, the tests), nothing happens.
 */
export interface System {
  getuid?: () => number;
  mkdir(dir: string): void;
  chown(dir: string, user: string): void; // the folder and everything in it
  setgid(user: string): void;
  setuid(user: string): void;
}

export type Outcome = "kept" | "not-root" | "dropped";

export function dropPrivileges(opts: { user: string | undefined; dataDir: string }, sys: System): Outcome {
  if (!opts.user) return "kept";
  if (!sys.getuid || sys.getuid() !== 0) return "not-root";
  sys.mkdir(opts.dataDir);
  sys.chown(opts.dataDir, opts.user);
  sys.setgid(opts.user); // the group first: once the user is dropped, the group can't be changed
  sys.setuid(opts.user);
  return "dropped";
}

/** The real calls. POSIX only: on Windows there is no getuid, and nothing runs. */
export const system: System = {
  getuid: process.getuid ? () => process.getuid!() : undefined,
  mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  chown: (dir, user) => execFileSync("chown", ["-R", `${user}:${user}`, dir]),
  setgid: (user) => process.setgid!(user),
  setuid: (user) => process.setuid!(user),
};
