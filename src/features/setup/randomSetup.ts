import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { activeJinxesFor } from "@/data/jinxes";
import { ownedScriptCharacters } from "@/data/roleRegistry";
import type { BagCounts } from "@/data/setupCounts";
import type { RoleDef, RoleId } from "@/stores/types";
import type { FillBagResult } from "./fillRolePool";
import { compositionCandidates, emptyCounts, isBagType, sameCounts } from "./setupPolicies";

export type RandomSetupInput = {
  scriptCharacters: RoleDef[];
  /** Residents only: Travelers retain their separate assignment workflow. */
  targetPlayerCount: number | null;
  fabledIds?: RoleId[];
  loricIds?: RoleId[];
  random?: () => number;
};

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

const manualFailure = (): Extract<FillBagResult, { ok: false }> => ({ ok: false, failure: {
  reason: "uncertain-setup",
  message: "This random selection needs manual setup review. Choose characters manually or try another random setup. Nothing has been distributed.",
} });

/**
 * A complete new resident bag, never an assignment to players. Unlike Fill Bag,
 * this can draw count-changing characters such as Baron. The existing setup
 * policy engine is the sole authority for those effects.
 *
 * Draw evil characters first, since supported deterministic character policies
 * exchange Townsfolk/Outsiders without changing Minion/Demon counts. Validate
 * again after drawing the good characters: custom definitions, jinxes, uncertain
 * setups and additional modifiers must never produce a claimed valid bag.
 */
export function randomSetup(input: RandomSetupInput): FillBagResult {
  const { scriptCharacters, targetPlayerCount, fabledIds = [], loricIds = [], random = Math.random } = input;
  const characters = ownedScriptCharacters({ characters: scriptCharacters }).filter(r => isBagType(r.type));
  const modifiers: RoleDef[] = [];
  for (const id of new Set([...fabledIds, ...loricIds])) {
    const role = FABLED.find(r => r.id === id) ?? LORICS.find(r => r.id === id);
    if (!role) return manualFailure();
    modifiers.push(role);
  }

  function analyze(roles: RoleDef[]): { ok: true; composition: BagCounts } | Extract<FillBagResult, { ok: false }> {
    const hasJinx = activeJinxesFor([...roles, ...modifiers].map(r => r.id)).length > 0;
    const result = compositionCandidates(targetPlayerCount, roles, modifiers, hasJinx);
    if (!result.candidates) {
      if (result.reason === "population") return { ok: false, failure: {
        reason: "unsupported-count",
        message: "Choose between 5 and 15 resident players before generating a random setup. Travelers are counted separately.",
      } };
      return manualFailure();
    }
    if (result.candidates.length !== 1) return { ok: false, failure: {
      reason: "multiple-candidates",
      message: "This selection allows more than one composition. Choose the composition and characters manually before distributing.",
      candidates: result.candidates,
    } };
    return { ok: true, composition: result.candidates[0]! };
  }

  const initial = analyze([]);
  if (!initial.ok) return initial;
  const selected: RoleDef[] = [];
  function draw(type: keyof BagCounts, count: number): Extract<FillBagResult, { ok: false }> | undefined {
    const eligible = characters.filter(r => r.type === type);
    if (eligible.length < count) return { ok: false, failure: {
      reason: "insufficient-roles",
      message: `The script does not have enough ${type} characters for this random selection. Choose characters manually or try another random setup.`,
    } };
    selected.push(...shuffled(eligible, random).slice(0, count));
  }

  for (const type of ["demon", "minion"] as const) {
    const failure = draw(type, initial.composition[type]);
    if (failure) return failure;
  }
  const adjusted = analyze(selected);
  if (!adjusted.ok) return adjusted;
  for (const type of ["townsfolk", "outsider"] as const) {
    const failure = draw(type, adjusted.composition[type]);
    if (failure) return failure;
  }
  const final = analyze(selected);
  if (!final.ok) return final;
  const actual = emptyCounts();
  for (const role of selected) if (isBagType(role.type)) actual[role.type]++;
  if (!sameCounts(actual, final.composition)) return manualFailure();

  const pool = selected.map(r => r.id);
  return { ok: true, pool, generated: [...pool], composition: final.composition };
}
