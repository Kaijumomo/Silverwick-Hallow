import type { Alignment, InformationAction, RoleDef, RoleId, RoleType, Script } from "@/stores/types";
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

/** Phase 10D: the only types an ORDINARY participant's Actual or Shown Role may
 * have -- shared by the Role boundary (classifyRole) and the registry below. */
export const ORDINARY_ROLE_TYPES: readonly RoleType[] = ["townsfolk", "outsider", "minion", "demon"];
export const isOrdinaryRoleType = (type: unknown): boolean =>
  typeof type === "string" && (ORDINARY_ROLE_TYPES as readonly string[]).includes(type);

/**
 * SOL-10D-C03: RoleId is the character identity key. A script's characters,
 * ONE per RoleId: the FIRST definition of an id owns it. New imports reject
 * duplicate ids (parseClocktowerScript); an already-stored legacy script may
 * still carry later duplicates, which no Role consumer ever resolves --
 * classification (classifyRole's first match), pickers, this registry (and so
 * projection and private information), display and Setup all read a script's
 * characters through this one owner rule.
 */
export function ownedScriptCharacters(script: Pick<Script, "characters"> | null | undefined): RoleDef[] {
  const seen = new Set<RoleId>();
  const owned: RoleDef[] = [];
  for (const role of script?.characters ?? []) {
    if (seen.has(role.id)) continue;
    seen.add(role.id);
    owned.push(role);
  }
  return owned;
}

export function buildRegistry(script: Script): RoleRegistry {
  const map = new Map<RoleId, RoleDef>();
  for (const r of ownedScriptCharacters(script)) map.set(r.id, r);
  // Phase 10D (ASTRA-10D-004): an ordinary-typed character of THIS script
  // owns its id -- it is the very definition the Role boundary admits
  // (classifyRole) and the pickers offer, so projection and private
  // information resolve that same Role. A Fabled or Loric that merely reuses
  // the id never silently replaces it (the Role Ownership Boundary: an id match
  // alone never transfers another definition). Only the canonical Traveler
  // catalogue keeps its (frozen) precedence, exactly as in classifyRole.
  const ownedOrdinary = (id: RoleId) => isOrdinaryRoleType(map.get(id)?.type);
  if (script.fabled) for (const r of script.fabled) if (!ownedOrdinary(r.id)) map.set(r.id, r);
  for (const r of TRAVELERS) map.set(r.id, r);
  for (const r of LORICS) if (!ownedOrdinary(r.id)) map.set(r.id, r);
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
