import { useEffect, useMemo, useRef, useState } from "react";
import { useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import { Almanac } from "@/features/almanac/Almanac";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { SetupPanel } from "@/features/setup/SetupPanel";
import { TRAVELERS } from "@/data/travelers";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { connectFirebase } from "@/firebase/session";
import { isFirebaseConfigured } from "@/firebase/config";
import { createLobby, formatCode } from "@/firebase/lobby";
import { revokePlayerAndCommit } from "@/firebase/membershipCommands";
import { closeMultiplayerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import { friendlyFirebaseError, type FriendlyError } from "@/firebase/errors";
import { requireActiveSession, lifecycleMessage } from "@/firebase/lifecycle";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useMediaQuery } from "@/components/useMediaQuery";

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
  const { backend, online: onlineMap, pending: pendingOnlineCount, presence } = useSessionRuntime();
  const [ending, setEnding] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [nightPanelOpen, setNightPanelOpen] = useState(false);
  const [setupPanelOpen, setSetupPanelOpen] = useState(false);
  const narrowScreen = useMediaQuery("(max-width: 760px)");
  const moreActionsRef = useRef<HTMLButtonElement>(null);
  const [overflowMenuOpen, setOverflowMenuOpen] = useState(false);
  const [copyToast, setCopyToast] = useState<string | null>(null);
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

  const revokeAndCommitPlayer = async (playerId: string, commitLocal: () => boolean) => {
    if (!lobby) {
      commitLocal();
      return;
    }
    if (!backend) {
      throw new Error("Firebase is reconnecting. The player was not changed locally.");
    }
    try {
      await revokePlayerAndCommit(backend, lobby.code, playerId, commitLocal);
    } catch (e) {
      const friendly = friendlyFirebaseError(e, "st");
      throw new Error(`${friendly.title}: ${friendly.message}`);
    }
  };

  const removeSelectedPlayer = (playerId: string) =>
    revokeAndCommitPlayer(playerId, () => useStorytellerStore.getState().removePlayer(playerId));

  const unseatSelectedPlayer = (playerId: string) =>
    revokeAndCommitPlayer(playerId, () => useStorytellerStore.getState().unseatPlayer(playerId));

  // Auto-open night panel whenever phase transitions to "night".
  useEffect(() => {
    if (game?.phase === "night") setNightPanelOpen(true);
  }, [game?.phase]);

  // Auto-open setup panel whenever phase transitions to "setup".
  useEffect(() => {
    if (game?.phase === "setup") setSetupPanelOpen(true);
  }, [game?.phase]);

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
            {playerCount} {playerCount === 1 ? "player" : "players"}
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
            <span className="phase-pill" style={{ background: "rgba(196,158,80,0.18)", color: "var(--gold-bright)" }} title="Players in queue waiting to be assigned a seat">
              {pendingQueueCount} in queue
            </span>
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
              className="btn btn-sm"
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
              onClick={() => {
                closeOverflow();
                window.open(
                  `?display=public&code=${encodeURIComponent(lobby.code)}`,
                  "_blank",
                  "noopener"
                );
              }}
              title="Open the public projector view in a new tab"
            >
              Public display ↗
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
          <button
            className="btn btn-gold"
            onClick={() => { closeOverflow(); advancePhase(); }}
            disabled={game.phase === "ended"}
          >
            {advanceLabel}
          </button>
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

      <div className="game-body">
        {setupVisible && script && (
          <SetupPanel
            game={game}
            script={script}
            onClose={() => setSetupPanelOpen(false)}
            foreground={narrowScreen}
            returnFocusRef={moreActionsRef}
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
      {copyToast && (
        <div className="toast" role="status">
          {copyToast}
        </div>
      )}
    </div>
  );
}
