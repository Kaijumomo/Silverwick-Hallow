import { isCanonicalRole } from "@/data/canonical";
import type { EffectRecord, RoleDef, STPlayerRecord } from "@/stores/types";

/** PHASE10F_CHARACTER_RULES_MATRIX.md Section 4, B9 self-target amendment.
 * A canonical Poisoner may poison themself. That poison cannot cancel
 * itself recursively, but outside impairment / ability loss still applies.
 * Bounded inference from the official Poisoner (any player, until dusk),
 * Widow (self-poison suppresses its ability) and Abilities lifecycle rules:
 * https://wiki.bloodontheclocktower.com/Poisoner
 * https://wiki.bloodontheclocktower.com/Widow
 * https://wiki.bloodontheclocktower.com/Abilities
 * This recognizes only the exact participant's own canonical poison. It
 * grants no policy to other characters or multi-source dependency cycles.
 */
export function isPoisonerSelfEffect(holder: STPlayerRecord, effect: EffectRecord, sourceRole: RoleDef | undefined): boolean {
  const source = effect.sourceParticipant;
  return effect.sourceCharacter === "poisoner" && effect.type === "poisoned"
    && source?.kind === "participant" && source.playerId === holder.id && source.participantId === holder.participantId
    && !!sourceRole && sourceRole.id === "poisoner" && isCanonicalRole(sourceRole);
}

/** Treacherous 30th: an Innkeeper may choose themself and the Storyteller may make
 * them the drunk one. Official ruling (Innkeeper, Examples): "The Innkeeper protects
 * themself and the Pacifist. The Storyteller chooses that the Innkeeper becomes drunk.
 * The Pacifist is attacked by the Demon tonight and dies." The drunkenness therefore
 * applies even though its own source is the drunk one, and (through the normal
 * whileSourceFunctions rule) voids BOTH protections. Like the Poisoner exception this
 * is only a query overlay for the exact participant's own canonical Innkeeper drunk
 * Effect; it never rewrites stored state or solves other source cycles.
 * https://wiki.bloodontheclocktower.com/Innkeeper */
export function isInnkeeperSelfEffect(holder: STPlayerRecord, effect: EffectRecord, sourceRole: RoleDef | undefined): boolean {
  const source = effect.sourceParticipant;
  return effect.sourceCharacter === "innkeeper" && effect.type === "drunk"
    && source?.kind === "participant" && source.playerId === holder.id && source.participantId === holder.participantId
    && !!sourceRole && sourceRole.id === "innkeeper" && isCanonicalRole(sourceRole);
}
