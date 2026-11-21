import { isCanonicalRole } from "@/data/canonical";
import { GAINED_ABILITY, GAINED_CHARACTER, GAINED_SHOWN } from "@/stores/gainedAbility";
import type { AbilityOperation } from "@/stores/abilityResolution";
import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import { answerOf, lifeOperation, outcome, requireLivingActor } from "./shared";

/**
 * Philosopher -- GUIDED (SV-3a, Sects & Violets). https://wiki.bloodontheclocktower.com/Philosopher (saved revision 2421)
 *
 * "Once per game, at night, choose a good character: gain that ability. If this character is in play, they are drunk."
 * "They do not become that character." How to Run: "Each night, wake the Philosopher. They either shake their head no or point at any
 * Townsfolk icon or any Outsider icon on their character sheet." "If they pointed to an icon of a character not in play, swap the
 * Philosopher token with the chosen character token and mark them with the IS THE PHILOSOPHER reminder." "If they pointed to an icon
 * of a character in play, the player of the chosen character becomes drunk."
 *
 * One night step, every night until the ability is used. Shaking their head ("Not Tonight") only closes tonight's step: nothing is
 * used, and the Philosopher wakes again next night. A chosen Townsfolk or Outsider of the script is ONE resolution (one Undo):
 *  1. the ability is used (the Life boundary, as every once-per-game ability);
 *  2. the Philosopher gets a `gainedAbility` Effect naming the character (stores/gainedAbility.ts). The Philosopher stays the
 *     Philosopher: actual character, alignment and what the player is shown never change.
 * Everything else is DERIVED from that record and the board, never stored (PO decisions 2026-11-21, SV3_BUILD_PROPOSAL.md
 * sections 12 and 13):
 *  - whoever truly holds the chosen character (actual character: a Drunk or Marionette who only believes they are it does not count)
 *    is drunk while the Philosopher lives and functions, with the Philosopher's official DRUNK token (rulesQuery gainedAbilityDrunk);
 *  - if nobody truly held it at the time, the Storyteller's board shows the chosen character's token on the Philosopher's seat with
 *    the official IS THE PHILOSOPHER token (the record's `shown` flag); otherwise the Philosopher keeps their token;
 *  - the gained ability wakes when that character would wake (nightOrder); it is the Storyteller's by hand in SV-3a.
 * Drunk or poisoned (or a Drunk shown the Philosopher): the choice is made, the ability is used and nothing is gained.
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 10, the Slayer's once-per-game use: an impaired choice still
 * spends the use and does nothing; Section 12, the Pit-Hag's Role seam, whose change of character ends the gained record).
 * By hand (Manual): choosing the Philosopher (the pages say nothing about gaining this ability); a character that is not a verified
 * official one (automation eligibility also refuses a character outside the reviewed list).
 */
export const PHILOSOPHER_CHARACTER = "character";

export const PHILOSOPHER: AbilityDescriptor = {
  roleId: "philosopher",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "oncePerGame" },
  inputs: [{ id: PHILOSOPHER_CHARACTER, kind: "character", source: "player", label: "The good character the Philosopher chooses" }],
  hooks: ["role"],
  presentation: { complexity: "complex", action: "Choose a good character" },
  evaluator: (context): AbilityEvaluation => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    const { query } = context;
    const chosen = answerOf(context.inputs, PHILOSOPHER_CHARACTER, "character");
    if (!chosen || chosen.roleIds.length !== 1) return { kind: "illegal", message: "Choose one good character." };
    const role = query.roleOf(chosen.roleIds[0]!);
    // "any Townsfolk icon or any Outsider icon on their character sheet": a Townsfolk or an Outsider of this script.
    if (!role || (role.type !== "townsfolk" && role.type !== "outsider")) return { kind: "illegal", message: "Choose a Townsfolk or an Outsider of this script." };
    if (role.id === context.roleId) return { kind: "unsupported", message: "The pages do not say what gaining the Philosopher's own ability does: resolve this choice by hand." };
    if (!isCanonicalRole(role)) return { kind: "unsupported", message: "A character that is not a verified official one was chosen: resolve this choice by hand." };
    const me = context.actor.player;
    const use: AbilityOperation = lifeOperation([{ kind: "useAbility", target: context.actor.binding }]);
    // A drunk or poisoned Philosopher (or a Drunk shown the Philosopher) uses the ability and gains nothing.
    if (context.simulated || !context.functioning) return outcome([use]);
    // Who truly holds the chosen character now (actual character only; the Philosopher is never its holder).
    const held = Object.values(query.game.players).some((p) => !p.isEmpty && !!p.participantId && p.id !== me.id && p.actualRole === role.id);
    const gain: AbilityOperation = { domain: "effect", intents: [{ kind: "apply", target: context.actor.binding, effect: {
      type: GAINED_ABILITY, source: context.actor.binding, sourceCharacter: context.roleId, lifetime: { kind: "manual" },
      parameters: { [GAINED_CHARACTER]: { kind: "role", roleIds: [role.id] }, ...(held ? {} : { [GAINED_SHOWN]: { kind: "boolean", value: true } }) },
    } }] };
    return outcome([use, gain], true);
  },
};
