import { useEffect, useState } from "react";
import { publicPath } from "./paths";
import type { RoomBackend, Unsubscribe } from "./backend";
import type { PublicLobbyRecord } from "@/stores/types";
import { CONNECTION_ERROR_MESSAGE, DATA_ERROR_MESSAGE, decodePublicSnapshot, subscribeDecoded, type PublicSnapshot } from "./snapshots";

// Public-only subscription. Reads ONLY `lobbies/{code}/public` — never the
// storyteller, player-private, roster, or presence paths. Mirrors the inner
// public watcher in `playerSync.ts` (lines 99–116) but without coupling to
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
    let unsub: (() => void) | null = null;

    // Probe permission with a one-shot `get()` first. Firebase's `onValue`
    // does not surface permission_denied to the value callback (it only goes
    // to an unwired error callback), so an unauthorized device would otherwise
    // hang on "loading" forever. `get()` rejects on permission_denied, which
    // we map to the same "not found / not authorized" empty state as a
    // missing lobby.
    backend
      .get(publicPath(code))
      .then(() => {
        if (cancelled) return;
        unsub = subscribeToPublicLobby(backend, code, (value, snapshot) => {
          if (cancelled) return;
          setLoading(snapshot.status === "waiting");
          setError(snapshot.status === "invalid" ? DATA_ERROR_MESSAGE : null);
          setEnded(snapshot.status === "ended" || value?.status === "ended");
          setPublicLobby(value);
        }, () => {
          if (cancelled) return;
          setLoading(false);
          setPublicLobby(null);
          setError(CONNECTION_ERROR_MESSAGE);
        });
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setPublicLobby(null);
        setEnded(false);
        setError(CONNECTION_ERROR_MESSAGE);
      });

    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, [backend, code]);

  return { publicLobby, ended, loading, error };
}
