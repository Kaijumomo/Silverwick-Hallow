import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";

/** PHASE10F_CHARACTER_RULES_MATRIX.md Section 7, extended by approved B3 setup.
 * The fact keeps its lifetime independently of its original Fortune Teller.
 * These existing typed Effect parameters only establish whether automatic
 * information belongs to this same setup identity. Uncertain legacy facts or
 * changed identities retain the token and use normal manual play. */
export function fortuneTellerSetupRefusal(query: RulesQuery, actor: ParticipantBinding): string | null {
  if (query.inPlay("fortuneteller").length !== 1)
    return "More than one Fortune Teller is in play: whose Red Herring is whose is not modeled -- resolve manually.";
  const holders = query.factHolders("fortuneTellerRedHerring");
  if (!holders.known) return holders.reason;
  if (holders.value.length > 1) return "More than one Red Herring is recorded. Correct the Red Herring Effects, or resolve manually.";
  const holder = holders.value[0];
  if (!holder) return "No Red Herring is recorded for this Fortune Teller. Silverwick does not invent one during Night -- record it as a correction, or resolve manually.";
  const effect = query.participant(holder.holder)?.effects.find(item => item.id === holder.effectId);
  const owner = effect?.parameters?.fortuneTeller;
  const epoch = effect?.parameters?.fortuneTellerIdentityEpoch;
  const player = query.participant(actor);
  if (owner?.kind !== "participant" || owner.participants.length !== 1 ||
    owner.participants[0]?.participantId !== actor.participantId || epoch?.kind !== "text" ||
    !epoch.value || epoch.value !== player?.packetEpoch)
    return "This Red Herring is not verified for the Fortune Teller's current setup identity. Resolve manually.";
  return null;
}
