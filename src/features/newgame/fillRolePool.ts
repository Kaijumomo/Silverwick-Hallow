import { isCanonicalRole } from "@/data/canonical";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { activeJinxesFor } from "@/data/jinxes";
import {
  compositionCandidates, hasCountPolicy, hasUncertainComposition, isBagType, sameCounts,
} from "@/features/setup/setupPolicies";
import type { BagCounts } from "@/data/setupCounts";
import type { RoleDef, RoleId } from "@/stores/types";

const BAG_TYPES = ["townsfolk", "outsider", "minion", "demon"] as const;

const UNSUPPORTED_MESSAGE =
  "Silverwick can't safely complete this bag automatically. Finish the bag manually.";

export type FillBagFailure =
  | { reason: "unsupported-count" | "uncertain-setup" | "insufficient-roles"; message: string }
  | { reason: "overfilled"; message: string; excess: Partial<BagCounts> }
  | { reason: "multiple-candidates"; message: string; candidates: BagCounts[] };

export type FillBagResult =
  | { ok: true; pool: RoleId[]; generated: RoleId[]; composition: BagCounts }
  | { ok: false; failure: FillBagFailure };

export type FillRolePoolInput = {
  /** Storyteller-selected roles already in the bag. Always preserved. */
  pinnedIds: RoleId[];
  targetPlayerCount: number | null;
  /** The active script's ordinary (Townsfolk/Outsider/Minion/Demon) characters. */
  scriptCharacters: RoleDef[];
  fabledIds?: RoleId[];
  loricIds?: RoleId[];
  /** Required when composition analysis returns more than one valid candidate. */
  chosenComposition?: BagCounts;
  /** Injectable for deterministic tests; defaults to Math.random. */
  random?: () => number;
};

/** Fisher-Yates pick, independent of the player-deal shuffle in storytellerStore. */
function shuffledPick<T>(items: readonly T[], count: number, random: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, count);
}

/**
 * Completes a Storyteller's role bag around whatever they already picked.
 * Pure: never touches Zustand game state or assigns roles to players. Stage 1
 * (which characters are in the game) only — Stage 2 (which player gets which
 * character) remains dealRolePool()'s job alone.
 *
 * Reuses the existing setup analyzer's composition-candidate engine so this
 * stays the one source of truth for count-changing characters (Baron, Fang
 * Gu, Godfather, ...) and uncertain/interacting setups — it never guesses
 * when the analyzer itself would refuse to.
 */
export function fillRolePool(input: FillRolePoolInput): FillBagResult {
  const {
    pinnedIds, targetPlayerCount, scriptCharacters,
    fabledIds = [], loricIds = [], chosenComposition, random = Math.random,
  } = input;

  const roleById = new Map(scriptCharacters.map(r => [r.id, r]));
  const pinnedRoles: RoleDef[] = [];
  for (const id of pinnedIds) {
    const role = roleById.get(id);
    if (!role || !isBagType(role.type))
      return { ok: false, failure: { reason: "uncertain-setup", message: UNSUPPORTED_MESSAGE } };
    pinnedRoles.push(role);
  }

  const modifierDefs: RoleDef[] = [];
  let unknownModifier = false;
  for (const id of new Set([...fabledIds, ...loricIds])) {
    const def = FABLED.find(r => r.id === id) ?? LORICS.find(r => r.id === id);
    if (!def) { unknownModifier = true; continue; }
    modifierDefs.push(def);
  }
  if (unknownModifier)
    return { ok: false, failure: { reason: "uncertain-setup", message: UNSUPPORTED_MESSAGE } };

  const trustedIds = pinnedRoles.filter(isCanonicalRole).map(r => r.id);
  const hasJinx = activeJinxesFor([...trustedIds, ...modifierDefs.map(r => r.id)]).length > 0;

  const result = compositionCandidates(targetPlayerCount, pinnedRoles, modifierDefs, hasJinx);
  if (!result.candidates) {
    if (result.reason === "population") return { ok: false, failure: {
      reason: "unsupported-count",
      message: "Choose a supported player count before filling the bag automatically.",
    } };
    return { ok: false, failure: { reason: "uncertain-setup", message: UNSUPPORTED_MESSAGE } };
  }

  const pinnedCounts: BagCounts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
  for (const r of pinnedRoles) pinnedCounts[r.type as keyof BagCounts]++;

  const feasible = result.candidates.filter(c => BAG_TYPES.every(t => pinnedCounts[t] <= c[t]));

  if (feasible.length === 0) {
    const nearest = result.candidates[0]!;
    const excess: Partial<BagCounts> = {};
    for (const t of BAG_TYPES) if (pinnedCounts[t] > nearest[t]) excess[t] = pinnedCounts[t] - nearest[t];
    return { ok: false, failure: {
      reason: "overfilled",
      message: "The manually selected roles already exceed every supported composition. Adjust the bag manually.",
      excess,
    } };
  }

  let target: BagCounts;
  if (feasible.length === 1) {
    target = feasible[0]!;
  } else {
    const chosen = chosenComposition && feasible.find(c => sameCounts(c, chosenComposition));
    if (!chosen) return { ok: false, failure: {
      reason: "multiple-candidates",
      message: "Multiple valid compositions are available. Choose one to fill the bag.",
      candidates: feasible,
    } };
    target = chosen;
  }

  const generated: RoleId[] = [];
  for (const type of BAG_TYPES) {
    const remaining = target[type] - pinnedCounts[type];
    if (remaining <= 0) continue;
    // Never introduce a character the Storyteller didn't choose that would itself
    // change the expected composition (count-policy roles) or whose setup this
    // analyzer can't confidently reason about (uncertain-composition roles).
    const eligible = scriptCharacters.filter(r =>
      r.type === type && !pinnedIds.includes(r.id) &&
      !hasCountPolicy(r.id) && !hasUncertainComposition(r.id));
    if (eligible.length < remaining) return { ok: false, failure: {
      reason: "insufficient-roles",
      message: `The script doesn't have enough ${type} characters to complete this bag automatically.`,
    } };
    generated.push(...shuffledPick(eligible, remaining, random).map(r => r.id));
  }

  return { ok: true, pool: [...pinnedIds, ...generated], generated, composition: target };
}
