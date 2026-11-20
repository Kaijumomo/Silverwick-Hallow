import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { isDeathEvent, mayBeDeathAs } from "@/stores/lifeEvents";
import { KLUTZ_CHOICE_RULING, KLUTZ_EVIL_TEAM_LOST, KLUTZ_GOOD_TEAM_LOST } from "@/stores/gameRuleFactRegistry";
import { firstParticipant, lifeOperation, outcome } from "./shared";

/**
 * Klutz -- GUIDED Day choice (SV-1c, Sects & Violets). https://wiki.bloodontheclocktower.com/Klutz (saved revision 1758)
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 3 registration; the Slayer's Day claim path).
 *
 * "When you learn that you died, publicly choose 1 alive player: if they are evil, your team loses." "In the strange situation where the
 * Klutz is evil and chooses an evil player, then the game ends and the good team wins instead."
 * PO direction (2026-11-12): the Moonchild's Day row and "!", and the End control is flagged for the Storyteller; the row goes when the
 * Day ends, and a Klutz who has not chosen by nightfall loses the ability (no marker: the Klutz has no official reminder).
 *
 * The Storyteller taps the row, then the living player the Klutz chose (Day entry, a public claim). The choice uses the ability once
 * (`useAbility`, which closes the row; Undo reopens it) and, for a sober and healthy Klutz, records what it means as a game-rule fact
 * sourced by the Klutz (the request carries that provenance):
 *  - an evil player: KLUTZ_GOOD_TEAM_LOST (a good Klutz) or KLUTZ_EVIL_TEAM_LOST (an evil Klutz);
 *  - a player who may register either way (a Spy or Recluse), or a Klutz whose alignment is unresolved: KLUTZ_CHOICE_RULING;
 *  - a good player: nothing more.
 * A drunk or poisoned Klutz's choice is recorded (the use) and nothing is flagged (PO direction). Nothing ends the game by itself: the
 * End control carries an advisory line (endGameEligibility.ts klutzAdvisory); a proposed winner is SV-5.
 */
export const KLUTZ_TARGET = "target";

/** The dead Klutz learned they died during last night or today (an unverifiable window is the Storyteller's call: kept open). Only a
 * death AS the Klutz counts (its recorded character evidence): a player who died as another character and became the Klutz afterwards
 * (a Barber swap, the Pit-Hag) has no choice (SV-1 pairs 059, 090). A death with no evidence (recorded late) keeps the choice open
 * (mayBeDeathAs): the Storyteller decides. */
export function klutzLearnedDeath(query: RulesQuery, klutz: ParticipantBinding): boolean {
  const moment = query.moment();
  if (!moment || moment.phase !== "day") return false;
  const mine = (event: { subject: { participantId: string }; actualRoleAtEvent?: string }) =>
    event.subject.participantId === klutz.participantId && mayBeDeathAs(event, "klutz");
  return (["night", "day"] as const).some((phase) => {
    const window = query.lifeEvents({ phase, day: moment.day }, (event) => isDeathEvent(event) && mine(event));
    return window.status !== "known" || window.events.length > 0;
  });
}

/** What the recorded choice means, for the note shown after the pick. */
export type KlutzVerdict = "nothing" | "loses" | "ruling" | "impaired";

export function klutzVerdict(query: RulesQuery, klutz: ParticipantBinding, target: ParticipantBinding, functioning: boolean): { verdict: KlutzVerdict; fact?: string } {
  if (!functioning) return { verdict: "impaired" };
  const team = query.participant(klutz)?.actualAlignment;
  const chosen = query.registration(target, "klutz").alignment;
  if (!chosen.known) return { verdict: "ruling", fact: KLUTZ_CHOICE_RULING };
  if (chosen.value !== "evil") return { verdict: "nothing" };
  if (team !== "good" && team !== "evil") return { verdict: "ruling", fact: KLUTZ_CHOICE_RULING };
  return { verdict: "loses", fact: team === "good" ? KLUTZ_GOOD_TEAM_LOST : KLUTZ_EVIL_TEAM_LOST };
}

export const KLUTZ: AbilityDescriptor = {
  roleId: "klutz",
  timing: ["day"],
  invocation: "publicClaim",
  usage: { kind: "oncePerGame" },
  inputs: [{ id: KLUTZ_TARGET, kind: "participant", source: "player", constraints: ["alive"], label: "The living player the Klutz chose" }],
  hooks: ["targeting", "registration"],
  presentation: { complexity: "simple", action: "Choose the living player the Klutz publicly chose" },
  evaluator: (context): AbilityEvaluation => {
    const { query } = context;
    const me = context.actor.binding;
    const actor = query.participant(me);
    if (!actor) return { kind: "illegal", message: "The Klutz's seat changed." };
    if (actor.alive || !klutzLearnedDeath(query, me)) return { kind: "notApplicable", message: "The Klutz chooses on the Day they learn they died." };
    const target = firstParticipant(context.inputs, KLUTZ_TARGET);
    if (!query.participant(target)?.alive) return { kind: "illegal", message: "The Klutz chooses a player who is alive." };
    const use = lifeOperation([{ kind: "useAbility", target: me }]);
    if (context.simulated) return outcome([]);
    const { fact } = klutzVerdict(query, me, target, context.functioning);
    return fact ? outcome([use, { domain: "gameRuleFact", intents: [{ kind: "apply", type: fact }] }], true) : outcome([use]);
  },
};
