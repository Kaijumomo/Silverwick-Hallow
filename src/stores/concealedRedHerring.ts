import type { ParticipantBinding } from "./abilityResolution";
import { newReminderId, type ReminderIntent } from "./reminderResolution";
import type { StorytellerLobbyRecord } from "./types";

/**
 * A Drunk or Marionette shown the Fortune Teller has no Red Herring fact (the simulated wake asks the Storyteller for the answer).
 * The Storyteller may still keep a plain reminder token, the official "Red Herring" notation, on a player of their choosing.
 * It is notation only: written through the Reminder seam, linked to its holder by the exact source participant, and never read
 * by any rule, so a real Fortune Teller's Red Herring fact and the answer given are untouched.
 */
const isHerring = (reminder: { sourceCharacter?: string; label: string; sourceParticipant?: { kind: string; participantId?: string } }, ownerParticipantId: string) =>
  reminder.sourceCharacter === "fortuneteller" && reminder.label === "Red Herring" &&
  reminder.sourceParticipant?.kind === "participant" && reminder.sourceParticipant.participantId === ownerParticipantId;

/** The player carrying this owner's reminder-only Red Herring, if one was placed. */
export function concealedRedHerringHolder(game: StorytellerLobbyRecord, ownerParticipantId: string) {
  return Object.values(game.players).find(player => !player.isEmpty && player.reminders.some(reminder => isHerring(reminder, ownerParticipantId)));
}

/** Moves the token: removes this owner's earlier one and places a new one on `target`. */
export function concealedRedHerringIntents(game: StorytellerLobbyRecord, owner: ParticipantBinding, target: ParticipantBinding): ReminderIntent[] {
  const intents: ReminderIntent[] = [];
  for (const player of Object.values(game.players)) {
    if (player.isEmpty || !player.participantId) continue;
    for (const reminder of player.reminders) if (isHerring(reminder, owner.participantId))
      intents.push({ kind: "remove", target: { playerId: player.id, participantId: player.participantId }, reminderId: reminder.id });
  }
  intents.push({ kind: "place", target: { playerId: target.playerId, participantId: target.participantId },
    reminder: { id: newReminderId(), label: "Red Herring", source: owner, sourceCharacter: "fortuneteller" } });
  return intents;
}
