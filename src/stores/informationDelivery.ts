import type {
  InformationDeliveryId,
  InformationRequirement,
  InformationTiming,
  InformationValue,
  PlayerId,
  RoleId,
} from "./types";

export const informationDeliveryId = (): InformationDeliveryId =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2, 10)}`;

export type ValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Structural coherence of an Information Action's own Requirement
 * definitions -- not the supplied Information Values. A malformed Role
 * Information definition (duplicate Requirement ids within one Action, an
 * invalid cardinality count) must fail the command safely rather than
 * silently resolving to whichever requirement happened to be found first.
 */
export function validateRequirementsCoherent(requirements: InformationRequirement[]): ValidationResult {
  const seen = new Set<string>();
  for (const requirement of requirements) {
    if (seen.has(requirement.id)) {
      return { ok: false, message: `Malformed Information Action: duplicate requirement id "${requirement.id}".` };
    }
    seen.add(requirement.id);
    const cardinality = requirement.cardinality;
    if (cardinality && cardinality.kind !== "optional"
      && !(Number.isInteger(cardinality.count) && cardinality.count > 0)) {
      return { ok: false, message: `Malformed Information Action: invalid cardinality for requirement "${requirement.id}".` };
    }
  }
  return { ok: true };
}

/**
 * Enforce Information Action timing only where Silverwick already has
 * explicit knowledge (Phase 9D.4 Section 2): firstNight is valid only on
 * Night 1, otherNight only on a later Night. Triggered/manual Actions
 * remain entirely Storyteller-controlled -- no trigger condition is
 * modeled, so they are always accepted here.
 */
export function validateInformationTiming(
  timing: InformationTiming,
  game: { phase: string; day: number }
): ValidationResult {
  if (timing.kind === "firstNight") {
    return game.phase === "night" && game.day === 1
      ? { ok: true }
      : { ok: false, message: "This is a first-night Information Action; it is valid only during Night 1." };
  }
  if (timing.kind === "otherNight") {
    return game.phase === "night" && game.day > 1
      ? { ok: true }
      : { ok: false, message: "This is an other-night Information Action; it is valid only during a later Night." };
  }
  return { ok: true };
}

type ExistenceLookup<T> = { has: (id: T) => boolean };

/** What Player/Role ids Silverwick can confirm actually exist right now.
 * Passed in by the caller (which holds the authoritative game snapshot
 * and Role registry) so this module stays a pure structural validator.
 * A plain Set satisfies this, and so does a thin `{ has }` wrapper around
 * RoleRegistry.get -- the caller is never required to enumerate every
 * Role id up front just to check membership. */
export type ReferenceContext = {
  playerIds?: ExistenceLookup<PlayerId>;
  roleIds?: ExistenceLookup<RoleId>;
};

/**
 * Structural validation only: did the Storyteller supply the type and
 * amount of information this Information Action's Requirements expect,
 * and do any Player/Role references actually resolve? This never judges
 * whether the recorded answer is the mechanically correct BOTC one --
 * that stays Storyteller judgment (Phase 9D.3 Section 9/13; Phase 9D.4
 * Section 10). A structurally valid but mechanically false answer (a
 * poisoned Empath's real number, a Fortune Teller's red herring "no") is
 * exactly what this must accept. Whether the *chosen* Player/Role was the
 * mechanically correct one is likewise never judged here -- only whether
 * it exists.
 */
export function validateInformationValues(
  requirements: InformationRequirement[],
  values: InformationValue[],
  refs: ReferenceContext = {}
): ValidationResult {
  const knownRequirementIds = new Set(requirements.map((r) => r.id));
  const seenRequirementIds = new Set<string>();

  for (const value of values) {
    if (!knownRequirementIds.has(value.requirementId)) {
      return { ok: false, message: `Value supplied for unknown requirement "${value.requirementId}".` };
    }
    // Ambiguous duplicate supplied values for the same Requirement are
    // rejected outright, never silently collapsed to "last one wins".
    if (seenRequirementIds.has(value.requirementId)) {
      return { ok: false, message: `Multiple values supplied for requirement "${value.requirementId}".` };
    }
    seenRequirementIds.add(value.requirementId);

    if (value.kind === "player" && refs.playerIds) {
      for (const playerId of value.playerIds) {
        if (!refs.playerIds.has(playerId)) {
          return { ok: false, message: `"${value.requirementId}" references a Player who does not exist ("${playerId}").` };
        }
      }
    }
    if (value.kind === "role" && refs.roleIds && !refs.roleIds.has(value.roleId)) {
      return { ok: false, message: `"${value.requirementId}" references a Role that does not exist ("${value.roleId}").` };
    }
  }

  const byRequirement = new Map(values.map((v) => [v.requirementId, v]));
  for (const requirement of requirements) {
    const cardinality = requirement.cardinality ?? { kind: "exactly" as const, count: 1 };
    const value = byRequirement.get(requirement.id);

    if (!value) {
      if (cardinality.kind === "optional") continue;
      return { ok: false, message: `Missing required value for "${requirement.id}".` };
    }

    if (value.kind !== requirement.kind) {
      return {
        ok: false,
        message: `"${requirement.id}" expects a ${requirement.kind} value, but received ${value.kind}.`,
      };
    }

    if (value.kind === "player") {
      const count = value.playerIds.length;
      if (cardinality.kind === "exactly" && count !== cardinality.count) {
        return {
          ok: false,
          message: `"${requirement.id}" expects exactly ${cardinality.count} player(s), but received ${count}.`,
        };
      }
      if (cardinality.kind === "atLeast" && count < cardinality.count) {
        return {
          ok: false,
          message: `"${requirement.id}" expects at least ${cardinality.count} player(s), but received ${count}.`,
        };
      }
      if (cardinality.kind === "optional" && count > 1) {
        return { ok: false, message: `"${requirement.id}" expects at most one player.` };
      }
    }
  }

  return { ok: true };
}
