import { isCanonicalRole } from "@/data/canonical";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { SetupContext } from "@/rules/setup/setupContext";
import { twinPairOf } from "@/stores/twinPair";

export type TwinSetup = {
  status: "missing" | "ready" | "invalid" | "manual";
  required: boolean;
  message: string;
  /** Who may be chosen as the Good Twin: any other seated, non-Traveller player of the opposing alignment. */
  eligible: ParticipantBinding[];
  evilTwin?: ParticipantBinding;
  target?: ParticipantBinding;
};

/**
 * SV-4c, initial-setup readiness only (the Red Herring's pattern, redHerringSetup.ts): "While setting up the game, choose a Good Twin by
 * marking any good character with the TWIN reminder." The stored `twin` Effect stays the sole authority; this neither invents a Good Twin
 * nor refreshes facts in play. "It is rarely a good idea to choose a Traveller to be a Twin": a Traveller is not offered here (by hand).
 */
export function twinSetup(context: SetupContext): TwinSetup {
  const evils = context.ordinary.filter(player => player.actualRole === "eviltwin");
  const result = (status: TwinSetup["status"], message: string, required = true, extra: Partial<TwinSetup> = {}): TwinSetup =>
    ({ status, required, message, eligible: [], ...extra });
  if (!evils.length) return result("ready", "", false);
  const definition = context.registry?.get("eviltwin");
  if (evils.length !== 1 || !definition || !isCanonicalRole(definition) || context.game.day !== 0)
    return result("manual", "Prepare the Evil Twin's Good Twin using the existing effect controls.");
  const evil = evils[0]!;
  if (!evil.participantId || !evil.actualAlignment) return result("manual", "Prepare the Evil Twin's Good Twin using the existing effect controls.");
  const evilTwin: ParticipantBinding = { playerId: evil.id, participantId: evil.participantId };
  const eligible = context.ordinary
    .filter(player => player.id !== evil.id && !!player.participantId && !!player.actualAlignment && player.actualAlignment !== evil.actualAlignment)
    .map(player => ({ playerId: player.id, participantId: player.participantId! }));
  const withTwin = (status: TwinSetup["status"], message: string, extra: Partial<TwinSetup> = {}): TwinSetup => result(status, message, true, { eligible, evilTwin, ...extra });
  const pair = twinPairOf(context.game.players);
  if (pair.kind !== "single") return withTwin("invalid", "Correct the Good Twin in More settings: the setup fact does not name this Evil Twin.");
  if (!pair.valid || !pair.other?.participantId)
    return pair.markers === 0 ? withTwin("missing", "Choose the Good Twin.")
      : withTwin("invalid", "Correct the Good Twin in More settings: one player of the opposing alignment must carry the TWIN reminder.");
  return withTwin("ready", "Good Twin ready.", { target: { playerId: pair.other.id, participantId: pair.other.participantId } });
}
