import { useCallback, useEffect, useMemo, useState } from "react";
import { lifeAccessibleLabel, publicLifeStateOf } from "@/stores/lifeState";
import { LifeStateText } from "@/features/life/LifeMarks";
import { PrivateInformation } from "./PrivateInformation";
import { usePlayerStore } from "@/stores/playerStore";
import { connectFirebase } from "@/firebase/session";
import { isFirebaseConfigured, getConfigSource } from "@/firebase/config";
import { acknowledgeReveal, applyJoinIntent, chooseTraveler, joinLobby, leaveLobby, useOwnTravelerChoice, usePlayerSync } from "@/firebase/playerSync";
import { lifecycleMessage } from "@/firebase/lifecycle";
import { FirebaseConfigScreen } from "./phone/FirebaseConfigScreen";
import { SignInScreen } from "./phone/SignInScreen";
import { WaitingScreen } from "./phone/WaitingScreen";
import { PreGameFlow, showsPreGame } from "./phone/PreGameFlow";
import { ConnectingScreen, FailureScreen, formatCode, KnockingScreen, LeavingScreen, ReconnectingScreen, RejectedScreen, RevokedScreen } from "./phone/PhoneStates";
import type { RoomBackend } from "@/firebase/backend";
import { lookupOfficialRole } from "@/data/officialRoles";
import { getBuiltinScript } from "@/data/scripts";
import { iconUrlFor } from "@/data/iconUrl";
import type { PublicLobbyRecord, RoleDef } from "@/stores/types";
import { Modal } from "@/components/Modal";
import { SeatNotePopup } from "./SeatNotePopup";
import { SeatNotePreview } from "./SeatNotePreview";
import { PlayerTabs } from "./PlayerTabs";
import { AlmanacBody } from "@/features/almanac/AlmanacBody";
import { RemoteScreenBoundary } from "@/features/remote/RemoteScreenBoundary";
import { DATA_ERROR_MESSAGE, CONNECTION_ERROR_MESSAGE } from "@/firebase/snapshots";
import { PlayerEnded, PlayerEnding } from "./PlayerTerminal";
import { clearJoinPrefill, peekJoinPrefill } from "@/features/home/joinPrefill";

type PlayerTab = "role" | "town" | "more";

type Props = {
  initialCode?: string;
  /** Leaves the player flow for Home; injectable for tests. */
  goHome?: () => void;
};

const defaultGoHome = () => window.location.assign(window.location.pathname);

export function PlayerScreen({ initialCode, goHome = defaultGoHome }: Props) {
  return <RemoteScreenBoundary><PlayerScreenContent initialCode={initialCode} goHome={goHome} /></RemoteScreenBoundary>;
}

function PlayerScreenContent({ initialCode, goHome = defaultGoHome }: Props) {
  // Name handed over once by Home (never via the URL). Read without clearing so
  // StrictMode's double render keeps it, then cleared on mount: single use.
  const [prefillName, setPrefillName] = useState(() => peekJoinPrefill(initialCode));
  useEffect(() => { clearJoinPrefill(); }, []);
  const consumePrefill = useCallback(() => setPrefillName(null), []);
  const status = usePlayerStore((s) => s.status);
  const code = usePlayerStore((s) => s.code);
  const requestedName = usePlayerStore((s) => s.requestedName);
  const playerId = usePlayerStore((s) => s.playerId);
  const self = usePlayerStore((s) => s.self);
  const publicLobby = usePlayerStore((s) => s.publicLobby);
  const revealed = usePlayerStore((s) => s.revealed);
  const terminalResult = usePlayerStore((s) => s.terminalResult);
  const ownRevealAck = usePlayerStore((s) => s.ownRevealAck);
  const error = usePlayerStore((s) => s.error);
  const remoteData = usePlayerStore((s) => s.remoteData);

  const setRevealed = usePlayerStore((s) => s.setRevealed);
  const reset = usePlayerStore((s) => s.reset);

  const [retry, setRetry] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [backend, setBackend] = useState<RoomBackend | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  // The connection attempt's own failure (never a join-submit error), and the
  // code typed on the sign-in screen while the knock is in flight.
  const [connectFailure, setConnectFailure] = useState<string | null>(null);
  const [submittedCode, setSubmittedCode] = useState("");
  const [submittedName, setSubmittedName] = useState("");
  const [activeTab, setActiveTab] = useState<PlayerTab>("role");
  const [travelerChoiceBusyId, setTravelerChoiceBusyId] = useState<string | null>(null);
  // Package 3 (3B): the pre-game ceremony (circle, reveal, team) is over once
  // the player enters the town. Local only, so a reload re-seals the token.
  const [entered, setEntered] = useState(false);
  // Acknowledging mid-ceremony flips the reveal mode to "seen"; this keeps the
  // player in the ceremony until they enter the town themselves.
  const [ceremonyActive, setCeremonyActive] = useState(false);
  const [travelerChoiceError, setTravelerChoiceError] = useState<string | null>(null);
  const [ackBusy, setAckBusy] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    setConnectFailure(null);
    if (!isFirebaseConfigured()) {
      if (getConfigSource() === "env") {
        const message = "Unable to connect — contact your Storyteller.";
        usePlayerStore.getState().setStatus("error", message);
        setConnectFailure(message);
      } else {
        setConfigOpen(true);
      }
      return;
    }
    (async () => {
      try {
        const { backend: b, uid } = await connectFirebase();
        if (!mounted) return;
        applyJoinIntent(retry === 0 ? initialCode : undefined, uid);
        setBackend(b);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[player connect]", e instanceof Error ? e.message : e);
        const message = lifecycleMessage(e);
        usePlayerStore.getState().setStatus("error", message);
        setConnectFailure(message);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [initialCode, retry]);

  usePlayerSync(backend, retry);
  // A new identity in Setup starts the ceremony again.
  const revealToken = self?.revealToken;
  useEffect(() => {
    if (usePlayerStore.getState().publicLobby?.phase === "setup") setEntered(false);
  }, [revealToken]);
  // CLOSURE-01: the player's own pending Traveler request, if any.
  const pendingTravelerChoice = useOwnTravelerChoice(backend, status === "seated");

  const leave = async () => {
    if (!backend || leaving) return;
    setLeaving(true);
    try { await leaveLobby(backend); }
    catch (error) { usePlayerStore.getState().setStatus("error", lifecycleMessage(error)); }
    finally { setLeaving(false); }
  };

  // Script characters — used by Town note popup and Almanac tab.
  const scriptCharacters = useMemo((): RoleDef[] => {
    if (!publicLobby?.scriptId) return [];
    return getBuiltinScript(publicLobby.scriptId)?.characters ?? [];
  }, [publicLobby?.scriptId]);

  // Almanac roles: script + active Fabled + active Lorics + seated Travelers.
  const playerAlmanacRoles = useMemo((): RoleDef[] => {
    if (!publicLobby) return scriptCharacters;
    const roles: RoleDef[] = [...scriptCharacters];

    for (const id of publicLobby.fabled ?? []) {
      const r = lookupOfficialRole(id);
      if (r) roles.push(r);
    }
    for (const id of publicLobby.lorics ?? []) {
      const r = lookupOfficialRole(id);
      if (r) roles.push(r);
    }

    const seenTravelerIds = new Set<string>();
    for (const p of Object.values(publicLobby.players)) {
      if (p.isTraveler && p.publicDisplayRole && !seenTravelerIds.has(p.publicDisplayRole)) {
        const r = lookupOfficialRole(p.publicDisplayRole);
        if (r) { roles.push(r); seenTravelerIds.add(p.publicDisplayRole); }
      }
    }

    return roles;
  }, [scriptCharacters, publicLobby]);

  const onJoinSubmit = async (joinCode: string, name: string) => {
    setSubmittedCode(joinCode);
    setSubmittedName(name);
    if (!backend) {
      usePlayerStore
        .getState()
        .setStatus("error", "Not connected to Firebase yet — try again in a moment.");
      return;
    }
    try {
      const { uid } = await connectFirebase();
      await joinLobby(backend, joinCode, uid, name);
      const joinedCode = usePlayerStore.getState().code;
      if (joinedCode) window.history.replaceState(null, "", `?join=${encodeURIComponent(joinedCode)}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[joinSubmit]", e instanceof Error ? e.message : e);
      usePlayerStore
        .getState()
        .setStatus("error", lifecycleMessage(e));
    }
  };

  const back = () => { reset(); goHome(); };
  const ownSeat = publicLobby && playerId ? publicLobby.players[playerId]?.seat : undefined;
  const seatNumber = ownSeat === undefined ? null : ownSeat + 1;
  const retryConnection = () => { setConnectFailure(null); setRetry(value => value + 1); };

  if (configOpen && getConfigSource() !== "env") {
    return (
      <FirebaseConfigScreen
        onClose={() => setConfigOpen(false)}
        onSaved={async () => {
          try {
            const { backend: b } = await connectFirebase();
            setBackend(b);
            setConfigOpen(false);
          } catch {
            // Stay in config view if connect fails
          }
        }}
      />
    );
  }

  if (status === "ended") {
    return <PlayerEnded result={terminalResult} onRetry={() => setRetry(value => value + 1)} onBack={() => back()} />;
  }

  if (status === "ending") return <PlayerEnding />;

  // 1b: the join request is being written. The store has no code yet, so the
  // eyebrow uses what the player typed.
  if (status === "knocking" && !code) return <KnockingScreen code={submittedCode} />;

  // Join screens that need no session code: rejected / revoked / not found at
  // join time, and the connection attempt's own failure.
  if (!code && (status === "rejected" || status === "revoked")) {
    return status === "rejected"
      ? <RejectedScreen code={submittedCode} name="Guest" message={error} onBack={back} />
      : <RevokedScreen code={submittedCode} name="Guest" seat={null} message={error} onBack={back} />;
  }
  if (!code && status === "notFound") {
    // Failed join: return to Sign in with the name and code still filled in,
    // so the code can be corrected without starting over.
    return <FailureScreen label="not-found" eyebrow={submittedCode ? formatCode(submittedCode) : "Silverwick Hollow"} title="Lobby unavailable" message={error} onBack={() => reset()} />;
  }
  if (!code && !backend && connectFailure) {
    return (
      <FailureScreen
        label="connect-failed"
        eyebrow="Silverwick Hollow"
        title="Lobby unavailable"
        message={connectFailure}
        onRetry={retryConnection}
        onCancel={back}
        {...(getConfigSource() !== "env" ? { onSettings: () => setConfigOpen(true) } : {})}
      />
    );
  }

  if (!code || status === "idle" || status === "configuring") {
    // 1a: the join form is not usable until the backend is connected.
    if (!backend && isFirebaseConfigured()) return <ConnectingScreen />;
    return (
      <SignInScreen
        key={`${initialCode ?? ""}|${submittedCode}`}
        initialCode={submittedCode || (initialCode ?? "")}
        initialName={submittedName || (prefillName ?? "")}
        error={error}
        onBack={back}
        onSubmit={async (joinCode, name) => { consumePrefill(); await onJoinSubmit(joinCode, name); }}
      />
    );
  }

  const ownName = requestedName ?? "";
  if (status === "connecting" || status === "knocking") return <ConnectingScreen />;
  if (status === "reconnecting") return <ReconnectingScreen code={code} name={ownName} />;

  const remoteFailure = Object.values(remoteData).find((value) => value === "invalid" || value === "error");
  if (remoteFailure) {
    return (
      <FailureScreen
        label="data-unavailable"
        eyebrow={formatCode(code)}
        title="Game data unavailable"
        message={remoteFailure === "invalid" ? DATA_ERROR_MESSAGE : CONNECTION_ERROR_MESSAGE}
        onRetry={retryConnection}
        onCancel={() => void leave()}
      />
    );
  }

  if (status === "waiting") {
    // A1: the public, names-only arrivals list (Setup only). Never the
    // private waiting queue, uids or seat bindings.
    return (
      <WaitingScreen
        ownName={ownName}
        arrivals={publicLobby?.arrivals}
        planned={publicLobby?.plannedPlayers}
        leaving={leaving}
        onLeave={() => void leave()}
      />
    );
  }

  if (status === "leaving") {
    return <LeavingScreen code={code} seat={seatNumber} seatCount={publicLobby?.seatOrder.length || 12} />;
  }

  if (status === "rejected") return <RejectedScreen code={code} name={ownName} message={error} onBack={back} />;
  if (status === "revoked") return <RevokedScreen code={code} name={ownName} seat={seatNumber} message={error} onBack={back} />;
  if (status === "error" || status === "notFound") {
    return (
      <FailureScreen
        label={status === "notFound" ? "not-found" : "error"}
        eyebrow={formatCode(code)}
        title="Lobby unavailable"
        message={error}
        {...(status === "error" ? { onRetry: retryConnection, onCancel: () => void leave() } : { onBack: back })}
      />
    );
  }

  if (!publicLobby) {
    return <div className="player player-status" role="status"><h2>Waiting for game data…</h2><p>The Storyteller's game is synchronizing.</p></div>;
  }

  // Phase 9 Setup finalization B4: the normal workflow is "Storyteller
  // marks player as Traveler -> this device shows 'Choose your Traveler'".
  // Driven entirely by the player's own public roster entry -- once the
  // Storyteller (or this submission, once applied) sets a publicDisplayRole,
  // this reactively clears with no separate bookkeeping. The Storyteller's
  // manual override (TravelerArrival) remains fully available throughout;
  // this is not a lock.
  const myPublicRecord = playerId ? publicLobby.players[playerId] : undefined;
  const needsTravelerChoice = !!myPublicRecord?.isTraveler && !myPublicRecord.publicDisplayRole;

  const chooseTravelerRole = async (roleId: string) => {
    if (!backend) { setTravelerChoiceError("Not connected. Reconnect and try again."); return; }
    // A pending request is immutable until the Storyteller clears it: never a
    // replacement write (the server rule refuses one anyway).
    if (pendingTravelerChoice) return;
    setTravelerChoiceError(null);
    setTravelerChoiceBusyId(roleId);
    try { await chooseTraveler(backend, roleId); }
    catch (e) { setTravelerChoiceError(lifecycleMessage(e)); }
    finally { setTravelerChoiceBusyId(null); }
  };

  const acknowledge = async () => {
    if (!backend || ackBusy) return;
    setCeremonyActive(true);
    setAckBusy(true);
    setAckError(null);
    try { await acknowledgeReveal(backend); }
    catch (e) { setAckError(lifecycleMessage(e)); }
    finally { setAckBusy(false); }
  };
  const token = self?.revealToken;
  const mode = revealModeOf(token, ownRevealAck);
  const acked = !!token && ownRevealAck === token;
  const milestone = playerMilestone(publicLobby, !!self, acked);
  const ownLife = self?.life ? lifeStateOfSelf(self.life) : null;

  // Package 3 (3B): before the game, the circle, the sealed token and (for
  // evil players the Storyteller briefed) the team. Nothing private renders
  // until the player turns their own token.
  if (needsTravelerChoice || (!entered && (ceremonyActive || showsPreGame(publicLobby.phase, !!self, mode, needsTravelerChoice)))) {
    return (
      <PreGameFlow
        publicLobby={publicLobby}
        playerId={playerId}
        ownName={ownName}
        self={self}
        mode={mode}
        acknowledged={acked}
        needsTravellerChoice={needsTravelerChoice}
        pendingTravellerId={pendingTravelerChoice}
        busyTravellerId={travelerChoiceBusyId}
        travellerError={travelerChoiceError}
        onChooseTraveller={(id) => void chooseTravelerRole(id)}
        onAcknowledge={() => void acknowledge()}
        onEnter={() => { setRevealed(false); setCeremonyActive(false); setEntered(true); }}
      />
    );
  }

  // Seated -- Phase 10H (§§11.1-11.2): a personal window -- phase, name, one
  // short public-safe status line, the current view, and touch-safe bottom
  // navigation. Leave is secondary (under More).
  return (
    <div className="player player-shell player-seated">
      <header className="player-shell-header">
        <span className="player-phase">{milestone.phase}</span>
        <span className="player-name">{requestedName}</span>
        <p className="player-status-line" role="status">{milestone.line}</p>
      </header>

      <main className="player-main">
        {activeTab === "role" && <>
          {ownLife && (
            // F7 (10H-AC-039): the player's OWN Life, privately -- also at Night.
            <p className="player-own-life">You: <LifeStateText state={ownLife} /></p>
          )}
          <SealedCard
            self={self}
            revealed={revealed}
            mode={mode}
            onReveal={() => setRevealed(true)}
            onHide={() => setRevealed(false)}
            {...(token && backend ? { onAcknowledge: () => void acknowledge() } : {})}
            ackState={acked ? "done" : ackBusy ? "busy" : "idle"}
            ackError={ackError}
          />
        </>}

        {activeTab === "town" && (
          <TownView
            publicLobby={publicLobby}
            ownPlayerId={playerId}
            code={code}
            scriptCharacters={scriptCharacters}
          />
        )}

        {activeTab === "more" && (
          <div className="player-more">
            <section className="player-reference" aria-label="Reference">
              <h3 className="drawer-section-title">Reference</h3>
              <div className="player-almanac-panel">
                <AlmanacBody roles={playerAlmanacRoles} />
              </div>
            </section>
            <section className="player-leave" aria-label="Leave">
              <h3 className="drawer-section-title">Leave</h3>
              <button className="btn btn-sm" onClick={() => setConfirmLeaveOpen(true)} disabled={leaving}>Request to leave lobby</button>
            </section>
          </div>
        )}
      </main>

      {confirmLeaveOpen && (
        <Modal title="Request to leave?" onClose={() => setConfirmLeaveOpen(false)}>
          <div className="dialog-body">
            <p className="behavior-help">
              You will remain seated in the game until the Storyteller accepts your request.
            </p>
            <div className="dialog-row">
              <button className="btn btn-sm" onClick={() => setConfirmLeaveOpen(false)}>Cancel</button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => { setConfirmLeaveOpen(false); void leave(); }}
                disabled={leaving}
              >
                Request to leave
              </button>
            </div>
          </div>
        </Modal>
      )}

      <PlayerTabs active={activeTab} onChange={setActiveTab} />
    </div>
  );
}

/**
 * Phase 10H (§11.3, F1; 10H-AC-028): the ONLY setup states a player phone
 * shows -- Lobby/Waiting, Setting Up, Your Role Is Ready, Night N / Day N.
 * Derived from the public phase and the player's OWN identity; it never says
 * whether roles were dealt, the bag, special setup or who is unfinished.
 */
export function playerMilestone(publicLobby: PublicLobbyRecord, hasRole: boolean, acknowledged: boolean): { phase: string; line: string } {
  if (publicLobby.phase === "night") return { phase: `Night ${publicLobby.day}`, line: "Night has fallen." };
  if (publicLobby.phase === "day") return { phase: `Day ${publicLobby.day}`, line: "The town is awake." };
  if (!hasRole) return { phase: "Setting up", line: "The Storyteller is setting up the game." };
  return { phase: "Setting up", line: acknowledged ? "Your role is ready. Waiting for the game to begin." : "Your role is ready." };
}

/** The player's own Life State from their private self envelope. */
function lifeStateOfSelf(life: { alive: boolean; ghostVote: boolean; exiled?: true }) {
  return publicLifeStateOf({ alive: life.alive, ghostVote: life.ghostVote, ...(life.exiled ? { exiled: true } : {}) });
}

// ---------------------------------------------------------------------------
// Wiki link helper
// ---------------------------------------------------------------------------

function wikiUrlFor(name: string): string {
  const slug = name
    .trim()
    .replace(/['']/g, "")
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join("_");
  return `https://wiki.bloodontheclocktower.com/${slug}`;
}

// ---------------------------------------------------------------------------
// SealedCard — role reveal + per-bluff tap-to-reveal
// ---------------------------------------------------------------------------

/** Phase 10H (§§11.4-11.6; E1, F2, F3, F5): which face the sealed card shows.
 *  - first:   never acknowledged -- the ceremonial first reveal;
 *  - updated: the visible identity changed since the player acknowledged --
 *             ONLY the neutral "Your Role Was Updated" until revealed;
 *  - seen:    the current identity was acknowledged -- the plain sealed card. */
export type RevealMode = "first" | "updated" | "seen";

export function revealModeOf(token: string | undefined, ownAck: string | null): RevealMode {
  if (!ownAck) return "first";
  return token && ownAck === token ? "seen" : "updated";
}

export function SealedCard({
  self,
  revealed,
  onReveal,
  onHide,
  mode = "seen",
  onAcknowledge,
  ackState = "idle",
  ackError = null,
}: {
  self: import("@/stores/types").PlayerSelfEnvelope | null;
  revealed: boolean;
  onReveal: () => void;
  onHide: () => void;
  mode?: RevealMode;
  /** "I've Seen My Role" -- advisory only; absent when nothing to acknowledge. */
  onAcknowledge?: () => void;
  ackState?: "idle" | "busy" | "done";
  ackError?: string | null;
}) {
  const [waitedLong, setWaitedLong] = useState(false);
  const [revealedBluffs, setRevealedBluffs] = useState<Set<number>>(new Set());
  // The ceremony plays once per reveal of a never-acknowledged identity.
  const [ceremony, setCeremony] = useState(false);

  useEffect(() => {
    if (self !== null) { setWaitedLong(false); return; }
    const t = setTimeout(() => setWaitedLong(true), 5000);
    return () => clearTimeout(t);
  }, [self]);

  const bluffsKey = (self?.bluffs ?? []).join("|");
  useEffect(() => {
    setRevealedBluffs(new Set());
  }, [bluffsKey]);

  if (!self) {
    return (
      <div className="sealed-card sealed-card-waiting">
        <p className="behavior-help">
          Your role isn't ready yet.
        </p>
        {waitedLong && (
          <p className="behavior-help sealed-card-wait-more">
            The Storyteller is still setting up.
          </p>
        )}
      </div>
    );
  }

  const role = lookupOfficialRole(self.shownRole);
  const roleName = role?.name ?? self.shownRole;
  const roleType = role?.type ?? "townsfolk";
  const info = !!(self.demon || self.minions?.length || self.extraText);

  if (!revealed) {
    return (
      <div className="sealed-card-wrap">
        <button
          type="button"
          className={`sealed-card sealed-card-${mode}`}
          onClick={() => { setCeremony(mode === "first"); onReveal(); }}
          aria-label="Tap to reveal your role"
        >
          {mode === "updated" ? (
            <span className="sealed-card-back">
              <span className="sealed-card-notice">Your Role Was Updated</span>
              <span className="sealed-card-hint">Tap to reveal it when no one can see your screen</span>
            </span>
          ) : mode === "first" ? (
            <span className="sealed-card-back sealed-card-ceremonial">
              <span className="sealed-card-ornament" aria-hidden="true">✦</span>
              <span className="sealed-card-notice">Your Role Is Ready</span>
              <span className="sealed-card-hint">Make sure no one can see your screen, then tap to reveal</span>
            </span>
          ) : (
            <span className="sealed-card-back">Tap to reveal your role</span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="sealed-card-wrap">
      <article className={`sealed-card revealed${ceremony ? " ceremony" : ""}`} aria-label="Your role">
        <div className="sealed-card-art">
          <img
            src={iconUrlFor(role ?? self.shownRole)}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
        <h2 className="sealed-card-name">
          {roleName}
          <span className={`label type-${roleType}`}>{roleType}</span>
          {self.shownAlignment && <span className={`label alignment-${self.shownAlignment}`}>
            {self.shownAlignment}
          </span>}
        </h2>
        {role?.ability && <p className="sealed-card-ability prose">{role.ability}</p>}
        {role?.flavor && <p className="sealed-card-flavor prose">{role.flavor}</p>}
        <div className="sealed-card-actions">
          <button type="button" className="btn" onClick={() => { setCeremony(false); onHide(); }} aria-label="Tap to seal your role">Hide my role</button>
          {onAcknowledge && ackState !== "done" && (
            <button type="button" className="btn btn-gold" onClick={onAcknowledge} disabled={ackState === "busy"}>
              {ackState === "busy" ? "Sending…" : "I've Seen My Role"}
            </button>
          )}
          {ackState === "done" && <span className="sealed-card-acked" role="status">✓ The Storyteller knows you've seen your role</span>}
        </div>
        {ackError && <p className="field-error" role="alert">{ackError}</p>}
      </article>

      <div className="sealed-card-extras">
        {info && (
          <section className="from-storyteller" aria-label="From the Storyteller">
            <h3 className="from-storyteller-title">From the Storyteller</h3>
            <PrivateInformation payload={self} />
          </section>
        )}
        {self.bluffs && self.bluffs.length > 0 && (
          <div className="sealed-card-bluffs">
            <span className="label">Demon bluffs — tap to reveal individually</span>
            <div className="bluff-reveal-grid">
              {self.bluffs.map((b, i) => {
                const r = lookupOfficialRole(b);
                const open = revealedBluffs.has(i);
                return (
                  <button
                    key={`${i}-${b}`}
                    type="button"
                    className={`bluff-reveal-card ${open ? "revealed" : ""}`}
                    onClick={() => {
                      setRevealedBluffs((prev) => {
                        const next = new Set(prev);
                        if (next.has(i)) next.delete(i);
                        else next.add(i);
                        return next;
                      });
                    }}
                    aria-label={`Bluff ${i + 1}${open ? "" : " — tap to reveal"}`}
                  >
                    {open ? (
                      <span className="bluff-reveal-name">{r?.name ?? b}</span>
                    ) : (
                      <>
                        <span className="bluff-reveal-q">?</span>
                        <span className="bluff-reveal-hint">Bluff {i + 1}</span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <a className="sealed-card-wiki" href={wikiUrlFor(roleName)} target="_blank" rel="noopener noreferrer">
          {roleName} on the wiki ↗
        </a>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Town view — roster, online dot, per-seat notes (no neighbour subtitles)
// ---------------------------------------------------------------------------

export function TownView({
  publicLobby,
  ownPlayerId,
  code,
  scriptCharacters,
}: {
  publicLobby: PublicLobbyRecord | null;
  ownPlayerId: string | null;
  code: string;
  scriptCharacters: RoleDef[];
}) {
  const townNotes = usePlayerStore((s) => s.townNotes);
  const setTownNote = usePlayerStore((s) => s.setTownNote);
  const [noteTarget, setNoteTarget] = useState<string | null>(null);

  const roleById = useMemo(
    () => new Map(scriptCharacters.map((r) => [r.id, r])),
    [scriptCharacters]
  );

  // Phase 10F: during Night the public projection withholds Life State, so
  // no alive count is derived or shown (`lifeShown` false).
  const counts = useMemo(() => {
    if (!publicLobby) return { alive: 0, dead: 0, online: 0, total: 0, lifeShown: false };
    let alive = 0, dead = 0, online = 0, lifeShown = true;
    for (const id of publicLobby.seatOrder) {
      const p = publicLobby.players[id];
      if (!p) continue;
      const life = publicLifeStateOf(p);
      if (life === null) lifeShown = false;
      else if (life === "alive") alive++;
      else dead++;
      if (p.online) online++;
    }
    return { alive, dead, online, total: publicLobby.seatOrder.length, lifeShown };
  }, [publicLobby]);

  if (!publicLobby) return null;

  const noteTargetPlayer = noteTarget
    ? publicLobby.players[noteTarget]
    : null;

  return (
    <div className="town-view">
      <div className="town-view-header">
        <h3 className="drawer-section-title" style={{ margin: 0 }}>Town</h3>
        {counts.lifeShown && <span className="label">{counts.alive}/{counts.total} alive</span>}
        <span className="label">{counts.online}/{counts.total} online</span>
      </div>

      <ul className="town-list">
        {publicLobby.seatOrder.map((id) => {
          const p = publicLobby.players[id];
          if (!p) return null;
          const isYou = id === ownPlayerId;
          const nKey = `${code}:${id}`;
          const note = townNotes[nKey] ?? null;
          const life = publicLifeStateOf(p);

          return (
            <li
              key={id}
              className={`town-row ${life === null ? "life-withheld" : `${life === "alive" ? "" : "dead"} life-${life}`} ${isYou ? "you" : ""}`}
            >
              <button
                type="button"
                className="town-row-main"
                onClick={() => {
                  if (!isYou) setNoteTarget(id);
                }}
                aria-label={`${lifeAccessibleLabel(p.name, p.seat + 1, life)} — tap to add notes`}
              >
                <span className="label town-row-seat">seat {p.seat + 1}</span>
                <span className="town-name">
                  {p.name}
                  {isYou && " (you)"}
                  {p.isTraveler && p.publicDisplayRole && <span className="label type-traveler">{lookupOfficialRole(p.publicDisplayRole)?.name ?? p.publicDisplayRole}</span>}
                </span>
                <span className="town-row-meta">
                  <span
                    className={`town-presence ${p.online ? "online" : "offline"}`}
                    title={p.online ? "Online" : "Offline"}
                    aria-label={p.online ? "Online" : "Offline"}
                  />
                  {/* Phase 10A: the shared public life grammar -- dead,
                      vote available/used, exiled -- always in text. */}
                  {life && <LifeStateText state={life} className="label" />}
                </span>
              </button>
              {note && (note.roles.length > 0 || note.confidence) && (
                <SeatNotePreview note={note} roleById={roleById} />
              )}
              {note?.text && (
                <p className="town-row-note">{note.text}</p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="town-legend">Tap a seat to add private notes</p>

      {noteTarget && noteTargetPlayer && (
        <SeatNotePopup
          playerName={noteTargetPlayer.name}
          scriptCharacters={scriptCharacters}
          note={townNotes[`${code}:${noteTarget}`] ?? null}
          onSave={(next) => setTownNote(code, noteTarget, next)}
          onClose={() => setNoteTarget(null)}
        />
      )}
    </div>
  );
}
