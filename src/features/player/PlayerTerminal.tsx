import { usePlayerStore, type PlayerTerminalResult } from "@/stores/playerStore";

/**
 * Phase 10H (contract §16): the player's terminal states.
 *  - "Ending..." while the Storyteller's terminal close is in flight;
 *  - the declared result (Good or Evil victory) once the session ended and the
 *    player's own validated results/{uid} was read;
 *  - the generic Game Ended screen when there is no recorded result;
 *  - a retryable error when the result could not be read (never a false
 *    "no result").
 * Back to Start clears the terminal context and this game's Town notes.
 * No "you won/lost" is derived: the result names only the winning team.
 */
export function PlayerEnding() {
  return (
    <div className="player player-status" role="status" aria-live="polite">
      <h2 className="title">Ending…</h2>
      <p className="behavior-help">The Storyteller is ending the game.</p>
    </div>
  );
}

const WINNER_TITLE = { good: "Good wins", evil: "Evil wins" } as const;

export function PlayerEnded({ result, onRetry, onBack }: {
  result: PlayerTerminalResult | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  // ASTRA-10H-007: only an explicit pending read shows "Reading..."; an ended
  // state with no result state at all is the generic Game Ended below.
  if (result?.status === "pending") {
    return (
      <div className="player player-status" role="status" aria-live="polite">
        <h2 className="title">Game ended</h2>
        <p className="behavior-help">Reading the final result…</p>
      </div>
    );
  }
  if (result?.status === "error") {
    return (
      <div className="player player-status" role="alert">
        <h2 className="title">Game ended</h2>
        <p className="behavior-help">We couldn't read the final result. {result.message}</p>
        <button className="btn" onClick={onRetry}>Try again</button>
        <button className="btn" onClick={onBack}>Back to start</button>
      </div>
    );
  }
  if (result?.status === "ready") {
    const { winner, declaredAt } = result.result;
    return (
      <div className={`player player-status player-result player-result-${winner}`} role="status">
        <div className="player-result-light" aria-hidden="true" />
        <p className="player-result-eyebrow">The game is over</p>
        <h2 className="title player-result-title">{WINNER_TITLE[winner]}</h2>
        <p className="behavior-help">
          The Storyteller declared {winner === "good" ? "Good" : "Evil"} victory on {declaredAt.phase === "night" ? "Night" : "Day"} {declaredAt.day}.
        </p>
        <TownNotesReview />
        <button className="btn btn-gold" onClick={onBack}>Back to start</button>
      </div>
    );
  }
  return (
    <div className="player player-status player-result player-result-none" role="status">
      <p className="player-result-eyebrow">The game is over</p>
      <h2 className="title player-result-title">Game ended</h2>
      <p className="behavior-help">The Storyteller has ended the game. Thanks for playing!</p>
      <TownNotesReview />
      <button className="btn btn-gold" onClick={onBack}>Back to start</button>
    </div>
  );
}

/** F10 (10H-AC-058): this game's Town notes stay readable through the
 * post-game review and are cleared by Back to Start. Local only. */
function TownNotesReview() {
  const code = usePlayerStore((s) => s.code);
  const notes = usePlayerStore((s) => s.townNotes);
  const publicLobby = usePlayerStore((s) => s.publicLobby);
  const prefix = code ? `${code}:` : null;
  const mine = prefix ? Object.entries(notes).filter(([key, note]) => key.startsWith(prefix) && note.text.trim()) : [];
  if (mine.length === 0) return null;
  return (
    <details className="player-notes-review">
      <summary>Your Town notes ({mine.length})</summary>
      <ul>
        {mine.map(([key, note]) => {
          const seatId = key.slice(prefix!.length);
          const name = publicLobby?.players[seatId]?.name;
          return <li key={key}><strong>{name ?? "A seat"}</strong>: {note.text}</li>;
        })}
      </ul>
      <p className="behavior-help">These notes stay on this phone until you go Back to start.</p>
    </details>
  );
}
