import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { SETUP_COUNTS, MIN_PLAYERS, MAX_PLAYERS, MAX_TOTAL_PLAYERS, MAX_TRAVELERS } from "@/data/setupCounts";
import type { RoleDef } from "@/stores/types";

/** The design lists the editions TB, BMR, SnV. */
export const SCRIPT_ORDER = ["tb", "bmr", "snv"] as const;

export const TEAM_COLOR = {
  townsfolk: "#86b7d4",
  outsider: "#94c29a",
  minion: "#d97a6c",
  demon: "#e3894c",
  fabled: "#e0c070",
  loric: "#7fc4b4",
} as const;
export { MIN_PLAYERS, MAX_PLAYERS, MAX_TOTAL_PLAYERS };

/** The two counters of Step I. "Players" is the TOTAL (seated players plus
 * Travellers); its buttons move the seated count (5 to 15). The Travellers
 * buttons move the Traveller count (from 0). Seated plus Travellers never
 * exceeds 20. */
export const seatedBounds = (travellers: number) => ({ min: MIN_PLAYERS, max: Math.min(MAX_PLAYERS, MAX_TOTAL_PLAYERS - travellers) });
export const travellerBounds = (seated: number) => ({ min: 0, max: Math.min(MAX_TRAVELERS, MAX_TOTAL_PLAYERS - seated) });
const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.max(min, Math.min(max, n));

/** Composition of the seated (ordinary) players: Townsfolk, Outsiders, Minions, Demon. */
export function compositionFor(seated: number): [number, number, number, number] {
  const row = SETUP_COUNTS[clamp(seated, { min: MIN_PLAYERS, max: MAX_PLAYERS })]!;
  return [row.townsfolk, row.outsider, row.minion, row.demon];
}

const byName = (a: RoleDef, b: RoleDef) => a.name.localeCompare(b.name, "en");
/** The design lists each group alphabetically. */
export const FABLED_CHOICES: RoleDef[] = [...FABLED].sort(byName);
export const LORIC_CHOICES: RoleDef[] = [...LORICS].sort(byName);
