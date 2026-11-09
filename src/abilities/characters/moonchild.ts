import type { AbilityDescriptor } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { AbilityOperation } from "@/stores/abilityResolution";
import { ask, deathAttempt, firstParticipant, lifeOperation, nothing, outcome, tokenOutcome } from "./shared";

export const MOONCHILD_CHOICE = "moonchildChoice";
/** A choice the Storyteller recorded for an EVIL player: nothing happens, so it draws no token, but it is kept in the game (Undo reverses it)
 * so the Day does not offer the same Moonchild a second choice. Ends at dawn like the good choice. */
export const MOONCHILD_UNAFFECTED = "moonchildUnaffected";

/** True once this Moonchild's public choice for the Day is recorded, whichever way it went (a good player, or an evil one that changes nothing). */
export function moonchildHasChosen(query: RulesQuery, moonchild: ParticipantBinding): boolean {
  if (pendingMoonchildChoice(query, moonchild)) return true;
  const holders = query.factHolders(MOONCHILD_UNAFFECTED);
  if (!holders.known) return false;
  return holders.value.some(({ holder, effectId }) => {
    const effect = query.participant(holder)?.effects.find((candidate) => candidate.id === effectId);
    return effect?.sourceParticipant?.kind === "participant" && effect.sourceParticipant.participantId === moonchild.participantId;
  });
}

/** The player this Moonchild publicly chose during the Day (authoritative `moonchildChoice` Effect), with its Effect id. */
export function pendingMoonchildChoice(query: RulesQuery, moonchild: ParticipantBinding): { target: ParticipantBinding; effectId: string } | null {
  const holders = query.factHolders(MOONCHILD_CHOICE);
  if (!holders.known) return null;
  for (const { holder, effectId } of holders.value) {
    const effect = query.participant(holder)?.effects.find((candidate) => candidate.id === effectId);
    if (effect?.sourceParticipant?.kind === "participant" && effect.sourceParticipant.participantId === moonchild.participantId) return { target: holder, effectId };
  }
  return null;
}

/**
 * Moonchild -- GUIDED-PARTIAL (Treacherous 30th, owner-authorized; shared protection
 * rules of docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md, matrix Section 3).
 * https://wiki.bloodontheclocktower.com/Moonchild
 *
 * "When you learn that you died, publicly choose 1 alive player. Tonight, if it was a
 * good player, they die."
 *
 * Resolved on the Night after the Moonchild died (the Day just ended or this Night). The
 * Moonchild is dead -- this ability is one of the few that work while dead. The chosen
 * player is entered here; the death follows only if they registered as GOOD. An evil
 * player is unharmed. Per the wiki the Moonchild's state TONIGHT decides: an impaired
 * Moonchild's choice kills no one.
 *  - the death must be recorded in the Life Event Window (Day just ended / tonight);
 *    a known absence ends the wake, an unverifiable window keeps the action Manual.
 *  - the kill is a non-Demon death (protection for "any"): Innkeeper / Tea Lady /
 *    Sailor-style protection is honoured through the shared rule.
 *  - NOT modeled: a chosen Goon (alignment at the time of choosing decides), an ambiguous
 *    registration -> Manual.
 */
export const MOONCHILD: AbilityDescriptor = {
  roleId: "moonchild",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", constraints: ["alive"], label: "The living player the Moonchild chose" }],
  hooks: ["targeting", "death", "registration"],
  presentation: { complexity: "complex", action: "Enter the living player the Moonchild chose" },
  evaluator: (context) => {
    const { query } = context;
    const actor = query.participant(context.actor.binding);
    if (!actor) return { kind: "illegal", message: "The Moonchild's seat changed." };
    if (actor.alive) return { kind: "notApplicable", message: "The Moonchild is alive: the ability works only after they learn they died." };
    if (context.simulated || !context.functioning) return nothing();
    const moment = query.moment();
    if (!moment || moment.phase !== "night") return { kind: "notApplicable", message: "The Moonchild's choice resolves at Night." };

    // The Moonchild chooses publicly, in the Day, right after learning they died; the Storyteller records it then (the Effect). The only thing the
    // Moonchild does at Night is that choice killing a good player, so without a recorded good choice there is nothing to wake for.
    const pending = pendingMoonchildChoice(query, context.actor.binding);
    if (!pending) return { kind: "notApplicable", message: "The Moonchild chose no good player: nobody dies tonight." };
    const target = firstParticipant(context.inputs, "target");
    const chosen = query.participant(target);
    if (!chosen?.alive) return { kind: "illegal", message: "The Moonchild chooses a player who is alive." };
    if (pending.target.participantId !== target.participantId) return { kind: "illegal", message: "Tonight's death is the player the Moonchild publicly chose." };
    const death = deathAttempt(context, target, "any");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    // The choice is spent tonight whatever happens to it (protected, or not killed): it never lingers into another night.
    const spent: AbilityOperation[] = [{ domain: "effect", intents: [{ kind: "remove", target: pending.target, effectId: pending.effectId }] }];
    if (death.kind === "survives") return outcome(spent);
    return tokenOutcome(context, "moonchild", [lifeOperation([{ kind: "death", target }]), ...spent], true);
  },
};
