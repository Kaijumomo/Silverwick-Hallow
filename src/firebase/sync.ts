import {
  projectLobbyToPublic,
  projectLobbyToSelfMap,
  type OnlineMap,
} from "@/stores/projections";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { Json, RoomBackend } from "./backend";
import {
  playerPath,
  publicPath,
  storytellerPath,
} from "./paths";

// ---------------------------------------------------------------------------
// THE LOAD-BEARING CHOKEPOINT
// ---------------------------------------------------------------------------
// `writeProjections` is the only generic projection function that writes public
// and private game views. Lifecycle and membership commands are intentional
// exceptions. Every projection caller goes through this function, making the
// privacy boundary an API property: the
// projection helpers (`projectLobbyToPublic`, `projectLobbyToSelfMap`) strip
// `actualRole`/`shownRole`/`behaviorMode`/`privateInfo`/`stNotes`/`statuses`
// before anything reaches `public/*` or `player/{id}/*`.
//
// If you find yourself writing to `public/...` or `player/...` outside this
// file, stop — that's the kind of bug that ships role data to the wrong seat.
// ---------------------------------------------------------------------------

export type WriteContext = {
  backend: RoomBackend;
  code: string;
  stState: StorytellerLobbyRecord;
  registry: RoleRegistry;
  online: OnlineMap;
  membership?: Record<string, string>;
};

export async function writeProjections(ctx: WriteContext): Promise<void> {
  const { backend, code, stState, registry, online } = ctx;

  const updates: Record<string, Json> = {};

  updates[publicPath(code)] = projectLobbyToPublic(
    stState,
    online
  ) as unknown as Json;

  const selfMap = projectLobbyToSelfMap(stState, registry);
  for (const [playerId, self] of Object.entries(selfMap)) {
    updates[playerPath(code, playerId)] = self as unknown as Json;
  }
  // Clean up stale projections for players whose role was cleared. Without
  // this, a player who was previously the Imp would keep reading "imp" from
  // their player/{id} path even after the ST blanked their role.
  // Skip isEmpty seats — they are never assigned a player path.
  for (const [playerId, player] of Object.entries(stState.players)) {
    if (player.isEmpty) continue;
    if (!(playerId in selfMap)) {
      updates[playerPath(code, playerId)] = null;
    }
  }

  // ST-private state. Only the ST can read this path (Firebase rules enforce).
  updates[storytellerPath(code)] = stState as unknown as Json;
  // JSON preserves empty arrays/maps for a fully validated writer takeover.
  updates[`lobbies/${code}/checkpoint`] = JSON.stringify({ game: stState, roster: ctx.membership ?? {} });

  await backend.update(updates);
}
