import { historyId } from "./history";
import { applyReminderPlan, planReminderTransaction, type ReminderIntent, type ReminderPlan } from "./reminderResolution";
import type { ParticipantId, ReminderRecord, StorytellerLobbyRecord } from "./types";

/** Leaf ownership/lifecycle bookkeeping. It deliberately imports no ability
 * semantics, RulesQuery or character coordinator: Life and Role use it while
 * those higher-level modules are still initializing. No gameplay rule reads
 * a Master reminder; only its exact generated identity is managed here. */
const PREFIX = "butler-master:";
const refuse = (message: string): { ok: false; message: string } => ({ ok: false, message });
export const butlerReminderId = (participantId: ParticipantId, epoch: string): string => PREFIX + JSON.stringify([participantId, epoch]);

/** Recognize only this command's exact generated identity and origin. The
 * token's label/artwork never establishes a selection or a gameplay rule. */
export function butlerReminderOrigin(reminder: ReminderRecord): { participantId: ParticipantId; epoch: string } | null {
  if (!reminder.id.startsWith(PREFIX) || reminder.sourceCharacter !== "butler" || reminder.sourceParticipant?.kind !== "participant") return null;
  try {
    const parts: unknown = JSON.parse(reminder.id.slice(PREFIX.length));
    if (!Array.isArray(parts) || parts.length !== 2 || typeof parts[0] !== "string" || typeof parts[1] !== "string" || !parts[1] ||
      parts[0] !== reminder.sourceParticipant.participantId || reminder.id !== butlerReminderId(parts[0], parts[1])) return null;
    return { participantId: parts[0], epoch: parts[1] };
  } catch { return null; }
}

/** Life/Role compose this with their own plans, including death followed by
 * resurrection in one transaction. Only exact generated notation is removed. */
export function planButlerReminderCleanup(game: StorytellerLobbyRecord, lost: ReadonlySet<ParticipantId>, nextHistoryId = historyId, resolutionId?: string):
  { ok: true; game: StorytellerLobbyRecord; plans: ReminderPlan[] } | { ok: false; message: string } {
  const intents: ReminderIntent[] = [];
  for (const player of Object.values(game.players)) {
    if (player.isEmpty || !player.participantId) continue;
    for (const reminder of player.reminders) {
      const origin = butlerReminderOrigin(reminder);
      if (origin && lost.has(origin.participantId)) intents.push({ kind: "remove", target: { playerId: player.id, participantId: player.participantId }, reminderId: reminder.id });
    }
  }
  if (!intents.length) return { ok: true, game, plans: [] };
  const result = planReminderTransaction(game, { intents, ...(resolutionId ? { resolutionId } : {}) }, { historyId: nextHistoryId, reminderId: () => "unused" });
  if (!result.ok) return refuse(result.message);
  return result.changed ? { ok: true, game: applyReminderPlan(game, result.plan), plans: [result.plan] } : { ok: true, game, plans: [] };
}

/** Membership/identity reconciliation uses only generated notation ownership.
 * Impairment and target death never erase the recorded choice. */
export function reconcileButlerReminders(game: StorytellerLobbyRecord): StorytellerLobbyRecord {
  if (game.phase === "ended") return game;
  const intents: ReminderIntent[] = [];
  for (const player of Object.values(game.players)) for (const reminder of player.reminders) {
    if (player.isEmpty || !player.participantId) continue;
    const origin = butlerReminderOrigin(reminder);
    if (!origin || reminder.sourceParticipant?.kind !== "participant") continue;
    const seated = game.players[reminder.sourceParticipant.playerId];
    const source = seated && !seated.isEmpty && seated.participantId === reminder.sourceParticipant.participantId ? seated : undefined;
    const expired = game.phase === "setup" || reminder.createdAt?.phase === "night" && reminder.createdAt.day < game.day;
    if (expired || !source || !source.alive || source.actualRole !== "butler" || source.packetEpoch !== origin.epoch) {
      intents.push({ kind: "remove", target: { playerId: player.id, participantId: player.participantId }, reminderId: reminder.id });
    }
  }
  if (!intents.length) return game;
  const result = planReminderTransaction(game, { intents });
  return result.ok && result.changed ? applyReminderPlan(game, result.plan) : game;
}
