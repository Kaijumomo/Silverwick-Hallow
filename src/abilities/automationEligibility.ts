import { isCanonicalRole } from "@/data/canonical";
import { REVIEWED_INTERACTION_ROLES } from "./characters/passiveRules";
import type { AbilityDescriptor, AbilityInputs, InformationConstraint } from "./semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { effectSemanticsOf } from "@/stores/rulesQuery";

export type AutomationEligibility = { kind: "automated" } | { kind: "manual"; reason: string };
export type AutomationContext = {
  query: RulesQuery;
  descriptor: AbilityDescriptor;
  actor: ParticipantBinding;
  roleId: string;
  simulated?: boolean;
  inputs?: AbilityInputs;
};

/** Also used by owners outside the descriptor catalog (currently Voting).
 * Additional roles must be explicitly reviewed by that caller for its scope;
 * this never bypasses canonical ownership or unknown Effect checks. */
export function interactionCoverageEligibility(query: RulesQuery, additionalReviewedRoles: readonly string[] = []): AutomationEligibility {
  for (const represented of Object.values(query.game.players)) {
    if (represented.isEmpty || !represented.participantId) continue;
    const definition = query.roleOf(represented.actualRole);
    if (!definition || !isCanonicalRole(definition) || (!REVIEWED_INTERACTION_ROLES.has(definition.id) && !additionalReviewedRoles.includes(definition.id))) {
      return { kind: "manual", reason: "A character in play has interactions outside verified coverage." };
    }
    if (represented.effects.some(effect => effect.state === "active" && !effectSemanticsOf(effect.type))) return { kind: "manual", reason: "An effect in play has unverified interactions." };
  }
  return { kind: "automated" };
}

/** Pure preflight shared by gameplay and the authoritative coordinator. It
 * grants no command authority and writes nothing. Missing player/Storyteller
 * choices can be collected; a missing rule or judgment makes the ENTIRE action
 * Manual. Supplied legacy judgments cannot turn unknown rules into automation.
 */
export function automationEligibility({ query, descriptor, actor, roleId, simulated = false, inputs = {} }: AutomationContext): AutomationEligibility {
  const manual = (reason: string): AutomationEligibility => ({ kind: "manual", reason });
  const role = query.roleOf(roleId);
  const player = query.participant(actor);
  if (!role || !isCanonicalRole(role) || !descriptor.evaluator || !player) return manual("This action is not fully modeled.");
  const coverage = interactionCoverageEligibility(query);
  if (coverage.kind === "manual") return coverage;
  if (descriptor.hooks.includes("death") && Object.values(query.game.players).filter(p => !p.isEmpty && p.alive && query.roleOf(p.actualRole)?.type === "demon").length > 1) return manual("Death interactions with multiple living Demons are not fully modeled.");
  for (const value of Object.values(inputs)) if (value.kind === "character" && value.roleIds.some(id => !REVIEWED_INTERACTION_ROLES.has(id))) return manual("The chosen character has interactions outside verified coverage.");
  // A self-killing role transition can depend on who registers as an eligible
  // successor. The existing successor evaluator only models actual types;
  // uncertain registration must not silently narrow that candidate set.
  if (descriptor.hooks.includes("death") && descriptor.hooks.includes("role") && Object.values(inputs).some(value => value.kind === "participant" && value.participants.some(target => target.participantId === actor.participantId))) {
    for (const candidate of Object.values(query.game.players)) {
      if (candidate.isEmpty || !candidate.alive || !candidate.participantId || candidate.participantId === actor.participantId) continue;
      const registration = query.registration({ playerId: candidate.id, participantId: candidate.participantId }, roleId).character;
      if (!registration.known) return manual(registration.reason);
    }
  }
  const functions = query.abilityFunctions(actor);
  if (!simulated && !functions.known) return manual(functions.reason);
  const gate = query.modifierGate(roleId, descriptor.hooks);
  if (gate.kind === "gated") return manual("A rule affecting this action is not fully modeled.");
  const constraints: InformationConstraint[] = [];
  if (gate.kind === "constrained") for (const { modifier, result } of gate.results) {
    if (result.kind === "judgment" || result.kind === "unsupported") return manual(result.message);
    if (result.kind === "constrainInformation") constraints.push({ modifierId: modifier.id, requirementId: result.requirementId, allowed: result.allowed, reason: result.reason });
  }
  // Input legality is still enforced by the coordinator. Do not call an
  // evaluator before its declared choices exist in the expected shape.
  for (const requirement of descriptor.inputs) {
    const value = inputs[requirement.id];
    if (!value || value.kind !== requirement.kind) return { kind: "automated" };
    if (value.kind === "participant" && (!Array.isArray(value.participants) ||
      (!value.participants.length && !requirement.allowNone) || value.participants.some(binding => !query.participant(binding)))) return { kind: "automated" };
  }
  const evaluation = descriptor.evaluator({ actor: { binding: actor, player }, roleId, simulated,
    functioning: !simulated && functions.known && functions.value, inputs, judgments: {}, query, constraints });
  if (evaluation.kind === "unsupported") return manual(evaluation.message);
  if (evaluation.kind === "needsInput" && evaluation.requirements.some(requirement => requirement.source === "judgment")) return manual(evaluation.message);
  return { kind: "automated" };
}
