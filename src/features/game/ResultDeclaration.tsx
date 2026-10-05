import { useId, useMemo, useRef, useState } from "react";
import { Modal } from "@/components/Modal";
import type { TerminalIntent } from "@/stores/storytellerStore";
import { endGameWithIntent } from "@/firebase/terminal";
import { lifeStatusOf } from "@/stores/lifeState";
import { LifeStateText } from "@/features/life/LifeMarks";
import { momentLabel } from "@/stores/lifeEvents";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { Alignment, StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

/**
 * Phase 10H (contract §§3.1 S4, 14, 19; 10H-AC-045/047): the Storyteller
 * DECLARES the result -- Silverwick never infers a winner (no win-condition
 * evaluation exists in 10H). Two normal intents (Good victory, Evil victory)
 * and one exceptional one (End Without Result), all through the ONE terminal
 * seam (endGameWithIntent). A true confirmation, so it is modal; the second
 * step names exactly what will happen. Terminal and Undo-free.
 */
type Choice = "good" | "evil" | "noResult";
const INTENT: Record<Choice, TerminalIntent> = {
  good: { kind: "declare", winner: "good" },
  evil: { kind: "declare", winner: "evil" },
  noResult: { kind: "noResult" },
};
const CONFIRM_LABEL: Record<Choice, string> = { good: "Declare Good Victory", evil: "Declare Evil Victory", noResult: "End Without Result" };

export function FinishGameDialog({ onClose, onEnded, multiplayer }: {
  onClose: () => void;
  /** Called once the game has ended successfully (the cinematic follows). */
  onEnded: () => void;
  multiplayer: boolean;
}) {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const goodRef = useRef<HTMLButtonElement>(null);
  const confirm = async () => {
    if (!choice || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await endGameWithIntent(INTENT[choice]);
      if (result.ok) onEnded();
      else setError(result.message);
    } finally {
      setBusy(false);
    }
  };
  const title = choice === null ? "Finish the game"
    : choice === "noResult" ? "End without a result?" : `Declare ${choice === "good" ? "Good" : "Evil"} victory?`;
  return (
    <Modal title={title} onClose={busy ? () => {} : onClose} className="finish-game-dialog"
      initialFocusRef={choice === null ? goodRef : confirmRef}>
      <div className="dialog-body finish-game-body">
        {choice === null ? (
          <>
            <p className="behavior-help">Declare who won. Silverwick does not decide the winner.</p>
            <div className="result-choices" role="group" aria-label="Result">
              <button ref={goodRef} type="button" className="result-choice result-good" onClick={() => setChoice("good")}>
                <span className="result-choice-title">Good wins</span>
                <span className="result-choice-help">Declare Good victory</span>
              </button>
              <button type="button" className="result-choice result-evil" onClick={() => setChoice("evil")}>
                <span className="result-choice-title">Evil wins</span>
                <span className="result-choice-help">Declare Evil victory</span>
              </button>
            </div>
            <div className="result-exceptional">
              <span className="result-exceptional-label">Exceptional</span>
              <button type="button" className="btn btn-sm" onClick={() => setChoice("noResult")}>End without a result…</button>
            </div>
          </>
        ) : (
          <>
            <p>
              {choice === "noResult"
                ? "The game ends with no recorded winner. Nothing about a winner is sent to players."
                : `${choice === "good" ? "Good" : "Evil"} is recorded as the winner${multiplayer ? " and every seated player's phone shows the result" : ""}.`}
            </p>
            <p className="behavior-help">The game becomes a read-only record of its final state. This cannot be undone.</p>
            {busy && <p role="status" className="finish-game-status">Ending the game…</p>}
            {error && <p role="alert" className="field-error">{error}</p>}
            <div className="confirm-dialog-actions">
              <button type="button" className="btn" disabled={busy} onClick={() => { setChoice(null); setError(null); }}>Back</button>
              <button ref={confirmRef} type="button" className={`btn ${choice === "noResult" ? "btn-danger" : "btn-gold"}`} disabled={busy} onClick={() => void confirm()}>
                {error ? `Try again: ${CONFIRM_LABEL[choice]}` : CONFIRM_LABEL[choice]}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Phase 10H (contract §§2.3, 19; S4): the cinematic result transition and the
 * post-game summary -- presentation only, derived from the retained ended
 * snapshot (no summary-only state is persisted). Reduced motion removes the
 * reveal animation (the CSS keys it to prefers-reduced-motion).
 */
export function GameResultSummary({ game, registry, onReview, onActivity, onNewGame, onHome }: {
  game: StorytellerLobbyRecord;
  registry: RoleRegistry;
  onReview: () => void;
  onActivity: () => void;
  onNewGame: () => void;
  onHome: () => void;
}) {
  const titleId = useId();
  const winner = game.result?.winner ?? null;
  const seated = useMemo(() => game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty), [game]);
  const team = (side: Alignment) => seated.filter((p) => p.actualAlignment === side);
  const unresolved = seated.filter((p) => p.actualAlignment !== "good" && p.actualAlignment !== "evil");
  const dead = seated.filter((p) => !p.alive).length;
  const roleName = (id: string) => (id ? registry.get(id)?.name ?? id : "No character");
  const headline = winner === "good" ? "Good wins" : winner === "evil" ? "Evil wins" : "The game is over";
  const row = (p: STPlayerRecord) => (
    <li key={p.id} className="summary-player">
      <span className="summary-player-name">{p.name || `Seat ${p.seat + 1}`}</span>
      <span className="summary-player-role">{roleName(p.actualRole)}{p.shownRole && p.shownRole !== p.actualRole ? ` (shown ${roleName(p.shownRole)})` : ""}</span>
      <LifeStateText state={lifeStatusOf(p).state} className="summary-player-life" />
    </li>
  );
  return (
    <section className="result-summary" data-winner={winner ?? "none"} role="region" aria-labelledby={titleId}>
      <div className="result-cinematic" aria-hidden="true" />
      <div className="result-summary-inner">
        <p className="result-eyebrow">{game.result ? `Declared ${momentLabel(game.result.declaredAt)}` : "No recorded result"}</p>
        <h2 id={titleId} className="result-headline">{headline}</h2>
        <dl className="result-stats">
          <div><dt>Days played</dt><dd>{game.day}</dd></div>
          <div><dt>Players</dt><dd>{seated.length}</dd></div>
          <div><dt>Dead at the end</dt><dd>{dead}</dd></div>
          <div><dt>Recorded changes</dt><dd>{game.history.length}</dd></div>
        </dl>
        <div className="result-teams">
          {(["good", "evil"] as const).map((side) => (
            <div key={side} className={`result-team result-team-${side}`}>
              <h3 className="result-team-title">{side === "good" ? "Good" : "Evil"}{winner === side ? " — winners" : ""}</h3>
              <ul className="summary-players">{team(side).map(row)}</ul>
            </div>
          ))}
          {unresolved.length > 0 && (
            <div className="result-team">
              <h3 className="result-team-title">Alignment not recorded</h3>
              <ul className="summary-players">{unresolved.map(row)}</ul>
            </div>
          )}
        </div>
        <div className="result-actions">
          <button type="button" className="btn btn-gold" onClick={onReview}>Review the final Grimoire</button>
          <button type="button" className="btn" onClick={onActivity}>History &amp; Activity</button>
          <button type="button" className="btn" onClick={onNewGame}>New game</button>
          <button type="button" className="btn" onClick={onHome}>Return Home</button>
        </div>
      </div>
    </section>
  );
}
