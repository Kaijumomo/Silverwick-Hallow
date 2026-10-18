import { iconUrlFor } from "@/data/iconUrl";
import { MAX_SEAT_GUESSES, usePlayerStore } from "@/stores/playerStore";
import type { RoleDef } from "@/stores/types";
import { TYPE_COLOUR, type TeamKey } from "./gameModel";

const GROUPS: ReadonlyArray<{ key: TeamKey; label: string }> = [
  { key: "townsfolk", label: "Townsfolk" },
  { key: "outsider", label: "Outsiders" },
  { key: "minion", label: "Minions" },
  { key: "demon", label: "Demon" },
];

/** "Who is {name}?" (design: guess bottom sheet): pick up to three characters
 * from the script. Tapping a chosen one removes it; at three, the rest are
 * disabled. */
export function GuessSheet({ seat, name, code, seatId, scriptCharacters, onClose }: {
  seat: number;
  name: string;
  code: string;
  seatId: string;
  scriptCharacters: readonly RoleDef[];
  onClose: () => void;
}) {
  const chosen = usePlayerStore((s) => s.seatGuesses[`${code}:${seatId}`]?.guesses ?? []);
  const setSeatGuess = usePlayerStore((s) => s.setSeatGuess);
  const full = chosen.length >= MAX_SEAT_GUESSES;
  const toggle = (id: string) => {
    if (chosen.includes(id)) setSeatGuess(code, seatId, { guesses: chosen.filter((c) => c !== id) });
    else if (!full) setSeatGuess(code, seatId, { guesses: [...chosen, id] });
  };
  return (
    <div className="swp-sheet-layer">
      <div className="swp-sheet-backdrop" onClick={onClose} />
      <div className="swp-sheet swp-guess-sheet" role="dialog" aria-modal="true" aria-label={`Who is ${name}?`}>
        <div className="swp-sheet-head">
          <div className="swp-sheet-titles">
            <span className="swp-sheet-eyebrow">Seat {seat} · {chosen.length} of {MAX_SEAT_GUESSES} chosen</span>
            <span className="swp-sheet-title">Who is {name}?</span>
          </div>
          <button type="button" className="swp-done" onClick={onClose}>Done</button>
        </div>
        <div className="swp-fell swp-sheet-help">Pick up to three characters.</div>
        <div className="swp-guess-scroll">
          {GROUPS.map((g) => {
            const roles = scriptCharacters.filter((r) => (r.type as string) === g.key);
            if (roles.length === 0) return null;
            return (
              <div key={g.key} className="swp-guess-group">
                <span className="swp-guess-eyebrow" style={{ color: TYPE_COLOUR[g.key] }}>{g.label}</span>
                <div className="swp-guess-grid">
                  {roles.map((r) => {
                    const on = chosen.includes(r.id);
                    const disabled = full && !on;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        className={`swp-guess-cell${on ? " swp-guess-on" : ""}${disabled ? " swp-guess-dim" : ""}`}
                        aria-pressed={on}
                        aria-disabled={disabled}
                        onClick={() => toggle(r.id)}
                      >
                        <span className="swp-guess-token"><span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${iconUrlFor(r)})`, left: 3, top: 3, width: 40, height: 40 }} /></span>
                        <span className="swp-guess-name">{r.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
