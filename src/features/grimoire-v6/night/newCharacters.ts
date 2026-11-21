import { participantStepKey } from "@/stores/nightProgress";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

/**
 * PO review 2026-11-21 (SV-2c): the players a Snake Charmer swap or a Fang Gu jump changed tonight, to be woken and shown
 * YOU ARE, their new character and their alignment (wiki How to Run:
 * https://wiki.bloodontheclocktower.com/Snake_Charmer, https://wiki.bloodontheclocktower.com/Fang_Gu).
 * Read from Current State and tonight's History, so nothing is stored, a reload keeps it and Undo removes it:
 *  - the player who was given this character tonight and whose own step for it tonight was marked skipped (the new Snake Charmer,
 *    the new Fang Gu: the swap and the jump mark exactly that step);
 *  - every other character change of that same resolution (the Snake Charmer who became the Demon).
 * A player is listed only while alive and still holding the character they were given.
 */
export function charactersToReveal(game: StorytellerLobbyRecord, roleId: "snakecharmer" | "fanggu", gainer?: { participantId: string }): STPlayerRecord[] {
  if (game.phase !== "night") return [];
  type RoleRecord = { participantId: string; to?: string; resolutionId?: string };
  const tonight: RoleRecord[] = [];
  for (const record of game.history) {
    if (record.category !== "role" || ("correction" in record && record.correction) || record.moment?.phase !== "night" || record.moment.day !== game.day) continue;
    const participant = record.participant;
    if (!participant || participant.kind !== "participant" || record.change?.kind !== "value") continue;
    tonight.push({ participantId: participant.participantId, to: (record.change.to as { actualRole?: string }).actualRole, resolutionId: record.resolutionId });
  }
  const toRole = (record: RoleRecord) => record.to;
  const participantOf = (record: RoleRecord) => record.participantId;
  // SV-3b: on the row of a gained Snake Charmer, the swap is the gainer's own change of character tonight (the old Demon is given the
  // Philosopher, not the Snake Charmer).
  const converted = gainer ? tonight.filter((record) => participantOf(record) === gainer.participantId && !!record.resolutionId)
    : tonight.filter((record) => toRole(record) === roleId
      && game.nightProgress?.[`${game.day}:${participantStepKey(participantOf(record), roleId)}`]?.status === "skipped");
  const resolutions = new Set(converted.map((record) => record.resolutionId).filter((id): id is string => !!id));
  const records = [...converted, ...tonight.filter((record) => !converted.includes(record) && !!record.resolutionId && resolutions.has(record.resolutionId))];
  const out: STPlayerRecord[] = [];
  for (const record of records) {
    const player = Object.values(game.players).find((p) => p.participantId === participantOf(record));
    if (!player || !player.alive || player.actualRole !== toRole(record) || out.includes(player)) continue;
    out.push(player);
  }
  // The new Demon first, as the wiki wakes them (Snake Charmer); the new Fang Gu is alone.
  return out.sort((a, b) => Number(a.actualRole === roleId) - Number(b.actualRole === roleId));
}
