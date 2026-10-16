import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { SETUP_COUNTS, MIN_PLAYERS, MAX_PLAYERS, MAX_TOTAL_PLAYERS, clampTravelersForTotal, minTravelersForTotal, maxTravelersForTotal } from "@/data/setupCounts";
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

export const DEFAULT_TOTAL = 10;
export { MIN_PLAYERS, MAX_PLAYERS, MAX_TOTAL_PLAYERS };

/** The two counters of Step I. Travellers are separate from the total and the
 * total is never below 5 ordinary players or above 15 ordinary plus Travellers
 * (the app's existing population contract), so both clamp each other. */
export const clampTotal = (total: number): number => Math.max(MIN_PLAYERS, Math.min(MAX_TOTAL_PLAYERS, total));
export const travellerBounds = (total: number) => ({ min: minTravelersForTotal(total), max: maxTravelersForTotal(total) });
export const clampTravellers = clampTravelersForTotal;

/** Composition of the ordinary players: Townsfolk, Outsiders, Minions, Demon. */
export function compositionFor(total: number, travellers: number): [number, number, number, number] {
  const ordinary = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, total - clampTravellers(total, travellers)));
  const row = SETUP_COUNTS[ordinary]!;
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
