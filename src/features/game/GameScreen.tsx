import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { gameLifecycleToken, useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { VotingProvider, VotingDayControls, VotingCard, useVotingInteraction } from "@/features/voting/VotingWorkspace";
import { isTabletTrial } from "@/config/trial";
import { GrimoireIcon } from "@/components/GrimoireIcon";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { Almanac } from "@/features/almanac/Almanac";
import { PlayersWorkspace } from "@/features/players/PlayersWorkspace";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { ModernNightPanel } from "@/features/nightOrder/ModernNightPanel";
import { SetupPanel } from "@/features/setup/SetupPanel";
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
import { deriveNightWork, unfinishedNightWork } from "@/features/nightOrder/nightWork";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { buildRegistry } from "@/data/roleRegistry";
import { useShellLayout } from "@/components/useShellLayout";
import { Segmented } from "@/components/Segmented";
import { useShellStore, type TableLens } from "@/stores/shellStore";
import { LabelsView, RosterView } from "@/features/grimoire/RosterView";
import { ACTION_CARD_DOCK_HOST, ACTION_CARD_STAGE_HOST } from "@/components/ActionCard";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { FinishGameDialog, GameResultSummary } from "./ResultDeclaration";
import type { RoleId } from "@/stores/types";

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

  const [almanacOpen, setAlmanacOpen] = useState(false);
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
  const [goingLive, setGoingLive] = useState(false);
  const [nightPanelOpen, setNightPanelOpen] = useState(false);
  const [nightOpenRequest, setNightOpenRequest] = useState(0);
  const [setupPanelOpen, setSetupPanelOpen] = useState(false);
  const [advancedPlayerId, setAdvancedPlayerId] = useState<string | null>(null);
  useEffect(() => { setAdvancedPlayerId(current => current === selectedPlayerId ? current : null); }, [selectedPlayerId]);
  const [queuePopupOpen, setQueuePopupOpen] = useState(false);
  // ASTRA-10G-002: an open waiting queue never survives the game ending.
  const gameEnded = useStorytellerStore((s) => s.game?.phase === "ended");
  useEffect(() => { if (gameEnded) setQueuePopupOpen(false); }, [gameEnded]);
  // Which roles in the bag Silverwick most recently auto-filled (Fill/Re-roll
  // Bag) -- lifted above SetupPanel so the pinned/generated distinction
  // survives closing and reopening Setup within this Grimoire session. Not
  // part of game/Firebase state: purely local UI provenance, never authority.
  const [generatedRoleIds, setGeneratedRoleIds] = useState<RoleId[]>([]);
  // Phase 10H (contract §5): desktop coordinated regions; tablet ONE dock;
  // phone ONE bottom workspace. All shell state is session-local (shellStore).
  const layout = useShellLayout();
  const docked = layout !== "desktop";
  const dockTab = useShellStore((s) => s.dockTab);
  const setDockTab = useShellStore((s) => s.setDockTab);
  const lens = useShellStore((s) => s.lens);
  const actionOpen = useShellStore((s) => s.actionOpen);
  const actionRequest = useShellStore((s) => s.actionRequest);
  // A Night action opened (or resumed) on a docked layout brings the Night
  // surface -- where its card lives -- forward. ASTRA-10H-009: EVERY tap on
  // the lit actor (actionRequest) does so too, even when the action was
  // already open (actionOpen true -> true) but the Storyteller had hidden the
  // dock. Only the actor tap bumps actionRequest; inspecting a participant
  // never does, so inspection never reopens the Night dock.
  useEffect(() => { if (actionOpen && layout === "phone") { setDockTab("night"); setNightPanelOpen(true); } }, [actionOpen, layout, actionRequest]);
  const setLens = useShellStore((s) => s.setLens);
  const moreActionsRef = useRef<HTMLButtonElement>(null);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [phaseError, setPhaseError] = useState<string | null>(null);
  // Phase 10A: Day Resolution, the dusk safety check, and the bounded
  // recent Life Events (corrections) panel.
  const [lifeEventsOpen, setLifeEventsOpen] = useState(false);
  // Phase 10G: the Storyteller-private Activity surface.
  const [activityOpen, setActivityOpen] = useState(false);
  // Phase 10G: the Night -> Day review of unfinished Night work.
  const [dawnReviewOpen, setDawnReviewOpen] = useState(false);
  // ASTRA-10H-005: Privacy Mode removes private DOM WITHOUT moving the Table.
  // The shell tracks private content occupied at the instant Privacy turns on
  // -- the desktop action-card column, the docked Night workspace's height --
  // are measured synchronously inside that state change (before React
  // unmounts anything; never during render) and held by empty, non-private
  // structural placeholders while Privacy is on.
  const railRef = useRef<HTMLDivElement>(null);
  const ruleFactsRef = useRef<HTMLDivElement>(null);
  type PrivacyShell = { actionColumn: boolean; railHeight: number | null; ruleFactsHeight: number };
  const shellBeforePrivacy = useRef<PrivacyShell>({ actionColumn: false, railHeight: null, ruleFactsHeight: 0 });
  const [privacyShell, setPrivacyShell] = useState<PrivacyShell | null>(null);
  useEffect(() => usePrivacyStore.subscribe((next, prev) => {
    if (!next.enabled || prev.enabled) return;
    const cardShown = !!document.querySelector(`#${ACTION_CARD_STAGE_HOST} > .action-card:not([hidden])`);
    const rail = railRef.current;
    shellBeforePrivacy.current = {
      actionColumn: !docked && cardShown,
      railHeight: docked && rail && !rail.hidden ? rail.getBoundingClientRect().height : null,
      ruleFactsHeight: ruleFactsRef.current?.getBoundingClientRect().height ?? 0,
    };
  }), [docked]);
  useLayoutEffect(() => {
    setPrivacyShell(privacyMode ? shellBeforePrivacy.current : null);
    if (!privacyMode) shellBeforePrivacy.current = { actionColumn: false, railHeight: null, ruleFactsHeight: 0 };
  }, [privacyMode]);
  // 10A-ASTRA-003: turning Privacy Mode on closes every Life Event-bearing
  // dialog at once (each also renders nothing private under Privacy Mode).
  useEffect(() => {
    if (!privacyMode) return;
    setLifeEventsOpen(false);
    setActivityOpen(false);
    setDawnReviewOpen(false);
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
    if (game?.phase === "night") { setNightPanelOpen(true); setDockTab("night"); }
  }, [game?.phase]);
  // Selecting a participant brings the Seat workspace forward in the one dock;
  // clearing the selection returns the dock to Night.
  useEffect(() => { setDockTab(selectedPlayerId ? "seat" : "night"); }, [selectedPlayerId]);

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

  if (!game) return null;
  // Phase 10G (Section 18): a finished game is a read-only review -- no
  // ordinary game-mutating control is mounted at all.
  const ended = game.phase === "ended";
  const modernReference = layout !== "phone";
  /** Phase 10G: tonight's unfinished work, from the ONE shared derivation the
   * Night Order renders (never restated here). */
  const nightUnfinished = () => unfinishedNightWork(game, deriveNightWork(game, { script: script ?? null, registry, semantics: CANONICAL_ABILITY_SEMANTICS }));
  const selected = selectedPlayerId ? game.players[selectedPlayerId] : null;
  const setupVisible = !modernReference && game.phase === "setup" && setupPanelOpen && !!script && !privacyMode;
  const seatedPlayers = Object.values(game.players).filter((p) => !p.isEmpty);
  const playerCount = seatedPlayers.length;
  const setupTravelerCount = game.phase === "setup" ? seatedPlayers.filter(p => p.isTraveler).length : 0;
  const displayedPlayerCount = playerCount - setupTravelerCount;
  const plannedSeatCount = game.seatOrder.length;
  const emptySeatCount = Object.values(game.players).filter((p) => p.isEmpty).length;
  const aliveCount = seatedPlayers.filter((p) => p.alive).length;
  const pendingQueueCount = Object.keys(game.pendingPlayers ?? {}).length;

  const nightRail = !modernReference && game.phase === "night" && !!script;
  const inspectorVisible = !!selected && !ended && (!modernReference || advancedPlayerId === selected.id);
  // H3: on a phone at RS-20 density the Roster replaces the Table.
  const rosterReplacesTable = layout === "phone" && game.seatOrder.length > 15;
  const effectiveLens: TableLens = rosterReplacesTable && lens === "table" ? "roster"
    : privacyMode && lens === "labels" ? "table" : lens;

  const advanceLabel =
    game.phase === "setup"
      ? "Begin night 1"
      : game.phase === "night"
        ? "→ Day"
        : game.phase === "day"
          ? "→ Night"
          : "Game ended";

  const scriptEmblem = script?.characters.find(role => role.type === "demon");

  const phasePrimary = game.phase !== "setup" && !ended ? (
    <div className="phase-primary">
      {modernReference && <span className="grimoire-phase-label"><GrimoireIcon name={game.phase === "night" ? "night" : "day"} size={15} strokeWidth={1.7} />{PHASE_LABEL[game.phase]} {game.day}</span>}
      <VotingDayControls />
      <button
        className="btn btn-gold phase-advance"
        onClick={() => {
          closeOverflow();
          // Phase 10A: Day -> Night passes through the dusk review, a
          // private Storyteller dialog -- unavailable under Privacy Mode
          // (10A-ASTRA-003); turn Privacy Mode off, then review.
          if (game.phase === "day") { if (!privacyMode) voting?.show("finish"); return; }
          // Phase 10G: Night -> Day passes through Dawn Review when
          // tonight's work is unfinished (advisory -- the Storyteller may
          // continue anyway); a clean Night advances directly. Like Dusk,
          // it is private review: unavailable under Privacy Mode.
          if (game.phase === "night") {
            if (privacyMode) return;
            if (nightUnfinished().total > 0) { setDawnReviewOpen(true); return; }
          }
          const result = advancePhase();
          setPhaseError(result.ok ? null : "Setup changed. Open Players to review what needs attention.");
        }}
        disabled={privacyMode}
        title={game.phase === "day" && privacyMode ? "Turn off Privacy Mode to review the Day before continuing to Night"
          : game.phase === "night" && privacyMode ? "Turn off Privacy Mode to review the Night before continuing to Day" : undefined}
        aria-describedby={privacyMode ? "phase-advance-reason" : undefined}
      >
        {game.phase === "day" ? `Begin Night ${game.day + 1}` : advanceLabel}
      </button>
      {privacyMode && (
        <span id="phase-advance-reason" className="disabled-reason phase-advance-reason">
          Turn off Privacy Mode first
        </span>
      )}
    </div>
  ) : null;

  return (
    <div className="game" data-phase={game.phase} data-grimoire-modern={modernReference || undefined}>
      <header className="phase-bar">
        <div className="phase-bar-left">
          {modernReference && <div className="grimoire-script-heading">
            <span className="grimoire-script-art" aria-hidden="true">{scriptEmblem ? <img src={iconUrlFor(scriptEmblem)} alt="" /> : "✧"}</span>
            <h1>{script?.name ?? "Grimoire"}</h1>
          </div>}
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
          {pendingQueueCount > 0 && !ended && (
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
            <span className="phase-pill" style={{ opacity: 0.6 }} role="status">
              {sessionStatus === "reconnecting" ? "Reconnecting…" : sessionStatus === "connecting" || sessionStatus === "idle" ? "Connecting…" : "Not live"}
            </span>
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
            Privacy<span className="privacy-toggle-word"> Mode</span>{privacyMode ? " On" : ""}
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
          {!modernReference && <button className="btn btn-sm" onClick={() => { closeOverflow(); setAlmanacOpen(true); }}>
            Almanac
          </button>}
          {game.phase === "setup" && !modernReference && (
            <button
              className={`btn ${setupPanelOpen ? "btn-sm" : "btn-gold"}`}
              onClick={() => { closeOverflow(); setSetupPanelOpen((o) => !o); }}
              title={setupPanelOpen ? "Hide setup helper" : "Show setup helper"}
            >
              {setupPanelOpen ? "hide setup" : "setup"}
            </button>
          )}
          {!modernReference && game.phase === "night" && (
            <button
              className="btn btn-sm"
              onClick={() => { closeOverflow(); setNightPanelOpen((o) => !o); }}
              title={nightPanelOpen ? "Hide night order" : "Show night order"}
            >
              {nightPanelOpen ? "hide order" : "night order"}
            </button>
          )}
          {!lobby && !ended && !isTabletTrial && (
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
          {!ended && <button
            className="btn btn-sm"
            onClick={() => { closeOverflow(); undo(); }}
            disabled={undoStack.length === 0}
            title={`${undoStack.length} undo step${undoStack.length === 1 ? "" : "s"}`}
          >
            ↶ Undo
          </button>}
          {game.phase === "day" && !privacyMode && (
            <button className="btn btn-sm" onClick={() => { closeOverflow(); voting?.show("history"); }}
              title="Review and correct today's recorded votes">
              Nominations
            </button>
          )}
          {game.phase !== "setup" && !privacyMode && (
            <button className="btn btn-sm" onClick={() => { closeOverflow(); setActivityOpen(true); }}
              title="Review what changed and what was told this game">
              Activity
            </button>
          )}
          {(game.phase === "night" || game.phase === "day") && !privacyMode && (
            <button className="btn btn-sm" onClick={() => { closeOverflow(); setLifeEventsOpen(true); }}
              title="Review and correct recent deaths, executions, exiles and resurrections">
              Life events
            </button>
          )}

          {(game.phase === "night" || game.phase === "day") && <button
            className="btn btn-sm btn-danger"
            disabled={ending || terminalClosing}
            onClick={() => {
              closeOverflow();
              // Phase 10H (§14): the Storyteller DECLARES the result (Good /
              // Evil / End Without Result) in a true confirmation; every
              // terminal intent goes through the one terminal seam.
              setFinishOpen(true);
            }}
          >
            {terminalClosing ? "Ending…" : "Finish game"}
          </button>}
          {game.phase === "setup" && <button
            className="btn btn-sm btn-danger"
            disabled={ending}
            onClick={() => { closeOverflow(); setDiscardOpen(true); }}
          >
            Discard setup
          </button>}
          {ended && !summaryOpen && !privacyMode && (
            <button className="btn btn-sm btn-gold" onClick={() => { closeOverflow(); setSummaryOpen(true); }}>Game summary</button>
          )}
          {ended && (
            <button className="btn btn-sm" onClick={() => { closeOverflow(); setView("newgame"); }}>New game</button>
          )}
        </div>
        {/* Phase 10H (Forward rule): the current phase-advance action is the
            Storyteller's primary control and stays directly visible at every
            width -- never inside the generic overflow menu. A disabled advance
            says why, adjacent and in words (10H-AC-067). */}
        {!modernReference && phasePrimary}
      </header>

      {lobby && <ConnectionStatus />}
      {ended && (
        <div className="ended-review-banner" role="status">
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

      {/* ASTRA-10H-005: under Privacy the (private) rule facts are unmounted and
          an EMPTY slot of their pre-Privacy height keeps the Table in place. */}
      {!privacyMode && game.phase !== "setup" && (
        <div ref={ruleFactsRef} className="rule-fact-slot"><RuleFactStrip game={game} readOnly={game.phase === "ended"} /></div>
      )}
      {privacyMode && !!privacyShell?.ruleFactsHeight && (
        <div className="rule-fact-slot" aria-hidden="true" style={{ height: privacyShell.ruleFactsHeight, flex: "none" }} />
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

      {ended && summaryOpen && !privacyMode && script ? (
        <GameResultSummary game={game} registry={registry}
          onReview={() => setSummaryOpen(false)}
          onActivity={() => { setSummaryOpen(false); setActivityOpen(true); }}
          onNewGame={() => setView("newgame")}
          onHome={() => setView("home")} />
      ) : (
      <PlayersWorkspace key={gameLifecycleToken()} enabled={modernReference}
        nightOpenRequest={nightOpenRequest}
        nightKey={modernReference && game.phase === "night" && script ? `${gameLifecycleToken()}:${game.day}` : undefined}
        night={modernReference && game.phase === "night" && script ? (visible, close) => <ModernNightPanel game={game} script={script} visible={visible} onClose={close} /> : undefined}
        roles={almanacRoles} onMore={setAdvancedPlayerId} advancedPlayerId={advancedPlayerId}>
      <div className="game-body" data-layout={layout} data-dock={docked ? dockTab : undefined}>
        {setupVisible && script && (
          <SetupPanel
            game={game}
            script={script}
            onClose={() => setSetupPanelOpen(false)}
            // Phase 10H (§10; 10H-AC-025): Setup is a Grimoire-centred stage
            // workspace on every layout -- on a phone the ONE bottom workspace
            // -- never a modal takeover page.
            foreground={false}
            returnFocusRef={moreActionsRef}
            generatedRoleIds={generatedRoleIds}
            onGeneratedRoleIdsChange={setGeneratedRoleIds}
          />
        )}
        {/* Phase 10H (§§5.1, 5.4, 8.1): the Night task rail exists only at
            Night. It stays MOUNTED for the whole Night (hidden, not unmounted,
            when the Storyteller hides it or the dock shows another surface),
            so the current step keeps owning the action context and an open
            action card can be resumed. Privacy Mode unmounts its contents. */}
        {nightRail && (
          // ASTRA-10H-008: on a docked layout the Night dock shows only while
          // its tab is active AND the Storyteller has not closed it -- the same
          // nightPanelOpen the Close control and the reopen toggle change.
          <div ref={railRef} className="shell-pane shell-rail" hidden={docked ? dockTab !== "night" || !nightPanelOpen : !nightPanelOpen}
            style={privacyShell?.railHeight ? { height: privacyShell.railHeight, maxHeight: "none" } : undefined}>
            {/* Docked layouts (ASTRA-10H-002): the action card renders here as
                the dock's ACTIVE content -- the Night list steps aside while it
                shows (CSS), and its Night-list control / Resume swap back. */}
            {docked && <div id={ACTION_CARD_DOCK_HOST} className="action-card-dock-host" />}
            <NightOrderPanel
              game={game}
              script={script!}
              onClose={() => setNightPanelOpen(false)}
            />
          </div>
        )}
        <div className="shell-stage" role="region" aria-label="Grimoire" data-action-column={privacyShell?.actionColumn ? "privacy" : undefined}>
          <div className="stage-toolbar">
            <Segmented<TableLens> label="View" className="lens-switch" value={effectiveLens} onChange={setLens} options={[
              { value: "table", label: "Table", disabled: rosterReplacesTable, hint: rosterReplacesTable ? "too many seats for the phone Table — the Roster replaces it" : undefined },
              { value: "roster", label: "Roster" },
              // ASTRA-10H-005: under Privacy the Labels lens (full Effect /
              // Reminder detail) is withheld rather than shown disabled with a
              // reason line, so the toolbar -- and the Table -- never move.
              ...(privacyMode ? [] : [{ value: "labels" as const, label: "Labels" }]),
            ]} />
          </div>
          {/* Desktop: the action card takes its own column beside the Table. */}
          {!docked && <div id={ACTION_CARD_STAGE_HOST} className="action-card-stage-host" />}
          {effectiveLens === "table"
            ? <GrimoireCircle online={onlineMap} backend={backend} code={lobby?.code ?? ""} />
            : effectiveLens === "roster" ? <RosterView /> : <LabelsView />}
          {effectiveLens !== "table" && <VotingCard inline />}
        </div>
        {inspectorVisible && (
          <div className="shell-pane shell-inspector" hidden={docked && nightRail && dockTab !== "seat"}>
            <PlayerDrawer
              player={selected!}
              onRemove={removeSelectedPlayer}
              onUnseat={unseatSelectedPlayer}
            />
          </div>
        )}
        {docked && nightRail && inspectorVisible && (
          <div className="dock-tabs" role="tablist" aria-label="Workspace">
            <button type="button" role="tab" aria-selected={dockTab === "night"} className="dock-tab" onClick={() => { setDockTab("night"); setNightPanelOpen(true); }}>
              Night {game.day}
            </button>
            <button type="button" role="tab" aria-selected={dockTab === "seat"} className="dock-tab" onClick={() => setDockTab("seat")}>
              {selected!.name || `Seat ${selected!.seat + 1}`}
            </button>
          </div>
        )}
      </div>
      {modernReference && phasePrimary && !voting?.open && <div className="grimoire-phase-dock">{phasePrimary}</div>}
      </PlayersWorkspace>
      )}
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
            if (modernReference) setNightOpenRequest(value => value + 1);
            else { setNightPanelOpen(true); setDockTab("night"); }
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
        <ActivityPanel game={game} registry={registry} readOnly={game.phase === "ended"} onClose={() => setActivityOpen(false)} />
      )}

      {selected && ended && (
        <EndedParticipantReview player={selected} game={game} registry={registry} onClose={() => useStorytellerStore.getState().selectPlayer(null)} />
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
      {copyToast && (
        <div className="toast" role="status">
          {copyToast}
        </div>
      )}
    </div>
  );
}
