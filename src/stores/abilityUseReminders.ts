import { isCanonicalRole } from "@/data/canonical";
import type { RoleRegistry } from "@/data/roleRegistry";
import { applyReminderPlan, planReminderTransaction, type ReminderIntent } from "./reminderResolution";
import type { ReminderRecord, STPlayerRecord, StorytellerLobbyRecord } from "./types";

const supported = (role: string) => role === "virgin" || role === "slayer";
export const abilityUseReminderId = (player: STPlayerRecord) =>
  `ability-use:${JSON.stringify([player.participantId, player.actualRole, player.packetEpoch ?? null])}`;

/** Exact generated notation ownership, never an ability-availability query. */
export const ownsAbilityUseReminder = (player: STPlayerRecord, reminder: ReminderRecord) =>
  supported(player.actualRole) && reminder.id === abilityUseReminderId(player)
  && reminder.sourceCharacter === player.actualRole && reminder.sourceParticipant?.kind === "participant"
  && reminder.sourceParticipant.participantId === player.participantId && reminder.sourceParticipant.playerId === player.id;

/** Reflect accepted Life use/reset and Role identity transitions through the
 * existing notation planner. Removed notation stays removed until a new use;
 * no reminder is read to decide whether an ability can function or be spent. */
export function planAbilityUseReminders(previous: StorytellerLobbyRecord, next: StorytellerLobbyRecord, registry?: RoleRegistry | null):
  { ok: true; game: StorytellerLobbyRecord } | { ok: false; message: string } {
  const intents: ReminderIntent[] = [];
  for (const old of Object.values(previous.players)) {
    const player = next.players[old.id];
    if (!old.participantId || !player?.participantId || player.isEmpty || player.participantId !== old.participantId) continue;
    const changedIdentity = old.actualRole !== player.actualRole || old.packetEpoch !== player.packetEpoch;
    if (changedIdentity || !player.abilityUsed) {
      const owned = player.reminders.find(reminder => ownsAbilityUseReminder(old, reminder));
      if (owned) intents.push({ kind: "remove", target: { playerId: player.id, participantId: player.participantId }, reminderId: owned.id });
    }
    const definition = registry?.get(player.actualRole);
    if (!old.abilityUsed && player.abilityUsed && supported(player.actualRole) && definition && isCanonicalRole(definition)) {
      const source = { playerId: player.id, participantId: player.participantId };
      intents.push({ kind: "place", target: source, reminder: { id: abilityUseReminderId(player), label: "No Ability", sourceCharacter: player.actualRole, source } });
    }
  }
  if (!intents.length) return { ok: true, game: next };
  const planned = planReminderTransaction(next, { intents });
  return !planned.ok ? planned : { ok: true, game: planned.changed ? applyReminderPlan(next, planned.plan) : next };
}
