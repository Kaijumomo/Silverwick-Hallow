import { useMemo, useState } from "react";
import { usePlayerStore, type PlayerTerminalResult, type SeatVerdict } from "@/stores/playerStore";
import { iconUrlFor } from "@/data/iconUrl";
import { lookupOfficialRole } from "@/data/officialRoles";
import { getBuiltinScript } from "@/data/scripts";
import { MoonEmblem } from "./phone/PhoneParts";
import { StatusScreen } from "./phone/StatusScreen";
import { EndingScreen, formatCode } from "./phone/PhoneStates";

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
  const code = usePlayerStore((s) => s.code);
  return <EndingScreen code={code ?? ""} />;
}

const WINNER_TITLE = { good: "Good wins", evil: "Evil wins" } as const;

export function PlayerEnded({ result, onRetry, onBack }: {
  result: PlayerTerminalResult | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const code = usePlayerStore((s) => s.code) ?? "";
  const back = { label: "Back to start", onClick: onBack };
  // ASTRA-10H-007: only an explicit pending read shows "Reading..."; an ended
  // state with no result state at all is the generic Game Ended below.
  if (result?.status === "pending") {
    // ASTRA-10H-007: leaving never waits on the read. Back to Start clears
    // the terminal context; the read's own context guard (playerSync)
    // then discards its late answer, so nothing old reappears.
    return (
      <StatusScreen
        label="ended-pending"
        reserve={46}
        emblem={<MoonEmblem lit spin={16} />}
        eyebrow={code ? formatCode(code) : "Silverwick Hollow"}
        title="Game ended"
        body="Reading the final result…"
        primary={back}
      />
    );
  }
  if (result?.status === "error") {
    return (
      <StatusScreen
        label="ended-error"
        tone="error"
        emblem={<MoonEmblem lit={false} tone="error" spin={0} />}
        eyebrow={code ? formatCode(code) : "Silverwick Hollow"}
        title="Game ended"
        message={`We couldn't read the final result. ${result.message}`}
        primary={{ label: "Try again", onClick: onRetry }}
        secondary={back}
      />
    );
  }
  if (result?.status === "ready") {
    const { winner, declaredAt } = result.result;
    return (
      <StatusScreen
        label={`ended-${winner}`}
        big
        tone={winner}
        eyebrow="The game is over"
        title={WINNER_TITLE[winner]}
        body={`The Storyteller declared ${winner === "good" ? "Good" : "Evil"} victory on ${declaredAt.phase === "night" ? "Night" : "Day"} ${declaredAt.day}.`}
        primary={back}
      >
        <TownNotesReview />
      </StatusScreen>
    );
  }
  return (
    <StatusScreen
      label="ended-none"
      emblem={<MoonEmblem lit={false} spin={0} />}
      eyebrow="The game is over"
      title="Game ended"
      body="The Storyteller has ended the game. Thanks for playing!"
      primary={back}
    >
      <TownNotesReview />
    </StatusScreen>
  );
}

const VERDICT_LABEL: Record<SeatVerdict, string> = { good: "Good", unsure: "?", evil: "Evil" };
const VERDICT_RGB: Record<SeatVerdict, string> = { good: "134,183,212", unsure: "224,185,106", evil: "232,138,122" };

/** F10 (10H-AC-058): this game's notes stay readable through the post-game
 * review and are cleared by Back to Start. Local only.
 *
 * Package 3 (3D): the review lists each seat that has a verdict or character
 * guesses (named from the player-side script / official catalogue, with a
 * readable fallback for an unknown id). These are the player's own guesses:
 * nothing here reads Storyteller state. Legacy free-text notes are kept on the
 * device but are no longer shown. */
function TownNotesReview() {
  const code = usePlayerStore((s) => s.code);
  const notes = usePlayerStore((s) => s.seatGuesses);
  const publicLobby = usePlayerStore((s) => s.publicLobby);
  const [open, setOpen] = useState(false);
  const scriptId = publicLobby?.scriptId;
  const roles = useMemo(() => new Map((scriptId ? getBuiltinScript(scriptId)?.characters ?? [] : []).map((role) => [role.id, role])), [scriptId]);
  const roleOf = (id: string) => roles.get(id) ?? lookupOfficialRole(id);
  const prefix = code ? `${code}:` : null;
  const seatOf = (seatId: string) => publicLobby?.players[seatId]?.seat ?? Number.POSITIVE_INFINITY;
  const mine = prefix
    ? Object.entries(notes)
      .filter(([key, note]) => key.startsWith(prefix) && (note.verdict !== null || note.guesses.length > 0))
      .sort(([a], [b]) => seatOf(a.slice(prefix.length)) - seatOf(b.slice(prefix.length)))
    : [];
  if (mine.length === 0) return null;
  return (
    <section className={`swp-nr${open ? " swp-nr-open" : ""}`} aria-label="Your town notes">
      <button type="button" className="swp-nr-head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>Your town notes ({mine.length})</span>
        <span className="swp-nr-chev" aria-hidden="true">›</span>
      </button>
      {open && (
        <div className="swp-nr-body">
          <p className="swp-fell swp-nr-help">Your own notes and guesses, not confirmed game information.</p>
          <ul className="swp-nr-list">
            {mine.map(([key, note]) => {
              const player = publicLobby?.players[key.slice(prefix!.length)];
              return (
                <li key={key} className="swp-nr-item">
                  <span className="swp-nr-seat">{player ? player.seat + 1 : "–"}</span>
                  <span className="swp-nr-name">{player?.name ?? "A seat"}</span>
                  {note.guesses.length > 0 && (
                    <span className="swp-nr-guesses">
                      {note.guesses.map((id) => {
                        const r = roleOf(id);
                        return <span key={id} className="swp-mini-token swp-nr-token" role="img" aria-label={r?.name ?? id}><span className="swp-token-art" style={{ backgroundImage: `url(${iconUrlFor(r ?? id)})`, left: 1, top: 1, width: 20, height: 20 }} /></span>;
                      })}
                      <span className="swp-nr-names">{note.guesses.map((id) => roleOf(id)?.name ?? `Unrecognized character (${id})`).join(", ")}</span>
                    </span>
                  )}
                  {note.verdict && (
                    <span className="swp-nr-verdict" style={{ color: `rgb(${VERDICT_RGB[note.verdict]})`, borderColor: `rgb(${VERDICT_RGB[note.verdict]})`, background: `rgba(${VERDICT_RGB[note.verdict]},.18)` }}>{VERDICT_LABEL[note.verdict]}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="swp-fell swp-nr-help">These notes stay on this phone until you go Back to start.</p>
        </div>
      )}
    </section>
  );
}
