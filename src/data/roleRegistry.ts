import type { Alignment, InformationAction, RoleDef, RoleId, Script } from "@/stores/types";
import { TRAVELERS } from "@/data/travelers";
import { LORICS } from "@/data/lorics";
import { INFORMATION_ACTIONS } from "@/data/informationActions";
import { isCanonicalRole } from "@/data/canonical";

export type RoleRegistry = {
  get: (id: RoleId) => RoleDef | undefined;
  alignmentOf: (id: RoleId) => Alignment;
  /** Phase 9D.3/9D.4: a Role's structured Information Actions, resolved
   * from Role data alone -- never a production-code Role-id branch. A
   * Role's own `informationActions` (set directly on its RoleDef, e.g. by
   * a custom/homebrew script) always takes precedence. The centralized
   * canonical map (src/data/informationActions.ts) is the fallback, but
   * ONLY when this exact Role can be safely identified as the genuine
   * canonical Role of that id via isCanonicalRole() -- Role Ownership
   * Boundary (Phase 9D.4 Section 6). A custom/homebrew Role that merely
   * reuses an official-looking id (e.g. a homebrew "chef" with different
   * ability text) must never silently inherit the real Chef's Information
   * Actions; when ownership can't be established this way, the safe
   * answer is no fallback at all, not a guess. An unknown Role id or a
   * Role with none defined yet both return []. */
  informationActionsOf: (id: RoleId) => InformationAction[];
};

export function deriveAlignment(role: RoleDef): Alignment {
  if (role.alignment) return role.alignment;
  switch (role.type) {
    case "townsfolk":
    case "outsider":
      return "good";
    case "minion":
    case "demon":
      return "evil";
    case "traveler":
    case "fabled":
    case "loric":
      return "good";
  }
}

export function buildRegistry(script: Script): RoleRegistry {
  const map = new Map<RoleId, RoleDef>();
  for (const r of script.characters) map.set(r.id, r);
  if (script.fabled) for (const r of script.fabled) map.set(r.id, r);
  for (const r of TRAVELERS) map.set(r.id, r);
  for (const r of LORICS) map.set(r.id, r);
  return {
    get: (id) => map.get(id),
    alignmentOf: (id) => {
      const r = map.get(id);
      if (!r) {
        throw new Error(`Unknown role id: ${id}`);
      }
      return deriveAlignment(r);
    },
    informationActionsOf: (id) => {
      const role = map.get(id);
      if (!role) return [];
      if (role.informationActions) return role.informationActions;
      const fallback = INFORMATION_ACTIONS[id];
      if (!fallback) return [];
      return isCanonicalRole(role) ? fallback : [];
    },
  };
}
