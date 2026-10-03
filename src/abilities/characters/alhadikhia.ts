import type { AbilityDescriptor, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { answerOf, ask, deathAttempt, lifeOperation, nameOf, nothing, outcome, participantsOf, requireLivingActor, subjectId } from "./shared";

/**
 * Al-Hadikhia -- GUIDED. docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md Section 13
 * (including the corrected rule: every Al-Hadikhia death is caused by a DEMON
 * ability -> protectedFrom(target, "demon")).
 *
 * "Each night*, you may choose 3 players (all players learn who): each
 * silently chooses to live or die, but if all live, all die."
 *  - nobody chosen (an explicit empty answer, allowNone) -> no Life change, no
 *    announcement record; the step may complete;
 *  - exactly 3 distinct participants, in the declared 1 -> 2 -> 3 order; each
 *    one's live/die choice is asked and its consequence SETTLED (any
 *    protection judgment included) before the next player is asked
 *    (SOL-10F-A6), against the EVOLVING Life state (RulesQuery.assumingAlive):
 *      live: dead -> resurrection; alive -> nothing;
 *      die: dead -> stays dead; alive -> Demon-caused death unless protected
 *           (known protected -> stays alive; unknown -> judgment);
 *  - then, if all three are alive (a protected "die" counts as alive), a death
 *    is attempted for each, again 1 -> 2 -> 3 and again Demon-caused.
 * All Life events form ONE ordered Life transaction (10F-AC-16).
 * Impaired / simulated: choices only; no Life change.
 */
/** SOL-10F-A1: a live/die choice belongs to BOTH its ordered position and the
 * participant in it -- replacing that participant asks afresh. */
export const choiceId = (index: number, who: ParticipantBinding) => subjectId(`choice:${index + 1}`, who);

export const AL_HADIKHIA: AbilityDescriptor = {
  roleId: "alhadikhia",
  timing: ["otherNight"],
  invocation: "procedure",
  usage: { kind: "unlimited" },
  inputs: [{ id: "chosen", kind: "participant", source: "player", count: 3, allowNone: true, constraints: ["distinct"],
    label: "The 3 players chosen, in order (or nobody)" }],
  hooks: ["death"],
  presentation: { complexity: "complex", action: "Choose 3 players in order, or nobody" },
  evaluator: (context: AbilityEvaluationContext) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    const chosen = participantsOf(context.inputs, "chosen") ?? [];
    if (!chosen.length) return nothing();
    const mechanics = !context.simulated && context.functioning;

    // The evolving working Life state of THIS resolution (one final commit).
    let query = context.query;
    const isAlive = (who: ParticipantBinding) => query.participant(who)?.alive === true;
    const intents: { kind: "death" | "resurrection"; target: ParticipantBinding }[] = [];
    const kill = (who: ParticipantBinding) => {
      const attempt = deathAttempt(context, who, "demon", query);
      if (attempt.kind === "dies") {
        intents.push({ kind: "death", target: who });
        query = query.assumingAlive(who, false);
      }
      return attempt;
    };
    // SOL-10F-A6: the running procedure, strictly 1 -> 2 -> 3. Player N's
    // choice is asked, then its consequence is SETTLED (including any
    // protection judgment) before player N+1 is asked anything.
    for (const [index, who] of chosen.entries()) {
      const id = choiceId(index, who);
      const answer = answerOf(context.inputs, id, "boolean");
      if (!answer) return ask(`${index + 1}. ${nameOf(context, who)} silently chooses to live or die.`,
        { id, kind: "boolean", source: "player", label: `${index + 1}. ${nameOf(context, who)} chooses to LIVE (No: chooses to die)` });
      if (!mechanics) continue; // impaired / simulated: choices only
      if (answer.value) {
        if (!isAlive(who)) {
          intents.push({ kind: "resurrection", target: who });
          query = query.assumingAlive(who, true);
        }
        continue;
      }
      if (!isAlive(who)) continue;
      const attempt = kill(who);
      if (attempt.kind === "ask") return ask(attempt.message, attempt.requirement);
    }
    if (!mechanics) return nothing();
    if (chosen.every(isAlive)) {
      for (const who of chosen) {
        const attempt = kill(who);
        if (attempt.kind === "ask") return ask(attempt.message, attempt.requirement);
      }
    }
    return intents.length ? outcome([lifeOperation(intents)]) : nothing();
  },
};
