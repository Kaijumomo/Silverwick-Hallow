import { useCallback, useEffect, useMemo, useState } from "react";
import { usePlayerStore } from "@/stores/playerStore";
import { connectFirebase } from "@/firebase/session";
import { isFirebaseConfigured, getConfigSource } from "@/firebase/config";
import { acknowledgeReveal, applyJoinIntent, chooseTraveler, joinLobby, leaveLobby, useOwnTravelerChoice, usePlayerSync } from "@/firebase/playerSync";
import { lifecycleMessage } from "@/firebase/lifecycle";
import { FirebaseConfigScreen } from "./phone/FirebaseConfigScreen";
import { SignInScreen } from "./phone/SignInScreen";
import { WaitingScreen } from "./phone/WaitingScreen";
import { PreGameFlow, showsPreGame } from "./phone/PreGameFlow";
import { GameScreen } from "./phone/GameScreen";
import { TravellerChoicePanel } from "./phone/TravellerChoice";
import { TRAVELERS } from "@/data/travelers";
import { ConnectingScreen, FailureScreen, formatCode, KnockingScreen, LeavingScreen, ReconnectingScreen, RejectedScreen, RevokedScreen } from "./phone/PhoneStates";
import type { RoomBackend } from "@/firebase/backend";
import { lookupOfficialRole } from "@/data/officialRoles";
import { getBuiltinScript } from "@/data/scripts";
import type { PublicLobbyRecord, RoleDef } from "@/stores/types";
import { RemoteScreenBoundary } from "@/features/remote/RemoteScreenBoundary";
import { DATA_ERROR_MESSAGE, CONNECTION_ERROR_MESSAGE } from "@/firebase/snapshots";
import { PlayerEnded, PlayerEnding } from "./PlayerTerminal";
import { clearJoinPrefill, peekJoinPrefill } from "@/features/home/joinPrefill";

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
  const terminalResult = usePlayerStore((s) => s.terminalResult);
  const ownRevealAck = usePlayerStore((s) => s.ownRevealAck);
  const error = usePlayerStore((s) => s.error);
  const remoteData = usePlayerStore((s) => s.remoteData);

  const setRevealed = usePlayerStore((s) => s.setRevealed);
  const reset = usePlayerStore((s) => s.reset);

  const [retry, setRetry] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [backend, setBackend] = useState<RoomBackend | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  // The connection attempt's own failure (never a join-submit error), and the
  // code typed on the sign-in screen while the knock is in flight.
  const [connectFailure, setConnectFailure] = useState<string | null>(null);
  const [submittedCode, setSubmittedCode] = useState("");
  const [submittedName, setSubmittedName] = useState("");
  const [travelerChoiceBusyId, setTravelerChoiceBusyId] = useState<string | null>(null);
  // Package 3 (3B): the pre-game ceremony (circle, reveal, team) is over once
  // the player enters the town with THIS identity. Local only, so a reload
  // re-seals the token, and a changed identity (a new reveal token) starts the
  // ceremony again, mid-game as well as in Setup.
  const [enteredToken, setEnteredToken] = useState<string | undefined | false>(false);
  // Package 3 (3C): the Traveller opened the choice (in the Character tab).
  const [choiceOpen, setChoiceOpen] = useState(false);
  // Acknowledging mid-ceremony flips the reveal mode to "seen"; this keeps the
  // player in the ceremony until they enter the town themselves.
  const [ceremonyActive, setCeremonyActive] = useState(false);
  const [travelerChoiceError, setTravelerChoiceError] = useState<string | null>(null);
  const [ackBusy, setAckBusy] = useState(false);

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
    try { await acknowledgeReveal(backend); }
    catch { /* advisory only: the Storyteller simply does not see "seen" */ }
    finally { setAckBusy(false); }
  };
  const token = self?.revealToken;
  const entered = enteredToken !== false && enteredToken === token;
  const mode = revealModeOf(token, ownRevealAck);
  const acked = !!token && ownRevealAck === token;
  const milestone = playerMilestone(publicLobby, !!self, acked);

  // Package 3 (3C): a Traveller who opened the choice sees it in the Character
  // tab of the game frame, with the tabs live.
  const travellerChoice = needsTravelerChoice && choiceOpen ? (
    <TravellerChoicePanel
      travellers={TRAVELERS}
      busyId={travelerChoiceBusyId}
      error={travelerChoiceError}
      pendingId={pendingTravelerChoice}
      onChoose={(id) => void chooseTravelerRole(id)}
    />
  ) : undefined;

  // Package 3 (3B): before the game, the circle, the sealed token and (for
  // evil players the Storyteller briefed) the team. Nothing private renders
  // until the player turns their own token.
  if (!travellerChoice && (needsTravelerChoice || (!entered && (ceremonyActive || showsPreGame(publicLobby.phase, !!self, mode, needsTravelerChoice))))) {
    return (
      <PreGameFlow
        publicLobby={publicLobby}
        playerId={playerId}
        ownName={ownName}
        self={self}
        mode={mode}
        acknowledged={acked}
        needsTravellerChoice={needsTravelerChoice}
        startAtReveal={choiceOpen}
        onOpenTravellerChoice={() => setChoiceOpen(true)}
        onAcknowledge={() => void acknowledge()}
        onEnter={() => { setRevealed(false); setCeremonyActive(false); setChoiceOpen(false); setEnteredToken(token); }}
      />
    );
  }

  // Package 3 (3C): the in-game phone -- Character, Notes, Town and Script.
  // (Notes and Script keep their interim content until 3D.)
  return (
    <>
      <GameScreen
        publicLobby={publicLobby}
        self={self}
        playerId={playerId}
        code={code}
        name={ownName}
        phaseLabel={milestone.phase}
        {...(travellerChoice ? { character: travellerChoice } : {})}
        scriptName={getBuiltinScript(publicLobby.scriptId)?.name ?? "Script"}
        scriptCharacters={scriptCharacters}
        referenceRoles={playerAlmanacRoles}
        leaving={leaving}
        onLeave={leave}
      />

    </>
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

// ---------------------------------------------------------------------------
// Reveal mode
// ---------------------------------------------------------------------------

/** Phase 10H (§§11.4-11.6; E1, F2, F3, F5): which face the reveal shows.
 *  - first:   never acknowledged -- the ceremonial first reveal;
 *  - updated: the visible identity changed since the player acknowledged --
 *             ONLY the neutral "Your Role Was Updated" until revealed;
 *  - seen:    the current identity was acknowledged. */
export type RevealMode = "first" | "updated" | "seen";

export function revealModeOf(token: string | undefined, ownAck: string | null): RevealMode {
  if (!ownAck) return "first";
  return token && ownAck === token ? "seen" : "updated";
}
