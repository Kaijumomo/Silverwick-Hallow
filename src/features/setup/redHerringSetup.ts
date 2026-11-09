import { isCanonicalRole } from "@/data/canonical";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { SetupContext } from "./setupContext";

export const RED_HERRING_EFFECT = "fortuneTellerRedHerring";
export type RedHerringSetup = {
  status: "missing" | "ready" | "invalid" | "manual";
  required: boolean;
  message: string;
  eligible: ParticipantBinding[];
  target?: ParticipantBinding;
};

/** Initial-setup readiness only. The existing source-free Effect remains the
 * sole authority; this neither invents a target nor refreshes facts in play. */
export function redHerringSetup(context: SetupContext): RedHerringSetup {
  const tellers = context.ordinary.filter(player => player.actualRole === "fortuneteller");
  const eligible = context.occupied.filter(player => player.actualAlignment === "good" && player.participantId)
    .map(player => ({ playerId: player.id, participantId: player.participantId! }));
  const result = (status: RedHerringSetup["status"], message: string, required = true): RedHerringSetup =>
    ({ status, required, message, eligible });
  if (!tellers.length) return result("ready", "", false);
  const definition = context.registry?.get("fortuneteller");
  if (tellers.length !== 1 || !definition || !isCanonicalRole(definition) || context.game.day !== 0)
    return result("manual", "Prepare the Fortune Teller's Red Herring using the existing effect controls.");
  const facts = context.occupied.flatMap(player => player.effects.filter(effect => effect.type === RED_HERRING_EFFECT)
    .map(effect => ({ player, effect })));
  if (!facts.length) return result("missing", "Choose a good player as the Fortune Teller's Red Herring.");
  const fact = facts[0]!;
  if (facts.length !== 1 || fact.effect.state !== "active" || !fact.player.participantId ||
    fact.player.actualAlignment !== "good" || fact.effect.lifetime.kind !== "manual" || fact.effect.expiry.kind !== "none")
    return result("invalid", "Correct the Red Herring in More settings: one good player must have the active setup fact.");
  const owner = fact.effect.parameters?.fortuneTeller;
  const epoch = fact.effect.parameters?.fortuneTellerIdentityEpoch;
  if (owner?.kind !== "participant" || owner.participants.length !== 1 || epoch?.kind !== "text" || !epoch.value)
    return result("manual", "The Red Herring stays fixed. Resolve this Fortune Teller's information manually for an older unbound fact.");
  if (owner.participants[0]?.participantId !== tellers[0]!.participantId || epoch.value !== tellers[0]!.packetEpoch)
    return result("invalid", "The Fortune Teller's setup identity changed. Use Undo or correct the Red Herring in More settings before beginning.");
  return { ...result("ready", "Red Herring ready."), target: { playerId: fact.player.id, participantId: fact.player.participantId } };
}
