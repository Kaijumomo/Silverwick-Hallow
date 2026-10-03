import type { AbilityDescriptor, AbilityEvaluation, AbilityEvaluationContext } from "../semantics";
import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import type { RoleId } from "@/stores/types";
import { answerOf, ask, deathAttempt, firstParticipant, lifeOperation, nameOf, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Harlot -- GUIDED (Traveller). docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md
 * Section 15.
 *
 * "Each night*, choose a living player: if they agree, you learn their
 * character, but you both might die." Other Nights by the GAME's Night number
 * (a late-arriving Harlot is not on a "first night" of its own).
 *
 *  1. the Harlot chooses one living participant (themself included --
 *     SOL-10F-S7-F1);
 *  2. that participant answers Yes / No (their own Player choice);
 *     No -> no information, no death;
 *  3. Yes -> the character shown is their registration to the Harlot
 *     (ambiguity -> Storyteller judgment), recorded through Information
 *     Delivery (`harlot-other-night`, owner-authorized Silverwick metadata:
 *     the consenting chosen player + the character shown);
 *  4. "might" -> the Storyteller chooses whether the death consequence happens;
 *     if so, both deaths are attempted in ONE resolution, each respecting
 *     protectedFrom(..., "any"). If one death would change whether the other
 *     is protected (death order would matter), Silverwick does not invent an
 *     order -> Manual.
 *
 * The communicated character is determined BEFORE any death; the delivery
 * record follows the Life operation only because bookkeeping is always
 * recorded after mechanics in one snapshot (PHASE10F Section 4).
 * Impaired / simulated: the Storyteller chooses the character shown; no death.
 */
export const CONSENT = "consent";
export const CHARACTER_JUDGMENT = "harlot:character";
export const SHOWN = "shown";
export const DEATH_CONSEQUENCE = "deathConsequence";

/** Records the consenting player the Harlot chose and the character shown. */
function inform(context: AbilityEvaluationContext, chosen: ParticipantBinding, roleId: RoleId, before: AbilityOperation[] = []): AbilityEvaluation {
  return outcome([...before, { domain: "information", recipient: context.actor.binding, informationActionId: "harlot-other-night", values: [
    { requirementId: "chosenPlayer", kind: "player", participants: [chosen] },
    { requirementId: "role", kind: "role", roleId },
  ] }]);
}

export const HARLOT: AbilityDescriptor = {
  roleId: "harlot",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  // SOL-10F-S7-F1: any LIVING participant -- the Harlot may choose themself.
  inputs: [{ id: "target", kind: "participant", source: "player", constraints: ["alive"], label: "The living player chosen" }],
  hooks: ["information", "registration", "death"],
  informationActions: ["harlot-other-night"],
  presentation: { complexity: "complex", action: "Choose a living player (they may agree)" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    const target = firstParticipant(context.inputs, "target");
    const consent = answerOf(context.inputs, CONSENT, "boolean");
    if (!consent) return ask(`${nameOf(context, target)} is shown that the Harlot chose them: do they agree?`,
      { id: CONSENT, kind: "boolean", source: "player", label: `${nameOf(context, target)} agrees` });
    if (!consent.value) return nothing();

    if (context.simulated || !context.functioning) {
      const shown = answerOf(context.inputs, SHOWN, "character");
      if (!shown || shown.roleIds.length !== 1) return ask("This Harlot has no functioning ability: choose the character shown.",
        { id: SHOWN, kind: "character", source: "storyteller", label: "The character shown to the Harlot" });
      return inform(context, target, shown.roleIds[0]!);
    }
    let roleId: RoleId;
    const registered = context.query.registration(target, "harlot").character;
    if (registered.known) roleId = registered.value;
    else {
      const judged = answerOf(context.judgments, CHARACTER_JUDGMENT, "character");
      if (!judged || judged.roleIds.length !== 1) return ask(registered.reason,
        { id: CHARACTER_JUDGMENT, kind: "character", source: "judgment", label: `The character ${nameOf(context, target)} registers as to the Harlot` });
      roleId = judged.roleIds[0]!;
    }

    const consequence = answerOf(context.inputs, DEATH_CONSEQUENCE, "boolean");
    if (!consequence) return ask("Both players MIGHT die: the Storyteller decides.",
      { id: DEATH_CONSEQUENCE, kind: "boolean", source: "storyteller", label: "The Harlot and the chosen player die (if not protected)" });
    if (!consequence.value) return inform(context, target, roleId);

    // "You both" -- the distinct participants involved: ONE death attempt per
    // participant (a self-chosen Harlot is one participant, never two
    // contradictory Life intents for the same ParticipantId).
    const self = target.participantId === context.actor.binding.participantId;
    const pair: ParticipantBinding[] = self ? [context.actor.binding] : [context.actor.binding, target];
    const deaths: { kind: "death"; target: ParticipantBinding }[] = [];
    for (const [index, who] of pair.entries()) {
      const alone = deathAttempt(context, who, "any");
      if (alone.kind === "ask") return ask(alone.message, alone.requirement);
      const other = pair[1 - index];
      if (other && deathAttempt(context, who, "any", context.query.assumingAlive(other, false)).kind !== alone.kind) {
        return { kind: "unsupported", message: "Whether one of these deaths is prevented depends on the other death happening first -- the order matters, so resolve it manually." };
      }
      if (alone.kind === "dies") deaths.push({ kind: "death", target: who });
    }
    return inform(context, target, roleId, deaths.length ? [lifeOperation(deaths)] : []);
  },
};
