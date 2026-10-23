import { useEffect, useState, type CSSProperties } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { ConnectionStatus } from "@/firebase/StorytellerSession";
import { acceptLeaveRequest, rejectLeaveRequest, storytellerOccupancyCompletion } from "@/firebase/membershipCommands";
import { ensurePublicDisplayAccess, rotatePublicDisplayAccess, buildPublicDisplayLink } from "@/firebase/publicDisplayAuth";
import { friendlyFirebaseError } from "@/firebase/errors";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import { SeatAssignPopup } from "@/features/grimoire/SeatAssignPopup";
import { flash, useV6Ui } from "../v6Store";
import { goOnline, useSetupFlow } from "./flow";

/**
 * The session surfaces Setup keeps from the Ledger, hosted inside the unified Grimoire: connection status, the
 * waiting queue (with Reject), leave requests, the Public Display link, and the Firebase settings dialog. None of
 * them is a permanent control: each appears only while it has something to say.
 */
const tray: CSSProperties = { position: "absolute", left: 16, right: 16, top: 84, zIndex: 60, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" };
const live: CSSProperties = { pointerEvents: "auto" };

function LeaveRequests() {
  const game = useStorytellerStore((s) => s.game);
  const lobby = useStorytellerStore((s) => s.lobby);
  const { backend, leaveRequests } = useSessionRuntime();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A stale error for a request that has since resolved must not resurface against a later one from the same uid.
  useEffect(() => {
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([uid]) => uid in leaveRequests)));
  }, [leaveRequests]);
  if (!game || !lobby || Object.keys(leaveRequests).length === 0) return null;
  const run = async (uid: string, action: () => Promise<void>) => {
    if (!backend || busy.has(uid)) return;
    setBusy((prev) => new Set(prev).add(uid));
    setErrors((prev) => { const { [uid]: _omit, ...rest } = prev; return rest; });
    try { await action(); }
    catch (error) {
      const friendly = friendlyFirebaseError(error, "st");
      setErrors((prev) => ({ ...prev, [uid]: `${friendly.title}: ${friendly.message}` }));
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(uid); return next; });
    }
  };
  return (
    <div className="leave-requests-bar" role="region" aria-label="Leave requests" style={live}>
      <span className="leave-requests-bar-title">Leave requests</span>
      {Object.entries(leaveRequests).map(([uid, playerId]) => {
        const seat = playerId ? game.players[playerId] : undefined;
        const name = seat && !seat.isEmpty ? seat.name : "A player";
        return (
          <div className="leave-request-row" key={uid}>
            <span className="leave-request-text">{name} requested to leave</span>
            <button className="btn btn-sm" disabled={busy.has(uid)} onClick={() => void run(uid, () => rejectLeaveRequest(backend!, lobby.code, uid))}>Keep seated</button>
            <button className="btn btn-sm btn-danger" disabled={busy.has(uid)}
              onClick={() => void run(uid, () => acceptLeaveRequest(backend!, lobby.code, uid, (id) => storytellerOccupancyCompletion("unseat", id)))}>Accept leave</button>
            {busy.has(uid) && <span className="disabled-reason" role="status">Updating…</span>}
            {errors[uid] && <div className="error-list leave-request-error" role="alert"><p>{errors[uid]}</p></div>}
          </div>
        );
      })}
    </div>
  );
}

/** The Public Display capability: ensured once a live writer exists; the error is shown here, Copy / Reset beside the invitation. */
function DisplayLink() {
  const lobby = useStorytellerStore((s) => s.lobby);
  const backend = useSessionRuntime((s) => s.backend);
  const qrOpen = useV6Ui((s) => s.qrOpen);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!lobby || !lobby.sessionId || !backend) { setToken(null); return; }
    let cancelled = false;
    ensurePublicDisplayAccess(backend, lobby.code, lobby.sessionId)
      .then((value) => { if (!cancelled) { setToken(value); setError(null); } })
      .catch((e) => { if (!cancelled) { const f = friendlyFirebaseError(e, "st"); setError(`${f.title}: ${f.message}`); } });
    return () => { cancelled = true; };
  }, [lobby?.code, lobby?.sessionId, backend]);
  if (!lobby) return null;
  // Availability follows the CURRENT live writer, never a token fetched before it lapsed.
  const link = backend && token ? buildPublicDisplayLink(window.location, lobby.code, token) : null;
  const reset = async () => {
    if (!lobby.sessionId || !backend || busy) return;
    setBusy(true); setError(null);
    try { setToken(await rotatePublicDisplayAccess(backend, lobby.code, lobby.sessionId)); flash("Display link reset. Old links no longer work."); }
    catch (e) { const f = friendlyFirebaseError(e, "st"); setError(`${f.title}: ${f.message}`); }
    finally { setBusy(false); }
  };
  return (
    <>
      {error && (
        <div className="connection-status" data-tone="error" role="alert" style={live}>
          <span className="connection-status-message">{error}</span>
          <span className="connection-status-actions"><button className="btn btn-sm" onClick={() => setError(null)}>dismiss</button></span>
        </div>
      )}
      {qrOpen && (
        <div className="grimoire-invite-actions" style={{ ...live, position: "absolute", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 95, display: "flex", gap: 8 }}>
          <button className="btn" disabled={!link} onClick={() => { if (link) window.open(link, "_blank", "noopener"); }}>Public display ↗</button>
          <button className="btn" disabled={!link} onClick={() => { if (link) navigator.clipboard.writeText(link).then(() => flash("Display link copied."), () => flash("Copy failed. Select the link instead.")); }}>Copy display link</button>
          <button className="btn" disabled={!backend || busy} onClick={() => void reset()}>Reset display link</button>
        </div>
      )}
    </>
  );
}

export function SetupOverlays() {
  const game = useStorytellerStore((s) => s.game);
  const lobby = useStorytellerStore((s) => s.lobby);
  const backend = useSessionRuntime((s) => s.backend);
  const flow = useSetupFlow();
  const waiting = Object.keys(game?.pendingPlayers ?? {}).length;
  if (!game) return null;
  return (
    <>
      <div style={tray}>
        {lobby && <div style={live}><ConnectionStatus /></div>}
        {flow.notice && (
          <div className="connection-status" data-tone="error" role="alert" style={live}>
            <span className="connection-status-message">{flow.notice}</span>
            <span className="connection-status-actions">
              <button className="btn btn-sm" onClick={() => void goOnline()}>Try again</button>
              <button className="btn btn-sm" onClick={() => flow.set({ notice: null })}>dismiss</button>
            </span>
          </div>
        )}
        <DisplayLink />
        <LeaveRequests />
      </div>
      {lobby && waiting > 0 && game.phase !== "ended" && (
        <button type="button" className="phase-pill queue-pill-btn" onClick={() => flow.set({ queueOpen: true })}
          style={{ position: "absolute", left: 16, bottom: 136, zIndex: 60 }}>{waiting} waiting</button>
      )}
      {flow.queueOpen && game.phase !== "ended" && (
        <SeatAssignPopup backend={backend} code={lobby?.code ?? ""} onClose={() => flow.set({ queueOpen: false })} />
      )}
      {flow.configOpen && (
        <FirebaseConfigDialog onClose={() => flow.set({ configOpen: false })} onSaved={() => { flow.set({ configOpen: false }); void goOnline(); }} />
      )}
    </>
  );
}
