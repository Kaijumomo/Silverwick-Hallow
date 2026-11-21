import type { AbilityOperation } from "@/stores/abilityResolution";
import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import { answerOf, firstParticipant, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Cerenovus -- GUIDED (SV-4a, Sects & Violets). https://wiki.bloodontheclocktower.com/Cerenovus (saved revision 3048)
 * Shared rules: the Witch's persistence (docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md Section 1); the States page's Madness section.
 *
 * "Each night, choose a player & a good character: they are 'mad' that they are this character tomorrow, or might be executed."
 * How to Run: "They point at any player and at any Townsfolk or Outsider icon on their character sheet. ... Mark the chosen player with
 * the MAD reminder. Wake this player, show them the THIS CHARACTER SELECTED YOU info token, then the Cerenovus token, then the
 * character token of the character they are mad about being."
 *
 * One night step, every night including the first. The player is tapped on the board (a dead player may be chosen: "Your ability can
 * also affect dead players"), then the character is picked from the board's character picker (a Townsfolk or an Outsider of the
 * script). A functioning Cerenovus records ONE sourced `mad` Effect on the chosen player, with the character as its `character`
 * parameter, in one resolution (one Undo). A MAD this Cerenovus placed on the same player earlier is replaced (a new pick, a new
 * character); MAD on other players stays until its own end.
 *  - Lifetime `nights: 2`: placed on Night N, it ends on entry to Day N+1 -- "the dawn after the following night" (PO 2026-11-12).
 *  - `whileSourceFunctions` (PO Q3, 2026-11-21): it applies only while the Cerenovus functions (derived live, nothing rewritten), as
 *    the Witch's curse does. A Cerenovus the Vigormortis killed still functions, so its MAD keeps applying.
 *  - Drunk or poisoned (or a Drunk shown the Cerenovus): "no ability, but acts as if sober". The choice is made and the player is
 *    woken as usual, but no MAD is recorded (the Witch's pattern: it chooses but curses no one).
 * The app never decides whether the mad player tried: executing them is the Storyteller's judgment through the seat's own menu (SV-4b).
 * A Goblin jinx and the like stay the Storyteller's judgment as every jinx does.
 */
export const CERENOVUS_TARGET = "target";
export const CERENOVUS_CHARACTER = "character";
export const MAD_EFFECT = "mad";
/** The Effect parameter that carries the character the player is mad about being. */
export const MAD_CHARACTER_PARAMETER = "character";

export const CERENOVUS: AbilityDescriptor = {
  roleId: "cerenovus",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [
    { id: CERENOVUS_TARGET, kind: "participant", source: "player", label: "The player who goes mad" },
    { id: CERENOVUS_CHARACTER, kind: "character", source: "player", label: "The Townsfolk or Outsider they are mad about being" },
  ],
  hooks: ["targeting"],
  sourcedEffects: [{ type: MAD_EFFECT, persistence: "whileSourceFunctions" }],
  presentation: { complexity: "complex", action: "Choose a player" },
  evaluator: (context): AbilityEvaluation => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    const { query } = context;
    const target = firstParticipant(context.inputs, CERENOVUS_TARGET);
    const chosen = answerOf(context.inputs, CERENOVUS_CHARACTER, "character");
    if (!chosen || chosen.roleIds.length !== 1) return { kind: "illegal", message: "Choose one character." };
    const role = query.roleOf(chosen.roleIds[0]!);
    // "any Townsfolk or Outsider icon on their character sheet".
    if (!role || (role.type !== "townsfolk" && role.type !== "outsider")) return { kind: "illegal", message: "Choose a Townsfolk or an Outsider of this script." };
    const picked = query.participant(target);
    if (!picked) return { kind: "stale", message: "The chosen player is no longer in that seat." };
    // "no ability, but acts as if sober": the choice is made, the player is woken, and nobody goes mad.
    if (context.simulated || !context.functioning) return nothing();
    const me = context.actor.binding;
    // The same Cerenovus's earlier MAD on this player is replaced by the new pick.
    const earlier = picked.effects.filter((effect) => effect.type === MAD_EFFECT && effect.state === "active" && effect.sourceCharacter === "cerenovus"
      && effect.sourceParticipant?.kind === "participant" && effect.sourceParticipant.participantId === me.participantId);
    const operation: AbilityOperation = { domain: "effect", intents: [
      ...earlier.map((effect) => ({ kind: "remove" as const, target, effectId: effect.id })),
      { kind: "apply", target, effect: {
        type: MAD_EFFECT, source: me, sourceCharacter: "cerenovus", lifetime: { kind: "nights", count: 2 },
        parameters: { [MAD_CHARACTER_PARAMETER]: { kind: "role", roleIds: [role.id] } },
      } },
    ] };
    return outcome([operation]);
  },
};
