import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { SETUP_COUNTS, MIN_PLAYERS, MAX_PLAYERS, MAX_TOTAL_PLAYERS, MAX_TRAVELERS } from "@/data/setupCounts";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import type { RoleDef, Script } from "@/stores/types";

/** The three step titles (rail, indicator). */
export const STEP_TITLES = ["Script & Players", "Fabled & Loric", "Players"] as const;
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX"] as const;

/** The design lists the editions TB, BMR, SnV. */
export const SCRIPT_ORDER = ["tb", "bmr", "snv"] as const;
export const builtinScriptCards = (): Script[] => SCRIPT_ORDER.map((id) => BUILTIN_SCRIPTS[id]).filter((s): s is Script => !!s);

export const TEAM_COLOR = {
  townsfolk: "#86b7d4",
  outsider: "#94c29a",
  minion: "#d97a6c",
  demon: "#e3894c",
  fabled: "#e0c070",
  loric: "#7fc4b4",
} as const;

export const DEFAULT_SEATED = 10;
export { MIN_PLAYERS, MAX_PLAYERS, MAX_TOTAL_PLAYERS };

/** The two counters of Step I. "Players" is the TOTAL (seated players plus
 * Travellers); its buttons move the seated count (5 to 15). The Travellers
 * buttons move the Traveller count (from 0). Seated plus Travellers never
 * exceeds 20. */
export const seatedBounds = (travellers: number) => ({ min: MIN_PLAYERS, max: Math.min(MAX_PLAYERS, MAX_TOTAL_PLAYERS - travellers) });
export const travellerBounds = (seated: number) => ({ min: 0, max: Math.min(MAX_TRAVELERS, MAX_TOTAL_PLAYERS - seated) });
const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.max(min, Math.min(max, n));
export const clampSeated = (seated: number, travellers: number): number => clamp(seated, seatedBounds(travellers));
export const clampTravellers = (seated: number, travellers: number): number => clamp(travellers, travellerBounds(seated));
export const totalOf = (seated: number, travellers: number): number => seated + travellers;

/** Composition of the seated (ordinary) players: Townsfolk, Outsiders, Minions, Demon. */
export function compositionFor(seated: number): [number, number, number, number] {
  const row = SETUP_COUNTS[clamp(seated, { min: MIN_PLAYERS, max: MAX_PLAYERS })]!;
  return [row.townsfolk, row.outsider, row.minion, row.demon];
}

const byName = (a: RoleDef, b: RoleDef) => a.name.localeCompare(b.name, "en");
/** The design lists each group alphabetically. */
export const FABLED_CHOICES: RoleDef[] = [...FABLED].sort(byName);
export const LORIC_CHOICES: RoleDef[] = [...LORICS].sort(byName);

export const fabledNote = (total: number): string =>
  total > MAX_PLAYERS ? `Spirit of Ivory is recommended with ${total} players.` : "Help new players, fix awkward counts, or add a twist.";
export const LORIC_NOTE = "Change the rules for everyone at the table.";

/** The count line under a script card. */
export const scriptCardCount = (script: Script): string => `${script.characters.length} characters`;
