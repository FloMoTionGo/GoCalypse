// The Server field and the seat secret (tasks/security_fixes T4): the key a tab
// holds is kept per server host, a link naming another server shows that host
// on the home screen, and a typed endpoint comes back after a refresh with the
// same key. Its own rig: one test points the page at a host that does not
// exist, and the failed request it logs must not reach the other files' pages.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { guiRig } from "./page.mjs";

let rig, b;
before(async () => {
  rig = await guiRig();
  b = rig.browser;
  await open(rig.url({ name: "Keyed" }));
});
after(async () => rig?.close());

/** Loads the page afresh: a URL that differs from the current one only in its hash would not reload it. */
async function open(url) {
  await b.load("about:blank");
  await b.load(url);
  await b.waitFor("joinButton.disabled === false", 20000, "the page-load rejoin to answer (or give up)");
}
/** Types an endpoint into the Server field as a person would, and lets the page hear it. */
const typeServer = (value) =>
  b.ev(`(() => { serverInput.value = ${JSON.stringify(value)}; serverInput.dispatchEvent(new Event("change", { bubbles: true })); return serverInput.value; })()`);
const footerServer = () => b.ev("document.querySelector('#server-menu summary').textContent");

test("server: the seat secret is kept per server host, so another host gets another key", async () => {
  const here = await b.ev("playerKey()");
  assert.ok(here.length >= 32, `a key: ${here}`);
  const names = await b.ev("Object.keys(sessionStorage).filter((k) => k.startsWith('gocalypse.playerKey.'))");
  assert.ok(names.some((n) => n.includes("127.0.0.1")), `the key's name carries the host: ${names.join(", ")}`);
  await typeServer("wss://example.test");
  const there = await b.ev("playerKey()");
  assert.notEqual(there, here, "another host, another key");
  await typeServer(rig.server.ws);
  assert.equal(await b.ev("playerKey()"), here, "back on the first host, the first key");
});

test("server: a link naming another server shows that server's host on the home screen", async () => {
  await open(rig.url({ server: "wss://example.test", name: "Linked" }));
  assert.match(await footerServer(), /example\.test/, "the footer names the host");
  assert.equal(await b.ev("serverInput.value"), "wss://example.test");
});

test("server: a typed endpoint survives a refresh, with the same key", async () => {
  await open(rig.url());
  const typed = rig.server.ws.replace("127.0.0.1", "localhost"); // the same server under another name
  await typeServer(typed);
  const key = await b.ev("playerKey()");
  await open(`${rig.web.url}/index.html`); // no link parameters: the field must remember on its own
  assert.equal(await b.ev("serverInput.value"), typed, "the field comes back as typed");
  assert.equal(await b.ev("playerKey()"), key, "and with that host's key");
  assert.match(await footerServer(), /localhost/, "the footer says which server");
});
