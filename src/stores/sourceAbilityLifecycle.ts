import { isCanonicalRole } from "@/data/canonical";
import { applyEffectPlan, planEffectTransaction, type EffectPlan } from "./effectResolution";
import { applyReminderPlan, planReminderTransaction, type ReminderPlan } from "./reminderResolution";
import { historyId } from "./history";
import type { RulesQueryEnvironment } from "./rulesQuery";
import type { CurrentParticipantRef, ParticipantId, StorytellerLobbyRecord } from "./types";
import type { VotingModifier, VotingRound } from "./votingTypes";

/** One shared comparison for Life evidence, including ordered transitions
 * whose final alive/dead value happens to equal their starting value. */
export function invalidateVotingLifeEvidence(previous: StorytellerLobbyRecord, next: StorytellerLobbyRecord, rounds: VotingRound[]): VotingRound[] {
  const stamp = (game: StorytellerLobbyRecord, ref: CurrentParticipantRef) => {
    const seated = game.players[ref.playerId];
    const player = seated && !seated.isEmpty && seated.participantId === ref.participantId ? seated : undefined;
    return JSON.stringify([player?.alive, player?.ghostVote, player?.exiled,
      game.lifeEventWindow.events.filter(e => e.subject.participantId === ref.participantId)]);
  };
  return rounds.map(round => {
    const responses = round.responses.map(response => response.lifeSafe && stamp(previous, response.voter) !== stamp(next, response.voter)
      ? { ...response, refundSafe: false, lifeSafe: false } : response);
    return responses.some((response, i) => response !== round.responses[i]) ? { ...round, responses } : round;
  });
}

/** Ephemeral composition of existing domain plans, never persisted. */
export type SourceAbilityLossPlan = {
  effects: EffectPlan[];
  reminders: ReminderPlan[];
  removedVotingModifiers: string[];
};

/** Only explicitly linked Bureaucrat notation follows its modifier. A matching
 * label, source or artwork alone is never mechanical authority. */
export function planRemovedVotingReminders(game: StorytellerLobbyRecord, removed: readonly VotingModifier[], nextHistoryId = historyId):
  { ok: true; game: StorytellerLobbyRecord; plans: ReminderPlan[] } | { ok: false; message: string } {
  let working = game;
  const plans: ReminderPlan[] = [];
  for (const modifier of removed) {
    const target = working.players[modifier.target.playerId];
    const reminderId = `voting-${modifier.id}`;
    if (!target || target.isEmpty || target.participantId !== modifier.target.participantId || !target.reminders.some(r => r.id === reminderId)) continue;
    const result = planReminderTransaction(working, { intents: [{ kind: "remove", target: { playerId: target.id, participantId: target.participantId }, reminderId }] },
      { historyId: nextHistoryId, reminderId: () => "unused" });
    if (!result.ok) return result;
    if (result.changed) { plans.push(result.plan); working = applyReminderPlan(working, result.plan); }
  }
  return { ok: true, game: working, plans };
}

/** Official Abilities: death and changing character end these persistent
 * abilities; temporary impairment only changes derived applicability. This
 * narrow policy intentionally covers no other character or effect type.
 * https://wiki.bloodontheclocktower.com/Abilities */
export function planSourceAbilityLoss(
  game: StorytellerLobbyRecord,
  lost: ReadonlySet<ParticipantId>,
  environment: RulesQueryEnvironment | undefined,
  nextHistoryId: () => string,
  resolutionId?: string,
): { ok: true; plan: SourceAbilityLossPlan } | { ok: false; message: string } {
  let working = game;
  const effects: EffectPlan[] = [];
  for (const player of Object.values(game.players)) {
    if (player.isEmpty || !player.participantId) continue;
    for (const effect of player.effects) {
      const source = effect.sourceParticipant;
      if (source?.kind !== "participant" || !lost.has(source.participantId)) continue;
      const sourcePlayer = game.players[source.playerId];
      if (!sourcePlayer || sourcePlayer.isEmpty || sourcePlayer.participantId !== source.participantId) continue;
      // A protected-baseline save may retain an old sourced effect after an
      // earlier character change. Any new source ability transition ends that
      // residue too; requiring the current role to match would revive it when
      // the source changes back to the recorded character.
      const supported = effect.sourceCharacter === "poisoner" && effect.type === "poisoned" || effect.sourceCharacter === "monk" && effect.type === "safeFromDemon";
      const definition = effect.sourceCharacter ? environment?.registry.get(effect.sourceCharacter) : undefined;
      if (!supported || !definition || !isCanonicalRole(definition)) continue;
      const result = planEffectTransaction(working, { intents: [{ kind: "remove", target: { playerId: player.id, participantId: player.participantId }, effectId: effect.id }],
        ...(resolutionId ? { resolutionId } : {}), context: { provenance: { reason: "Source ability ended" } } },
      { historyId: nextHistoryId, effectId: () => "unused" });
      if (!result.ok) return result;
      if (result.changed) { effects.push(result.plan); working = applyEffectPlan(working, result.plan); }
    }
  }
  const removed = (game.voting?.modifiers ?? []).filter(m => lost.has(m.source.participantId));
  const reminders = planRemovedVotingReminders(working, removed, nextHistoryId);
  if (!reminders.ok) return reminders;
  return { ok: true, plan: { effects, reminders: reminders.plans, removedVotingModifiers: removed.map(m => m.id) } };
}

export function applySourceAbilityLossPlan(game: StorytellerLobbyRecord, plan?: SourceAbilityLossPlan, previous: StorytellerLobbyRecord = game): StorytellerLobbyRecord {
  if (!plan) return game;
  let next = game;
  for (const effect of plan.effects) next = applyEffectPlan(next, effect);
  for (const reminder of plan.reminders) next = applyReminderPlan(next, reminder);
  if (next.voting && plan.removedVotingModifiers.length) next = { ...next, voting: { ...next.voting,
    rounds: invalidateVotingLifeEvidence(previous, next, next.voting.rounds),
    modifiers: next.voting.modifiers.filter(m => !plan.removedVotingModifiers.includes(m.id)), revision: next.voting.revision + 1 } };
  return next;
}
