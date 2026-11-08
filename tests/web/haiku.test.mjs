// The haiku's powers as players read them: web/main.js mirrors server/src/rules/haiku.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { WEB } from "../lib/paths.mjs";

const powersIn = (file) =>
  [...fs.readFileSync(file, "utf8").matchAll(/powers:\s*(\[\s*"[\s\S]*?"\s*,?\s*\])/g)].map((m) => new Function(`return ${m[1]}`)());
const client = () => powersIn(path.join(WEB, "main.js"));
const server = () => powersIn(path.join(WEB, "..", "server", "src", "rules", "haiku.ts"));

test("haiku powers: the page says exactly what the server says", () => {
  assert.equal(server().length, 3);
  assert.deepEqual(client(), server());
});

test("haiku powers: none is explained by an item the player may never have seen", () => {
  for (const power of server().flat()) assert.doesNotMatch(power, /Ferry|Skiff|Seedling/, power);
});

test("haiku powers: a ward and a seed say what they do", () => {
  const [moon, , tree] = server();
  for (const power of moon) assert.match(power, /can't be captured or removed/, power);
  assert.match(tree[0], /trample/);
  for (const power of tree) assert.match(power, /grow/, power);
});

test("haiku powers: 川 at level 3 says it carries any stone of your two colours", () => {
  assert.match(server()[1][2], /any stone of your two colours/);
});
