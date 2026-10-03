// Where things are, for every test tier. Tests run from any working directory.
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WEB = path.join(ROOT, "web");
export const SERVER = path.join(ROOT, "server");
export const SERVER_BUILD = path.join(SERVER, "build");
export const TESTS = path.join(ROOT, "tests");

const require = createRequire(import.meta.url);

/** web/sprites.js and web/pixelScene.js load as CommonJS in Node (see their headers). */
export function loadWeb() {
  return { G: require(path.join(WEB, "sprites.js")), P: require(path.join(WEB, "pixelScene.js")) };
}

/** A module of the compiled server (tests/run.mjs builds it first: `npx tsc` in server/). */
export function serverModule(rel) {
  const file = path.join(SERVER_BUILD, rel);
  if (!fs.existsSync(file)) throw new Error(`${file} is missing: build the server first (node tests/run.mjs builds it)`);
  return require(file);
}
