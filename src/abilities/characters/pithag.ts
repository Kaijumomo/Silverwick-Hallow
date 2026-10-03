import { isCanonicalRole } from "@/data/canonical";
import { needsShownIdentity } from "@/stores/identity";
import { toldRoleChangeIntents } from "@/stores/roleResolution";
import type { AbilityDescriptor } from "../semantics";
import { answerOf, firstParticipant, nothing, outcome, requireLivingActor } from "./shared";

/**
 * Pit-Hag -- GUIDED-PARTIAL. docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md
 * Section 12.
 *
 * "Each night*, choose a player & a character they become (if not in play).
 * If a Demon is made, deaths tonight are arbitrary."
 *  - the character is already in play (someone's Actual Role, alive or dead)
 *    -> nothing happens mechanically;
 *  - not in play and not a Demon -> GUIDED: the target's Actual Role changes
 *    through the Role seam (which preserves Actual Alignment and resets ability
 *    use per its frozen contract), and the target is told the new character
 *    (perception). The new character's square-bracket Setup text never runs;
 *    no extra wake is invented (the re-derived Night Order shows any row the
 *    new character has).
 *  - a Demon would be made -> VERIFIED-MANUAL: the WHOLE resolution goes to
 *    Manual (no partial Role change), because "deaths tonight are arbitrary"
 *    needs 10G's game-level Night state.
 *  - Traveller target or destination (an optional rule), a non-canonical
 *    destination, or a concealed identity on either side -> Manual.
 *  - impaired / simulated: the choices are simulated; nothing changes.
 */
const CONCEALED_MODES = ["drunk_fake_role_behavior", "marionette_fake_good_behavior", "fake_demon_behavior"];

export const PIT_HAG: AbilityDescriptor = {
  roleId: "pithag",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [
    { id: "target", kind: "participant", source: "player", label: "The player to change" },
    { id: "character", kind: "character", source: "player", label: "The character they become" },
  ],
  hooks: ["role", "death", "targeting"],
  presentation: { complexity: "complex", action: "Choose a player and a character" },
  evaluator: (context) => {
    const dead = requireLivingActor(context);
    if (dead) return dead;
    const chosen = answerOf(context.inputs, "character", "character");
    if (!chosen || chosen.roleIds.length !== 1 || typeof chosen.roleIds[0] !== "string") return { kind: "illegal", message: "Choose exactly one character." };
    if (context.simulated || !context.functioning) return nothing();
    const roleId = chosen.roleIds[0];
    const destination = context.query.roleOf(roleId);
    if (!destination) return { kind: "illegal", message: "That is not a character on this script." };
    if (context.query.inPlay(roleId).length > 0) return nothing(); // already in play: nothing happens
    if (destination.type === "demon") {
      return { kind: "unsupported", message: "A Demon would be made: \"deaths tonight are arbitrary\" needs game-level Night state Silverwick does not hold until Phase 10G. Resolve the whole Pit-Hag action manually." };
    }
    if (destination.type === "traveler" || destination.type === "fabled" || destination.type === "loric") {
      return { kind: "unsupported", message: "Turning a player into a Traveller (an optional rule) or a non-character is not automated -- resolve manually." };
    }
    if (!isCanonicalRole(destination)) return { kind: "unsupported", message: `${destination.name} is not a verified official character -- resolve manually.` };
    const target = context.query.participant(firstParticipant(context.inputs, "target"))!;
    if (target.isTraveler) return { kind: "unsupported", message: "Transforming a Traveller is an optional rule -- resolve manually." };
    if (target.shownRole !== target.actualRole || needsShownIdentity(target.actualRole) || CONCEALED_MODES.includes(target.behaviorMode) || needsShownIdentity(roleId)) {
      return { kind: "unsupported", message: "A concealed identity is involved: what this player is shown is not modeled -- resolve manually." };
    }
    // Normal player-facing alignment derives from the Shown Role; keep the
    // player's ACTUAL alignment when the new character's default differs.
    const defaultAlignment = destination.type === "townsfolk" || destination.type === "outsider" ? "good" : "evil";
    const shownAlignment = target.shownAlignment === null && target.actualAlignment && target.actualAlignment !== defaultAlignment
      ? target.actualAlignment : target.shownAlignment;
    return outcome([{ domain: "role", intents: toldRoleChangeIntents(target, roleId, shownAlignment) }]);
  },
};
