import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { captureVotingContext, gameLifecycleToken, useStorytellerStore, type VotingCommandContext } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { activeVotingRound, currentVoter, currentVotingState, votingContextChanged } from "@/stores/voting";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import type { VotingBinding, VotingIntent, VotingRound, VotingScope } from "@/stores/votingTypes";
import type { LifeConfirmationToken } from "@/stores/lifeResolution";
import { executionsAt } from "@/stores/lifeEvents";
import type { ExecutionOutcome, STPlayerRecord } from "@/stores/types";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { historyId } from "@/stores/history";
import "./voting.css";

type WithoutScope<T> = T extends VotingScope ? Omit<T, keyof VotingScope> : never;
type Action = WithoutScope<VotingIntent>;
type Draft = { nominator: VotingBinding | null; nominee: VotingBinding | null; context: VotingCommandContext };
type Surface = "closed" | "nomination" | "finish" | "history";
type VotingUI = {
  surface: Surface; open: boolean; draft: Draft | null; error: string | null;
  round: VotingRound | null; voter: ReturnType<typeof currentVoter>;
  show: (surface?: Surface) => void; close: () => void; tap: (id: string) => boolean;
  run: (action: Action, context?: VotingCommandContext, finishAfter?: boolean) => boolean;
  change: () => void; next: () => void; begin: () => void;
  confirmation: { message: string; accept: () => void } | null;
};
const VotingInteraction = createContext<VotingUI | null>(null);
export const useVotingInteraction = () => useContext(VotingInteraction);
const bind = (p: STPlayerRecord): VotingBinding => ({ playerId: p.id, participantId: p.participantId! });
export function hasDayExecution(game: Parameters<typeof executionsAt>[0]) {
  const result = executionsAt(game, { phase: "day", day: game.day });
  return (result.status === "known" ? result.events : result.recorded).length > 0;
}

/** Only selection/disclosure lives here. Every accepted response belongs to Current State. */
export function VotingProvider({ children }: { children: ReactNode }) {
  const game = useStorytellerStore(s => s.game);
  const lobby = useStorytellerStore(s => s.lobby);
  const lifecycle = gameLifecycleToken();
  const privacy = usePrivacyStore(s => s.enabled);
  const backend = useSessionRuntime(s => s.backend);
  const sessionStatus = useSessionRuntime(s => s.status);
  const [surface, setSurface] = useState<Surface>("closed");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<VotingUI["confirmation"]>(null);
  const context = useMemo(() => captureVotingContext(), [game, lobby, lifecycle, backend, sessionStatus]);
  const round = game ? activeVotingRound(game) : null;
  const voter = game ? currentVoter(game) : null;
  const close = () => { setSurface("closed"); setError(null); setConfirmation(null); };
  useEffect(() => { close(); setDraft(null); }, [privacy, lifecycle, game?.phase, game?.day]);
  useEffect(() => { setConfirmation(null); }, [game, lobby]);
  const valid = !!game && game.phase === "day" && !privacy;
  const show = (which: Surface = "nomination") => {
    if (!valid) return;
    useTargetPicker.getState().cancel();
    useStorytellerStore.getState().selectPlayer(null);
    setSurface(which); setError(null); setConfirmation(null);
    if (which === "nomination" && !round) setDraft({ nominator: null, nominee: null, context: captureVotingContext() });
  };
  const run = (action: Action, captured = context, finishAfter = false, tokens: LifeConfirmationToken[] = []): boolean => {
    if (!game || !valid) return false;
    const intent = { ...action, code: game.code, day: game.day, expectedRevision: currentVotingState(game).revision,
      ...((action.kind === "execution" || action.kind === "virgin") ? { confirmations: tokens } : {}) } as VotingIntent;
    const result = useStorytellerStore.getState().resolveVoting(intent, captured);
    if (!result.ok) {
      setError(result.message);
      if (result.code === "needsConfirmation") {
        setConfirmation({ message: result.message, accept: () => run(action, captured, finishAfter, [...tokens, result.confirmation]) });
      }
      return false;
    }
    setError(null); setConfirmation(null);
    if (finishAfter) {
      // Preserve the accepted Life outcome if the following transition is refused.
      // Reopening Finish day retries the phase only, never the execution.
      const current = useStorytellerStore.getState().game;
      const pending = current && activeVotingRound(current);
      if (current && pending) {
        const ack = useStorytellerStore.getState().resolveVoting({ kind: "acknowledge", roundId: pending.id, code: current.code, day: current.day, expectedRevision: currentVotingState(current).revision }, captureVotingContext());
        if (!ack.ok) { setSurface("finish"); setError(ack.message); return true; }
      }
      const phase = useStorytellerStore.getState().advancePhase(captureVotingContext());
      if (!phase.ok) { setSurface("finish"); setError(phase.message); }
    }
    return true;
  };
  const next = () => {
    if (round && !run({ kind: "acknowledge", roundId: round.id })) return;
    setDraft({ nominator: null, nominee: null, context: captureVotingContext() }); setSurface("nomination");
  };
  const tap = (id: string): boolean => {
    if (!valid || surface !== "nomination") return false;
    const p = game.players[id];
    if (!p || p.isEmpty || !p.participantId) return true;
    if (round) {
      if (voter?.participantId === p.participantId) run({ kind: "respond", roundId: round.id, voter: bind(p), choice: "yes" });
      return true;
    }
    if (!draft || draft.context.game !== game) {
      setDraft({ nominator: null, nominee: null, context });
      if (draft) { setError("The game changed. Select the nominator again."); return true; }
    }
    const d = draft?.context.game === game ? draft : { nominator: null, nominee: null, context };
    // Dead callers are allowed for exile. Ordinary eligibility is enforced by the authoritative begin command.
    setDraft(d.nominator ? { ...d, nominee: bind(p) } : { ...d, nominator: bind(p) });
    setError(null); return true;
  };
  const begin = () => {
    if (!game || !draft?.nominator || !draft.nominee) return;
    const nominee = game.players[draft.nominee.playerId];
    if (run({ kind: "begin", roundId: historyId(), mode: nominee?.isTraveler ? "exile" : "nomination",
      nominator: draft.nominator, nominee: draft.nominee, confirmUnknown: true }, draft.context)) setDraft(null);
  };
  return <VotingInteraction.Provider value={{ surface, open: valid && surface !== "closed", draft, error, round, voter,
    show, close, tap, run, next, begin, change: () => setDraft(d => d ? { ...d, nominee: null } : d), confirmation }}>
    {children}
  </VotingInteraction.Provider>;
}

export function VotingDayControls() {
  const ui = useVotingInteraction(); const game = useStorytellerStore(s => s.game);
  const privacy = usePrivacyStore(s => s.enabled);
  if (!ui || !game || game.phase !== "day" || privacy) return null;
  const block = hasDayExecution(game) ? null : currentVotingState(game).block;
  return <>
    <button className="btn btn-sm voting-nominate" aria-pressed={ui.open && ui.surface === "nomination"}
      onClick={() => ui.open ? ui.close() : ui.show()}>{ui.open ? "Close nominations" : ui.round?.status === "voting" ? "Resume vote" : "Nominate"}</button>
    {!ui.open && block && <span className="voting-block-summary">{block.nominee ? `${block.nominee.nameAtTime} · ${block.tally} on the block` : `Tie · ${block.tally}`}</span>}
  </>;
}

const suppressRepeat = (e: React.KeyboardEvent) => { if (e.repeat && (e.key === " " || e.key === "Enter")) e.preventDefault(); };

/** Dimensions, typography, colours and ordinary stages follow the exported Claude Card. */
export function VotingCard({ width = 560, offsetY = 0, offsetX = 0, inline = false }: { width?: number; offsetY?: number; offsetX?: number; inline?: boolean }) {
  const ui = useVotingInteraction(); const game = useStorytellerStore(s => s.game);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [ui?.round?.id, ui?.surface, ui?.open]);
  if (!ui?.open || !game) return null;
  const { round, voter, draft } = ui;
  const state = currentVotingState(game);
  const nomin = draft?.nominator ? game.players[draft.nominator.playerId] : null;
  const nominee = draft?.nominee ? game.players[draft.nominee.playerId] : null;
  const isExile = (round?.mode === "exile") || (!round && !!nominee?.isTraveler);
  const current = voter ? game.players[voter.playerId] : null;
  const contextChanged = !!round && votingContextChanged(game, round);
  const mode = ui.surface;
  const need = round ? isExile ? round.threshold : Math.max(round.threshold, (state.block?.tally ?? -1) + 1) : 0;
  const vote = (choice: "yes" | "no") => round && voter && ui.run({ kind: "respond", roundId: round.id, voter, choice });
  const ordinal = round ? state.rounds.filter(r => r.mode === round.mode).findIndex(r => r.id === round.id) + 1 : state.rounds.filter(r => r.mode === (isExile ? "exile" : "nomination")).length + 1;
  return <section className={`voting-card-anchor${inline ? " voting-card-inline" : ""}`} style={{ width, marginTop: offsetY, marginLeft: offsetX }} aria-label="Nomination card">
    <div className="voting-card">
      <header className="voting-card-header"><span className="voting-kicker"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11v3a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12" /></svg>
        Day {game.day} · {mode === "finish" ? "Finish day" : mode === "history" ? "Nominations" : `${isExile ? "Exile" : "Nomination"} ${ordinal}`}</span>
        <button className="voting-quiet" onClick={ui.close}>{mode === "nomination" ? "End nominations" : "Close"}</button>
      </header>
      {mode === "finish" ? <FinishDay /> : mode === "history" ? <VotingHistory /> : <>
        {!round && <>
          <div className="voting-slots">
            <div className={`voting-slot${!nomin ? " choosing" : ""}`}><span>{isExile ? "Called by" : "Nominator"}</span><strong>{nomin?.name || "Tap a player"}</strong></div>
            <span className="voting-slot-arrow" aria-hidden="true" />
            <div className={`voting-slot voting-slot-nominee${nomin && !nominee ? " choosing" : ""}`}><span>{isExile ? "Traveler" : "Nominee"}</span><strong>{nominee?.name || (nomin ? "Tap a player" : "—")}</strong></div>
          </div>
          {nomin && nominee && <div className="voting-accusation"><em>{isExile ? "Everyone may support an exile." : "Let the accused speak, then call the vote."}</em><div><button className="voting-secondary" onClick={ui.change}>Change</button><button className="voting-primary" onClick={ui.begin}>{isExile ? "Begin exile" : "Begin the vote"}</button></div></div>}
          {state.coverage === "unknown" && <p className="voting-note">Earlier nominations are untracked. Begin records this nomination; earlier limits and results need your judgment.</p>}
        </>}
        {round?.virginPending && <div className="voting-exception"><strong>{round.nominee.nameAtTime}’s first nomination</strong><p>Does the Virgin execute {round.nominator.nameAtTime}?</p><div className="voting-actions"><button className="voting-primary" onClick={() => ui.run({ kind: "virgin", roundId: round.id, execute: true, outcome: "died" }, undefined, true)}>Execute · died</button><button className="voting-secondary" onClick={() => ui.run({ kind: "virgin", roundId: round.id, execute: true, outcome: "survived" }, undefined, true)}>Executed · survived</button><button className="voting-quiet" onClick={() => ui.run({ kind: "virgin", roundId: round.id, execute: false })}>Continue voting</button></div></div>}
        {contextChanged && <div className="voting-exception"><p>The table changed during this vote. Review the players and living count before continuing.</p><button className="voting-secondary" onClick={() => round && ui.run({ kind: "acknowledgeContext", roundId: round.id })}>Use current table</button></div>}
        {round?.status === "voting" && !round.virginPending && !contextChanged && <>
          <div className="voting-response-row"><div className="voting-current" aria-live="polite" aria-atomic="true"><span>Now {isExile ? "supporting" : "voting"}</span><strong title={voter?.nameAtTime}>{voter?.nameAtTime ?? "Review voter"}</strong><small>{current ? `Seat ${current.seat + 1}${!current.alive && !isExile ? " · ghost vote, spent if used" : ""}` : "The participant changed. Review this round."}</small></div>
            <button className="voting-yes" onKeyDown={suppressRepeat} onClick={() => vote("yes")} disabled={!voter}>Yes</button><button className="voting-no" onKeyDown={suppressRepeat} onClick={() => vote("no")} disabled={!voter}>No</button></div>
          <div className="voting-progress"><div className="voting-pips" aria-hidden="true">{round.order.map((ref, i) => <span key={ref.participantId} data-answer={round.responses[i]?.choice ?? (i === round.responses.length ? "current" : "pending")} />)}</div><span><b>{round.tally}</b> of {need} needed</span><button className="voting-quiet" disabled={!round.responses.some(r => r.choice !== "skipped")} onClick={() => ui.run({ kind: "undoLast", roundId: round.id })}>Undo</button></div>
          {!!state.block && !isExile && <p className="voting-note">{state.block.nominee?.nameAtTime ?? "Tie"} · {state.block.tally} on the block · {Math.max(round.threshold, state.block.tally)} to tie · {need} to lead</p>}
        </>}
        {round?.status === "outcome" && <div className="voting-result"><div aria-live="polite"><strong>{round.result === "virgin" ? `${round.nominator.nameAtTime} was executed` : round.result === "exilePassed" ? "Exile supported" : round.result === "exileFailed" ? "Exile declined" : round.result === "tie" ? "A tie" : round.result === "block" ? `${round.nominee.nameAtTime} is on the block` : `${round.nominee.nameAtTime} is spared`}</strong><p>{round.result === "tie" ? `${round.tally} votes each. No one is on the block.` : `${round.tally} ${isExile ? "supporters" : "votes"}, ${round.threshold} needed.`}</p></div>
          {round.result === "virgin" ? <button className="voting-primary" onClick={() => ui.show("finish")}>Finish day</button> : round.result === "exilePassed" ? <div className="voting-actions"><button className="voting-primary" onClick={() => { if (ui.run({ kind: "exileOutcome", roundId: round.id, outcome: "died" })) ui.close(); }}>Exiled · died</button><button className="voting-quiet" onClick={() => { if (ui.run({ kind: "exileOutcome", roundId: round.id, outcome: "survived" })) ui.close(); }}>Survived</button></div> : <button className="voting-primary" onClick={ui.next}>Next nomination</button>}
        </div>}
      </>}
      {ui.error && <p className="voting-error" role="alert">{ui.error}</p>}
      {ui.confirmation && <button className="voting-secondary" onClick={ui.confirmation.accept}>{ui.confirmation.message} Confirm</button>}
      {mode === "nomination" && <div className="voting-tools"><button className="voting-quiet" aria-label="Voting corrections and options" aria-expanded={more} onClick={() => setMore(!more)}>···</button>{more && <div className="voting-actions"><button className="voting-quiet" onClick={() => ui.show("history")}>Correct votes</button><button className="voting-quiet" onClick={() => ui.show("finish")}>Finish day</button>{round?.status === "voting" && <button className="voting-quiet" onClick={() => { if (ui.run({ kind: "abandon", roundId: round.id })) ui.close(); }}>Abandon · keep votes spent</button>}{round && !isExile && voter && !contextChanged && <div className="voting-weight"><span>Count this Yes as</span><div className="voting-actions">{[-3, -1, 0, 1, 2, 3].map(n => <button className="voting-secondary" key={n} aria-label={`Record ${n} votes from ${voter.nameAtTime}`} onClick={() => ui.run({ kind: "respond", roundId: round.id, voter, choice: "yes", weightOverride: n })}>{n}</button>)}</div></div>}</div>}</div>}
    </div>
  </section>;
}

function FinishDay() {
  const ui = useVotingInteraction()!; const game = useStorytellerStore(s => s.game)!;
  const [target, setTarget] = useState<VotingBinding | null>(hasDayExecution(game) ? null : currentVotingState(game).block?.nominee ?? null);
  const [error, setError] = useState<string | null>(null);
  const query = executionsAt(game, { phase: "day", day: game.day });
  const events = query.status === "known" ? query.events : query.recorded;
  const selected = target ? game.players[target.playerId] : null;
  const player = selected?.participantId === target?.participantId ? selected : null;
  const staleTarget = !!target && !player;
  const context = captureVotingContext();
  const pacifist = Object.values(game.players).some(p => !p.isEmpty && p.alive && p.actualRole === "pacifist");
  const advance = () => {
    if (ui.round?.status === "voting") { setError("Complete or deliberately abandon the active vote first."); return; }
    if (staleTarget && !events.length) { setError("The selected participant changed. Choose the actual outcome again."); return; }
    if (ui.round?.mode === "exile" && ui.round.result === "exilePassed") { setError("Resolve the supported exile before finishing the day."); return; }
    // Acknowledgement checks the rendered boundary before a fresh phase context is obtained.
    if (ui.round && !ui.run({ kind: "acknowledge", roundId: ui.round.id }, context)) return;
    const result = useStorytellerStore.getState().advancePhase(ui.round ? captureVotingContext() : context);
    setError(result.ok ? null : result.message); if (result.ok) ui.close();
  };
  const record = (outcome: ExecutionOutcome) => player?.participantId && target && ui.run({ kind: "execution", target, outcome }, context, true);
  if (ui.round?.status === "voting") return <div className="voting-exception"><strong>A vote is still in progress</strong><button className="voting-primary" onClick={() => ui.show()}>Resume vote</button></div>;
  if (ui.round?.mode === "exile" && ui.round.result === "exilePassed") return <div className="voting-exception"><strong>An exile needs its outcome</strong><button className="voting-primary" onClick={() => ui.show()}>Resolve exile</button></div>;
  return <div className="voting-finish">
    {events.length ? <><strong>Execution recorded</strong><p>{events.map(e => `${e.subject.nameAtTime}${"outcome" in e ? ` · ${e.outcome === "alreadyDead" ? "already dead" : e.outcome}` : ""}`).join("; ")}</p><button className="voting-primary" onClick={advance}>Begin Night {game.day + 1}</button></> : <>
      <details className="voting-targets"><summary>Execution outcome · {staleTarget ? "Choose again" : player?.name ?? "No execution"}</summary><div className="voting-actions"><button className="voting-secondary" aria-pressed={!target} onClick={() => setTarget(null)}>No execution</button>{game.seatOrder.map(id => game.players[id]).filter(p => p && !p.isEmpty && !p.isTraveler).map(p => <button className="voting-secondary" key={p.id} aria-pressed={target?.participantId === p.participantId} onClick={() => setTarget(bind(p))}>{p.name}</button>)}</div></details>
      {staleTarget && <p role="alert">The selected participant changed. Choose the actual outcome again.</p>}
      {player ? <><strong>{player.alive ? `Did ${player.name} die?` : `${player.name} is already dead`}</strong>{pacifist && <p className="voting-note">Pacifist may apply. You decide whether an executed good player survives.</p>}<div className="voting-actions">{player.alive ? <><button className="voting-primary" onClick={() => record("died")}>Yes · died</button><button className="voting-secondary" onClick={() => record("survived")}>No · survived</button></> : <button className="voting-primary" onClick={() => record("alreadyDead")}>Record execution</button>}</div></> : <><p>{currentVotingState(game).block?.nominee ? "This differs from the block recommendation." : query.status === "unknown" ? "Earlier execution coverage is unknown. Confirm the actual outcome." : "No execution will be recorded."}</p><button className="voting-primary" onClick={advance}>No execution · Begin Night {game.day + 1}</button></>}
    </>}
    {error && <p className="voting-error" role="alert">{error}</p>}
  </div>;
}

function VotingHistory() {
  const ui = useVotingInteraction()!; const game = useStorytellerStore(s => s.game)!;
  const rounds = currentVotingState(game).rounds;
  return <div className="voting-history">{!rounds.length && <p>No nominations recorded today.</p>}{rounds.map((round, i) => <details key={round.id}><summary>{i + 1}. {round.nominator.nameAtTime} → {round.nominee.nameAtTime} · {round.tally}</summary>{round.responses.map(r => <div className="voting-history-response" key={r.voter.participantId}><span>{r.voter.nameAtTime}</span>{r.choice === "skipped" ? <small>Not eligible / not recorded</small> : <><div className="voting-actions">{(["yes", "no"] as const).map(choice => <button className="voting-quiet" key={choice} aria-label={`${choice === "yes" ? "Yes" : "No"} from ${r.voter.nameAtTime}`} aria-pressed={r.choice === choice} disabled={r.choice === choice} onClick={() => ui.run({ kind: "correctResponse", roundId: round.id, voter: r.voter, choice })}>{choice === "yes" ? "Yes" : "No"}</button>)}</div><small>{r.choice === "yes" ? r.weight : "—"}</small>{round.mode === "nomination" && r.choice === "yes" && <details><summary>Adjust</summary><div className="voting-actions">{[-3, -1, 0, 1, 2, 3].map(weight => <button className="voting-quiet" key={weight} aria-label={`Count ${r.voter.nameAtTime} as ${weight} votes`} disabled={r.weight === weight} onClick={() => ui.run({ kind: "correctResponse", roundId: round.id, voter: r.voter, choice: "yes", weightOverride: weight })}>{weight}</button>)}</div></details>}</>}</div>)}</details>)}<button className="voting-quiet" onClick={() => ui.show()}>Return to nominations</button></div>;
}
