import type { RoleRegistry } from "@/data/roleRegistry";
import type { STPlayerRecord, StorytellerLobbyRecord } from "./types";
import { PlayerSelfRecordSchema } from "./schemas";
import { projectIdentity } from "./projections";

export function hasPrivateDraft(player: STPlayerRecord): boolean {
  const info = player.privateInfo;
  return !!(info?.bluffs?.length || info?.fakeMinions?.length || info?.extraText?.trim());
}

/** Build from explicit draft selections only. Never infer the actual team. */
export function previewPrivatePacket(player: STPlayerRecord, game: StorytellerLobbyRecord, registry: RoleRegistry) {
  const identity = projectIdentity(player, registry);
  if (!identity) throw new Error("Configure the shown identity before previewing information.");
  if (!hasPrivateDraft(player)) throw new Error("Configure private information before previewing.");
  const info = player.privateInfo!;
  const minionIds = [...new Set(info.fakeMinions ?? [])];
  const minions = minionIds.map(id => {
    const selected = game.players[id];
    if (!selected || selected.isEmpty || id === player.id) throw new Error("Review minion selections: a selected player is no longer seated.");
    return { id, name: selected.name, seat: selected.seat };
  });
  const bluffs = info.bluffs?.length ? [...info.bluffs] : undefined;
  if (bluffs?.some(id => !registry.get(id))) throw new Error("Review bluff selections: a character is unavailable.");
  const payload = PlayerSelfRecordSchema.parse({
    ...identity,
    ...(bluffs ? { bluffs } : {}),
    ...(minions.length ? { minions } : {}),
    ...(info.extraText?.trim() ? { extraText: info.extraText.trim() } : {}),
  });
  return { payload, fingerprint: JSON.stringify([player.packetEpoch ?? "", game.day, game.phase, payload]) };
}

export function packetReadiness(player: STPlayerRecord, game: StorytellerLobbyRecord, registry: RoleRegistry) {
  if (!hasPrivateDraft(player)) return { state: "not configured" as const, error: null };
  try {
    const preview = previewPrivatePacket(player, game, registry);
    return {
      state: player.packetPreview?.fingerprint === preview.fingerprint ? "ready" as const : "configured" as const,
      error: null,
    };
  } catch (error) {
    return { state: "configured" as const, error: error instanceof Error ? error.message : "Review private information." };
  }
}

/** Identity changes invalidate queued previews and previously published extras. */
export function invalidatePrivatePacket<T extends STPlayerRecord>(player: T): T {
  const next = { ...player, packetEpoch: crypto.randomUUID() };
  delete next.packetPreview;
  delete next.publishedPacket;
  return next;
}
