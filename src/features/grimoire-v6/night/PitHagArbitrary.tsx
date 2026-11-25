import type { ArbitraryMode } from "./useNightEngine";
import { ChoicePrompt } from "../choice/ChoiceParts";

/**
 * PH-c (https://wiki.bloodontheclocktower.com/Pit-Hag: "If a Demon is created, you may choose any players to kill or to protect throughout
 * the night... Additional deaths are considered attacks from the Pit-Hag"). The compact row on a night the Pit-Hag made a Demon, in the
 * Barber card's language: the prompt line with two quiet pills. A pill chooses what the next tap on the board does (the engine owns the
 * tap); tapping the same pill again turns it off. Kill and Protect are the Storyteller's own choices: making a Demon kills and protects
 * nobody by itself. Presentation only.
 */
export function PitHagArbitrary({ mode, onMode }: { mode: ArbitraryMode | null; onMode: (mode: ArbitraryMode | null) => void }) {
  const pill = (value: ArbitraryMode, label: string) =>
    <button type="button" className="gv-choice-pill is-small" aria-pressed={mode === value} onClick={() => onMode(mode === value ? null : value)}>{label}</button>;
  return <div className="gv-choice" data-pithag-arbitrary>
    <hr className="gv-choice-divider" />
    <ChoicePrompt text="Deaths are arbitrary tonight" action={<div role="group" aria-label="Arbitrary deaths" style={{ display: "flex", gap: 8 }}>{pill("kill", "Kill")}{pill("protect", "Protect")}</div>} />
    {mode && <p className="gv-choice-note">{mode === "kill" ? "Tap a player on the board to kill them (a Pit-Hag attack)." : "Tap a player on the board to protect them until dawn. Tap again to take it off."}</p>}
  </div>;
}
