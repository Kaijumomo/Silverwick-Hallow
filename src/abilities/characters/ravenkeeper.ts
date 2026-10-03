import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RoleId } from "@/stores/types";
import { answerOf, ask, firstParticipant, nameOf, outcome, subjectId } from "./shared";

/**
 * Ravenkeeper -- GUIDED triggered ability. docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md
 * Section 9.
 *
 * "If you die at night, you are woken to choose a player: you learn their
 * character." The ONLY proof character with the explicit, verified Night
 * trigger (`nightTrigger: "actorDiedTonight"`): the exact participation
 * instance died during the CURRENT Night per the Life Event Window with known
 * coverage (unknown coverage -> Storyteller judgment, enforced by the
 * coordinator). It resolves while dead -- the ability triggers on that death.
 *
 * Functioning: any participant (alive or dead); the character they register
 * as to the Ravenkeeper (ambiguity -- e.g. a Recluse shown as a Minion -> the
 * Storyteller's judgment); recorded through Information Delivery
 * (`ravenkeeper-triggered`).
 * Impaired / simulated: the wake and choice are simulated; the Storyteller
 * shows any character -- no functioning calculation.
 */
export const CHARACTER_JUDGMENT = "ravenkeeper:character";
export const SHOWN = "shown";

function inform(context: AbilityEvaluationContext, target: ParticipantBinding, roleId: RoleId): AbilityEvaluation {
  return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "ravenkeeper-triggered", values: [
    { requirementId: "chosenPlayer", kind: "player", participants: [target] },
    { requirementId: "role", kind: "role", roleId },
  ] }]);
}

export const RAVENKEEPER: AbilityDescriptor = {
  roleId: "ravenkeeper",
  timing: ["triggered"],
  invocation: "wake",
  nightTrigger: "actorDiedTonight",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "The player chosen" }],
  hooks: ["information", "registration", "wake"],
  informationActions: ["ravenkeeper-triggered"],
  presentation: { complexity: "complex", action: "Died tonight: choose a player to learn their character" },
  evaluator: (context) => {
    const target = firstParticipant(context.inputs, "target");
    if (context.simulated || !context.functioning) {
      const shown = answerOf(context.inputs, subjectId(SHOWN, target), "character");
      if (!shown || shown.roleIds.length !== 1) return ask("This Ravenkeeper has no functioning ability: choose the character shown.",
        { id: subjectId(SHOWN, target), kind: "character", source: "storyteller", label: "The character shown to the Ravenkeeper" });
      return inform(context, target, shown.roleIds[0]!);
    }
    const registered = context.query.registration(target, "ravenkeeper").character;
    if (registered.known) return inform(context, target, registered.value);
    const judged = answerOf(context.judgments, subjectId(CHARACTER_JUDGMENT, target), "character");
    if (!judged || judged.roleIds.length !== 1) return ask(registered.reason,
      { id: subjectId(CHARACTER_JUDGMENT, target), kind: "character", source: "judgment", label: `The character ${nameOf(context, target)} registers as to the Ravenkeeper` });
    return inform(context, target, judged.roleIds[0]!);
  },
};
