// React hook that activates the ST-side Firebase sync when there's an
// active lobby. Behavior:
//   1. Watch authoritative roster bindings and a separate pending request queue.
//   2. Subscribe to local store changes; debounce 200ms; on each commit,
//      call writeProjections() with the latest STPlayerRecord and presence.
//   3. On unmount, unsubscribe everything.

import { useEffect, useRef } from "react";
import {
  selectScriptById,
  useStorytellerStore,
} from "@/stores/storytellerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { classifyRoster, watchJoinRequests, watchRoster } from "./lobby";
import { writeProjections } from "./sync";
import type { OnlineMap } from "@/stores/projections";
import type { RoomBackend } from "./backend";
import type { PlayerId } from "@/stores/types";

const WRITE_DEBOUNCE_MS = 200;

type PresenceEntry = { online?: boolean; lastSeen?: number };
type PresenceMap = Record<string, PresenceEntry>; // keyed by uid
type RosterMap = Record<string, string>; // uid → playerId

function deriveOnlineMap(roster: RosterMap, presence: PresenceMap): OnlineMap {
  const out: OnlineMap = {};
  for (const [uid, value] of Object.entries(roster)) {
    // Only ST-written player IDs appear in this collection.
    const playerId: PlayerId = value;
    const p = presence[uid];
    out[playerId] = !!p?.online;
  }
  return out;
}

export function useStorytellerSync(
  backend: RoomBackend | null,
  onSyncError?: (msg: string | null) => void,
  onPresenceUpdate?: (online: OnlineMap, pendingOnlineCount: number) => void
) {
  const lobby = useStorytellerStore((s) => s.lobby);

  const writeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingWrite = useRef<boolean>(false);

  // Presence + roster snapshots — refs so they aren't part of the effect
  // dependency array but are always read at flush time.
  const rosterRef = useRef<RosterMap>({});
  const presenceRef = useRef<PresenceMap>({});

  // ---- Sync loop: subscribe to store changes, debounce, project + write.
  useEffect(() => {
    if (!backend || !lobby) return;
    const code = lobby.code;

    const flush = async () => {
      pendingWrite.current = false;
      const state = useStorytellerStore.getState();
      const game = state.game;
      if (!game) return;
      const script = selectScriptById(state, game.scriptId);
      if (!script) return;
      const registry = buildRegistry(script);
      const online = deriveOnlineMap(rosterRef.current, presenceRef.current);
      try {
        await writeProjections({ backend, code, stState: game, registry, online });
        // Clear any previous sync error banner on success.
        onSyncError?.(null);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[sync] writeProjections failed:", e instanceof Error ? e.message : e);
        onSyncError?.("Last sync failed — retrying…");
      }
    };

    const schedule = () => {
      pendingWrite.current = true;
      if (writeTimer.current) return;
      writeTimer.current = setTimeout(() => {
        writeTimer.current = null;
        if (pendingWrite.current) flush();
      }, WRITE_DEBOUNCE_MS);
    };

    // Initial write (immediately re-uploads everything on (re)connect).
    flush();

    const unsubStore = useStorytellerStore.subscribe((s, prev) => {
      // Only react to game/lobby/customScripts changes — not view, drawer,
      // pendingKnocks (those don't affect Firebase paths).
      if (
        s.game !== prev.game ||
        s.lobby !== prev.lobby ||
        s.customScripts !== prev.customScripts
      ) {
        schedule();
      }
    });

    // Watch presence for the lobby. When a uid's online flips, schedule a
    // re-projection so the public roster carries the new value.
    const unsubPresence = backend.subscribe(
      `lobbies/${code}/presence`,
      (value) => {
        presenceRef.current = (value as PresenceMap | undefined) ?? {};
        if (onPresenceUpdate) {
          const online = deriveOnlineMap(rosterRef.current, presenceRef.current);
          // Count pending devices currently showing presence online=true.
          const seatedUids = new Set(Object.keys(rosterRef.current));
          const fullRoster = useStorytellerStore.getState().game?.players ?? {};
          const knownIds = new Set(Object.keys(fullRoster));
          let pendingOnlineCount = 0;
          for (const [uid, entry] of Object.entries(presenceRef.current)) {
            if (!seatedUids.has(uid) && !knownIds.has(uid) && entry?.online) {
              pendingOnlineCount++;
            }
          }
          onPresenceUpdate(online, pendingOnlineCount);
        }
        schedule();
      }
    );

    return () => {
      unsubStore();
      unsubPresence();
      if (writeTimer.current) {
        clearTimeout(writeTimer.current);
        writeTimer.current = null;
      }
    };
  }, [backend, lobby?.code]);

  // ---- Membership and request watches (ST still assigns seats manually).
  useEffect(() => {
    if (!backend || !lobby) return;
    const code = lobby.code;

    const unsubRoster = watchRoster(backend, code, (raw) => {
      const next: RosterMap = {};
      for (const entry of classifyRoster(raw)) {
        next[entry.uid] = entry.playerId;
      }
      rosterRef.current = next;
    });

    const unsubRequests = watchJoinRequests(backend, code, (requests) => {
      const state = useStorytellerStore.getState();
      const game = state.game;
      if (!game) return;
      for (const uid of Object.keys(game.pendingPlayers)) {
        if (!requests[uid]) useStorytellerStore.getState().removePendingPlayer(uid);
      }
      for (const [uid, name] of Object.entries(requests)) {
        state.addToPendingQueue(uid, name);
      }
    });

    return () => {
      unsubRoster();
      unsubRequests();
    };
  }, [backend, lobby?.code]);
}
