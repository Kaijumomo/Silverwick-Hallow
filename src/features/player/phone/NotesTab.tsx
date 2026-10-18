import { iconUrlFor } from "@/data/iconUrl";
import { lookupOfficialRole } from "@/data/officialRoles";
import { usePlayerStore, type SeatVerdict } from "@/stores/playerStore";
import type { PublicLobbyRecord, RoleDef } from "@/stores/types";
import { TYPE_COLOUR, teamKeyOf, townSeats } from "./gameModel";

const VERDICTS: ReadonlyArray<{ id: SeatVerdict; label: string; rgb: string }> = [
  { id: "good", label: "Good", rgb: "134,183,212" },
  { id: "unsure", label: "?", rgb: "224,185,106" },
  { id: "evil", label: "Evil", rgb: "232,138,122" },
];

/** Notes (design: Verdicts): one row per other player with a Good / ? / Evil
 * verdict and up to three character guesses. Private to this device; these are
 * the player's own guesses, never game information. */
export function NotesTab({ lobby, ownId, code, scriptCharacters, onGuess }: {
  lobby: PublicLobbyRecord;
  ownId: string | null;
  code: string;
  scriptCharacters: readonly RoleDef[];
  onGuess: (seatId: string) => void;
}) {
  const seatGuesses = usePlayerStore((s) => s.seatGuesses);
  const setSeatGuess = usePlayerStore((s) => s.setSeatGuess);
  const roleOf = (id: string) => scriptCharacters.find((r) => r.id === id) ?? lookupOfficialRole(id);
  const seats = townSeats(lobby, ownId).filter((s) => !s.you);
  return (
    <div className="swp-notes">
      {seats.map((s) => {
        const note = seatGuesses[`${code}:${s.id}`];
        const guesses = note?.guesses ?? [];
        return (
          <div key={s.id} className="swp-note-row">
            <span className="swp-note-seat">{s.seat}</span>
            <button type="button" className="swp-note-main" onClick={() => onGuess(s.id)} aria-label={`Guess who ${s.name} is`}>
              <span className={`swp-note-name${s.dead ? " swp-note-dead" : ""}`}>{s.name}</span>
              <span className="swp-note-guesses">
                {guesses.map((id) => {
                  const r = roleOf(id);
                  return (
                    <span key={id} className="swp-mini-token" title={r?.name ?? id} style={{ boxShadow: `0 0 0 1px ${TYPE_COLOUR[teamKeyOf(r?.type)]}` }}>
                      <span role="img" aria-label={r?.name ?? id} className="swp-token-art" style={{ backgroundImage: `url(${iconUrlFor(r ?? id)})`, inset: 2, left: 2, top: 2, width: 20, height: 20 }} />
                    </span>
                  );
                })}
                {guesses.length === 0 && <span className="swp-note-hint">Tap to guess</span>}
              </span>
            </button>
            <div className="swp-verdicts" role="group" aria-label={`Verdict for ${s.name}`}>
              {VERDICTS.map((v) => {
                const on = note?.verdict === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`swp-verdict${on ? " swp-verdict-on" : ""}`}
                    style={on ? { background: `rgba(${v.rgb},.22)`, borderColor: `rgb(${v.rgb})`, color: `rgb(${v.rgb})` } : undefined}
                    aria-pressed={on}
                    onClick={() => setSeatGuess(code, s.id, { verdict: on ? null : v.id })}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
