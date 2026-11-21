import type { EffectRecord, RoleId, STPlayerRecord } from "./types";

/**
 * SV-3 (the Philosopher): a GAINED ability, recorded as one Effect on the player who gained it. Read from Current State only
 * (never a Reminder, never History); nothing about it is cached or derived into storage.
 *
 * The record is self-sourced (the gainer is its own source) and names, as `sourceCharacter`, the character that gained it. It
 * holds while that player is still that character: a change of character ends it (the stored record is removed by the source's
 * ability loss, and is never read once the character differs). Death and drunkenness do not end it: "If the Philosopher's ability
 * works while dead, such as the Klutz's, it works if the Philosopher is dead"; a drunk or poisoned gainer simply has no functioning
 * ability, as for any other ability. https://wiki.bloodontheclocktower.com/Philosopher
 *
 * Parameters: `character` (one role id, the ability gained) and `shown` (true when the gainer's token on the Storyteller's board was
 * swapped for the gained character because nobody truly held it at the time: "swap the Philosopher token with the chosen character
 * token and mark them with IS THE PHILOSOPHER"). `shown` is the Storyteller's board only: what the player is shown never changes.
 */
export const GAINED_ABILITY = "gainedAbility";
export const GAINED_CHARACTER = "character";
export const GAINED_SHOWN = "shown";

/** The gained-ability record that still belongs to this player, or null. With more than one (a later regain), the last one counts. */
export function gainedRecordOf(player: Pick<STPlayerRecord, "id" | "participantId" | "actualRole" | "effects" | "isEmpty"> | null | undefined): EffectRecord | null {
  if (!player || player.isEmpty || !player.participantId || !player.actualRole) return null;
  for (let index = player.effects.length - 1; index >= 0; index--) {
    const effect = player.effects[index]!;
    if (effect.type !== GAINED_ABILITY || effect.state !== "active" || effect.sourceCharacter !== player.actualRole) continue;
    const source = effect.sourceParticipant;
    if (source?.kind !== "participant" || source.participantId !== player.participantId || source.playerId !== player.id) continue;
    const character = effect.parameters?.[GAINED_CHARACTER];
    if (character?.kind !== "role" || character.roleIds.length !== 1 || !character.roleIds[0]) continue;
    return effect;
  }
  return null;
}

/** The character whose ability this player has gained, or null. */
export function gainedRoleOf(player: Parameters<typeof gainedRecordOf>[0]): RoleId | null {
  const record = gainedRecordOf(player);
  const character = record?.parameters?.[GAINED_CHARACTER];
  return character?.kind === "role" ? character.roleIds[0]! : null;
}

/** The character the Storyteller's board shows on this player's seat in place of their own token, or null (no swap). */
export function gainedTokenShownOf(player: Parameters<typeof gainedRecordOf>[0]): RoleId | null {
  const record = gainedRecordOf(player);
  const shown = record?.parameters?.[GAINED_SHOWN];
  return shown?.kind === "boolean" && shown.value ? gainedRoleOf(player) : null;
}
