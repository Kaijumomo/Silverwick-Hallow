import { useEffect, useState } from "react";
import { publicPath } from "./paths";
import type { RoomBackend, Unsubscribe } from "./backend";
import type { PublicLobbyRecord } from "@/stores/types";
import { decodeSession, sessionPath } from "./lifecycle";
import { CONNECTION_ERROR_MESSAGE, DATA_ERROR_MESSAGE, decodePublicSnapshot, subscribeDecoded, type PublicSnapshot } from "./snapshots";

// Public-only subscription. Reads ONLY `lobbies/{code}/public` — never the
// storyteller, player-private, roster, or presence paths. Mirrors the inner
// public watcher in `playerSync.ts` but without coupling to
// `usePlayerStore` (which carries player-identity state).
export function subscribeToPublicLobby(
  backend: RoomBackend,
  code: string,
  cb: (value: PublicLobbyRecord | null, snapshot: PublicSnapshot) => void,
  onReadError?: () => void,
): Unsubscribe {
  return subscribeDecoded(backend, publicPath(code), (raw) => decodePublicSnapshot(raw, code), (snapshot) => {
    cb(snapshot.status === "ready" ? snapshot.data : null, snapshot);
  }, onReadError);
}

export type UsePublicLobbyResult = {
  publicLobby: PublicLobbyRecord | null;
  ended: boolean;
  loading: boolean;
  error: string | null;
};

export function usePublicLobby(
  backend: RoomBackend | null,
  code: string | null
): UsePublicLobbyResult {
  const [publicLobby, setPublicLobby] = useState<PublicLobbyRecord | null>(null);
  const [ended, setEnded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!backend || !code) {
      setLoading(true);
      return;
    }
    setLoading(true);
    setError(null);
    setEnded(false);
    setPublicLobby(null);

    let cancelled = false;
    let terminal = false;
    let unsub: (() => void) | undefined;
    let finalReads = 0;
    // Package 4 (PO-approved public winner delivery): once the game ends the
    // live listener stops, and the final public record is read once -- the
    // last Day/Night-correct projection plus the declared winner the terminal
    // commit adds. Rules let an enrolled display read it after the end; an
    // older deployment refuses, and the neutral ended scene stays.
    const readFinal = () => {
      const read = ++finalReads;
      void backend.get(publicPath(code)).then(raw => {
        if (cancelled || read !== finalReads) return;
        const snapshot = decodePublicSnapshot(raw, code);
        if (snapshot.status === "ready" && snapshot.data.status === "ended") setPublicLobby(snapshot.data);
      }).catch(() => {});
    };
    const markEnded = () => {
      if (!terminal) {
        terminal = true;
        unsub?.(); unsub = undefined;
        setLoading(false); setPublicLobby(null); setError(null); setEnded(true);
      }
      readFinal();
    };
    const offSession = backend.subscribe(sessionPath(code), raw => {
      if (cancelled) return;
      if (terminal) {
        // The public signal can precede the commit that carries the winner:
        // read the final record again when the session itself ends.
        try { if (decodeSession(raw)?.state === "ended") readFinal(); } catch { /* keep the ended scene */ }
        return;
      }
      try {
        const session = decodeSession(raw);
        if (!session) {
          unsub?.(); unsub = undefined;
          setLoading(false); setPublicLobby(null); setError("This lobby does not exist or has expired."); return;
        }
        if (session.state === "ended") { markEnded(); return; }
        if (!unsub) unsub = subscribeToPublicLobby(backend, code, (value, snapshot) => {
          if (cancelled || terminal) return;
          if (snapshot.status === "ended" || value?.status === "ended") { markEnded(); return; }
          setLoading(snapshot.status === "waiting");
          setError(snapshot.status === "invalid" ? DATA_ERROR_MESSAGE : null);
          setPublicLobby(value);
        }, () => {
          if (cancelled || terminal) return;
          setLoading(false); setPublicLobby(null); setError(CONNECTION_ERROR_MESSAGE);
          // A terminal session read is still authorized after roster cleanup.
          void backend.get(sessionPath(code)).then(value => {
            if (!cancelled && decodeSession(value)?.state === "ended") markEnded();
          }).catch(() => {});
        });
      } catch {
        unsub?.(); unsub = undefined;
        setLoading(false); setPublicLobby(null); setError(DATA_ERROR_MESSAGE);
      }
    }, () => {
      if (!cancelled && !terminal) {
        unsub?.(); unsub = undefined;
        setLoading(false); setPublicLobby(null); setError(CONNECTION_ERROR_MESSAGE);
      }
    });
    return () => { cancelled = true; offSession(); unsub?.(); };
  }, [backend, code]);

  return { publicLobby, ended, loading, error };
}
