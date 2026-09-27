const ADJECTIVES = [
  "Swift", "Silent", "Crimson", "Lucky", "Bold", "Hidden", "Fierce",
  "Clever", "Golden", "Shadow", "Iron", "Rapid", "Quiet", "Wild",
];

const NOUNS = [
  "Otter", "Falcon", "Panther", "Badger", "Heron", "Wolf", "Raven",
  "Tiger", "Fox", "Hawk", "Lynx", "Crane", "Viper", "Bear",
];

export function randomGuestName(): string {
  const adjective = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = Math.floor(100 + Math.random() * 900);
  return `${adjective}${noun}${suffix}`;
}

// Unicode "other" categories: control, format (incl. zero-width space and the
// bidi overrides), surrogate, private-use and unassigned. None of these has
// any business in a display name.
const INVISIBLE_CHARS = /\p{C}/gu;

/**
 * A name safe to show: no control/format/bidi characters, no run of
 * whitespace wider than one space, and no more than 24 *code points* (so an
 * emoji at the boundary is dropped whole, not split). Trims first so an
 * all-invisible or all-whitespace name comes back empty and falls back to a
 * guest name.
 */
export function sanitizeName(raw: string): string {
  const visible = raw.replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").trim();
  return [...visible].slice(0, 24).join("");
}
