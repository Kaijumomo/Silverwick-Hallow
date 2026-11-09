import type { RoleRegistry } from "@/data/roleRegistry";
import { getPrivateInfoApplicability } from "@/stores/privatePackets";
import type { PlayerId, RoleId, StorytellerLobbyRecord } from "@/stores/types";

/**
 * The Demon bluffs belong to the player they are told to (privateInfo.bluffs), never to the table.
 * The seat that holds them is the first seated player for whom bluffs apply -- the Demon, or the
 * apparent Demon of a fake-Demon scenario -- exactly the rule the private-information editor uses.
 */
export function bluffHolderId(game: StorytellerLobbyRecord, registry: RoleRegistry): PlayerId | null {
  for (const id of game.seatOrder) {
    const p = game.players[id];
    if (p && !p.isEmpty && getPrivateInfoApplicability(p, registry).bluffs) return id;
  }
  return null;
}

export function bluffsOf(game: StorytellerLobbyRecord, holder: PlayerId | null): RoleId[] {
  return holder ? [...(game.players[holder]?.privateInfo?.bluffs ?? [])] : [];
}
