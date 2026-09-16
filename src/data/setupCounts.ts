import { TRAVELERS } from "./travelers";

export type BagCounts = {
  townsfolk: number;
  outsider: number;
  minion: number;
  demon: number;
};

export const SETUP_COUNTS: Record<number, BagCounts> = {
  5:  { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
  6:  { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
  7:  { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
  8:  { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
  9:  { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
  10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
  11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
  12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
  13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
  14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
  15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 },
};

/** Ordinary composition bounds. Travellers never count toward this range,
 * and never consume an ordinary bag slot -- see setupContext's
 * targetNonTravelerCount (Phase 9 Setup finalization B4). */
export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 15;

/** Defensive-only ceiling: a Traveler count can never exceed the number of
 * distinct characters in the supported Traveler catalogue. Never used to
 * derive MAX_TOTAL_PLAYERS -- the catalogue's size must not determine
 * maximum attendance (Phase 9 Setup finalization B4 revision). */
export const MAX_TRAVELERS = TRAVELERS.length;

/** Total planned participants a New Game plan may declare. Fixed at the
 * standard supported game size, independent of the Traveler catalogue.
 * Ordinary players are never derived from this total directly -- see
 * ordinaryFromPlan below. */
export const MAX_TOTAL_PLAYERS = 20;

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

/** The smallest number of Travelers a given total may declare while still
 * keeping ordinary players at or below MAX_PLAYERS. */
export const minTravelersForTotal = (total: number): number => Math.max(0, total - MAX_PLAYERS);

/** The largest number of Travelers a given total may declare while still
 * keeping ordinary players at or above MIN_PLAYERS, and never exceeding the
 * Traveler catalogue. */
export const maxTravelersForTotal = (total: number): number =>
  Math.min(MAX_TRAVELERS, Math.max(0, total - MIN_PLAYERS));

/** Clamps a proposed Traveler count into the valid range for `total`,
 * preferring to keep it as close to the proposed value as possible. Ordinary
 * players = total - the returned Traveler count, always in [MIN_PLAYERS,
 * MAX_PLAYERS]. */
export const clampTravelersForTotal = (total: number, travelers: number): number =>
  clamp(travelers, minTravelersForTotal(total), maxTravelersForTotal(total));

/** Ordinary player count derived from a total/Traveler plan -- never the
 * total participant count itself. See B4 population model: ordinary =
 * total - Travellers, hard-bounded to [MIN_PLAYERS, MAX_PLAYERS]. */
export const ordinaryFromPlan = (total: number, travelers: number): number =>
  total - clampTravelersForTotal(total, travelers);
