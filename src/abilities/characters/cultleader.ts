import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { Alignment } from "@/stores/types";
import { changeAlignmentIntent } from "@/stores/alignmentResolution";
import { shownAlignmentIntent } from "@/stores/roleResolution";
import { answerOf, ask, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Cult Leader -- GUIDED-PARTIAL. docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md
 * Section 11. Only the NIGHTLY alignment portion is guided.
 *
 * "Each night, you become the alignment of an alive neighbor." A procedure
 * (no player input): the two nearest LIVING neighbours (Rules Query), each by
 * its registered alignment to the Cult Leader.
 *  - both the same -> deterministic;
 *  - one good, one evil -> the Storyteller chooses either result;
 *  - an ambiguous registration -> the Storyteller's explicit judgment;
 *  - impaired / simulated -> no alignment change.
 * When the Actual Alignment changes: (1) Actual Alignment through the
 * Alignment seam, THEN (2) the player-facing alignment through the one
 * perception writer (Role seam setPerception) so the player is told -- a
 * declared mechanical order. No change -> nothing is recorded (no wake, no
 * information invented).
 *
 * VERIFIED-MANUAL boundary: the Day cult formation / cult vote / win is NOT
 * modeled (no Day timing here, so the Day entry offers only Manual); no vote
 * engine is built.
 */
export const ALIGNMENT_CHOICE = "alignmentChoice";
export const ALIGNMENT_JUDGMENT = "alignmentJudgment";

function become(context: AbilityEvaluationContext, alignment: Alignment): AbilityEvaluation {
  const player = context.actor.player;
  if (player.actualAlignment === alignment) return nothing();
  // Built by the seams' own intent builders from the record the actor holds
  // (bound participant + observed state).
  return outcome([
    { domain: "alignment", intents: [changeAlignmentIntent(player, alignment)] },
    { domain: "role", intents: [shownAlignmentIntent(player, alignment)] },
  ], true);
}

export const CULT_LEADER: AbilityDescriptor = {
  roleId: "cultleader",
  timing: ["firstNight", "otherNight"],
  invocation: "procedure",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["alignment", "registration", "information"],
  presentation: { complexity: "complex", action: "Become the alignment of a living neighbour" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    if (context.simulated || !context.functioning) return nothing();
    const judged = () => {
      const answer = answerOf(context.judgments, ALIGNMENT_JUDGMENT, "alignment");
      return answer ? become(context, answer.alignment)
        : ask("A neighbour's alignment registration is ambiguous: the Storyteller decides the Cult Leader's alignment.",
          { id: ALIGNMENT_JUDGMENT, kind: "alignment", source: "judgment", label: "The Cult Leader's resulting alignment" });
    };
    const neighbours = context.query.aliveNeighbours(context.actor.binding);
    if (!neighbours.known) return judged();
    const unique = [neighbours.value.left, neighbours.value.right]
      .filter((binding): binding is ParticipantBinding => !!binding)
      .filter((binding, index, all) => all.findIndex((other) => other.participantId === binding.participantId) === index);
    if (!unique.length) return nothing();
    const alignments = new Set<Alignment>();
    for (const neighbour of unique) {
      const alignment = context.query.registration(neighbour, "cultleader").alignment;
      if (!alignment.known) return judged();
      alignments.add(alignment.value);
    }
    if (alignments.size === 1) return become(context, [...alignments][0]!);
    const chosen = answerOf(context.inputs, ALIGNMENT_CHOICE, "alignment");
    return chosen ? become(context, chosen.alignment)
      : ask("One living neighbour is good and one is evil: the Storyteller chooses which alignment the Cult Leader becomes.",
        { id: ALIGNMENT_CHOICE, kind: "alignment", source: "storyteller", label: "The Cult Leader becomes" });
  },
};
