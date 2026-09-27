import { test } from "node:test";
import assert from "node:assert/strict";
import { randomGuestName, sanitizeName } from "./usernames";

test("sanitizeName strips control, format and bidi characters", () => {
  assert.equal(sanitizeName("Al​ice"), "Alice"); // zero-width space
});

test("a right-to-left override alone leaves nothing to show", () => {
  // U+202E reverses everything after it on screen (and in log lines); it
  // carries no visible character of its own, so stripping it can leave an
  // empty name, which falls back to a guest name in GoRoom.onJoin.
  assert.equal(sanitizeName("‮"), "");
  assert.equal(sanitizeName("‮Alice"), "Alice");
});

test("collapses whitespace runs and trims the ends", () => {
  assert.equal(sanitizeName("  Alice   Cooper  "), "Alice Cooper");
  assert.equal(sanitizeName("\t\n"), "");
});

test("caps length by code points, not UTF-16 units, so an emoji at the edge survives whole", () => {
  const grin = "\u{1F600}"; // a single code point, but a surrogate pair (2 UTF-16 units)
  const name = "A".repeat(23) + grin; // 24 code points, but 25 UTF-16 units
  // slice(0, 24) on the raw string would cut the surrogate pair in half and
  // leave a lone (unpaired) surrogate, which shows as a broken glyph.
  assert.equal(name.slice(0, 24).length, 24);
  assert.notEqual(name.slice(0, 24), name);
  // sanitizeName counts code points instead, so the emoji comes through whole.
  const cleaned = sanitizeName(name);
  assert.equal(cleaned, name);
  assert.equal([...cleaned].length, 24);
});

test("randomGuestName never needs sanitizing", () => {
  const name = randomGuestName();
  assert.equal(sanitizeName(name), name);
});
