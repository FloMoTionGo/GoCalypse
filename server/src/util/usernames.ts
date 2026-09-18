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
