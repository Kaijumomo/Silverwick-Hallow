import type { CurrentParticipantRef, EffectRecord, StorytellerLobbyRecord } from "@/stores/types";
import { participantRefOf } from "@/stores/participants";

/** Explicit B3 setup fixture; tests of ability information begin with the
 * already-established source-free fact and its original setup identity. */
export function withRedHerring(game: StorytellerLobbyRecord, targetId: string, actorId = "p0", id = "rh-1"): StorytellerLobbyRecord {
  const actor = game.players[actorId]!;
  const epoch = actor.packetEpoch ?? "fortune-teller-setup";
  const fact: EffectRecord = { id, type: "fortuneTellerRedHerring", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" },
    appliedAt: { phase: "setup", day: 0 }, parameters: {
      fortuneTeller: { kind: "participant", participants: [participantRefOf(game, actorId) as CurrentParticipantRef] },
      fortuneTellerIdentityEpoch: { kind: "text", value: epoch },
    } };
  const players = { ...game.players, [actorId]: { ...actor, packetEpoch: epoch } };
  players[targetId] = { ...players[targetId]!, effects: [...players[targetId]!.effects, fact] };
  return { ...game, players };
}
