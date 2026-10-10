import { isCanonicalRole } from "@/data/canonical";
import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { LifeEvent } from "@/stores/types";
import { answerOf, ask, outcome, requireLivingActor } from "./shared";
import { informationAbilityRefusal } from "./informationSupport";
import { passiveRegistrationOptions } from "./passiveRules";

/** B5b extends PHASE10F_CHARACTER_RULES_MATRIX.md.
 * https://wiki.bloodontheclocktower.com/Undertaker
 * Only a previous-Day execution that caused death qualifies. The retained
 * Life Event owns the death-time identity; current identity and History never
 * supply missing evidence. Optional registration remains Storyteller-owned.
 */
export const undertakerShownId = (event: LifeEvent): string => `undertaker:shown:${JSON.stringify([event.id, event.actualRoleAtEvent])}`;

function deliver(context: AbilityEvaluationContext, roleId: string): AbilityEvaluation {
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "undertaker-other-night",
    values: [{ requirementId: "role", kind: "role", roleId }] }]);
}

export const UNDERTAKER: AbilityDescriptor = {
  roleId: "undertaker", timing: ["otherNight"], invocation: "wake", usage: { kind: "unlimited" }, inputs: [],
  hooks: ["information", "registration"], informationActions: ["undertaker-other-night"],
  presentation: { complexity: "simple", action: "Show the character that died by execution" },
  evaluator: context => {
    const refusal = requireLivingActor(context) ?? informationAbilityRefusal(context);
    if (refusal) return refusal;
    const moment = context.query.moment();
    if (!moment || moment.phase !== "night" || moment.day <= 1) return { kind: "notApplicable", message: "There is no previous Day execution to learn about." };
    const deaths = context.query.lifeEvents({ phase: "day", day: moment.day - 1 }, event => event.kind === "execution" && event.outcome === "died");
    if (deaths.status !== "known") return { kind: "unsupported", message: "The previous Day's execution record is incomplete. Resolve this information manually." };
    if (!deaths.events.length) return { kind: "notApplicable", message: "Nobody died by execution during the previous Day." };
    if (deaths.events.length !== 1) return { kind: "unsupported", message: "More than one player died by execution. The Storyteller chooses which character to show manually." };
    const event = deaths.events[0]!;
    const role = event.actualRoleAtEvent && context.query.roleOf(event.actualRoleAtEvent);
    if (!role || !isCanonicalRole(role)) return { kind: "unsupported", message: "The executed player's character at death is not verified. Resolve this information manually." };
    if (context.simulated || !context.functioning) {
      const id = undertakerShownId(event);
      const chosen = answerOf(context.inputs, id, "character");
      if (!chosen || chosen.roleIds.length !== 1) return ask("Choose the character to show.",
        { id, kind: "character", source: "storyteller", label: "The character shown to the Undertaker" });
      return deliver(context, chosen.roleIds[0]!);
    }
    // Spy/Recluse may register while dead. Current registration is usable only
    // for the same participant still holding the recorded character. If they
    // changed/left, no historical impairment or registration state is invented.
    const binding = { playerId: event.subject.playerId, participantId: event.subject.participantId };
    const player = context.query.participant(binding);
    if (passiveRegistrationOptions(role.id) && (!player || player.actualRole !== role.id)) {
      return { kind: "unsupported", message: "The executed character's registration cannot be verified after its identity changed. Resolve manually." };
    }
    // Explicit false-registration effects can affect any character, not only
    // Spy/Recluse. Consult the existing query for those uncertainties too.
    if (player) {
      const registered = context.query.registration(binding, "undertaker").character;
      if (!registered.known) return { kind: "unsupported", message: registered.reason };
      if (player.actualRole === role.id) return deliver(context, registered.value);
    }
    return deliver(context, role.id);
  },
};
