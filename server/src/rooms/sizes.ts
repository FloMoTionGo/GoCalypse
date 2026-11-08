// The board sizes a table may be asked for (ideas.md §11.10). A leaf of its own, so GoRoom.ts and
// rooms/tables.ts (which GoRoom.ts imports for the lobby islands) can both read it without importing each other.
export const BOARD_SIZES = [9, 13, 19, 25];

/** The smallest table is pure Go: no market, Kata, haiku, river creatures or storm. */
export const isPureGo = (size: number): boolean => size === 9;
