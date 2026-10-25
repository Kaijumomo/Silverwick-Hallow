import { useEffect, useState } from "react";
import { connectFirebase } from "@/firebase/session";
import { isFirebaseConfigured } from "@/firebase/config";
import { friendlyFirebaseError } from "@/firebase/errors";
import { usePublicLobby } from "@/firebase/publicSync";
import { CONNECTION_ERROR_MESSAGE } from "@/firebase/snapshots";
import { authorizePublicDisplay, parseDisplayTokenFromFragment } from "@/firebase/publicDisplayAuth";
import type { RoomBackend } from "@/firebase/backend";
import { RemoteScreenBoundary } from "@/features/remote/RemoteScreenBoundary";
import { TownSquare } from "./TownSquare";
import { joinLinkFor } from "./QrCode";
import { buildTownSquareView } from "./townSquareModel";

/** Phase 9C.6 (OPUS-002): attempt enrollment (if a fragment token is
 * present), clean the URL on success, and NEVER let a denied/stale fragment
 * block the subsequent public subscription attempt — the same anonymous UID
 * may already hold a valid `displayMembers/{uid}` binding from an earlier,
 * successful enrollment, while this particular fragment is merely stale or
 * foreign. Never logs or renders the token itself. */
async function enrollFromFragment(backend: RoomBackend, code: string, uid: string): Promise<void> {
  const token = parseDisplayTokenFromFragment(window.location.hash);
  if (!token) return;
  try {
    await authorizePublicDisplay(backend, code, uid, token);
    const cleaned = new URL(window.location.href);
    cleaned.hash = "";
    window.history.replaceState(null, "", `${cleaned.pathname}${cleaned.search}`);
  } catch {
    // Denied or malformed: do not leak the token, do not block the caller —
    // the normal public subscription attempt below still runs.
    // eslint-disable-next-line no-console
    console.error("[publicDisplay enroll] denied");
  }
}

type Props = { code: string };

export function PublicDisplayScreen({ code }: Props) {
  return <RemoteScreenBoundary key={code}><PublicDisplayContent code={code} /></RemoteScreenBoundary>;
}

function PublicDisplayContent({ code }: Props) {
  const [backend, setBackend] = useState<RoomBackend | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  // Firebase connect, then (Phase 9C.6, OPUS-002) attempt fragment-token
  // enrollment BEFORE exposing `backend` to the public subscription below —
  // so that subscription never races ahead of a required enrollment. The
  // authorization UID comes ONLY from connectFirebase()'s own return value —
  // never the URL, fragment, query parameter, or local input.
  useEffect(() => {
    let mounted = true;
    if (!isFirebaseConfigured()) return;
    (async () => {
      try {
        const { backend: b, uid } = await connectFirebase();
        await enrollFromFragment(b, code, uid);
        if (mounted) setBackend(b);
      } catch (e) {
        if (mounted) {
          // eslint-disable-next-line no-console
          console.error("[publicDisplay connect]", e instanceof Error ? e.message : e);
          const friendly = friendlyFirebaseError(e, "player");
          setConnectError(`${friendly.title}: ${friendly.message}`);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [code]);

  // The backend's own connection signal drives the "Reconnecting" pill: the
  // initial "not yet connected" is not a drop, only a loss after the
  // connection was established is. The last update stays on screen meanwhile.
  useEffect(() => {
    if (!backend?.subscribeConnection) return;
    let established = false;
    const off = backend.subscribeConnection((connected) => {
      if (connected) { established = true; setReconnecting(false); }
      else if (established) setReconnecting(true);
    });
    return () => { off(); setReconnecting(false); };
  }, [backend]);

  const { publicLobby, ended, loading, error } = usePublicLobby(backend, code);

  if (!isFirebaseConfigured()) {
    return (
      <div className="public-display public-display-message">
        <h2>Firebase is not configured</h2>
        <p>Configure Firebase from the storyteller view first, then return here.</p>
      </div>
    );
  }
  if (connectError) {
    return (
      <div className="public-display public-display-message">
        <h2>Connection failed</h2>
        <p>{connectError}</p>
      </div>
    );
  }
  if (error) {
    // Phase 9C.6 (OPUS-002): CONNECTION_ERROR_MESSAGE is exactly what a
    // denied/rotated/expired `/public` read (or a genuine network issue)
    // surfaces as here. Package 4G: it is the Town Square "Not Linked" scene,
    // whose copy points the Storyteller at Invite -- never raw Firebase
    // diagnostics or capability contents. Other messages (e.g. "this lobby
    // does not exist or has expired") are already specific and left as-is.
    if (error === CONNECTION_ERROR_MESSAGE) {
      return <TownSquare view={buildTownSquareView({ lobby: null, status: "notLinked" })} />;
    }
    return <div className="public-display public-display-message" role="alert"><h2>Game data unavailable</h2><p>{error}</p></div>;
  }
  if (ended && !publicLobby) {
    // No final record could be read (an older deployment, or End Without
    // Result before it arrives): the neutral ended scene, no winner invented.
    return <TownSquare view={buildTownSquareView({ lobby: null, status: "ended" })} />;
  }
  if (!backend || loading) {
    return (
      <div className="public-display public-display-message">
        <h2>{backend ? "Waiting for game data…" : "Connecting…"}</h2>
      </div>
    );
  }
  if (!publicLobby) {
    return (
      <div className="public-display public-display-message">
        <h2>Lobby {code} not found</h2>
        <p>
          This lobby doesn't exist, has ended, or this device isn't authorized.
          Ask the Storyteller for a fresh Public Display link.
        </p>
      </div>
    );
  }

  // Only the public record reaches the stage: Fabled / Loric are the roles it
  // publishes, and the join link carries just the lobby code.
  const view = buildTownSquareView({
    lobby: publicLobby,
    status: ended ? "ended" : reconnecting ? "reconnecting" : "live",
    joinUrl: joinLinkFor(window.location, publicLobby.code),
  });
  return <TownSquare view={view} />;
}
