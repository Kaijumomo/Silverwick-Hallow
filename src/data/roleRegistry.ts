import type { Alignment, InformationAction, RoleDef, RoleId, Script } from "@/stores/types";
import { TRAVELERS } from "@/data/travelers";
import { LORICS } from "@/data/lorics";
import { INFORMATION_ACTIONS } from "@/data/informationActions";

export type RoleRegistry = {
  get: (id: RoleId) => RoleDef | undefined;
  alignmentOf: (id: RoleId) => Alignment;
  /** Phase 9D.3: a Role's structured Information Actions, resolved from
   * Role data alone -- never a production-code Role-id branch. A Role's
   * own `informationActions` (set directly on its RoleDef, e.g. by a
   * custom/homebrew script) takes precedence; the centralized canonical
   * map is the fallback for Roles that don't define their own. An unknown
   * Role id or a Role with none defined yet both return []. */
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
    informationActionsOf: (id) => map.get(id)?.informationActions ?? INFORMATION_ACTIONS[id] ?? [],
  };
}
