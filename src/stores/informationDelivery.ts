import type { InformationDeliveryId, InformationRequirement, InformationValue } from "./types";

export const informationDeliveryId = (): InformationDeliveryId =>
  globalThis.crypto?.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2, 10)}`;

export type ValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Structural validation only: did the Storyteller supply the type and
 * amount of information this Information Action's Requirements expect?
 * This never judges whether the recorded answer is the mechanically
 * correct BOTC one -- that stays Storyteller judgment (Phase 9D.3
 * Section 9/13). A structurally valid but mechanically false answer
 * (a poisoned Empath's real number, a Fortune Teller's red herring "no")
 * is exactly what this must accept.
 */
export function validateInformationValues(
  requirements: InformationRequirement[],
  values: InformationValue[]
): ValidationResult {
  const byRequirement = new Map(values.map((v) => [v.requirementId, v]));
  const knownRequirementIds = new Set(requirements.map((r) => r.id));

  for (const value of values) {
    if (!knownRequirementIds.has(value.requirementId)) {
      return { ok: false, message: `Value supplied for unknown requirement "${value.requirementId}".` };
    }
  }

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
