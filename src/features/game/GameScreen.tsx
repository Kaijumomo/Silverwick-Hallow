import { VotingProvider, VotingDayControls, useVotingInteraction } from "@/features/voting/VotingWorkspace";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { Modal } from "@/components/Modal";
import { useEffect, useMemo, useRef, useState } from "react";
import { gameLifecycleToken, useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { isTabletTrial } from "@/config/trial";
import { GrimoireIcon } from "@/components/GrimoireIcon";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { PlayersWorkspace } from "@/features/players/PlayersWorkspace";
import { ModernNightPanel } from "@/features/nightOrder/ModernNightPanel";
import { SeatAssignPopup } from "@/features/grimoire/SeatAssignPopup";
import { iconUrlFor } from "@/data/iconUrl";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { resolvedCharacters } from "@/data/roleRegistry";
import { connectFirebase } from "@/firebase/session";
import { isFirebaseConfigured } from "@/firebase/config";
import { createLobby, formatCode } from "@/firebase/lobby";
import { acceptLeaveRequest, rejectLeaveRequest, revokePlayerAndCommit, storytellerOccupancyCompletion, type OccupancyCompletion } from "@/firebase/membershipCommands";
import { closeMultiplayerSession, closeSupersededLobby, useSessionRuntime } from "@/firebase/storytellerSync";
import { ConnectionStatus } from "@/firebase/StorytellerSession";
import { ensurePublicDisplayAccess, rotatePublicDisplayAccess, buildPublicDisplayLink } from "@/firebase/publicDisplayAuth";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import { friendlyFirebaseError, type FriendlyError } from "@/firebase/errors";
import { requireActiveSession } from "@/firebase/lifecycle";
import { usePrivacyStore } from "@/stores/privacyStore";
import { LifeEventsPanel } from "@/features/life/LifeEventsPanel";
import { ActivityPanel } from "@/features/activity/ActivityPanel";
import { DawnReview } from "@/features/nightOrder/DawnReview";
import { RuleFactStrip } from "@/features/ruleFacts/RuleFactStrip";
import { EndedParticipantReview } from "./EndedParticipantReview";
import { deriveNightWork, unfinishedNightWork, stepResolved } from "@/features/nightOrder/nightWork";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { buildRegistry } from "@/data/roleRegistry";
import { useShellLayout } from "@/components/useShellLayout";
import { useShellStore } from "@/stores/shellStore";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FinishGameDialog, GameResultSummary } from "./ResultDeclaration";

const PHASE_LABEL: Record<string, string> = {
  setup: "Setup",
  night: "Night",
  day: "Day",
  ended: "Ended",
};

export function GameScreen() {
  return <VotingProvider><GameScreenContent /></VotingProvider>;
}

function GameScreenContent() {
  const voting = useVotingInteraction();
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

  const [inviteOpen, setInviteOpen] = useState(false);
  const resultButtonRef = useRef<HTMLButtonElement>(null);
  const canUndoEnding = useStorytellerStore(s => s.canUndoFinishedGame);
  const nightCursor = useShellStore(s => s.nightCursor);
  const [configOpen, setConfigOpen] = useState(false);
  const [goLiveError, setGoLiveError] = useState<FriendlyError | null>(null);
  const { backend, online: onlineMap, pending: pendingOnlineCount, presence, leaveRequests, status: sessionStatus } = useSessionRuntime();
  const [leaveInFlight, setLeaveInFlight] = useState<Set<string>>(new Set());
  const [leaveErrors, setLeaveErrors] = useState<Record<string, string>>({});
  const [ending, setEnding] = useState(false);
  // Phase 10H: result declaration and the post-game summary (session-local UI).
  const [finishOpen, setFinishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const terminalClosing = useStorytellerStore((s) => s.terminalClose?.status === "closing");
  const mutationLocked = useStorytellerStore(s => s.terminalClose?.status === "closing" || !!s.terminalClose?.confirmedRecovery || !!s.terminalClose?.recoveryPending);
  const pendingEndingRecovery = useStorytellerStore(s => !!s.terminalClose?.recoveryPending);
  useEffect(() => { if (pendingEndingRecovery) setFinishOpen(true); }, [pendingEndingRecovery]);
  const [goingLive, setGoingLive] = useState(false);
  const [nightOpenRequest, setNightOpenRequest] = useState(0);
  const [advancedPlayerId, setAdvancedPlayerId] = useState<string | null>(null);
  useEffect(() => { setAdvancedPlayerId(current => current === selectedPlayerId ? current : null); }, [selectedPlayerId]);
  const [queuePopupOpen, setQueuePopupOpen] = useState(false);
  // ASTRA-10G-002: an open waiting queue never survives the game ending.
  const gameEnded = useStorytellerStore((s) => s.game?.phase === "ended");
  useEffect(() => { if (gameEnded) setQueuePopupOpen(false); }, [gameEnded]);
  const layout = useShellLayout();
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  const [lifeEventsOpen, setLifeEventsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [dawnReviewOpen, setDawnReviewOpen] = useState(false);
  useEffect(() => {
    if (privacyMode) { setLifeEventsOpen(false); setActivityOpen(false); setDawnReviewOpen(false); setSummaryOpen(false); }
  }, [privacyMode]);
  // Phase 9C.6 (OPUS-002): the current Public Display capability token, held
  // only in this component's local/runtime state — never in
  // useStorytellerStore.game, persistence, checkpoints, or any projection.
  const [displayToken, setDisplayToken] = useState<string | null>(null);
  const [displayLinkError, setDisplayLinkError] = useState<string | null>(null);
  const [displayLinkBusy, setDisplayLinkBusy] = useState(false);
  const onlineCount = Object.values(onlineMap).filter(Boolean).length;

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
    // ASTRA-10G-001: Go Live belongs to the game it started for. Every await
    // below can outlive that game (Finish game, Discard setup, New game), so
    // the continuation revalidates before creating and before adopting a
    // lobby. A lobby created for a game that is gone is closed
    // authoritatively (the fenced writer close), never attached or orphaned.
    const lifecycle = gameLifecycleToken();
    const stillEligible = () => {
      const now = useStorytellerStore.getState();
      return gameLifecycleToken() === lifecycle && !!now.game && now.game.phase !== "ended" && !now.lobby;
    };
    try {
      const { backend: b, uid } = await connectFirebase();
      if (!stillEligible()) return;
      const { code } = await createLobby(b, uid);
      const session = await requireActiveSession(b, code);
      const created = { code, uid, sessionId: session.id, status: "live" as const };
      // setLobby itself also refuses an ended game (defense in depth).
      if (!stillEligible() || !setLobby(created)) {
        // A failed cleanup is reported by closeSupersededLobby itself into the
        // page-global runtime (ASTRA-10G-R1-001): this screen may already be
        // gone, so its own error state would never be seen.
        try { await closeSupersededLobby(b, created); }
        catch (closeError) {
          // eslint-disable-next-line no-console
          console.error("[goLive] superseded lobby close", closeError instanceof Error ? closeError.message : closeError);
        }
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[goLive]", e instanceof Error ? e.message : e);
      setGoLiveError(friendlyFirebaseError(e, "st"));
    } finally {
      setGoingLive(false);
    }
  };

  // CLOSURE-03: ONE displayed definition per RoleId. The script's characters
  // and the Traveler catalogue come first, exactly as Role resolution defines
  // them (resolvedCharacters: first definition, the canonical Traveler over any
  // script definition of the same id, an admitted ordinary owner kept against
  // Fabled/Loric). A Fabled or Loric catalogue entry is then listed only when
  // its RoleId is not already displayed -- never as a second definition of an
  // id (LUNA-CLOSURE-03-R1: e.g. a homebrew Townsfolk `bigwig` vs the Loric).
  const almanacRoles = useMemo(() => {
    const roles = resolvedCharacters(script);
    const shown = new Set(roles.map((role) => role.id));
    for (const role of [...FABLED, ...LORICS]) {
      if (shown.has(role.id)) continue;
      shown.add(role.id);
      roles.push(role);
    }
    return roles;
  }, [script]);

  const registry = useMemo(() => buildRegistry(script ?? { id: game?.scriptId ?? "", name: "", characters: [] }), [script, game?.scriptId]);

  const performUndo = () => {
    if (privacyMode || mutationLocked) return;
    const state = useStorytellerStore.getState();
    const before = state.game;
    if (!before) return;
    try {
      useTargetPicker.getState().cancel();
      if (state.selectedPlayerId !== null) state.selectPlayer(null);
      setAdvancedPlayerId(null);
      if (before.phase === "ended") {
        const result = state.undoFinishedGame();
        setPhaseError(result.ok ? null : result.message);
        if (result.ok) { setSummaryOpen(false); if (result.message) setCopyToast(result.message); }
        return;
      }
      const undoResult = undo();
      if (undoResult && !undoResult.ok) { setPhaseError(undoResult.message); return; }
      setPhaseError(null);
      const after = useStorytellerStore.getState().game;
      if (after && after !== before && after.phase === "night") {
        const work = deriveNightWork(after, { script: script ?? null, registry, semantics: CANONICAL_ABILITY_SEMANTICS });
        const reopened = work.steps.find(step => !stepResolved(after, step) && (before.day !== after.day || before.phase !== "night" || stepResolved(before, step)));
        if (reopened) useShellStore.getState().setNightCursor({ day: after.day, stepKey: reopened.stepKey });
      }
    } catch {
      setPhaseError("This device could not save Undo. Check browser storage before continuing.");
    }
  };
  useEffect(() => {
    const keyboardUndo = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.defaultPrevented || event.altKey || event.repeat || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== "z" || target?.isContentEditable || target?.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],[role="dialog"]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault(); performUndo();
    };
    document.addEventListener("keydown", keyboardUndo);
    return () => document.removeEventListener("keydown", keyboardUndo);
  });

  if (!game) return null;
  const ended = game.phase === "ended";
  const nightUnfinished = () => unfinishedNightWork(game, deriveNightWork(game, { script: script ?? null, registry, semantics: CANONICAL_ABILITY_SEMANTICS }));
  const selected = selectedPlayerId ? game.players[selectedPlayerId] : null;
  const seatedPlayers = Object.values(game.players).filter(p => !p.isEmpty);
  const playerCount = seatedPlayers.length;
  const aliveCount = seatedPlayers.filter(p => p.alive).length;
  const voteCount = seatedPlayers.filter(p => p.alive || p.ghostVote).length;
  const pendingQueueCount = Object.keys(game.pendingPlayers ?? {}).length;
  const inspectorVisible = !!selected && !ended && advancedPlayerId === selected.id && !privacyMode;
  const scriptEmblem = script?.characters.find(role => role.type === "demon");
  const steps = game.phase === "night" && !privacyMode ? deriveNightWork(game, { script: script ?? null, registry, semantics: CANONICAL_ABILITY_SEMANTICS }).steps : [];
  const currentStep = (nightCursor?.day === game.day ? steps.find(step => step.stepKey === nightCursor.stepKey) : undefined) ?? steps.find(step => !stepResolved(game, step));
  const actingName = currentStep?.kind === "player" ? currentStep.effectiveRoleName : null;
  const phasePrimary = <div className="phase-primary">
    <button type="button" className="grimoire-undo" aria-label={ended ? "Undo ending" : "Undo last change"} title="Undo last change (Ctrl+Z)"
      disabled={privacyMode || mutationLocked || (ended ? !canUndoEnding : undoStack.length === 0)} onClick={performUndo}><GrimoireIcon name="return" size={16} /></button>
    <span className="grimoire-phase-divider" aria-hidden="true" />
    {ended ? <>
      <button ref={resultButtonRef} type="button" className="grimoire-phase-label grimoire-result-label" disabled={privacyMode} onClick={() => setSummaryOpen(true)} aria-label="Game summary"><GrimoireIcon name="day" size={15} />{game.result ? (game.result.winner === "good" ? "Good wins" : "Evil wins") : "Game ended"}</button>
      <button className="btn btn-gold phase-advance" onClick={() => setView("home")}>New game</button>
    </> : <>
      <span className="grimoire-phase-label"><GrimoireIcon name={game.phase === "night" ? "night" : "day"} size={15} strokeWidth={1.7} />{PHASE_LABEL[game.phase]}{game.phase !== "setup" ? (" " + game.day) : ""}</span>
      {actingName && <button className="grimoire-acting" onClick={() => setNightOpenRequest(value => value + 1)}>{actingName} is awake</button>}
      {!mutationLocked && <VotingDayControls />}
      {game.phase !== "setup" && <button className="btn btn-gold phase-advance" disabled={privacyMode || mutationLocked} onClick={() => {
        if (game.phase === "day") { voting?.show("finish"); return; }
        if (nightUnfinished().total > 0) { setDawnReviewOpen(true); return; }
        const result = advancePhase(); setPhaseError(result.ok ? null : "Setup changed. Open Players to review what needs attention.");
      }} title={privacyMode ? "Turn off Privacy Mode before continuing" : undefined} aria-describedby={privacyMode ? "phase-advance-reason" : undefined}>{game.phase === "day" ? ("Begin Night " + (game.day + 1)) : "Begin Day"}</button>}
      {privacyMode && game.phase !== "setup" && <span id="phase-advance-reason" className="disabled-reason phase-advance-reason">Turn off Privacy Mode first</span>}
    </>}
  </div>;

  return (
    <div className="game" data-phase={game.phase} data-grimoire-modern>
      <header className="phase-bar">
        <div className="phase-bar-left">
          <div className="grimoire-script-heading"><span className="grimoire-script-art" aria-hidden="true">{scriptEmblem ? <img src={iconUrlFor(scriptEmblem)} alt="" /> : "✧"}</span><div><h1>{script?.name ?? "Grimoire"}</h1><div className="grimoire-header-meta"><span>{playerCount} players · {aliveCount} alive · {voteCount} votes</span><button type="button" className="privacy-toggle" aria-pressed={privacyMode} aria-label={privacyMode ? "Disable Privacy Mode" : "Enable Privacy Mode"} onClick={togglePrivacyMode}><GrimoireIcon name="reveal" size={14} />{privacyMode ? "Show tokens" : "Hide tokens"}</button></div></div></div>
          {pendingQueueCount > 0 && !ended && <button type="button" className="phase-pill queue-pill-btn" onClick={() => setQueuePopupOpen(true)}>{pendingQueueCount} in queue</button>}
        </div>
        {!ended && <button type="button" className="grimoire-invite" aria-label="Invite" onClick={() => setInviteOpen(true)}><span>Invite</span>{lobby && <strong>{formatCode(lobby.code)}</strong>}<GrimoireIcon name="qr" size={17} /></button>}
      </header>
      {inviteOpen && <Modal title="Invite players" onClose={() => setInviteOpen(false)} className="grimoire-invite-dialog"><div className="dialog-body">
        {lobby ? <><p>Players join with code <strong>{formatCode(lobby.code)}</strong>.</p><button className="btn" onClick={() => void copyLobbyCode()}>Copy lobby code</button><p>{presence === "ready" ? (onlineCount + "/" + playerCount + " online") : "Presence unknown"}{pendingOnlineCount > 0 ? (" · " + pendingOnlineCount + " waiting") : ""}</p>{!backend && <p role="status">{sessionStatus === "reconnecting" ? "Reconnecting…" : "Connecting…"}</p>}<div className="grimoire-invite-actions"><button className="btn" disabled={!displayLink} onClick={() => { if (displayLink) window.open(displayLink, "_blank", "noopener"); }}>Public display ↗</button><button className="btn" disabled={!displayLink} onClick={() => void copyDisplayLink()}>Copy display link</button><button className="btn" disabled={!backend || displayLinkBusy} onClick={() => void resetDisplayLink()}>Reset display link</button></div></> : <><p>The Grimoire is ready for in-person play.</p>{!isTabletTrial && <button className="btn" disabled={goingLive || mutationLocked} onClick={() => void goLive()}>Go live</button>}</>}
      </div></Modal>}
      {lobby && <ConnectionStatus />}
      {ended && (
        <div className="sr-only" role="status">
          Finished game — read-only review of the final state.
        </div>
      )}
      {goLiveError && (
        <div className="connection-status" data-tone="error" role="alert">
          <strong>{goLiveError.title}</strong>
          <span className="connection-status-message">{goLiveError.message}</span>
          <span className="connection-status-actions">
            <button className="btn btn-sm" onClick={() => setGoLiveError(null)}>dismiss</button>
          </span>
        </div>
      )}
      {displayLinkError && (
        <div className="connection-status" data-tone="error" role="alert">
          <span className="connection-status-message">{displayLinkError}</span>
          <span className="connection-status-actions">
            <button className="btn btn-sm" onClick={() => setDisplayLinkError(null)}>dismiss</button>
          </span>
        </div>
      )}
      {phaseError && !privacyMode && <p role="alert">{phaseError}</p>}
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
                {busy && <span className="disabled-reason" role="status">Updating…</span>}
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

      {ended && summaryOpen && !privacyMode && script && <GameResultSummary game={game} registry={registry}
        onReview={() => { setSummaryOpen(false); window.requestAnimationFrame(() => resultButtonRef.current?.focus()); }}
        onActivity={() => { setSummaryOpen(false); setActivityOpen(true); }} onNewGame={() => setView("home")} onHome={() => setView("home")} />}
      <PlayersWorkspace key={gameLifecycleToken()} enabled
        nightOpenRequest={nightOpenRequest}
        nightKey={game.phase === "night" && script ? (gameLifecycleToken() + ":" + game.day) : undefined}
        night={game.phase === "night" && script ? (visible, close) => <ModernNightPanel game={game} script={script} visible={visible} onClose={close} /> : undefined}
        onEnd={game.phase === "day" || game.phase === "night" ? () => setFinishOpen(true) : undefined} endDisabled={terminalClosing || ending}
        onReviewHistory={ended && !privacyMode ? () => setActivityOpen(true) : undefined}
        onDiscardSetup={game.phase === "setup" ? () => setDiscardOpen(true) : undefined}
        supplementalInfo={!privacyMode && <>{(game.phase === "day" || game.phase === "night") && <button type="button" className="players-text-button" disabled={mutationLocked} onClick={() => setActivityOpen(true)}>Correct information records</button>}<details className="grimoire-rule-details"><summary>Game rules &amp; modifiers</summary><p>{[...game.fabled, ...(game.lorics ?? [])].map(id => registry.get(id)?.name ?? FABLED.find(r => r.id === id)?.name ?? LORICS.find(r => r.id === id)?.name ?? id).join(" · ") || "No active modifiers"}</p>{game.phase !== "setup" && <RuleFactStrip game={game} readOnly={ended || mutationLocked} />}</details></>}
        roles={almanacRoles} onMore={setAdvancedPlayerId} advancedPlayerId={advancedPlayerId}>
        <div className="game-body" data-layout={layout}>
          <div className="shell-stage" role="region" aria-label="Grimoire"><GrimoireCircle online={onlineMap} backend={backend} code={lobby?.code ?? ""} /></div>
          {inspectorVisible && <div className="shell-pane shell-inspector"><PlayerDrawer player={selected!} onRemove={removeSelectedPlayer} onUnseat={unseatSelectedPlayer} onCorrectOutcome={game.phase !== "setup" && !mutationLocked ? () => setLifeEventsOpen(true) : undefined} /></div>}
        </div>
        {!voting?.open && <div className="grimoire-phase-dock">{phasePrimary}</div>}
      </PlayersWorkspace>
      {finishOpen && !ended && (
        <FinishGameDialog multiplayer={!!lobby} onClose={() => setFinishOpen(false)}
          onEnded={() => { setFinishOpen(false); setSummaryOpen(true); useStorytellerStore.getState().selectPlayer(null); }} />
      )}
      {discardOpen && game.phase === "setup" && (
        <ConfirmDialog title="Discard this setup?" confirmLabel="Discard setup" danger busy={ending}
          onCancel={() => setDiscardOpen(false)}
          onConfirm={async () => {
            if (ending) return;
            setEnding(true);
            // Setup discard is not Finish Game: nothing was played, so the
            // setup is dropped (after any lobby closes authoritatively).
            try { await closeMultiplayerSession(); setDiscardOpen(false); endGame(); }
            catch { setDiscardOpen(false); /* shown by ConnectionStatus */ }
            finally { setEnding(false); }
          }}>
          <p>Nothing has been played yet. The setup is dropped and you return Home.</p>
        </ConfirmDialog>
      )}

      {/* ASTRA-10G-002: the ended review is read-only, membership included --
          an open queue unmounts the moment the game ends. */}
      {queuePopupOpen && !ended && (
        <SeatAssignPopup
          backend={backend}
          code={lobby?.code ?? ""}
          onClose={() => setQueuePopupOpen(false)}
        />
      )}

      {dawnReviewOpen && game.phase === "night" && !privacyMode && (
        <DawnReview
          game={game}
          unfinished={nightUnfinished()}
          onClose={() => setDawnReviewOpen(false)}
          onReviewNight={() => {
            setDawnReviewOpen(false);
            setNightOpenRequest(value => value + 1);
          }}
          onContinue={() => {
            setDawnReviewOpen(false);
            const result = advancePhase();
            setPhaseError(result.ok ? null : "Setup changed. Open Players to review what needs attention.");
          }}
        />
      )}
      {lifeEventsOpen && (game.phase === "night" || game.phase === "day") && (
        <LifeEventsPanel onClose={() => setLifeEventsOpen(false)} />
      )}
      {activityOpen && !privacyMode && game.phase !== "setup" && (
        <ActivityPanel game={game} registry={registry} readOnly={game.phase === "ended" || mutationLocked} initialFilter={game.phase === "ended" ? undefined : { category: "information" }} title={game.phase === "ended" ? undefined : "Information records"} onClose={() => setActivityOpen(false)} />
      )}

      {selected && ended && (
        <EndedParticipantReview player={selected} game={game} registry={registry} onClose={() => useStorytellerStore.getState().selectPlayer(null)} />
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
      {copyToast && (
        <div className="toast" role="status">
          {copyToast}
        </div>
      )}
    </div>
  );
}
