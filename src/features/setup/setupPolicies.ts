import { isCanonicalRole, CANONICAL_REVISION } from "@/data/canonical";
import { SETUP_COUNTS, type BagCounts } from "@/data/setupCounts";
import type { RoleDef } from "@/stores/types";

export const SETUP_POLICY_REVISION = CANONICAL_REVISION;
export const BAG_TYPES = ["townsfolk", "outsider", "minion", "demon"] as const;
export const isBagType = (type: string): type is keyof BagCounts =>
  BAG_TYPES.some(t => t === type);
export const emptyCounts = (): BagCounts => ({ townsfolk: 0, outsider: 0, minion: 0, demon: 0 });
export const sameCounts = (a: BagCounts, b: BagCounts) => BAG_TYPES.every(t => a[t] === b[t]);
export const formatCounts = (c: BagCounts) => `${c.townsfolk}T / ${c.outsider}O / ${c.minion}M / ${c.demon}D`;

/**
 * Reviewed single-effect policies for the pinned publisher definitions.
 * No English parsing and no general modifier composition. Godfather choices
 * exchange T/O together; unavailable removal has the zero floor.
 */
const outsiderChoices: Record<string, readonly number[]> = {
  baron: [2], fanggu: [1], vigormortis: [-1], godfather: [-1, 1],
  balloonist: [0, 1], sentinel: [-1, 0, 1],
};
export const hasCountPolicy = (id: string) => Object.hasOwn(outsiderChoices, id);
// These require a different composition model or an untracked ability choice.
const uncertainComposition = new Set([
  "atheist", "legion", "lilmonsta", "summoner", "kazali", "lordoftyphon",
  "huntsman", "hermit", "xaan", "alchemist", "boffin", "amnesiac", "bootlegger",
]);
export function compositionCandidates(target: number | null, roles: RoleDef[], modifiers: RoleDef[], hasJinx: boolean) {
  const all = [...roles, ...modifiers];
  const effects = all.filter(r => isCanonicalRole(r) && hasCountPolicy(r.id));
  const limited = roles.some(r => !isCanonicalRole(r)) ||
    all.some(r => isCanonicalRole(r) && uncertainComposition.has(r.id)) || hasJinx;
  if (effects.length > 1) return { candidates: null, reason: "interaction" as const };
  if (limited) return { candidates: null, reason: "manual" as const };
  const base = target === null ? undefined : SETUP_COUNTS[target];
  if (!base) return { candidates: null, reason: "population" as const };
  const choices = effects[0] ? outsiderChoices[effects[0].id]! : [0];
  const candidates: BagCounts[] = [];
  for (const requested of choices) {
    const delta = Math.max(-base.outsider, requested);
    const candidate = { ...base, outsider: base.outsider + delta, townsfolk: base.townsfolk - delta };
    if (candidate.townsfolk >= 0 && !candidates.some(c => sameCounts(c, candidate))) candidates.push(candidate);
  }
  return { candidates, reason: undefined };
}
