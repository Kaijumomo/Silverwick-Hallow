import { isCanonicalRole } from "@/data/canonical";
import type { RoleRegistry } from "@/data/roleRegistry";
import { applyReminderPlan, planReminderTransaction, type ReminderIntent } from "./reminderResolution";
import type { ReminderRecord, STPlayerRecord, StorytellerLobbyRecord } from "./types";

export const DRUNK_REMINDER_LABEL = "Is The Drunk";
export const MARIONETTE_REMINDER_LABEL = "Is The Marionette";

/**
 * The official "Is The ..." note a concealed identity carries: the Drunk, and the Marionette (who is shown as a good character
 * the Storyteller picks). Placed once, when that identity is prepared; never a source of actual identity or impairment.
 */
const IDENTITY_NOTES = [
  { role: "drunk", label: DRUNK_REMINDER_LABEL, prefix: "drunk-identity:", shown: ["townsfolk"] },
  { role: "marionette", label: MARIONETTE_REMINDER_LABEL, prefix: "marionette-identity:", shown: ["townsfolk", "outsider"] },
] as const;
type IdentityNote = (typeof IDENTITY_NOTES)[number];
const reminderId = (note: IdentityNote, participantId: string) => note.prefix + JSON.stringify([participantId]);

const owns = (note: IdentityNote, player: STPlayerRecord, reminder: ReminderRecord): boolean =>
  !!player.participantId && reminder.id === reminderId(note, player.participantId)
    && reminder.sourceCharacter === note.role && reminder.sourceParticipant?.kind === "participant"
    && reminder.sourceParticipant.playerId === player.id && reminder.sourceParticipant.participantId === player.participantId;

/** Generated notation ownership, never a source of actual identity or impairment. */
export function ownsDrunkReminder(player: STPlayerRecord, reminder: ReminderRecord): boolean {
  return owns(IDENTITY_NOTES[0], player, reminder);
}
export function ownsMarionetteReminder(player: STPlayerRecord, reminder: ReminderRecord): boolean {
  return owns(IDENTITY_NOTES[1], player, reminder);
}

function isPrepared(note: IdentityNote, player: STPlayerRecord, registry?: RoleRegistry | null): boolean {
  const role = registry?.get(player.actualRole);
  const shown = player.shownRole ? registry?.get(player.shownRole)?.type : undefined;
  return !player.isEmpty && !!player.participantId && player.actualRole === note.role
    && !!role && isCanonicalRole(role) && !!shown && (note.shown as readonly string[]).includes(shown);
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
    if (!old || old.participantId !== player.participantId) continue;
    for (const note of IDENTITY_NOTES) {
      if (!isPrepared(note, player, registry)) continue;
      if (old.actualRole === player.actualRole && old.shownRole === player.shownRole) continue;
      if (player.reminders.some(existing => owns(note, player, existing)
        || existing.sourceCharacter === note.role && existing.label === note.label)) continue;
      const target = { playerId: player.id, participantId: player.participantId! };
      intents.push({ kind: "place", target, reminder: {
        id: reminderId(note, player.participantId!), label: note.label, sourceCharacter: note.role, source: target,
      } });
    }
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
    if (player.isEmpty || !player.participantId) continue;
    for (const note of IDENTITY_NOTES) {
      if (isPrepared(note, player, registry)) continue;
      for (const existing of player.reminders) {
        if (!owns(note, player, existing)) continue;
        intents.push({ kind: "remove", target: { playerId: player.id, participantId: player.participantId }, reminderId: existing.id });
      }
    }
  }
  const result = apply(game, intents);
  return result.ok ? result.game : game;
}
