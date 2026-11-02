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

// The page says it is dark (REVIEW.md D1), so dialogs scroll with a dark
// scrollbar and the browser chrome matches the ink.
test("index.html names its theme colour, and style.css declares a dark colour scheme", () => {
  assert.match(html(), /<meta name="theme-color" content="#1f1a24"/);
  const css = fs.readFileSync(path.join(WEB, "style.css"), "utf8");
  const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
  assert.match(root, /color-scheme:\s*dark/, "color-scheme: dark on :root");
});

test("index.html makes the notice under the hand a live region, so a refusal is read out", () => {
  assert.match(html(), /<p id="notice"[^>]*role="status"/);
});

// Review U2: the welcome used to be a 550-word rules essay. The essentials
// (capture, left vs right click, four passes end it) stay in view; scoring and
// the two-fronts detail sit folded under their own summaries.
test("index.html keeps the welcome's essentials under 110 static words and folds scoring under its own summary", () => {
  const h = html();
  const start = h.indexOf('<dialog id="welcome"');
  const dialog = h.slice(start, h.indexOf("</dialog>", start));
  const inView = dialog.replace(/<details[\s\S]*?<\/details>/g, "").replace(/<section[\s\S]*?<\/section>/g, "");
  const words = inView.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").split(/\s+/).filter(Boolean);
  assert.ok(words.length < 110, `${words.length} static words before the folds: ${words.join(" ")}`);
  assert.match(inView, /all four players pass/i, "the essentials still say how the game ends");
  const fold = dialog.match(/<details[^>]*id="welcome-scoring-fold"[^>]*>([\s\S]*?)<\/details>/);
  assert.ok(fold, "a details#welcome-scoring-fold");
  assert.match(fold[1], /<summary>[^<]*scoring/i, "its summary names scoring");
  assert.match(fold[1], /id="welcome-scoring"/, "the scoring paragraph is inside it");
});

// Review U4: the error sentences live in web/errorCopy.js, which main.js and
// replayView.js both use, so it loads before them.
test("index.html loads errorCopy.js from the site before main.js and replayView.js", () => {
  const h = html();
  const at = (src) => h.indexOf(`<script src="${src}"></script>`);
  assert.ok(at("errorCopy.js") >= 0, "a script tag for errorCopy.js");
  assert.ok(at("errorCopy.js") < at("main.js"), "before main.js");
  assert.ok(at("errorCopy.js") < at("replayView.js"), "before replayView.js");
});
