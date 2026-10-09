import { resolveAbilitySemantics } from "@/abilities/semantics";
import { composeAbilityOutcome, type AbilityEnvironment, type AbilityPlanResult, type AbilityResolutionRequest } from "@/stores/abilityResolution";
import { createRulesQuery } from "@/stores/rulesQuery";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { proofEnv } from "./proofFixtures";

/** Unit fixture for retained evaluator/query contracts only. Deliberately
 * bypasses the production automation eligibility/coordinator: NEVER use this
 * to claim an authoritative gameplay action is accepted or input is safe.
 * Strict gameplay refusal is tested separately through planAbilityResolution.
 */
export function evaluateFixture(game: StorytellerLobbyRecord, request: AbilityResolutionRequest, environment: AbilityEnvironment = proofEnv()): AbilityPlanResult {
  if (request.mode !== "guided") throw new Error("Evaluator fixture requires a guided-shaped unit input");
  const resolved = resolveAbilitySemantics(request.roleId, environment.registry, environment.semantics);
  if (resolved.kind !== "supported" || !resolved.descriptor.evaluator) throw new Error("Evaluator fixture requires registered semantics");
  const query = createRulesQuery(game, environment);
  const binding = request.fingerprint.actor;
  const player = query.participant(binding);
  if (!player) return { ok: false, code: "stale", message: "Unit actor is stale" };
  const functioning = query.abilityFunctions(binding);
  const evaluation = resolved.descriptor.evaluator({ actor: { binding, player }, roleId: request.roleId,
    simulated: false, functioning: functioning.known && functioning.value, inputs: request.inputs ?? {}, judgments: request.judgments ?? {}, query, constraints: [] });
  if (evaluation.kind === "needsInput") return { ok: false, code: "needsInput", message: evaluation.message, requirements: [...evaluation.requirements] };
  if (evaluation.kind !== "outcome") return { ok: false, code: evaluation.kind, message: evaluation.message };
  return composeAbilityOutcome(game, evaluation.outcome, environment, { resolutionId: "unit-evaluator" });
}
