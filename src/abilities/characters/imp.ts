import { isCanonicalRole } from "@/data/canonical";
import { needsShownIdentity } from "@/stores/identity";
import { participantStepKey } from "@/stores/nightProgress";
import { toldRoleChangeIntents } from "@/stores/roleResolution";
import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { answerOf, ask, deathAttempt, firstParticipant, followUpParticipant, lifeOperation, nameOf, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Imp -- GUIDED, with the narrow Scarlet Woman dependency.
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md Sections 6 and 18.1.
 *
 * "Each night*, choose a player: they die. If you kill yourself this way, a
 * Minion becomes the Imp." Any target (alive / dead / self).
 *  - another player: dead -> nothing; alive -> a Demon-caused death unless
 *    protected (protectedFrom "demon"; unknown -> judgment).
 *  - self: a star-pass happens ONLY if the Imp actually dies from this
 *    ability (protected -> no death, no star-pass). Then, in this order:
 *      1. the old Imp's death;
 *      2. the successor: a living canonical Scarlet Woman whose ability
 *         functions MUST be chosen when at least 5 non-Traveller players were
 *         alive immediately before the death; otherwise any living Minion
 *         (one -> deterministic; several -> the Storyteller's choice; none ->
 *         no star-pass). A non-functioning Scarlet Woman is an ordinary
 *         candidate;
 *      3. the successor's Role change to the Imp, with their perception (they
 *         are told they are the Imp);
 *      4. the new Imp's own participant-scoped Imp step tonight is marked
 *         SKIPPED in the same snapshot, so the Night Order (and the
 *         coordinator) never grant that new Imp a second attack tonight --
 *         `abilityUsed` is never faked for this.
 *  - impaired / simulated: the choice is simulated; no death, no star-pass.
 * Game end is not decided here (Section 6).
 */
export const SUCCESSOR = "successor";
export const swFunctionsJudgment = (participantId: string) => `scarletWoman:functions:${participantId}`;
const SCARLET_WOMAN_THRESHOLD = 5;

/** Ordinary perception the seam can update truthfully: shown as their own
 * character, no concealed identity. Anything else is not invented here. */
const ordinaryPerception = (query: RulesQuery, binding: ParticipantBinding) => {
  const player = query.participant(binding);
  return !!player && player.shownRole === player.actualRole && !needsShownIdentity(player.actualRole) &&
    !["drunk_fake_role_behavior", "marionette_fake_good_behavior", "fake_demon_behavior"].includes(player.behaviorMode);
};

function successor(context: AbilityEvaluationContext): { binding: ParticipantBinding } | { evaluation: AbilityEvaluation } | null {
  const { query } = context;
  const seated = query.game.seatOrder.map((id) => query.game.players[id]).filter((p) => !!p && !p.isEmpty && !!p.participantId);
  const aliveNonTravellers = seated.filter((p) => p!.alive && !p!.isTraveler).length; // immediately BEFORE the Demon death
  const binding = (p: (typeof seated)[number]): ParticipantBinding => ({ playerId: p!.id, participantId: p!.participantId! });
  const minions = seated.filter((p) => p!.alive && !p!.isTraveler && p!.participantId !== context.actor.binding.participantId &&
    query.roleOf(p!.actualRole)?.type === "minion").map(binding);
  let candidates = minions;
  const scarletWoman = query.roleOf("scarletwoman");
  if (aliveNonTravellers >= SCARLET_WOMAN_THRESHOLD && scarletWoman && isCanonicalRole(scarletWoman)) {
    const priority: ParticipantBinding[] = [];
    for (const sw of minions.filter((b) => query.participant(b)?.actualRole === "scarletwoman")) {
      const functions = query.abilityFunctions(sw);
      if (functions.known) { if (functions.value) priority.push(sw); continue; }
      const judged = answerOf(context.judgments, swFunctionsJudgment(sw.participantId), "boolean");
      if (!judged) return { evaluation: ask(functions.reason, { id: swFunctionsJudgment(sw.participantId), kind: "boolean", source: "judgment",
        label: `${nameOf(context, sw)}'s Scarlet Woman ability is functioning` }) };
      if (judged.value) priority.push(sw);
    }
    if (priority.length) candidates = priority;
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return { binding: candidates[0]! };
  const chosen = followUpParticipant(context, context.inputs, SUCCESSOR);
  if (!chosen) return { evaluation: ask("The Imp died by its own ability: the Storyteller chooses which living Minion becomes the Imp.",
    { id: SUCCESSOR, kind: "participant", source: "storyteller", label: "The Minion who becomes the Imp" }) };
  if ("refusal" in chosen) return { evaluation: chosen.refusal };
  if (!candidates.some((c) => c.participantId === chosen.binding.participantId)) {
    return { evaluation: { kind: "illegal", message: "The new Imp must be one of the eligible living Minions (a functioning Scarlet Woman first)." } };
  }
  return { binding: chosen.binding };
}

export const IMP: AbilityDescriptor = {
  roleId: "imp",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "The player to kill" }],
  hooks: ["targeting", "death", "role"],
  presentation: { complexity: "complex", action: "Choose a player to kill" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) return nothing();
    const target = firstParticipant(context.inputs, "target");
    const self = target.participantId === context.actor.binding.participantId;
    if (!context.query.participant(target)?.alive) return nothing();
    const death = deathAttempt(context, target, "demon");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    if (death.kind === "survives") return nothing();
    const kill = lifeOperation([{ kind: "death", target }]);
    if (!self) return outcome([kill]);

    const next = successor(context);
    if (!next) return outcome([kill]);
    if ("evaluation" in next) return next.evaluation;
    const heir = context.query.participant(next.binding)!;
    if (!ordinaryPerception(context.query, next.binding)) {
      return { kind: "unsupported", message: `${nameOf(context, next.binding)} has a concealed identity: what they are told on becoming the Imp is not modeled -- resolve manually.` };
    }
    return outcome([
      kill,
      { domain: "role", intents: toldRoleChangeIntents(heir, "imp") },
      { domain: "nightStep", day: context.query.game.day, stepKey: participantStepKey(next.binding.participantId, "imp"), status: "skipped" },
    ], true);
  },
};
