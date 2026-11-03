import { isDeathEvent } from "@/stores/lifeEvents";
import type { AbilityDescriptor } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { AbilityOperation } from "@/stores/abilityResolution";
import { ask, deathAttempt, firstParticipant, lifeOperation, nothing, outcome, tokenOutcome } from "./shared";

export const MOONCHILD_CHOICE = "moonchildChoice";

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

    // A choice made publicly during the Day (the Effect) is the Moonchild learning they died: it needs no death window,
    // and it was judged GOOD when it was made. Without one (the Night fallback) the old window and alignment checks apply.
    const pending = pendingMoonchildChoice(query, context.actor.binding);
    const target = firstParticipant(context.inputs, "target");
    const chosen = query.participant(target);
    if (!chosen?.alive) return { kind: "illegal", message: "The Moonchild chooses a player who is alive." };
    const decided = !!pending && pending.target.participantId === target.participantId;
    if (!decided) {
      const mine = (event: { subject: { participantId: string } }) => event.subject.participantId === actor.participantId;
      let died: boolean | null = true;
      const windows = [query.lifeEvents({ phase: "day", day: moment.day - 1 }, (e) => isDeathEvent(e) && mine(e)), query.lifeEvents(moment, (e) => isDeathEvent(e) && mine(e))];
      if (moment.day < 2) windows.shift();
      if (windows.every((w) => w.status === "known")) died = windows.some((w) => w.status === "known" && w.events.length > 0);
      else if (windows.some((w) => w.status === "known" && w.events.length > 0 && w.events.some((e) => e.actualRoleAtEvent === "moonchild"))) died = true;
      else died = null;
      if (died === null) return { kind: "unsupported", message: "Silverwick cannot verify when the Moonchild died -- resolve this wake manually." };
      if (!died) return { kind: "notApplicable", message: "The Moonchild did not die since the last Night: their choice was already resolved." };
      if (chosen.actualRole === "goon") return { kind: "unsupported", message: "A chosen Goon dies by the alignment they had when chosen: resolve this manually." };
      const alignment = query.registration(target, "moonchild").alignment;
      if (!alignment.known) return { kind: "unsupported", message: alignment.reason };
      if (alignment.value !== "good") return nothing();
    }
    const death = deathAttempt(context, target, "any");
    if (death.kind === "ask") return ask(death.message, death.requirement);
    // The choice is spent tonight whatever happens to it (protected, or not killed): it never lingers into another night.
    const spent: AbilityOperation[] = pending ? [{ domain: "effect", intents: [{ kind: "remove", target: pending.target, effectId: pending.effectId }] }] : [];
    if (death.kind === "survives") return spent.length ? outcome(spent) : nothing();
    return tokenOutcome(context, "moonchild", [lifeOperation([{ kind: "death", target }]), ...spent], spent.length > 0);
  },
};
