// web/index.html as shipped (security-and-hardening, tasks/security_fixes T3):
// every script comes from the site itself, the vendored colyseus.js is the
// version tests/package.json pins, and a Content Security Policy allows no
// inline script.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { TESTS, WEB } from "../lib/paths.mjs";

const html = () => fs.readFileSync(path.join(WEB, "index.html"), "utf8");

test("index.html loads every script from the site itself, none from another origin", () => {
  const srcs = [...html().matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 5, `scripts: ${srcs.join(", ")}`);
  for (const src of srcs) assert.doesNotMatch(src, /^(https?:)?\/\//, `${src} is loaded from elsewhere`);
  assert.ok(srcs.some((s) => /colyseus\.js$/.test(s)), "colyseus.js is among them");
});

test("the vendored colyseus.js is the version tests/package.json pins", () => {
  const pinned = JSON.parse(fs.readFileSync(path.join(TESTS, "package.json"), "utf8")).devDependencies["colyseus.js"];
  const require = createRequire(path.join(TESTS, "package.json"));
  const dist = fs.readFileSync(path.join(path.dirname(require.resolve("colyseus.js/package.json")), "dist", "colyseus.js"));
  const vendored = fs.readFileSync(path.join(WEB, "vendor", "colyseus.js"));
  assert.ok(dist.equals(vendored), `web/vendor/colyseus.js is, byte for byte, colyseus.js ${pinned}'s dist/colyseus.js`);
});

test("index.html declares a Content Security Policy that allows no inline script", () => {
  const page = html();
  const m = page.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i); // the policy itself holds single quotes
  assert.ok(m, "a Content-Security-Policy meta tag");
  const directives = Object.fromEntries(
    m[1].split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [name, ...values] = d.split(/\s+/); return [name, values]; })
  );
  assert.deepEqual(directives["default-src"], ["'self'"]);
  assert.deepEqual(directives["script-src"], ["'self'"]);
  assert.ok(directives["img-src"]?.includes("data:"), "sprites become data: URLs");
  assert.ok(directives["connect-src"], "the Server field may point at any server");
  assert.doesNotMatch(m[1], /unsafe-inline|unsafe-eval/);
  assert.ok(page.indexOf("Content-Security-Policy") < page.indexOf("<script"), "the policy comes before the first script, or it would not cover it");
});
