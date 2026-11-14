import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { recordedDeathCause, type RecordedDeathCause } from "../invocation";
import { isDeathEvent } from "@/stores/lifeEvents";
import { answerOf, ask, nameOf, nothing, outcome, participantsOf } from "./shared";
import { informationAbilityRefusal } from "./informationSupport";

/**
 * Sage -- GUIDED triggered information (SV-1a, Sects & Violets).
 * https://wiki.bloodontheclocktower.com/Sage (saved revision 3009)
 *
 * "If the Demon kills you, you learn that it is 1 of 2 players." "The Sage only gets this information when killed by a Demon
 * attack. Being executed does not count." How to Run: "If the Sage was killed by the Demon, wake the Sage. Point at two players,
 * one who is the Demon that killed the Sage."
 *
 * Trigger (`actorKilledByDemonTonight`): the Sage died tonight, and the death's recorded cause is not another character. A guided
 * Demon kill records its cause and its player; a death entered by hand records none.
 *  - recorded Demon kill: the Storyteller taps two players; one must be the Demon that killed the Sage (the recorded killer).
 *  - nothing recorded, or a night on which a Pit-Hag made deaths arbitrary ("Because the Sage died due to the Pit-Hag, not the
 *    Demon, the Sage does not wake"): one Yes or No first. No closes the step and delivers nothing.
 *  - drunk, poisoned or a simulated wake: any two players ("This information is incorrect").
 * A Vortox in play makes the whole step Manual through the shared information modifier (passiveRules.ts); its false pair is SV-5.
 * The Recluse jinx stays a Storyteller judgment through the modifier gate, as every unverified jinx does.
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 9, the verified Night trigger, as for the Ravenkeeper).
 */
export const SAGE_PLAYERS = "players";
const SAGE_DEMON_KILLED = "sage:demonKilled";
export const sageCauseId = (eventId: string | null) => `${SAGE_DEMON_KILLED}:${JSON.stringify(eventId)}`;
const WRONG_PAIR = "One of the two must be the Demon that killed the Sage.";

/** The Sage's death tonight that fired the trigger, and what its record says about the cause (a Pit-Hag night asks every time). */
function deathCause(query: RulesQuery, eventId: string | null): RecordedDeathCause | null {
  const moment = query.moment();
  if (!moment || eventId === null) return null;
  const events = query.lifeEvents(moment, (event) => event.id === eventId && isDeathEvent(event));
  const event = (events.status === "known" ? events.events : events.recorded)[0];
  return event ? recordedDeathCause(query, event) : null;
}

/** The question the Storyteller answers before choosing the two players, or null when the recorded cause settles it. */
export function sageCauseQuestion(query: RulesQuery, sage: ParticipantBinding, eventId: string | null): { id: string; heading: string; note: string } | null {
  const cause = deathCause(query, eventId);
  if (!cause || cause.kind !== "unrecorded") return null;
  const player = query.participant(sage);
  const name = player?.name || (player ? `Seat ${player.seat + 1}` : "the Sage");
  return { id: sageCauseId(eventId), heading: `Did the Demon kill ${name}?`,
    note: cause.arbitrary ? "Deaths tonight are arbitrary. The Sage wakes only if the Demon killed them."
      : "Silverwick did not record what killed the Sage. The Sage wakes only if the Demon killed them." };
}

const inform = (context: AbilityEvaluationContext, players: ParticipantBinding[]): AbilityEvaluation =>
  outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "sage-triggered",
    values: [{ requirementId: SAGE_PLAYERS, kind: "player", participants: players }] }]);

export const SAGE: AbilityDescriptor = {
  roleId: "sage",
  timing: ["triggered"],
  invocation: "wake",
  nightTrigger: "actorKilledByDemonTonight",
  usage: { kind: "unlimited" },
  // "nobody" is admitted only so the Storyteller's No (the Demon did not kill the Sage) can close the step; the evaluator refuses it otherwise.
  inputs: [{ id: SAGE_PLAYERS, kind: "participant", source: "storyteller", count: 2, allowNone: true, constraints: ["distinct"], label: "The two players shown to the Sage" }],
  hooks: ["information", "registration", "wake"],
  informationActions: ["sage-triggered"],
  presentation: { complexity: "simple", action: "Point at two players, one of them the Demon" },
  evaluator: (context) => {
    const refusal = informationAbilityRefusal(context);
    if (refusal) return refusal;
    if (!context.trigger) return { kind: "notApplicable", message: "The Sage wakes only on the night the Demon killed them." };
    const cause = deathCause(context.query, context.trigger.eventId);
    if (!cause || cause.kind === "other") return { kind: "notApplicable", message: "The Sage was not killed by the Demon tonight." };
    if (cause.kind === "unrecorded") {
      const id = sageCauseId(context.trigger.eventId);
      const answer = answerOf(context.inputs, id, "boolean");
      const name = nameOf(context, context.actor.binding);
      if (!answer) return ask(`Silverwick did not record what killed ${name}. The Sage wakes only if the Demon killed them.`,
        { id, kind: "boolean", source: "storyteller", label: `The Demon killed ${name}` });
      if (!answer.value) return nothing();
    }
    const players = participantsOf(context.inputs, SAGE_PLAYERS) ?? [];
    if (players.length !== 2) return { kind: "illegal", message: "Point at two players, one of them the Demon." };
    // Drunk, poisoned or only shown the Sage: the Storyteller shows any two players.
    if (context.simulated || !context.functioning) return inform(context, players);
    const killer = cause.kind === "demon" && cause.killer && context.query.participant(cause.killer) ? cause.killer : null;
    if (killer) {
      if (!players.some((player) => player.participantId === killer.participantId)) return { kind: "illegal", message: WRONG_PAIR };
    } else if (!players.some((player) => {
      // The killer was not recorded (a death entered by hand): one of the two must be a player who can register as a Demon to the Sage.
      const demon = context.query.registersAsType(player, "demon", "sage");
      return !demon.known || demon.value;
    })) return { kind: "illegal", message: WRONG_PAIR };
    return inform(context, players);
  },
};
