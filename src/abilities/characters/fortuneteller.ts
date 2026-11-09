import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import { answerOf, ask, nameOf, outcome, participantsOf, requireLivingActor, subjectId } from "./shared";
import { fortuneTellerSetupRefusal } from "./fortuneTellerSetupFact";
import { informationAbilityRefusal, recluseInformationChoice } from "./informationSupport";

/**
 * Fortune Teller -- GUIDED with the approved Red Herring state.
 * docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md Section 7.
 *
 * "Each night, choose 2 players: you learn if either is a Demon. There is a
 * good player that registers as a Demon to you."
 *
 * Red Herring authority: ONE active `fortuneTellerRedHerring` Effect --
 * Storyteller-private authoritative Current State (an approved
 * `storytellerFact`), read through RulesQuery.factHolders. Never a Reminder,
 * never re-chosen each Night, no source dependence (manual lifetime, no source).
 *  - selected during initial Setup, independently of ability functioning;
 *  - missing on ANY Night (late-created character, removed fact or gap):
 *    never invented during information resolution -> correction / Manual;
 *  - several recorded (or several Fortune Tellers in play) -> unsupported.
 *
 * Answer: Yes when either chosen player is the Red Herring or registers as a
 * Demon to the Fortune Teller (a dead Demon still does); an ambiguous
 * registration that could change the answer is an explicit Storyteller
 * judgment. One Boolean, recorded through Information Delivery.
 *
 * Impaired: (after the Red Herring has been established in Setup)
 * the two choices are recorded with whichever Boolean the Storyteller
 * communicates -- no functioning calculation.
 * Simulated (a Drunk shown as the Fortune Teller): no Red Herring at all, only
 * the communicated answer.
 */
export const RED_HERRING = "fortuneTellerRedHerring";
export const RED_HERRING_CHOICE = "redHerring";
export const COMMUNICATED = "communicated";
export const registersAsDemonJudgment = (binding: ParticipantBinding) => `registersAsDemon:${binding.participantId}`;

const actionId = (context: AbilityEvaluationContext) => context.query.game.day === 1 ? "fortuneteller-first-night" : "fortuneteller-other-night";

function deliver(context: AbilityEvaluationContext, targets: ParticipantBinding[], answer: boolean, before: AbilityOperation[] = []): AbilityEvaluation {
  return outcome([...before, { domain: "information", recipient: context.actor.binding, informationActionId: actionId(context), values: [
    { requirementId: "players", kind: "player", participants: targets },
    { requirementId: "isDemon", kind: "boolean", value: answer },
  ] }]);
}

export const FORTUNE_TELLER: AbilityDescriptor = {
  roleId: "fortuneteller",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "targets", kind: "participant", source: "player", count: 2, constraints: ["distinct"], label: "The two players chosen" }],
  hooks: ["information", "registration", "targeting"],
  informationActions: ["fortuneteller-first-night", "fortuneteller-other-night"],
  // SOL-10F-S7-F2: the Red Herring is established for the actual Fortune
  // Teller even while drunk / poisoned (Storyteller setup fact).
  independentFacts: [RED_HERRING],
  presentation: { complexity: "complex", action: "Choose 2 players: learn if either is a Demon" },
  evaluator: (context) => evaluate(context),
};

function evaluate(context: AbilityEvaluationContext): AbilityEvaluation {
  const dead = requireLivingActor(context) ?? informationAbilityRefusal(context);
  if (dead) return dead;
  const targets = participantsOf(context.inputs, "targets")!;
  const communicated = (before: AbilityOperation[] = []): AbilityEvaluation => {
    // SOL-10F-A1: the answer belongs to THIS chosen pair.
    const told = answerOf(context.inputs, subjectId(COMMUNICATED, ...targets), "boolean");
    if (!told) return ask("This Fortune Teller has no functioning ability: choose the answer to give.",
      { id: subjectId(COMMUNICATED, ...targets), kind: "boolean", source: "storyteller", label: "Answer given: either is a Demon" });
    return deliver(context, targets, told.value, before);
  };
  // A simulated wake (e.g. a Drunk shown as the Fortune Teller) has no
  // Fortune Teller at all: no Red Herring, only the communicated answer.
  if (context.simulated) return communicated();
  const setupRefusal = fortuneTellerSetupRefusal(context.query, context.actor.binding);
  if (setupRefusal) return { kind: "unsupported", message: setupRefusal };

  // --- The Red Herring fact (SOL-10F-S7-F2) -------------------------------
  // Storyteller-owned setup state of the ACTUAL Fortune Teller, established
  // independently of whether the ability functions right now.
  const holders = context.query.factHolders(RED_HERRING);
  if (!holders.known) return { kind: "unsupported", message: holders.reason };
  if (holders.value.length > 1) {
    return { kind: "unsupported", message: "More than one Red Herring is recorded. Correct the Red Herring Effects, or resolve manually." };
  }
  const redHerring = holders.value[0]?.holder;
  if (context.query.inPlay("fortuneteller").length !== 1) {
    return { kind: "unsupported", message: "More than one Fortune Teller is in play: whose Red Herring is whose is not modeled -- resolve manually." };
  }
  if (!redHerring) {
    return { kind: "unsupported", message: "No Red Herring is recorded for this Fortune Teller. Silverwick does not invent one during Night -- record it as a correction, or resolve manually." };
  }
  // --- Impaired: arbitrary valid answer, no calculation -------------------
  if (!context.functioning) return communicated();

  // --- Functioning: the answer --------------------------------------------
  const herring = redHerring;
  const ambiguous: ParticipantBinding[] = [];
  let yes = false;
  for (const target of targets) {
    if (target.participantId === herring.participantId) { yes = true; continue; }
    const demon = context.query.registersAsType(target, "demon", "fortuneteller");
    if (demon.known) { if (demon.value) yes = true; continue; }
    ambiguous.push(target);
  }
  if (!yes) {
    if (ambiguous.length && ambiguous.every(target => recluseInformationChoice(context, target))) {
      const id = subjectId(COMMUNICATED, ...targets);
      const told = answerOf(context.inputs, id, "boolean");
      return told ? deliver(context, targets, told.value) : ask("The Recluse may register as a Demon. Choose the answer to show for this pair.",
        { id, kind: "boolean", source: "storyteller", label: "Answer given: either is a Demon" });
    }
    const open = ambiguous.filter((target) => !answerOf(context.judgments, registersAsDemonJudgment(target), "boolean"));
    if (open.length) {
      return ask("A chosen player's registration is ambiguous: the Storyteller decides whether they register as a Demon.",
        ...open.map((target) => ({ id: registersAsDemonJudgment(target), kind: "boolean" as const, source: "judgment" as const,
          label: `${nameOf(context, target)} registers as a Demon to the Fortune Teller` })));
    }
    yes = ambiguous.some((target) => answerOf(context.judgments, registersAsDemonJudgment(target), "boolean")!.value);
  }
  return deliver(context, targets, yes);
}
