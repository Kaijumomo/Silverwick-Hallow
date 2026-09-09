import type { RoleRegistry } from "@/data/roleRegistry";
import type { STPlayerRecord, StorytellerLobbyRecord } from "./types";
import { PlayerSelfRecordSchema } from "./schemas";
import { projectIdentity } from "./projections";
import { needsShownIdentity } from "./identity";
import { newTravelerArrival, travelerDemonInformation } from "./travelers";

export type PrivateInfoApplicability = {
  simulatedInfo: boolean;
  bluffs: boolean;
  fakeMinions: boolean;
  extraText: boolean;
};

/**
 * Central policy for which private-information controls belong to a scenario.
 * Wake identity answers which procedure to run; this answers which information
 * fields the Storyteller may configure for that procedure.
 */
export function getPrivateInfoApplicability(
  player: STPlayerRecord,
  registry: RoleRegistry,
): PrivateInfoApplicability {
  const mode = player.behaviorMode;
  const fakeDemon = mode === "fake_demon_behavior";
  const normalDemon = mode === "normal" && registry.get(player.actualRole)?.type === "demon";
  const simulatedInfo = !!player.shownRole && (
    needsShownIdentity(player.actualRole)
      || player.actualRole !== player.shownRole
      || mode === "drunk_fake_role_behavior"
      || mode === "marionette_fake_good_behavior"
  );
  return {
    simulatedInfo,
    bluffs: fakeDemon || normalDemon,
    fakeMinions: fakeDemon,
    extraText: simulatedInfo || fakeDemon || !!player.shownRole && [
      registry.get(player.shownRole)?.firstNightPrompt ?? registry.get(player.shownRole)?.ability,
      registry.get(player.shownRole)?.otherNightPrompt ?? registry.get(player.shownRole)?.ability,
    ].some(prompt => offersNightInformation(prompt ?? "")),
  };
}

/** Optional UI affordance from procedure text, never an ability resolver. */
export function offersNightInformation(prompt: string): boolean {
  return /\b(show|tell|learn|learns|information|signal|nod)\b/i.test(prompt);
}

export function hasPrivateDraft(player: STPlayerRecord): boolean {
  const info = player.privateInfo;
  return !!(info?.travelerDemon || info?.bluffs?.length || info?.fakeMinions?.length || info?.extraText?.trim());
}

/** Remove fields made incompatible by an explicit behavior-mode change. */
export function pruneInapplicablePrivateInfo(player: STPlayerRecord, registry: RoleRegistry): STPlayerRecord {
  const applicable = getPrivateInfoApplicability(player, registry);
  if (!player.privateInfo) return player;
  const info = { ...player.privateInfo };
  if (!applicable.bluffs) delete info.bluffs;
  if (!applicable.fakeMinions) delete info.fakeMinions;
  if (!applicable.extraText) delete info.extraText;
  const next = { ...player };
  if (Object.keys(info).length) next.privateInfo = info;
  else delete next.privateInfo;
  return next;
}

/** Build from explicit draft selections only. Never infer the actual team. */
export function previewPrivatePacket(player: STPlayerRecord, game: StorytellerLobbyRecord, registry: RoleRegistry) {
  const identity = projectIdentity(player, registry);
  if (!identity) throw new Error("Configure the shown identity before previewing information.");
  if (!hasPrivateDraft(player)) throw new Error("Configure private information before previewing.");
  const info = player.privateInfo!;
  let demon;
  if (info.travelerDemon) {
    const result = travelerDemonInformation(player, game, registry);
    if (!result.demon || result.demon.id !== info.travelerDemon) throw new Error(result.check ?? "The Demon changed. Review arrival information again.");
    demon = result.demon;
  }
  const applicable = getPrivateInfoApplicability(player, registry);
  if (info.bluffs?.length && !applicable.bluffs) {
    throw new Error("Bluffs are not applicable to this player's shown identity.");
  }
  if (info.fakeMinions?.length && !applicable.fakeMinions) {
    throw new Error("Minion selections are only applicable to an apparent Demon.");
  }
  if (info.extraText?.trim() && !applicable.extraText) {
    throw new Error("Extra information is not applicable to this player's current scenario.");
  }
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
    ...(demon ? { demon } : {}),
    ...(bluffs ? { bluffs } : {}),
    ...(minions.length ? { minions } : {}),
    ...(info.extraText?.trim() ? { extraText: info.extraText.trim() } : {}),
  });
  return { payload, fingerprint: JSON.stringify([player.packetEpoch ?? "", game.day, game.phase, payload]) };
}

/** Identity changes invalidate queued previews and previously published extras. */
export function invalidatePrivatePacket<T extends STPlayerRecord>(player: T): T {
  const next = { ...player, packetEpoch: crypto.randomUUID() };
  if (player.isTraveler && player.publishedPacket?.payload.demon) {
    next.travelerArrival = { ...(player.travelerArrival ?? newTravelerArrival()), demonInfoComplete: false };
  }
  delete next.publishedPacket;
  return next;
}
