// Player-side sync: watch roster/{ownUid} for the seating binding, then
// subscribe to player/{playerId} (self) and public/ (town).

import { useEffect, useState } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import { knockOnLobby } from "./lobby";
import {
  joinRequestPath,
  presencePath,
  publicPath,
  rosterEntryPath,
  playerPath,
} from "./paths";
import type { RoomBackend } from "./backend";
import type { PlayerSelfRecord, PublicLobbyRecord } from "@/stores/types";
import { friendlyFirebaseError } from "./errors";

const HEARTBEAT_MS = 15_000;

export async function joinLobby(
  backend: RoomBackend,
  code: string,
  uid: string,
  requestedName: string
): Promise<void> {
  const player = usePlayerStore.getState();
  try {
    // Rules reject new requests for missing/ended lobbies. Commit the request
    // before installing the session that starts public-data subscriptions.
    player.setStatus("knocking");
    await knockOnLobby(backend, code, uid, requestedName);
    player.setSession({ code, uid, requestedName: requestedName.trim() });
    player.setStatus("waiting");
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[joinLobby]", e instanceof Error ? e.message : e);
    const friendly = friendlyFirebaseError(e, "player");
    player.setStatus("error", `${friendly.title}: ${friendly.message}`);
  }
}

export function usePlayerSync(backend: RoomBackend | null) {
  const code = usePlayerStore((s) => s.code);
  const uid = usePlayerStore((s) => s.uid);
  const playerId = usePlayerStore((s) => s.playerId);
  const [requestSession, setRequestSession] = useState<string | null>(null);
  const hasRequest = !!code && !!uid && requestSession === JSON.stringify([code, uid]);

  // Pending requests grant public access, but never private access. Observe
  // the acknowledged request before probing public/ (also on refresh).
  useEffect(() => {
    if (!backend || !code || !uid) return;
    return backend.subscribe(joinRequestPath(code, uid), (value) => {
      setRequestSession(typeof value === "string" ? JSON.stringify([code, uid]) : null);
    });
  }, [backend, code, uid]);

  // Watch roster/{ownUid} for the playerId binding.
  useEffect(() => {
    if (!backend || !code || !uid) return;
    const unsub = backend.subscribe(rosterEntryPath(code, uid), (value) => {
      const ps = usePlayerStore.getState();
      // Guard: don't clobber "ended" status. After the public/ subscription
      // calls setEnded(), this effect's cleanup hasn't run yet — Firebase can
      // still deliver a buffered roster value. Without the guard, the fall-
      // through below would write setStatus("seated") over "ended".
      if (ps.status === "ended") return;
      if (typeof value !== "string" || value.length === 0) {
        // No roster entry; if we'd been seated and got removed, surface that.
        if (ps.playerId) {
          ps.setStatus("error", "Removed from lobby.");
          ps.setPlayerId(null);
          ps.setSelf(null);
        }
        return;
      }
      // Every roster value was written by the ST. Names exist only in requests.
      ps.setPlayerId(value);
      ps.setStatus("seated");
    });
    return () => unsub();
  }, [backend, code, uid]);

  // Subscribe to own player/{playerId} once seated.
  // A permission probe runs first so that a stale reconnect (e.g. the game
  // ended and the player's session is no longer valid) surfaces a clear error
  // instead of hanging silently.
  useEffect(() => {
    if (!backend || !code || !playerId) return;
    let active = true;
    let cleanup: (() => void) | null = null;
    backend.get(playerPath(code, playerId)).then(() => {
      if (!active) return;
      cleanup = backend.subscribe(playerPath(code, playerId), (value) => {
        const ps = usePlayerStore.getState();
        if (ps.status === "ended") return;
        if (value === undefined || value === null) {
          ps.setSelf(null);
          return;
        }
        ps.setSelf(value as unknown as PlayerSelfRecord);
      });
    }).catch((e) => {
      if (!active) return;
      const friendly = friendlyFirebaseError(e, "player");
      usePlayerStore.getState().setStatus("error", `${friendly.title}: ${friendly.message}`);
    });
    return () => { active = false; cleanup?.(); };
  }, [backend, code, playerId]);

  // Subscribe to public/ — and detect lobby-ended from within the same
  // subscription. The ST writes status="ended" to public/status via endLobby();
  // this fires immediately on the next subscription tick. One subscription
  // handles both normal updates and the game-ended signal, so there is no
  // separate read on lobbies/${code}/status (which would need its own rule).
  // Permission probe guards against reconnecting to an already-ended lobby.
  useEffect(() => {
    if (!backend || !code || (!playerId && !hasRequest)) return;
    let active = true;
    let cleanup: (() => void) | null = null;
    backend.get(publicPath(code)).then(() => {
      if (!active) return;
      cleanup = backend.subscribe(publicPath(code), (value) => {
        const ps = usePlayerStore.getState();
        if (value === undefined || value === null) {
          ps.setPublic(null);
          return;
        }
        const pub = value as unknown as PublicLobbyRecord;
        if (pub.status === "ended") {
          ps.setEnded();
          return;
        }
        ps.setPublic(pub);
      });
    }).catch((e) => {
      if (!active) return;
      const friendly = friendlyFirebaseError(e, "player");
      usePlayerStore.getState().setStatus("error", `${friendly.title}: ${friendly.message}`);
    });
    return () => { active = false; cleanup?.(); };
  }, [backend, code, playerId, hasRequest]);

  // Presence: while seated, write presence/{uid} = { online: true, lastSeen }
  // and arm an onDisconnect that flips us to offline when the socket dies.
  // A heartbeat refreshes lastSeen so a stale-but-online entry can be
  // detected by the storyteller if needed.
  useEffect(() => {
    if (!backend || !code || !uid) return;
    let active = true;
    let cancelDisconnect: (() => Promise<void>) | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const path = presencePath(code, uid);
    const writeOnline = () =>
      backend.set(path, { online: true, lastSeen: Date.now() });

    (async () => {
      try {
        // Arm offline-on-disconnect first, so a transient failure between
        // the two writes doesn't leave a stale "online" entry.
        cancelDisconnect = await backend.onDisconnectSet(path, {
          online: false,
          lastSeen: Date.now(),
        });
        if (!active) {
          await cancelDisconnect();
          cancelDisconnect = null;
          return;
        }
        await writeOnline();
        if (!active) return;
        heartbeat = setInterval(() => {
          writeOnline().catch(() => {
            // Heartbeat failures are non-fatal — onDisconnect handles real drops.
          });
        }, HEARTBEAT_MS);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[presence]", e instanceof Error ? e.message : e);
      }
    })();

    return () => {
      active = false;
      if (heartbeat) clearInterval(heartbeat);
      // Disarm the disconnect write and explicitly mark offline. The order
      // matters: cancel first so the disconnect doesn't race with the set.
      (async () => {
        if (cancelDisconnect) {
          try {
            await cancelDisconnect();
          } catch {
            // Cancel failure is harmless — onDisconnect just becomes a no-op.
          }
        }
        try {
          await backend.set(path, { online: false, lastSeen: Date.now() });
        } catch {
          // Network may already be gone — ignore.
        }
      })();
    };
  }, [backend, code, uid]);
}
