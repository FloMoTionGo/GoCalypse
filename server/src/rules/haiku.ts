// Haiku points (ideas.md §11.11). The lines of three short Go haiku lie on the
// board's least played points, one line to a point. A stone that lands on one,
// by any means, collects that line for its player for good; the haiku's card
// comes to the hand, and each further line of the same haiku levels its power
// up: one line level 1, two lines level 2, the whole haiku level 3. The card is
// played once, at the level it has reached.
//
// The decisions live here, away from room state: the haiku, how many go on a
// board, and where (pickHaikuPoints). Which points are played least comes from
// the saved games (history/heatmap.ts), or, while there are too few of them,
// from priorHeat. rooms/GoRoom.ts collects the lines and plays the cards.

export type HaikuId = "moon" | "river" | "tree";

export interface Haiku {
  id: HaikuId;
  kanji: string;
  name: string;
  lines: [string, string, string];
  /** What the card does at level 1, 2 and 3 (GoRoom haikuPower plays them). */
  powers: [string, string, string];
}

// The texts are our own (D-Q10, chosen 2026-10-24); each power reuses an item's rules.
export const HAIKU: Haiku[] = [
  {
    id: "moon",
    kanji: "月",
    name: "Moon",
    lines: ["Autumn moon rises", "over the stones on the pier", "none of them shall fall"],
    powers: [
      "Ward one of your stones until your next turn.",
      "Ward one of your groups until your next turn, as a Lantern Ward does.",
      "Ward one of your groups for 2 rounds.",
    ],
  },
  {
    id: "river",
    kanji: "川",
    name: "River",
    lines: ["The river carries", "one stone to a quiet shore", "the ferry comes home"],
    powers: [
      "Move one of your stones one step, as a Ferry does.",
      "Glide one of your stones along its row or column, as a Skiff does.",
      "Glide one of your stones as a Skiff does, and keep your turn.",
    ],
  },
  {
    id: "tree",
    kanji: "木",
    name: "Tree",
    lines: ["Small sprout by the edge", "the stones have left it alone", "one day it stands tall"],
    powers: [
      "Plant a seed, as a Seedling does.",
      "Plant a seed that is already sprouting: only you may play there.",
      "Plant two seeds, both already sprouting.",
    ],
  },
];

export const HAIKU_CARD_PREFIX = "haiku_";
/** What a line pays once its haiku's card has been played: no second card, fireflies instead. */
export const HAIKU_LATE_FIREFLIES = 10;
/** How far apart two haiku points must be, in either direction (the larger of the two distances). */
export const HAIKU_SPACING = 3;

export function haikuCardId(id: HaikuId): string {
  return HAIKU_CARD_PREFIX + id;
}

export function isHaikuCard(card: string): boolean {
  return card.startsWith(HAIKU_CARD_PREFIX) && HAIKU.some((h) => HAIKU_CARD_PREFIX + h.id === card);
}

export function haikuOfCard(card: string): Haiku | undefined {
  return HAIKU.find((h) => HAIKU_CARD_PREFIX + h.id === card);
}

/**
 * How many haiku go on a board: 3 on 13x13, 4 on 19x19, 6 on 25x25 -- as many
 * of those as there are haiku written. Three for now, on every board.
 */
export function haikuCount(size: number): number {
  const wanted = size >= 25 ? 6 : size >= 19 ? 4 : 3;
  return Math.min(wanted, HAIKU.length);
}

/**
 * How much each point gets played before any game is saved: the nearer a star
 * point or the centre, the more. A higher number is a more popular point.
 */
export function priorHeat(size: number): number[] {
  const edge = size >= 13 ? 3 : 2, mid = (size - 1) / 2, far = size - 1 - edge;
  const hubs = [edge, mid, far].flatMap((x) => [edge, mid, far].map((y) => ({ x, y })));
  const heat: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.min(...hubs.map((h) => Math.max(Math.abs(h.x - x), Math.abs(h.y - y))));
      heat.push(size - d);
    }
  }
  return heat;
}

export interface HaikuSpot {
  haiku: HaikuId;
  line: number; // 1, 2 or 3
  x: number;
  y: number;
}

/**
 * Where tonight's haiku lie, from `heat` (how much each point gets played): on
 * the least played quarter of the points off the first line (the river
 * creatures would eat a stone on it), at least HAIKU_SPACING apart, and each
 * haiku's three lines in three different quadrants, so finishing one takes a
 * plan. The same `random` gives the same points. Should the quarter be too
 * crowded, the next quarter joins in.
 */
export function pickHaikuPoints(heat: number[], size: number, random: () => number, count = haikuCount(size)): HaikuSpot[] {
  const inner: { x: number; y: number; heat: number }[] = [];
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) inner.push({ x, y, heat: heat[y * size + x] ?? 0 });
  // Least played first; ties in a fixed order, so only `random` decides between them.
  inner.sort((a, b) => a.heat - b.heat || a.y - b.y || a.x - b.x);
  const quadrant = (p: { x: number; y: number }) => (p.x < size / 2 ? 0 : 1) + (p.y < size / 2 ? 0 : 2);
  const haiku = HAIKU.slice(0, count);

  for (let share = 1; share <= 4; share++) {
    const pool = inner.slice(0, Math.max(1, Math.ceil((inner.length * share) / 4)));
    for (let attempt = 0; attempt < 400; attempt++) {
      const spots: HaikuSpot[] = [];
      let ok = true;
      for (const h of haiku) {
        const quadrants = [0, 1, 2, 3];
        for (let i = 3; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [quadrants[i], quadrants[j]] = [quadrants[j], quadrants[i]];
        }
        for (let line = 1; line <= 3 && ok; line++) {
          const q = quadrants[line - 1];
          const free = pool.filter(
            (p) => quadrant(p) === q && spots.every((s) => Math.max(Math.abs(s.x - p.x), Math.abs(s.y - p.y)) >= HAIKU_SPACING)
          );
          if (free.length === 0) ok = false;
          else {
            const p = free[Math.floor(random() * free.length)];
            spots.push({ haiku: h.id, line, x: p.x, y: p.y });
          }
        }
        if (!ok) break;
      }
      if (ok) return spots;
    }
  }
  return [];
}
