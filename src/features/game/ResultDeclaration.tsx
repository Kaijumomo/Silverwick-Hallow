import { useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalBehavior } from "@/components/Modal";
import { useStorytellerStore, type TerminalIntent } from "@/stores/storytellerStore";
import { endGameWithIntent } from "@/firebase/terminal";
import { usePrivacyStore } from "@/stores/privacyStore";
import { lifeStatusOf } from "@/stores/lifeState";
import { LifeStateText } from "@/features/life/LifeMarks";
import { momentLabel } from "@/stores/lifeEvents";
import { iconUrlFor } from "@/data/iconUrl";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { Alignment, StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

type Choice = "good" | "evil" | "noResult";
const INTENT: Record<Choice, TerminalIntent> = {
  good: { kind: "declare", winner: "good" },
  evil: { kind: "declare", winner: "evil" },
  noResult: { kind: "noResult" },
};

/** The End popup itself is the explicit confirmation. The Storyteller, never
 * a presentation heuristic, chooses the result through the terminal service. */
export function FinishGameDialog({ onClose, onEnded, multiplayer }: {
  onClose: () => void;
  onEnded: () => void;
  multiplayer: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const terminalClose = useStorytellerStore(s => s.terminalClose);
  const confirmedRecovery = terminalClose?.confirmedRecovery;
  const recoveryPending = terminalClose?.recoveryPending;
  const inFlight = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const close = () => {
    const current = useStorytellerStore.getState().terminalClose;
    if (!inFlight.current && !current?.confirmedRecovery && !current?.recoveryPending) onClose();
  };
  useModalBehavior(dialogRef, layerRef, close, keepRef);
  const confirm = async (choice: Choice) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await endGameWithIntent(INTENT[choice]);
      if (result.ok) onEnded();
      else setError(result.message);
    } catch {
      setError("The game could not be ended. Please try again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return createPortal(
    <div ref={layerRef} className="shell-ending-layer">
      <div className="shell-ending-backdrop" onClick={close} aria-hidden="true" />
      <div ref={dialogRef} className="shell-end-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} aria-busy={busy} tabIndex={-1}>
        <div className="shell-end-heading">
          <h2 id={titleId}>End the game</h2>
          <p id={descriptionId}>Choose the winning team. The Grimoire stays open for review.</p>
        </div>
        {multiplayer && <p className="shell-end-notice">The declared result will also be shared with seated players.</p>}
        {confirmedRecovery ? <><p className="shell-end-notice">The online game has ended. Save its confirmed result here to finish.</p><button type="button" className="btn btn-gold" disabled={busy} onClick={() => void confirm(confirmedRecovery.kind === "endedWithResult" ? confirmedRecovery.result.winner : "noResult")}>Retry saving result</button></> : recoveryPending ? <><p className="shell-end-notice">An ending was interrupted. Retry to recover the recorded result.</p><button type="button" className="btn btn-gold" disabled={busy} onClick={() => void confirm(terminalClose!.intent.kind === "declare" ? terminalClose!.intent.winner : "noResult")}>Retry finishing game</button></> : <div className="shell-end-choices" role="group" aria-label="Result">
          <button type="button" className="shell-end-good" disabled={busy} onClick={() => void confirm("good")}>Good wins</button>
          <button type="button" className="shell-end-evil" disabled={busy} onClick={() => void confirm("evil")}>Evil wins</button>
        </div>}
        {busy && <p role="status" className="shell-end-notice">Ending the game…</p>}
        {error && <p role="alert" className="field-error">{error}</p>}
        <button ref={keepRef} type="button" className="shell-end-keep" disabled={busy || !!confirmedRecovery || !!recoveryPending} onClick={close}>Keep playing</button>
        {!confirmedRecovery && !recoveryPending && <details className="shell-end-exceptional">
          <summary>Other outcome</summary>
          <p>No winner will be recorded.</p>
          <button type="button" disabled={busy} onClick={() => void confirm("noResult")}>End without a result</button>
        </details>}
      </div>
    </div>, document.body,
  );
}

type SummaryProps = {
  game: StorytellerLobbyRecord;
  registry: RoleRegistry;
  onReview: () => void;
  onActivity: () => void;
  onNewGame: () => void;
  onHome: () => void;
};

/** Private final-state details never remain in the DOM when privacy is on. */
export function GameResultSummary(props: SummaryProps) {
  const privateMode = usePrivacyStore(s => s.enabled);
  return privateMode ? null : <ResultScene {...props} />;
}

function ResultScene({ game, registry, onReview, onActivity, onNewGame }: SummaryProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLButtonElement>(null);
  useModalBehavior(dialogRef, layerRef, onReview, reviewRef);
  const winner = game.result?.winner ?? null;
  const seated = useMemo(() => game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty), [game]);
  const team = (side: Alignment) => seated.filter((p) => p.actualAlignment === side);
  const unresolved = seated.filter((p) => p.actualAlignment !== "good" && p.actualAlignment !== "evil");
  const demon = seated.find(p => registry.get(p.actualRole)?.type === "demon");
  const demonRole = demon ? registry.get(demon.actualRole) : undefined;
  const roleName = (id: string) => (id ? registry.get(id)?.name ?? id : "No character");
  const headline = winner === "good" ? "Good Wins" : winner === "evil" ? "Evil Wins" : "The game is over";
  const kicker = winner === "good" ? `Day ${game.day} · Dawn over Silverwick Hollow`
    : winner === "evil" ? `Night ${game.day} · The last candle gutters` : "No recorded result";
  // Some abilities award victory with a living Demon. Do not turn the scene's
  // narrative into a false rule evaluation or falsify the retained game state.
  const slain = winner === "good" && !!demon && !demon.alive;
  const story = winner === "good"
    ? `${slain ? `The ${demonRole?.name ?? "Demon"} has been found and slain. ` : ""}The town of Silverwick Hollow will see another dawn.`
    : winner === "evil" ? `${demon?.alive ? `The ${demonRole?.name ?? "Demon"} walks free and the town has fallen. ` : ""}Silverwick Hollow belongs to the dark.`
      : "The story has ended. The Grimoire remains open for review.";
  const row = (p: STPlayerRecord) => (
    <li key={p.id} className="shell-result-detail-player">
      <span>{p.name || `Seat ${p.seat + 1}`}</span>
      <span>{roleName(p.actualRole)}{p.shownRole && p.shownRole !== p.actualRole ? ` (shown ${roleName(p.shownRole)})` : ""}</span>
      <LifeStateText state={lifeStatusOf(p).state} />
    </li>
  );
  return createPortal(
    <div ref={layerRef} className="shell-result-layer" data-winner={winner ?? "none"}>
      <div className="shell-result-rays" aria-hidden="true" />
      <div className="shell-result-texture" aria-hidden="true" />
      <div className="shell-result-vignette" aria-hidden="true" />
      <div ref={dialogRef} className="shell-result-scene" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <p className="shell-result-kicker">{kicker}</p>
        <div className={`shell-result-portrait${slain ? " is-slain" : ""}`} aria-hidden="true">
          {demonRole && <img src={iconUrlFor(demonRole)} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />}
        </div>
        <div className="shell-result-title-group">
          <h2 id={titleId}>{headline}</h2>
          <div className="shell-result-ornament" aria-hidden="true"><span /><i /><b /><i /><span /></div>
          <p>{story}</p>
        </div>
        {winner && <ul className="shell-result-winning-team" aria-label={`${winner === "good" ? "Good" : "Evil"} — winners`}>
          {team(winner).map(p => {
            const role = registry.get(p.actualRole);
            return <li key={p.id} style={{ opacity: p.alive ? 1 : 0.55 }}>
              <span className="shell-result-team-token">{role && <img src={iconUrlFor(role)} alt="" onError={event => { event.currentTarget.style.visibility = "hidden"; }} />}</span>
              <span className="shell-result-team-name">{p.name || `Seat ${p.seat + 1}`}</span>
              <span className="sr-only">{roleName(p.actualRole)}</span>
            </li>;
          })}
        </ul>}
        <button ref={reviewRef} type="button" className="shell-result-review" onClick={onReview}>Review the Grimoire</button>
        <details className="shell-result-details">
          <summary>Game details &amp; history</summary>
          <p>{game.result ? `Declared ${momentLabel(game.result.declaredAt)}` : "No recorded result"} · {seated.length} players · {seated.filter(p => !p.alive).length} dead · {game.history.length} recorded changes</p>
          <div className="shell-result-teams">
            {(["good", "evil"] as const).map(side => <section key={side}>
              <h3>{side === "good" ? "Good" : "Evil"}{winner === side ? " — winners" : ""}</h3>
              <ul>{team(side).map(row)}</ul>
            </section>)}
            {unresolved.length > 0 && <section><h3>Alignment not recorded</h3><ul>{unresolved.map(row)}</ul></section>}
          </div>
          <div className="shell-result-detail-actions">
            <button type="button" onClick={onActivity}>History &amp; Activity</button>
            <button type="button" onClick={onNewGame}>New game</button>
          </div>
        </details>
      </div>
    </div>, document.body,
  );
}
