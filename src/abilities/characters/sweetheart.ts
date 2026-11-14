import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { LifeEvent } from "@/stores/types";
import { isDeathEvent } from "@/stores/lifeEvents";
import { nightTriggerStepKey } from "@/stores/nightProgress";
import { nameOf, outcome, participantsOf } from "./shared";

/**
 * Sweetheart -- GUIDED (SV-1b, Sects & Violets). https://wiki.bloodontheclocktower.com/Sweetheart (saved revision 2704)
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 9, the verified Night trigger, as for the Ravenkeeper).
 *
 * "When you die, 1 player is drunk from now on." "The Storyteller chooses which player becomes drunk." "This ability works while the
 * Sweetheart is dead." Night sheet: "If the Sweetheart died, a player became drunk immediately. If you haven't done this yet, do so now."
 *
 * Two entry points, one rule:
 *  - the Day (PO answer to Q1, 2026-11-14): when she dies in the Day, a Day actions row lets the Storyteller choose at once. Its
 *    resolution also marks the next Night's step for that death as done, so the night step does not ask again;
 *  - the Night (`actorDiedTodayOrTonight`): her step at her place in the night order, for a death tonight or a Day death not yet done.
 * The Storyteller chooses any one player, alive or dead, of either team. The player gets a `drunk` Effect sourced by her, with no end
 * ("from now on"). It keeps working while she is dead, pauses while she is drunk or poisoned and ends if she changes character
 * (`whileSourceHasAbility`, rulesQuery.ts; the character change removes it, sourceAbilityLifecycle.ts). Removing the official DRUNK
 * token removes the Effect.
 * Drunk or poisoned when the step runs (or a simulated wake): nobody becomes drunk ("is still lost if the player becomes drunk or
 * poisoned", Abilities). Her choosing herself is a paradox the page does not settle: the Storyteller's, by hand.
 */
export const SWEETHEART_PLAYER = "player";

/** The Night step key of one Sweetheart death (the same key the Night trigger consumes). */
const stepKeyOf = (sweetheart: ParticipantBinding, eventId: string) => nightTriggerStepKey(sweetheart.participantId, "sweetheart", eventId);

/** This Sweetheart's death today (Day only) whose choice is not made yet, or null. An uncovered Day window is never guessed: null. */
export function sweetheartOpenDayDeath(query: RulesQuery, sweetheart: ParticipantBinding): LifeEvent | null {
  const moment = query.moment();
  if (!moment || moment.phase !== "day") return null;
  const deaths = query.lifeEvents(moment, (event) => isDeathEvent(event) && event.subject.participantId === sweetheart.participantId
    && event.actualRoleAtEvent === "sweetheart");
  if (deaths.status !== "known") return null;
  return deaths.events.find((event) => {
    const status = query.game.nightProgress[`${moment.day + 1}:${stepKeyOf(sweetheart, event.id)}`]?.status;
    return status !== "done" && status !== "skipped";
  }) ?? null;
}

export const SWEETHEART: AbilityDescriptor = {
  roleId: "sweetheart",
  timing: ["day", "triggered"],
  invocation: "procedure",
  nightTrigger: "actorDiedTodayOrTonight",
  usage: { kind: "unlimited" },
  // "nobody" is admitted only for a Sweetheart who has no ability when her step runs; the evaluator refuses it otherwise.
  inputs: [{ id: SWEETHEART_PLAYER, kind: "participant", source: "storyteller", allowNone: true, label: "The player who becomes drunk" }],
  hooks: ["targeting"],
  sourcedEffects: [{ type: "drunk", persistence: "whileSourceHasAbility" }],
  presentation: { complexity: "simple", action: "Choose a player to be drunk from now on" },
  evaluator: (context): AbilityEvaluation => {
    const { query } = context;
    const me = context.actor.binding;
    const actor = query.participant(me);
    if (!actor) return { kind: "illegal", message: "The Sweetheart's seat changed." };
    if (actor.alive) return { kind: "notApplicable", message: "The Sweetheart's ability works when she dies." };
    const bookkeeping: AbilityOperation[] = [];
    if (!context.trigger) {
      // The Day action: her death today, marked so the next Night does not ask again.
      const event = sweetheartOpenDayDeath(query, me);
      if (!event) return { kind: "notApplicable", message: "The Sweetheart did not die today, or her choice is already made." };
      bookkeeping.push({ domain: "nightStep", day: query.game.day + 1, stepKey: stepKeyOf(me, event.id), status: "done" });
    }
    const chosen = participantsOf(context.inputs, SWEETHEART_PLAYER) ?? [];
    if (context.simulated || !context.functioning) return outcome(bookkeeping);
    const target = chosen[0];
    if (chosen.length !== 1 || !target) return { kind: "illegal", message: "Choose the player who becomes drunk." };
    if (target.participantId === me.participantId) {
      return { kind: "unsupported", message: `${nameOf(context, me)} making herself drunk is your ruling: resolve it by hand.` };
    }
    return outcome([{ domain: "effect", intents: [{ kind: "apply", target,
      effect: { type: "drunk", source: me, sourceCharacter: "sweetheart", lifetime: { kind: "manual" } } }] }, ...bookkeeping]);
  },
};
