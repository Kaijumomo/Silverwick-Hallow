import { canonicalOrder, isCanonicalRole } from "@/data/canonical";
import { needsShownIdentity } from "@/stores/identity";
import { isDeathEvent } from "@/stores/lifeEvents";
import { nightTriggerStepKey, participantStepKey } from "@/stores/nightProgress";
import { toldRoleChangeIntents } from "@/stores/roleResolution";
import type { AbilityOperation, ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { RoleDef, STPlayerRecord } from "@/stores/types";
import type { AbilityDescriptor, AbilityEvaluation } from "../semantics";
import { nightTriggerStatus } from "../invocation";
import { CONCEALED_MODES } from "./pithag";
import { ask, followUpParticipant, nameOf, nothing, outcome, participantsOf } from "./shared";

/**
 * Barber -- GUIDED (SV-1d, Sects & Violets). https://wiki.bloodontheclocktower.com/Barber (saved revision 1757)
 * Shared rules: docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md (matrix Section 9 Night trigger; Section 12 the Pit-Hag's Role seam).
 *
 * "If you died today or tonight, the Demon may choose 2 players (not another Demon) to swap characters." "The players' alignments stay
 * the same when they swap characters. Each player learns which character they become." "The Demon may choose not to swap players."
 * "If a player becomes a new character, they gain the new ability, even if it was a 'you start knowing' ability or a 'once per game'
 * ability that the original character already used." "If there is more than one living Demon, the Storyteller chooses which Demon makes
 * the swap." "The Demon may choose themself to swap." "The Demon may not choose another Demon player to swap." "If a player dies then
 * becomes the Barber, the Demon may not swap two players' characters tonight."
 *
 * The step (`actorDiedTodayOrTonight`, so a death as the Barber, recorded with its character evidence) is a Storyteller procedure at the
 * Barber's night-order place, after the Demons: the Demon either declines (the explicit "nobody" answer) or points at two players, alive or
 * dead, itself included. The two characters swap in one Role resolution (one commit, one Undo) through the Pit-Hag's seam: actual
 * alignment kept, each player told their new character, ability use fresh. Then bookkeeping, for each swapped player:
 *  - a character whose ability works only on the first night ("you start knowing"): its step is marked for tonight, and the Night list
 *    shows it right after the Barber's (Glossary: such a character created mid-game learns "at that point");
 *  - a character whose place tonight has already passed (the Demon, the Pit-Hag, ...): that step is marked skipped, as the Imp's
 *    star-pass does for the new Imp. A character later tonight wakes as usual.
 * By hand (Manual): a Traveller or a concealed identity on either side (as for the Pit-Hag); a character that is not a verified official one.
 * Drunk or poisoned when the step runs, or no living Demon: no swap happens; the step is closed with "nobody".
 * The official HAIRCUTS TONIGHT token is derived (haircutsTonight), never stored, and drawn even when the Barber was drunk or poisoned.
 */
export const BARBER_PLAYERS = "players";
export const BARBER_DEMON = "barber:demon";
export const BARBER_NOBODY = "The Demon chooses nobody";
const CHOOSE_NOBODY = `Choose “${BARBER_NOBODY}”.`;

const livingDemons = (query: RulesQuery): STPlayerRecord[] =>
  Object.values(query.game.players).filter((p) => !p.isEmpty && !!p.participantId && p.alive && query.roleOf(p.actualRole)?.type === "demon");
const bindingOf = (p: STPlayerRecord): ParticipantBinding => ({ playerId: p.id, participantId: p.participantId! });

/** True while this dead, real Barber's swap is still owed: from a Day death until the Night step is done, or from a Night death until it
 * is. Ends at dawn (the Night trigger is no longer open). Impairment is not read: the token is drawn anyway (PO ruling for derived tokens).
 * Like the other derived tokens it follows the actual character: a Drunk shown the Barber draws nothing. */
export function haircutsTonight(query: RulesQuery, barber: ParticipantBinding, descriptor: Pick<AbilityDescriptor, "nightTrigger" | "roleId"> = BARBER): boolean {
  const player = query.participant(barber);
  const moment = query.moment();
  if (!player || player.alive || !moment || player.actualRole !== descriptor.roleId) return false;
  const role = query.roleOf(player.actualRole);
  if (!role || !isCanonicalRole(role)) return false;
  if (moment.phase === "night") return nightTriggerStatus(descriptor, barber, query).kind === "triggered";
  if (moment.phase !== "day") return false;
  const deaths = query.lifeEvents(moment, (event) => isDeathEvent(event) && event.subject.participantId === barber.participantId && event.actualRoleAtEvent === "barber");
  if (deaths.status !== "known") return false;
  return deaths.events.some((event) => {
    const status = query.game.nightProgress[`${moment.day + 1}:${nightTriggerStepKey(barber.participantId, "barber", event.id)}`]?.status;
    return status !== "done" && status !== "skipped";
  });
}

/** Whether this character's ability works only on the first night (a first-night place and no other-night place). */
const firstNightOnly = (role: RoleDef) => !!role.firstNight && !role.otherNight;

export const BARBER: AbilityDescriptor = {
  roleId: "barber",
  timing: ["triggered"],
  invocation: "procedure",
  nightTrigger: "actorDiedTodayOrTonight",
  usage: { kind: "unlimited" },
  inputs: [{ id: BARBER_PLAYERS, kind: "participant", source: "player", count: 2, allowNone: true, noneLabel: BARBER_NOBODY, constraints: ["distinct"],
    label: "The two players whose characters swap" }],
  hooks: ["role", "targeting"],
  presentation: { complexity: "complex", action: "The Demon may choose 2 players to swap characters" },
  evaluator: (context): AbilityEvaluation => {
    const { query } = context;
    if (!context.trigger) return { kind: "notApplicable", message: "The Barber's swap happens only on the night the Barber died, or after a Day death." };
    const chosen = participantsOf(context.inputs, BARBER_PLAYERS) ?? [];
    // "The Demon may choose not to swap players."
    if (chosen.length === 0) return nothing();
    if (chosen.length !== 2) return { kind: "illegal", message: `Choose two players. ${CHOOSE_NOBODY}` };
    if (context.simulated || !context.functioning) {
      return { kind: "illegal", message: `${nameOf(context, context.actor.binding)} is drunk or poisoned: no swap happens. ${CHOOSE_NOBODY}` };
    }
    const demons = livingDemons(query);
    if (!demons.length) return { kind: "illegal", message: `There is no living Demon: no swap happens. ${CHOOSE_NOBODY}` };
    let demon = demons[0]!;
    if (demons.length > 1) {
      // "If there is more than one living Demon, the Storyteller chooses which Demon makes the swap."
      const answer = followUpParticipant(context, context.inputs, BARBER_DEMON);
      if (!answer) return ask("There is more than one living Demon: choose which Demon makes the swap.",
        { id: BARBER_DEMON, kind: "participant", source: "storyteller", label: "The Demon who makes the swap" });
      if ("refusal" in answer) return answer.refusal;
      const picked = demons.find((d) => d.participantId === answer.binding.participantId);
      if (!picked) return { kind: "illegal", message: "Choose a living Demon to make the swap." };
      demon = picked;
    }
    const players = chosen.map((binding) => query.participant(binding));
    if (players.some((p) => !p)) return { kind: "stale", message: "A chosen seat changed." };
    const [a, b] = players as [STPlayerRecord, STPlayerRecord];
    // "The Demon may not choose another Demon player to swap."
    if ([a, b].some((p) => p.participantId !== demon.participantId && query.roleOf(p.actualRole)?.type === "demon")) {
      return { kind: "illegal", message: "The Demon may not choose another Demon." };
    }
    if (a.isTraveler || b.isTraveler) return { kind: "unsupported", message: "A Traveller is one of the two: swap their characters by hand." };
    if ([a, b].some((p) => p.shownRole !== p.actualRole || needsShownIdentity(p.actualRole) || CONCEALED_MODES.includes(p.behaviorMode))) {
      return { kind: "unsupported", message: "A concealed identity is involved: what these players are shown is not modeled. Swap their characters by hand." };
    }
    const roleA = query.roleOf(a.actualRole), roleB = query.roleOf(b.actualRole);
    if (!roleA || !roleB || !isCanonicalRole(roleA) || !isCanonicalRole(roleB)) {
      return { kind: "unsupported", message: "A character that is not a verified official one is involved: swap them by hand." };
    }
    if (roleA.id === roleB.id) return nothing(); // the same character: nothing changes
    // Each player keeps their ACTUAL alignment; the Shown alignment follows the new character's default unless that would misstate it.
    const told = (player: STPlayerRecord, role: RoleDef) => {
      const defaultAlignment = role.type === "townsfolk" || role.type === "outsider" ? "good" : "evil";
      const shownAlignment = player.shownAlignment === null && player.actualAlignment && player.actualAlignment !== defaultAlignment ? player.actualAlignment : player.shownAlignment;
      return toldRoleChangeIntents(player, role.id, shownAlignment);
    };
    const operations: AbilityOperation[] = [{ domain: "role", intents: [...told(a, roleB), ...told(b, roleA)] }];
    const barberAt = canonicalOrder("barber", false) ?? 0;
    for (const [player, role] of [[a, roleB], [b, roleA]] as const) {
      const stepKey = participantStepKey(player.participantId!, role.id);
      if (player.alive && firstNightOnly(role)) operations.push({ domain: "nightStep", day: query.game.day, stepKey, status: "pending" });
      else if ((canonicalOrder(role.id, false) ?? Infinity) < barberAt) operations.push({ domain: "nightStep", day: query.game.day, stepKey, status: "skipped" });
    }
    return outcome(operations);
  },
};

export const barberDemonsOf = (query: RulesQuery): ParticipantBinding[] => livingDemons(query).map(bindingOf);
