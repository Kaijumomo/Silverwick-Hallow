import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { isInitialRevealComplete } from "@/stores/identity";
import { useGoLiveState } from "@/firebase/goLive";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { ConnectionStatus, UnattachedLobbyWarnings } from "@/firebase/StorytellerSession";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import type { Script } from "@/stores/types";
import { EDITION_LOGO, useLoadedArt } from "@/features/home/art";
import { ScriptStep } from "./ScriptStep";
import { ExtrasStep } from "./ExtrasStep";
import { ChooseMode, LiveInvite, SeatTown, type Arrival } from "./PlayersStep";
import { createLiveGame, leaveLive, retryLive, startOffline, type SetupPlan } from "./setupFlowActions";
import { DEFAULT_SEATED, STEP_TITLES, ROMAN, clampSeated, clampTravellers, totalOf, FABLED_CHOICES, LORIC_CHOICES, MIN_PLAYERS } from "./setupFlowModel";

/**
 * New Game: the three-step setup flow (Script & Players, Fabled & Loric,
 * Players) from the Claude Design "Ledger". Steps I and II are a local draft:
 * nothing is created, and nothing touches Firebase, until Step III. Choosing
 * "Invite to phones" creates the pristine setup game and its lobby (the shared
 * Go Live); "Play offline" creates the game with the typed names. Going back
 * from the Live screen closes the lobby authoritatively before discarding the
 * setup game.
 */
type Step = 0 | 1 | 2;
type Mode = "live" | "offline" | null;

/** The Live screen is restored after a refresh only for the tab that was on it. */
const LIVE_MARKER = "sf-live-screen";
const markLive = (on: boolean) => {
  try { if (on) sessionStorage.setItem(LIVE_MARKER, "1"); else sessionStorage.removeItem(LIVE_MARKER); } catch { /* storage unavailable */ }
};
const wasOnLive = () => { try { return sessionStorage.getItem(LIVE_MARKER) === "1"; } catch { return false; } };

export function NewGameScreen() {
  const setView = useStorytellerStore((s) => s.setView);
  const customScripts = useStorytellerStore((s) => s.customScripts);
  const game = useStorytellerStore((s) => s.game);
  const lobby = useStorytellerStore((s) => s.lobby);
  const joined = useSessionRuntime((s) => s.joined);
  const sessionStatus = useSessionRuntime((s) => s.status);
  const goLiveBusy = useGoLiveState((s) => s.busy);

  // A refresh while on the Live screen restores it from the persisted setup game.
  const [restored] = useState(() => {
    const now = useStorytellerStore.getState();
    return wasOnLive() && !!now.game && now.game.phase === "setup" && !isInitialRevealComplete(now.game) ? now.game : null;
  });
  const [step, setStep] = useState<Step>(restored ? 2 : 0);
  const [mode, setMode] = useState<Mode>(restored ? "live" : null);
  const [scriptId, setScriptId] = useState<string | null>(restored?.scriptId ?? null);
  const [seated, setSeated] = useState(restored ? restored.plannedPlayerCount - (restored.plannedTravelerCount ?? 0) : DEFAULT_SEATED);
  const [travellers, setTravellers] = useState(restored?.plannedTravelerCount ?? 0);
  const [extras, setExtras] = useState<string[]>(restored ? [...restored.fabled, ...restored.lorics] : []);
  const [names, setNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [liveFailed, setLiveFailed] = useState(false);
  const alive = useRef(true);
  /** Identifies the current Go Live attempt, so a late result of one the user already left never paints this screen. */
  const attempt = useRef(0);
  /** Synchronous guard against a double tap starting two flows before `busy` re-renders. */
  const starting = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const allScripts: Record<string, Script> = useMemo(() => ({ ...BUILTIN_SCRIPTS, ...customScripts }), [customScripts]);
  const script = scriptId ? allScripts[scriptId] : undefined;
  const logos = useLoadedArt(Object.values(EDITION_LOGO));
  const logoUrl = script && EDITION_LOGO[script.id] && logos.has(EDITION_LOGO[script.id]!) ? EDITION_LOGO[script.id] : undefined;

  const total = totalOf(seated, travellers);
  const setSeatedClamped = (next: number) => setSeated(clampSeated(next, travellers));
  const setTravellersClamped = (next: number) => setTravellers(clampTravellers(seated, next));
  const plan: SetupPlan | null = scriptId ? { scriptId, total, travellers, extras } : null;

  const namesOf = (ids: readonly string[]) =>
    ids.map((id) => [...FABLED_CHOICES, ...LORIC_CHOICES].find((role) => role.id === id)?.name).filter((name): name is string => !!name);

  // Live arrivals: distinct players currently joined (runtime), named from the
  // seat they hold or their waiting-queue name. Raw uids never reach the screen.
  const arrivals: Arrival[] = useMemo(() => joined.map(({ uid, playerId }, i) => ({
    key: uid,
    name: (playerId ? game?.players[playerId]?.name : game?.pendingPlayers[uid]) || `Player ${i + 1}`,
  })), [joined, game]);

  const liveStatus: "ready" | "starting" | "failed" = lobby ? "ready" : goLiveBusy && !liveFailed ? "starting" : "failed";
  const canBeginLive = !!lobby && sessionStatus === "live" && arrivals.length >= MIN_PLAYERS && !busy;

  // The Live screen is only meaningful while its setup game exists.
  useEffect(() => {
    if (step === 2 && mode === "live" && !game && !busy) { markLive(false); setMode(null); }
  }, [step, mode, game, busy]);

  const runGoLive = useCallback(async () => {
    const mine = ++attempt.current;
    setLiveFailed(false);
    setNotice(null);
    let outcome = await retryLive();
    if (outcome.kind === "busy") {
      // An earlier attempt (one the user already left) is still finishing: wait for it, then try once.
      await new Promise<void>((resolve) => {
        if (!useGoLiveState.getState().busy) return resolve();
        const unsubscribe = useGoLiveState.subscribe((state) => { if (!state.busy) { unsubscribe(); resolve(); } });
      });
      if (!alive.current || attempt.current !== mine || !useStorytellerStore.getState().game || useStorytellerStore.getState().lobby) return;
      outcome = await retryLive();
    }
    if (!alive.current || attempt.current !== mine) return;
    if (outcome.kind === "needsConfig") { setLiveFailed(true); setConfigOpen(true); }
    else if (outcome.kind === "failed") { setLiveFailed(true); setNotice(outcome.error.message); }
    else if (outcome.kind === "unavailable") { setLiveFailed(true); setNotice(outcome.message); }
    else if (outcome.kind === "superseded") { setLiveFailed(true); }
  }, []);

  const chooseLive = async () => {
    if (!plan || busy || starting.current) return;
    starting.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await createLiveGame(plan);
      if (!alive.current) return;
      if (outcome.kind === "cancelled") return;
      if (outcome.kind === "error") { setNotice(outcome.message); return; }
      markLive(true);
      setMode("live");
    } finally { starting.current = false; if (alive.current) setBusy(false); }
    void runGoLive();
  };

  const beginOffline = async () => {
    if (!plan || busy || starting.current) return;
    starting.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await startOffline(plan, names.slice(0, total));
      if (!alive.current) return;
      if (outcome.kind === "error") setNotice(outcome.message);
    } finally { starting.current = false; if (alive.current) setBusy(false); }
  };

  const beginLive = () => {
    // A background tab may defer its expiry timer or React render. Recheck
    // the current runtime and heartbeat deadlines at the actual click.
    const runtime = useSessionRuntime.getState();
    const current = useStorytellerStore.getState();
    const now = Date.now();
    const present = new Set(runtime.joined.filter(player => player.expiresAt > now).map(player => player.uid));
    if (busy || !current.lobby || runtime.status !== "live" || runtime.presence !== "ready" || present.size < MIN_PLAYERS) return;
    const writer = runtime.backend;
    if (!writer || writer.code !== current.lobby.code || writer.sessionId !== current.lobby.sessionId || writer.leaseMayHaveLapsed()) return;
    markLive(false);
    setView("game");
  };

  /** Leaves the Live screen: a lobby with anyone joined asks first, then closes before discarding. */
  const leaveLiveScreen = async (): Promise<boolean> => {
    if (mode !== "live") return true;
    // The joined list can read empty while phones are connected (presence error, reconnect), so any attached lobby with a waiting queue or unreadable presence also asks.
    const somebodyMayBeHere = arrivals.length > 0 || Object.keys(game?.pendingPlayers ?? {}).length > 0 || (!!lobby && useSessionRuntime.getState().presence !== "ready");
    if (somebodyMayBeHere && !window.confirm("Go back? Everyone who has joined will be disconnected and the lobby will close.")) return false;
    setBusy(true);
    attempt.current++;
    try {
      const outcome = await leaveLive();
      if (!alive.current) return false;
      if (outcome.kind === "stayed") { setNotice(outcome.message); return false; }
      markLive(false);
      setNotice(null);
      setLiveFailed(false);
      setMode(null);
      return true;
    } finally { if (alive.current) setBusy(false); }
  };

  const goTo = async (target: Step) => {
    if (busy) return;
    if (step === 2 && mode === "live" && !(await leaveLiveScreen())) return;
    setNotice(null);
    setStep(target);
    if (target < 2) setMode(null);
  };

  const back = async () => {
    if (busy) return;
    if (step === 0) { setView("home"); return; }
    if (step === 2 && mode) {
      if (mode === "live" && !(await leaveLiveScreen())) return;
      setNotice(null);
      setMode(null);
      return;
    }
    setStep((step - 1) as Step);
  };

  const named = names.slice(0, total).filter((name) => name.trim()).length;
  const railLines: string[][] = [
    script ? [script.name, `${total} players`] : [],
    step < 1 ? [] : extras.length ? namesOf(extras) : ["None"],
    step < 2 || !mode ? [] : mode === "live" ? ["Phones", `${arrivals.length} of ${total} arrived`] : ["Offline", `${named} of ${total} named`],
  ];

  return (
    <div className="sf-screen">
      <img className="sf-photo" src="/bg/BackgroundMenuTablet.png" alt="" />
      <div className="sf-veil" />
      <div className="sf-sheet">
        <div className="sf-notices">
          <ConnectionStatus />
          <UnattachedLobbyWarnings />
        </div>
        <header className="sf-head">
          <button type="button" className="sf-back" disabled={busy} onClick={() => void back()}>
            <span className="sf-back-chev" aria-hidden="true">‹</span>
            {step === 0 ? "Home" : "Back"}
          </button>
          <ol className="sf-steps" aria-label="Setup steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {STEP_TITLES.map((title, i) => {
              const state = i < step ? "done" : i === step ? "current" : "future";
              return (
                <li key={title} className="sf-step-item" aria-current={i === step ? "step" : undefined}>
                  <span className="sf-step-label" data-state={state}>
                    <span className="sf-step-diamond" aria-hidden="true" />
                    {title}
                  </span>
                  {i < STEP_TITLES.length - 1 && <span className="sf-step-sep" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
          {step > 0 && logoUrl ? <span className="sf-head-logo" role="img" aria-label={script?.name} style={{ backgroundImage: `url(${logoUrl})` }} /> : <span aria-hidden="true" />}
        </header>

        <div className="sf-body">
          <nav className="sf-rail" aria-label="Setup progress">
            {STEP_TITLES.map((title, i) => {
              const state = i < step ? "done" : i === step ? "current" : "future";
              return (
                <button
                  key={title}
                  type="button"
                  className="sf-rail-step"
                  data-state={state}
                  aria-current={i === step ? "step" : undefined}
                  disabled={state !== "done" || busy}
                  onClick={() => state === "done" && void goTo(i as Step)}
                >
                  {i < STEP_TITLES.length - 1 && <span className="sf-rail-line" aria-hidden="true" />}
                  <span className="sf-rail-num">{state === "done" ? "✓" : ROMAN[i]}</span>
                  <span className="sf-rail-text">
                    <span className="sf-rail-title">{title}</span>
                    {railLines[i]!.map((line, n) => <span key={`${line}-${n}`} className="sf-rail-line-text">{line}</span>)}
                  </span>
                </button>
              );
            })}
          </nav>

          {step === 0 && (
            <ScriptStep
              scripts={allScripts}
              scriptId={scriptId}
              onScript={setScriptId}
              seated={seated}
              travellers={travellers}
              onSeated={setSeatedClamped}
              onTravellers={setTravellersClamped}
              onNext={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <ExtrasStep
              total={total}
              extras={extras}
              onToggle={(id) => setExtras((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id])}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && mode === null && (
            <ChooseMode busy={busy} onLive={() => void chooseLive()} onOffline={() => { setNotice(null); setMode("offline"); }} />
          )}
          {step === 2 && mode === "live" && (
            <LiveInvite
              code={lobby?.code ?? null}
              arrivals={arrivals}
              total={total}
              status={liveStatus}
              canBegin={canBeginLive}
              onBegin={beginLive}
              message={notice}
              onRetry={() => void runGoLive()}
              retrying={goLiveBusy}
            />
          )}
          {step === 2 && mode === "offline" && (
            <SeatTown
              total={total}
              names={names}
              onName={(index, value) => setNames((current) => Array.from({ length: Math.max(current.length, index + 1) }, (_, i) => (i === index ? value : current[i] ?? "")))}
              minNamed={MIN_PLAYERS}
              busy={busy}
              onBegin={() => void beginOffline()}
              message={notice}
            />
          )}
        </div>
      </div>
      {configOpen && (
        <FirebaseConfigDialog
          onClose={() => setConfigOpen(false)}
          onSaved={() => { setConfigOpen(false); void runGoLive(); }}
        />
      )}
    </div>
  );
}
