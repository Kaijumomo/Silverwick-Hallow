import { useMemo } from "react";
import { usePlayerStore, type PlayerTerminalResult, type TownNote, type TownNoteConfidence } from "@/stores/playerStore";
import { lookupOfficialRole } from "@/data/officialRoles";
import { getBuiltinScript } from "@/data/scripts";
import { CONFIDENCE_CLASS } from "./SeatNotePreview";

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
        {/* ASTRA-10H-007: leaving never waits on the read. Back to Start clears
            the terminal context; the read's own context guard (playerSync)
            then discards its late answer, so nothing old reappears. */}
        <button className="btn" onClick={onBack}>Back to start</button>
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

const CONFIDENCE_TEXT: Record<TownNoteConfidence, string> = { suspect: "Suspect", likely: "Likely", confirm: "Confirm" };

/** PR-10H-002: a saved note is reviewable when ANY of its three dimensions
 * holds content -- a confidence, a role guess, or non-whitespace text. */
const hasContent = (note: TownNote): boolean =>
  note.confidence !== null || note.roles.length > 0 || note.text.trim().length > 0;

/** F10 (10H-AC-058): this game's Town notes stay readable through the
 * post-game review and are cleared by Back to Start. Local only.
 *
 * PR-10H-002: every non-empty note is listed with everything the player
 * recorded -- confidence, role guesses (named from the player-side script /
 * official catalogue, with a readable fallback for an unknown id) and text.
 * These are the player's own guesses: nothing here reads Storyteller state. */
function TownNotesReview() {
  const code = usePlayerStore((s) => s.code);
  const notes = usePlayerStore((s) => s.townNotes);
  const publicLobby = usePlayerStore((s) => s.publicLobby);
  const scriptId = publicLobby?.scriptId;
  const roleName = useMemo(() => {
    const names = new Map((scriptId ? getBuiltinScript(scriptId)?.characters ?? [] : []).map((role) => [role.id, role.name]));
    return (id: string) => names.get(id) ?? lookupOfficialRole(id)?.name ?? `Unrecognized character (${id})`;
  }, [scriptId]);
  const prefix = code ? `${code}:` : null;
  const seatOf = (seatId: string) => publicLobby?.players[seatId]?.seat ?? Number.POSITIVE_INFINITY;
  const mine = prefix
    ? Object.entries(notes)
      .filter(([key, note]) => key.startsWith(prefix) && hasContent(note))
      .sort(([a], [b]) => seatOf(a.slice(prefix.length)) - seatOf(b.slice(prefix.length)))
    : [];
  if (mine.length === 0) return null;
  return (
    <details className="player-notes-review">
      <summary>Your Town notes ({mine.length})</summary>
      <p className="behavior-help">Your own notes and guesses, not confirmed game information.</p>
      <ul>
        {mine.map(([key, note]) => {
          const player = publicLobby?.players[key.slice(prefix!.length)];
          const text = note.text.trim() ? note.text : null;
          return (
            <li key={key} className="player-notes-review-item">
              <span className="player-notes-review-seat">
                <strong>{player?.name ?? "A seat"}</strong>
                {player && <span className="label"> seat {player.seat + 1}</span>}
              </span>
              {note.confidence && (
                <span className="player-notes-review-line">
                  Your confidence:{" "}
                  <span className={`sn-preview-confidence ${CONFIDENCE_CLASS[note.confidence]}`}>{CONFIDENCE_TEXT[note.confidence]}</span>
                </span>
              )}
              {note.roles.length > 0 && (
                <span className="player-notes-review-line">
                  Your role {note.roles.length === 1 ? "guess" : "guesses"}: {note.roles.map(roleName).join(", ")}
                </span>
              )}
              {text && <span className="player-notes-review-line player-notes-review-text">{text}</span>}
            </li>
          );
        })}
      </ul>
      <p className="behavior-help">These notes stay on this phone until you go Back to start.</p>
    </details>
  );
}
