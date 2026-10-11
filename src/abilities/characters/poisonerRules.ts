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
