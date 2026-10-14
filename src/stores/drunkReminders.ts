import { isCanonicalRole } from "@/data/canonical";
import type { RoleRegistry } from "@/data/roleRegistry";
import { applyReminderPlan, planReminderTransaction, type ReminderIntent } from "./reminderResolution";
import type { ReminderRecord, STPlayerRecord, StorytellerLobbyRecord } from "./types";

export const DRUNK_REMINDER_LABEL = "Is The Drunk";
const PREFIX = "drunk-identity:";
const reminderId = (participantId: string) => PREFIX + JSON.stringify([participantId]);

/** Generated notation ownership, never a source of actual identity or impairment. */
export function ownsDrunkReminder(player: STPlayerRecord, reminder: ReminderRecord): boolean {
  return !!player.participantId && reminder.id === reminderId(player.participantId)
    && reminder.sourceCharacter === "drunk" && reminder.sourceParticipant?.kind === "participant"
    && reminder.sourceParticipant.playerId === player.id && reminder.sourceParticipant.participantId === player.participantId;
}

function isPreparedDrunk(player: STPlayerRecord, registry?: RoleRegistry | null): boolean {
  const role = registry?.get(player.actualRole);
  return !player.isEmpty && !!player.participantId && player.actualRole === "drunk"
    && !!role && isCanonicalRole(role) && !!player.shownRole && registry?.get(player.shownRole)?.type === "townsfolk";
}

type Result = { ok: true; game: StorytellerLobbyRecord } | { ok: false; message: string };
const apply = (game: StorytellerLobbyRecord, intents: ReminderIntent[]): Result => {
  if (!intents.length) return { ok: true, game };
  const result = planReminderTransaction(game, { intents });
  return !result.ok ? result : { ok: true, game: result.changed ? applyReminderPlan(game, result.plan) : game };
};

/** Create notation only on an accepted preparation/identity transition. Missing
 * notation on an unchanged identity may have been deliberately removed; loads,
 * Undo and unrelated commands must never invent it. An existing official note
 * is sufficient and retains its original ownership. */
export function planDrunkPreparationReminders(previous: StorytellerLobbyRecord, next: StorytellerLobbyRecord, registry?: RoleRegistry | null): Result {
  const intents: ReminderIntent[] = [];
  for (const player of Object.values(next.players)) {
    const old = previous.players[player.id];
    if (!old || old.participantId !== player.participantId || !isPreparedDrunk(player, registry)) continue;
    if (old.actualRole === player.actualRole && old.shownRole === player.shownRole) continue;
    if (player.reminders.some(note => ownsDrunkReminder(player, note)
      || note.sourceCharacter === "drunk" && note.label === DRUNK_REMINDER_LABEL)) continue;
    const target = { playerId: player.id, participantId: player.participantId! };
    intents.push({ kind: "place", target, reminder: {
      id: reminderId(player.participantId!), label: DRUNK_REMINDER_LABEL, sourceCharacter: "drunk", source: target,
    } });
  }
  return apply(next, intents);
}

/** Setup reassignment has its own writer. Reconcile only exact generated
 * records that no longer describe their owner, preserving manual notes and
 * snapshots where the Storyteller intentionally removed the official token. */
export function reconcileDrunkReminders(game: StorytellerLobbyRecord, registry?: RoleRegistry | null): StorytellerLobbyRecord {
  if (game.phase === "ended") return game;
  const intents: ReminderIntent[] = [];
  for (const player of Object.values(game.players)) {
    if (player.isEmpty || !player.participantId || isPreparedDrunk(player, registry)) continue;
    for (const note of player.reminders) {
      if (!ownsDrunkReminder(player, note)) continue;
      intents.push({ kind: "remove", target: { playerId: player.id, participantId: player.participantId }, reminderId: note.id });
    }
  }
  const result = apply(game, intents);
  return result.ok ? result.game : game;
}
