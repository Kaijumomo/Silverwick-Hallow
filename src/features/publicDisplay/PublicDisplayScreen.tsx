import { useEffect, useState } from "react";
import { connectFirebase } from "@/firebase/session";
import { isFirebaseConfigured } from "@/firebase/config";
import { friendlyFirebaseError } from "@/firebase/errors";
import { usePublicLobby } from "@/firebase/publicSync";
import { CONNECTION_ERROR_MESSAGE } from "@/firebase/snapshots";
import { authorizePublicDisplay, parseDisplayTokenFromFragment } from "@/firebase/publicDisplayAuth";
import { seatCentre } from "@/features/grimoire/densityTiers";
import type { RoomBackend } from "@/firebase/backend";
import { PublicSeat } from "./PublicSeat";
import { publicSeatLayout } from "./publicLayout";
import { lookupOfficialRole } from "@/data/officialRoles";
import { PHASE_LABEL, selectActiveFabled, selectActiveLorics } from "./presenters";
import { RemoteScreenBoundary } from "@/features/remote/RemoteScreenBoundary";

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
  const [stage, setStage] = useState({ width: 800, height: 800 });
  // ASTRA-10H-003: the stage wrapper only exists once the asynchronous connect
  // and subscription produce a lobby, so it is held as STATE through a
  // callback ref -- the observer attaches when the real node mounts, and
  // detaches / rebinds if React replaces it.
  const [stageNode, setStageNode] = useState<HTMLDivElement | null>(null);

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

  // Resize observer for the mounted seating stage.
  useEffect(() => {
    if (!stageNode) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setStage({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) });
    });
    ro.observe(stageNode);
    return () => ro.disconnect();
  }, [stageNode]);

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
    // surfaces as here — display-specific guidance replaces the old
    // "open this view from the storyteller's browser tab" advice, which is
    // obsolete now that a real separate device is authorized by capability,
    // not by a shared anonymous identity. Other messages (e.g. "this lobby
    // does not exist or has expired") are already specific and left as-is.
    // Never exposes raw Firebase diagnostics or capability contents.
    const message = error === CONNECTION_ERROR_MESSAGE
      ? "This display is no longer authorized. Open a fresh Public Display link from the Storyteller. You can also check this device's connection."
      : error;
    return <div className="public-display public-display-message" role="alert"><h2>Game data unavailable</h2><p>{message}</p></div>;
  }
  if (ended && !publicLobby) {
    return <div className="public-display public-display-message" role="status"><h2>Game ended</h2></div>;
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

  const playerCount = publicLobby.seatOrder.length;
  // Phase 10H (10H-AC-069): the Table's oval geometry, fitted to the measured
  // display so no seat's disc or text overprints a neighbour's.
  const { spec, label, table } = publicSeatLayout(stage, publicLobby.seatOrder.map((id) => {
    const p = publicLobby.players[id];
    return { role: !!(p?.publicDisplayRole && lookupOfficialRole(p.publicDisplayRole)), traveler: !!p?.isTraveler };
  }));
  const fabled = selectActiveFabled(publicLobby);
  const lorics = selectActiveLorics(publicLobby);
  // Public display only knows the roles it sees publicly. Use fabled+lorics
  // as the available id pool; jinxes that depend on hidden in-play characters
  // simply won't fire here, which is acceptable — they're still surfaced on
  // the storyteller view where the truth is known.
  return (
    <div className="public-display" data-phase={publicLobby.phase}>
      <header className="public-display-header">
        <span className="public-display-code">{publicLobby.code}</span>
        <span className="phase-pill" data-phase={publicLobby.phase}>
          {PHASE_LABEL[publicLobby.phase] ?? publicLobby.phase}
        </span>
        {publicLobby.day > 0 && (
          <span className="public-display-day">Day {publicLobby.day}</span>
        )}
        {fabled.length > 0 && (
          <div className="public-display-fabled">
            <span className="label">Fabled</span>
            {fabled.map((f) => (
              <span key={f.id} className="fabled-strip-item" title={f.ability}>
                {f.name}
              </span>
            ))}
          </div>
        )}
        {lorics.length > 0 && (
          <div className="public-display-fabled">
            <span className="label">Lorics</span>
            {lorics.map((l) => (
              <span key={l.id} className="loric-strip-item" title={l.ability}>
                {l.name}
              </span>
            ))}
          </div>
        )}
      </header>

      <div className="public-display-circle-wrap" ref={setStageNode} data-stage={`${stage.width}x${stage.height}`}>
        {playerCount === 0 ? (
          <div className="public-display-empty-center">
            <p>Waiting for the storyteller to seat players…</p>
          </div>
        ) : (
          <div className="public-display-circle" data-name-lines={label.nameLines} data-density={label.tier}>
            {publicLobby.seatOrder.map((id, i) => {
              const p = publicLobby.players[id];
              if (!p) return null;
              const pos = seatCentre(i, playerCount, table);
              return (
                <PublicSeat
                  key={id}
                  player={p}
                  size={spec.disc}
                  x={pos.x}
                  y={pos.y}
                  width={spec.width}
                  travelerPill={label.travelerPill}
                  lifeText={label.lifeText}
                />
              );
            })}
          </div>
        )}
      </div>

      <footer className="public-display-footer">
        code <strong>{publicLobby.code}</strong> · public display · read-only
      </footer>

      {ended && (
        <div className="public-display-ended-overlay" role="alert">
          <h1>Game ended</h1>
        </div>
      )}
    </div>
  );
}
