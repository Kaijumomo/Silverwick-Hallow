import { useEffect, useMemo, useRef, useState } from "react";
import { useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { Almanac } from "@/features/almanac/Almanac";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { SetupPanel } from "@/features/setup/SetupPanel";
import { SeatAssignPopup } from "@/features/grimoire/SeatAssignPopup";
import { TRAVELERS } from "@/data/travelers";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { connectFirebase } from "@/firebase/session";
import { isFirebaseConfigured } from "@/firebase/config";
import { createLobby, formatCode } from "@/firebase/lobby";
import { acceptLeaveRequest, rejectLeaveRequest, revokePlayerAndCommit, storytellerOccupancyCompletion, type OccupancyCompletion } from "@/firebase/membershipCommands";
import { closeMultiplayerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { ensurePublicDisplayAccess, rotatePublicDisplayAccess, buildPublicDisplayLink } from "@/firebase/publicDisplayAuth";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import { friendlyFirebaseError, type FriendlyError } from "@/firebase/errors";
import { requireActiveSession, lifecycleMessage } from "@/firebase/lifecycle";
import { usePrivacyStore } from "@/stores/privacyStore";
import { DayResolutionPanel, DuskReview } from "@/features/life/DayResolution";
import { LifeEventsPanel } from "@/features/life/LifeEventsPanel";
import { useMediaQuery } from "@/components/useMediaQuery";
import type { RoleId } from "@/stores/types";

const PHASE_LABEL: Record<string, string> = {
  setup: "Setup",
  night: "Night",
  day: "Day",
  ended: "Ended",
};

export function GameScreen() {
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) =>
    game ? selectScriptById(s, game.scriptId) : undefined
  );
  const lobby = useStorytellerStore((s) => s.lobby);
  const undoStack = useStorytellerStore((s) => s.undoStack);
  const undo = useStorytellerStore((s) => s.undo);
  const advancePhase = useStorytellerStore((s) => s.advancePhase);
  const endGame = useStorytellerStore((s) => s.endGame);
  const setView = useStorytellerStore((s) => s.setView);
  const setLobby = useStorytellerStore((s) => s.setLobby);
  const selectedPlayerId = useStorytellerStore((s) => s.selectedPlayerId);
  const privacyMode = usePrivacyStore((s) => s.enabled);
  const togglePrivacyMode = usePrivacyStore((s) => s.toggle);

  const [almanacOpen, setAlmanacOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [goLiveError, setGoLiveError] = useState<FriendlyError | null>(null);
  const { backend, online: onlineMap, pending: pendingOnlineCount, presence, leaveRequests } = useSessionRuntime();
  const [leaveInFlight, setLeaveInFlight] = useState<Set<string>>(new Set());
  const [leaveErrors, setLeaveErrors] = useState<Record<string, string>>({});
  const [ending, setEnding] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [nightPanelOpen, setNightPanelOpen] = useState(false);
  const [setupPanelOpen, setSetupPanelOpen] = useState(false);
  const [queuePopupOpen, setQueuePopupOpen] = useState(false);
  // Which roles in the bag Silverwick most recently auto-filled (Fill/Re-roll
  // Bag) -- lifted above SetupPanel so the pinned/generated distinction
  // survives closing and reopening Setup within this Grimoire session. Not
  // part of game/Firebase state: purely local UI provenance, never authority.
  const [generatedRoleIds, setGeneratedRoleIds] = useState<RoleId[]>([]);
  const narrowScreen = useMediaQuery("(max-width: 760px)");
  const moreActionsRef = useRef<HTMLButtonElement>(null);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  // Phase 10A: Day Resolution, the dusk safety check, and the bounded
  // recent Life Events (corrections) panel.
  const [dayResolutionOpen, setDayResolutionOpen] = useState(false);
  const [duskReviewOpen, setDuskReviewOpen] = useState(false);
  const [lifeEventsOpen, setLifeEventsOpen] = useState(false);
  // 10A-ASTRA-003: turning Privacy Mode on closes every Life Event-bearing
  // dialog at once (each also renders nothing private under Privacy Mode).
  useEffect(() => {
    if (!privacyMode) return;
    setDayResolutionOpen(false);
    setDuskReviewOpen(false);
    setLifeEventsOpen(false);
  }, [privacyMode]);
  // Phase 9C.6 (OPUS-002): the current Public Display capability token, held
  // only in this component's local/runtime state — never in
  // useStorytellerStore.game, persistence, checkpoints, or any projection.
  const [displayToken, setDisplayToken] = useState<string | null>(null);
  const [displayLinkError, setDisplayLinkError] = useState<string | null>(null);
  const [displayLinkBusy, setDisplayLinkBusy] = useState(false);
  const onlineCount = Object.values(onlineMap).filter(Boolean).length;
  const closeOverflow = () => setOverflowMenuOpen(false);

  const copyLobbyCode = async () => {
    if (!lobby) return;
    try {
      await navigator.clipboard.writeText(formatCode(lobby.code));
      setCopyToast("Copied lobby code");
    } catch {
      setCopyToast("Copy failed — select and copy manually");
    }
    window.setTimeout(() => setCopyToast(null), 1500);
  };

  const revokeAndCommitPlayer = async (playerId: string, completion: OccupancyCompletion) => {
    if (!lobby) {
      completion.commit();
      return;
    }
    if (!backend) {
      throw new Error("Firebase is reconnecting. The player was not changed locally.");
    }
    try {
      await revokePlayerAndCommit(backend, lobby.code, playerId, completion);
    } catch (e) {
      const friendly = friendlyFirebaseError(e, "st");
      throw new Error(`${friendly.title}: ${friendly.message}`);
    }
  };

  // Phase 9R.6: the intended local completion is declared explicitly and
  // recorded durably with the revocation, so recovery can finish exactly it.
  const removeSelectedPlayer = (playerId: string) =>
    revokeAndCommitPlayer(playerId, storytellerOccupancyCompletion("remove", playerId));

  const unseatSelectedPlayer = (playerId: string) =>
    revokeAndCommitPlayer(playerId, storytellerOccupancyCompletion("unseat", playerId));

  // Phase 9C.3 (OPUS-003): pending-departure surface. A stale error for a
  // uid whose request has since resolved (accepted, rejected, or otherwise
  // cleared) elsewhere must not resurface against a later, unrelated
  // request from the same uid.
  useEffect(() => {
    setLeaveErrors(prev => {
      const next: Record<string, string> = {};
      for (const uid of Object.keys(prev)) if (uid in leaveRequests) next[uid] = prev[uid]!;
      return next;
    });
  }, [leaveRequests]);

  const setLeaveBusy = (uid: string, busy: boolean) => setLeaveInFlight(prev => {
    const next = new Set(prev);
    if (busy) next.add(uid); else next.delete(uid);
    return next;
  });

  const acceptLeave = async (uid: string) => {
    if (!lobby || !backend || leaveInFlight.has(uid)) return;
    setLeaveBusy(uid, true);
    setLeaveErrors(prev => { const { [uid]: _omit, ...rest } = prev; return rest; });
    try {
      await acceptLeaveRequest(backend, lobby.code, uid, playerId => storytellerOccupancyCompletion("unseat", playerId));
    } catch (e) {
      const friendly = friendlyFirebaseError(e, "st");
      setLeaveErrors(prev => ({ ...prev, [uid]: `${friendly.title}: ${friendly.message}` }));
    } finally {
      setLeaveBusy(uid, false);
    }
  };

  const keepPlayerSeated = async (uid: string) => {
    if (!lobby || !backend || leaveInFlight.has(uid)) return;
    setLeaveBusy(uid, true);
    setLeaveErrors(prev => { const { [uid]: _omit, ...rest } = prev; return rest; });
    try {
      await rejectLeaveRequest(backend, lobby.code, uid);
    } catch (e) {
      const friendly = friendlyFirebaseError(e, "st");
      setLeaveErrors(prev => ({ ...prev, [uid]: `${friendly.title}: ${friendly.message}` }));
    } finally {
      setLeaveBusy(uid, false);
    }
  };

  // Auto-open night panel whenever phase transitions to "night".
  useEffect(() => {
    if (game?.phase === "night") setNightPanelOpen(true);
  }, [game?.phase]);

  // Setup is deliberately never auto-opened: Go Live and Setup are
  // independent, parallel actions the Storyteller chooses between, and
  // neither should push toward the other.

  // Phase 9C.6 (OPUS-002): ensure a Public Display capability exists once a
  // live lobby, its session id, and the LIVE runtime writer are all present.
  // `backend` here is useSessionRuntime's own runtime backend — set only
  // after finishLive() completes, and cleared to null on stop/close/
  // conflict/incoherent — never a writer obtained any other way (LOAD-
  // BEARING: see PROTOCOL.md). ensurePublicDisplayAccess is read-first and a
  // genuine no-op in steady state, so this effect re-running across an
  // ordinary reconnect (a fresh `backend` instance, same session) commits
  // nothing and never manufactures a reconnect conflict for another
  // Storyteller device. While the runtime writer is unavailable, no
  // displayAccess operation is attempted and the token is cleared so the
  // link controls disable themselves until a live writer is re-established.
  useEffect(() => {
    if (!lobby || !lobby.sessionId || !backend) {
      setDisplayToken(null);
      return;
    }
    let cancelled = false;
    ensurePublicDisplayAccess(backend, lobby.code, lobby.sessionId)
      .then(token => {
        if (cancelled) return;
        // A successful ensure clears any stale error from an earlier failed
        // attempt (Luna revision) — otherwise a genuinely recovered
        // capability would still show an obsolete/false error alongside a
        // now-usable token.
        setDisplayToken(token);
        setDisplayLinkError(null);
      })
      .catch(e => {
        if (cancelled) return;
        const friendly = friendlyFirebaseError(e, "st");
        setDisplayLinkError(`${friendly.title}: ${friendly.message}`);
      });
    return () => { cancelled = true; };
  }, [lobby?.code, lobby?.sessionId, backend]);

  // Luna revision: availability is derived from the CURRENT live runtime
  // `backend`, not merely a previously-fetched `displayToken` — a stale
  // token must not keep Open/Copy usable across a render where the runtime
  // writer has already become unavailable but the passive effect above has
  // not yet cleared it. This must never move into Zustand game state,
  // persistence, checkpoint, projections, or localSeq/undo.
  const displayLink = lobby && backend && displayToken
    ? buildPublicDisplayLink(window.location, lobby.code, displayToken)
    : null;

  const copyDisplayLink = async () => {
    if (!displayLink) return;
    try {
      await navigator.clipboard.writeText(displayLink);
      setCopyToast("Copied display link");
    } catch {
      setCopyToast("Copy failed — select and copy manually");
    }
    window.setTimeout(() => setCopyToast(null), 1500);
  };

  const resetDisplayLink = async () => {
    if (!lobby || !lobby.sessionId || !backend || displayLinkBusy) return;
    setDisplayLinkBusy(true);
    setDisplayLinkError(null);
    try {
      const token = await rotatePublicDisplayAccess(backend, lobby.code, lobby.sessionId);
      setDisplayToken(token);
      setCopyToast("Display link reset — old links no longer work");
      window.setTimeout(() => setCopyToast(null), 1500);
    } catch (e) {
      const friendly = friendlyFirebaseError(e, "st");
      setDisplayLinkError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setDisplayLinkBusy(false);
    }
  };

  const goLive = async () => {
    if (goingLive) return;
    setGoingLive(true);
    setGoLiveError(null);
    if (!isFirebaseConfigured()) {
      setConfigOpen(true);
      setGoingLive(false);
      return;
    }
    try {
      const { backend: b, uid } = await connectFirebase();
      const { code } = await createLobby(b, uid);
      const session = await requireActiveSession(b, code);
      setLobby({ code, uid, sessionId: session.id, status: "live" });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[goLive]", e instanceof Error ? e.message : e);
      setGoLiveError(friendlyFirebaseError(e, "st"));
    } finally {
      setGoingLive(false);
    }
  };

  const almanacRoles = useMemo(
    () => [...(script?.characters ?? []), ...TRAVELERS, ...FABLED, ...LORICS],
    [script]
  );

  if (!game) return null;
  const selected = selectedPlayerId ? game.players[selectedPlayerId] : null;
  const setupVisible = game.phase === "setup" && setupPanelOpen && !!script && !privacyMode;
  const seatedPlayers = Object.values(game.players).filter((p) => !p.isEmpty);
  const playerCount = seatedPlayers.length;
  const setupTravelerCount = game.phase === "setup" ? seatedPlayers.filter(p => p.isTraveler).length : 0;
  const displayedPlayerCount = playerCount - setupTravelerCount;
  const plannedSeatCount = game.seatOrder.length;
  const emptySeatCount = Object.values(game.players).filter((p) => p.isEmpty).length;
  const aliveCount = seatedPlayers.filter((p) => p.alive).length;
  const pendingQueueCount = Object.keys(game.pendingPlayers ?? {}).length;

  const advanceLabel =
    game.phase === "setup"
      ? "Begin night 1"
      : game.phase === "night"
        ? "→ Day"
        : game.phase === "day"
          ? "→ Night"
          : "Game ended";

  return (
    <div className="game" data-phase={game.phase} data-setup-foreground={setupVisible && narrowScreen || undefined}>
      <header className="phase-bar">
        <div className="phase-bar-left">
          <span className="phase-pill" data-phase={game.phase}>
            {PHASE_LABEL[game.phase] ?? game.phase}
          </span>
          {game.day > 0 && (
            <span className="day-counter">Day {game.day}</span>
          )}
          <span className="label">
            {displayedPlayerCount} {displayedPlayerCount === 1 ? "player" : "players"}
            {setupTravelerCount > 0 && ` · ${setupTravelerCount} Traveler${setupTravelerCount === 1 ? "" : "s"}`}
          </span>
          {emptySeatCount > 0 && (
            <span className="label planned-seat-summary">
              {emptySeatCount} empty of {plannedSeatCount} seats
            </span>
          )}
          {playerCount > 0 && (
            <span className="label" title="Alive of total players">
              {aliveCount}/{playerCount} alive
            </span>
          )}
          {lobby && playerCount > 0 && (
            <span className="label" title="Players online">
              {presence === "ready" ? `${onlineCount}/${playerCount} online` : "Presence unknown"}
            </span>
          )}
          {pendingQueueCount > 0 && (
            <button
              type="button"
              className="phase-pill queue-pill-btn"
              style={{ background: "rgba(196,158,80,0.18)", color: "var(--gold-bright)" }}
              title="Open the waiting queue to assign or reject players"
              onClick={() => setQueuePopupOpen(true)}
            >
              {pendingQueueCount} in queue
            </button>
          )}
          {lobby && pendingOnlineCount > 0 && (
            <span className="label" title="Players connected but not yet seated">
              {pendingOnlineCount} waiting
            </span>
          )}
          {lobby && !backend && (
            <span className="phase-pill" style={{ opacity: 0.6 }}>Connecting…</span>
          )}
          {lobby && backend && (
            <span className="lobby-pill" title="Players join with this code">
              code <strong>{formatCode(lobby.code)}</strong>
              <button
                type="button"
                className="lobby-pill-copy"
                onClick={copyLobbyCode}
                aria-label="Copy lobby code"
                title="Copy lobby code"
              >
                ⧉
              </button>
            </span>
          )}
          <button
            type="button"
            className={`btn btn-sm privacy-toggle${privacyMode ? " active" : ""}`}
            aria-pressed={privacyMode}
            aria-label={privacyMode ? "Disable Privacy Mode" : "Enable Privacy Mode"}
            onClick={togglePrivacyMode}
            title={privacyMode ? "Show Storyteller details" : "Hide Storyteller details"}
          >
            {privacyMode ? "Privacy Mode On" : "Privacy Mode"}
          </button>
        </div>
        {/* ⋮ toggle: visible only on narrow viewports via CSS */}
        <button
          className="btn btn-sm phase-bar-overflow-btn"
          ref={moreActionsRef}
          onClick={() => setOverflowMenuOpen((o) => !o)}
          aria-label="More actions"
          aria-expanded={overflowMenuOpen}
        >
          ⋮
        </button>
        {overflowMenuOpen && (
          <div className="phase-overflow-backdrop" onClick={closeOverflow} />
        )}
        <div className={`phase-bar-right${overflowMenuOpen ? " open" : ""}`}>
          <button className="btn btn-sm" onClick={() => { closeOverflow(); setView("home"); }}>
            ← Home
          </button>
          <button className="btn btn-sm" onClick={() => { closeOverflow(); setAlmanacOpen(true); }}>
            Almanac
          </button>
          {game.phase === "setup" && (
            <button
              className={`btn ${setupPanelOpen ? "btn-sm" : "btn-gold"}`}
              onClick={() => { closeOverflow(); setSetupPanelOpen((o) => !o); }}
              title={setupPanelOpen ? "Hide setup helper" : "Show setup helper"}
            >
              {setupPanelOpen ? "hide setup" : "setup"}
            </button>
          )}
          {game.phase === "night" && (
            <button
              className="btn btn-sm"
              onClick={() => { closeOverflow(); setNightPanelOpen((o) => !o); }}
              title={nightPanelOpen ? "Hide night order" : "Show night order"}
            >
              {nightPanelOpen ? "hide order" : "night order"}
            </button>
          )}
          {!lobby && (
            <button className="btn btn-sm" disabled={goingLive} onClick={() => { closeOverflow(); void goLive(); }} title="Create a Firebase lobby and start syncing">
              Go live
            </button>
          )}
          {lobby && (
            <button
              className="btn btn-sm"
              disabled={!displayLink}
              onClick={() => {
                closeOverflow();
                // Synchronous with the click (no await here) once the
                // capability has already been ensured by the effect above —
                // an async open here would trip popup blockers.
                if (displayLink) window.open(displayLink, "_blank", "noopener");
              }}
              title="Open the public projector view in a new tab"
            >
              Public display ↗
            </button>
          )}
          {lobby && (
            <button
              className="btn btn-sm"
              disabled={!displayLink}
              onClick={() => { closeOverflow(); void copyDisplayLink(); }}
              title="Copy a link that authorizes a separate device or projector to view the public display"
            >
              Copy display link
            </button>
          )}
          {lobby && (
            <button
              className="btn btn-sm"
              disabled={!backend || displayLinkBusy}
              onClick={() => { closeOverflow(); void resetDisplayLink(); }}
              title="Revoke the current display link and issue a new one"
            >
              Reset display link
            </button>
          )}
          <button
            className="btn btn-sm"
            onClick={() => { closeOverflow(); undo(); }}
            disabled={undoStack.length === 0}
            title={`${undoStack.length} undo step${undoStack.length === 1 ? "" : "s"}`}
          >
            ↶ Undo
          </button>
          {game.phase === "day" && !privacyMode && (
            <button className="btn btn-sm" onClick={() => { closeOverflow(); setDayResolutionOpen(true); }}
              title="Record the Day's execution or a Traveler exile as it happens">
              Day resolution
            </button>
          )}
          {(game.phase === "night" || game.phase === "day") && !privacyMode && (
            <button className="btn btn-sm" onClick={() => { closeOverflow(); setLifeEventsOpen(true); }}
              title="Review and correct recent deaths, executions, exiles and resurrections">
              Life events
            </button>
          )}
          {game.phase !== "setup" && <button
            className="btn btn-gold"
            onClick={() => {
              closeOverflow();
              // Phase 10A: Day -> Night passes through the dusk review.
              if (game.phase === "day") { setDuskReviewOpen(true); return; }
              const result = advancePhase();
              setPhaseError(result.ok ? null : "Setup changed. Open Setup to review what needs attention.");
            }}
            disabled={game.phase === "ended"}
          >
            {advanceLabel}
          </button>}
          <button
            className="btn btn-sm btn-danger"
            disabled={ending}
            onClick={async () => {
              closeOverflow();
              if (ending || !window.confirm("End this game and return to home?")) return;
              setEnding(true);
              try { await closeMultiplayerSession(); endGame(); }
              catch (error) { setGoLiveError({ title: "Could not end lobby", message: lifecycleMessage(error) }); }
              finally { setEnding(false); }
            }}
          >
            End game
          </button>
        </div>
      </header>

      {phaseError && !privacyMode && <p role="alert">{phaseError}</p>}
      {!privacyMode && (game.fabled.length > 0 || (game.lorics?.length ?? 0) > 0) && (
        <div className="fabled-strip">
          {game.fabled.length > 0 && (
            <>
              <span className="fabled-strip-label">Fabled</span>
              {game.fabled.map((id) => {
                const f = FABLED.find((x) => x.id === id);
                return (
                  <span key={id} className="fabled-strip-item" title={f?.ability}>
                    {f?.name ?? id}
                  </span>
                );
              })}
            </>
          )}
          {(game.lorics?.length ?? 0) > 0 && (
            <>
              <span className="fabled-strip-label">Lorics</span>
              {(game.lorics ?? []).map((id) => {
                const l = LORICS.find((x) => x.id === id);
                return (
                  <span key={id} className="loric-strip-item" title={l?.ability}>
                    {l?.name ?? id}
                  </span>
                );
              })}
            </>
          )}
        </div>
      )}

      {Object.keys(leaveRequests).length > 0 && (
        <div className="leave-requests-bar" role="region" aria-label="Leave requests">
          <span className="leave-requests-bar-title">Leave requests</span>
          {Object.entries(leaveRequests).map(([uid, requestPlayerId]) => {
            const seat = requestPlayerId ? game.players[requestPlayerId] : undefined;
            const name = seat && !seat.isEmpty ? seat.name : "A player";
            const busy = leaveInFlight.has(uid);
            const rowError = leaveErrors[uid];
            return (
              <div className="leave-request-row" key={uid}>
                <span className="leave-request-text">{name} requested to leave</span>
                <button className="btn btn-sm" disabled={busy} onClick={() => void keepPlayerSeated(uid)}>
                  Keep seated
                </button>
                <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void acceptLeave(uid)}>
                  Accept leave
                </button>
                {rowError && (
                  <div className="error-list leave-request-error" role="alert">
                    <p>{rowError}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="game-body">
        {setupVisible && script && (
          <SetupPanel
            game={game}
            script={script}
            onClose={() => setSetupPanelOpen(false)}
            foreground={narrowScreen}
            returnFocusRef={moreActionsRef}
            generatedRoleIds={generatedRoleIds}
            onGeneratedRoleIdsChange={setGeneratedRoleIds}
          />
        )}
        {game.phase === "night" && nightPanelOpen && script && (
          <NightOrderPanel
            game={game}
            script={script}
            onClose={() => setNightPanelOpen(false)}
          />
        )}
        <GrimoireCircle online={onlineMap} backend={backend} code={lobby?.code ?? ""} />
      </div>

      {queuePopupOpen && (
        <SeatAssignPopup
          backend={backend}
          code={lobby?.code ?? ""}
          onClose={() => setQueuePopupOpen(false)}
        />
      )}

      {dayResolutionOpen && !privacyMode && game.phase === "day" && (
        <DayResolutionPanel onClose={() => setDayResolutionOpen(false)} />
      )}
      {duskReviewOpen && game.phase === "day" && (
        <DuskReview
          onClose={() => setDuskReviewOpen(false)}
          onRecord={() => { setDuskReviewOpen(false); setDayResolutionOpen(true); }}
          onContinue={() => {
            setDuskReviewOpen(false);
            const result = advancePhase();
            setPhaseError(result.ok ? null : "Setup changed. Open Setup to review what needs attention.");
          }}
        />
      )}
      {lifeEventsOpen && !privacyMode && (game.phase === "night" || game.phase === "day") && (
        <LifeEventsPanel onClose={() => setLifeEventsOpen(false)} />
      )}

      {selected && (
        <PlayerDrawer
          player={selected}
          onRemove={removeSelectedPlayer}
          onUnseat={unseatSelectedPlayer}
        />
      )}
      {almanacOpen && !privacyMode && (
        <Almanac
          title={script ? `Almanac · ${script.name}` : "Almanac"}
          roles={almanacRoles}
          onClose={() => setAlmanacOpen(false)}
        />
      )}
      {configOpen && (
        <FirebaseConfigDialog
          onClose={() => setConfigOpen(false)}
          onSaved={() => {
            setConfigOpen(false);
            goLive();
          }}
        />
      )}
      {goLiveError && (
        <div className="error-list lobby-error" role="alert">
          <strong>{goLiveError.title}</strong>
          <p>{goLiveError.message}</p>
          <button
            className="btn btn-sm"
            onClick={() => setGoLiveError(null)}
          >
            dismiss
          </button>
        </div>
      )}
      {displayLinkError && (
        <div className="error-list lobby-error" role="alert">
          <p>{displayLinkError}</p>
          <button
            className="btn btn-sm"
            onClick={() => setDisplayLinkError(null)}
          >
            dismiss
          </button>
        </div>
      )}
      {copyToast && (
        <div className="toast" role="status">
          {copyToast}
        </div>
      )}
    </div>
  );
}
