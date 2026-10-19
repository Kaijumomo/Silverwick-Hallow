import { useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { entriesFor } from "@/stores/playerInfoLog";
import type { PlayerInfoContent, PlayerInfoEntry } from "@/stores/types";

const momentLabel = (entry: PlayerInfoEntry) =>
  entry.moment ? `${entry.moment.phase === "night" ? "Night" : "Day"} ${entry.moment.day}` : "Earlier";

function summary(content: PlayerInfoContent): string[] {
  return [
    ...(content.text ? [content.text] : []),
    ...(content.demon ? [`Demon: ${content.demon.name}`] : []),
    ...(content.minions ? [`Minions: ${content.minions.map((m) => m.name).join(", ")}`] : []),
    ...(content.bluffs ? [`${content.bluffs.length} bluff${content.bluffs.length === 1 ? "" : "s"}`] : []),
  ];
}

/**
 * Package 3 (C3): what this player has been shown, newest first, with a way to
 * correct the text. A correction silently replaces what the player sees (the
 * original stays in the Storyteller's record) and cannot be undone with Undo.
 * Storyteller screens only; the parent hides it in Privacy Mode.
 */
export function PlayerInfoLog({ playerId }: { playerId: string }) {
  const game = useStorytellerStore((s) => s.game);
  const correct = useStorytellerStore((s) => s.correctPlayerInfo);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const player = game?.players[playerId];
  if (!game || !player || player.isEmpty) return null;
  const entries = entriesFor(game, player);
  if (entries.length === 0) return null;
  const ended = game.phase === "ended";
  return <details className="information-review" aria-label={`Information history for ${player.name}`}>
    <summary>What {player.name} has been shown ({entries.length})</summary>
    <ol className="information-log">
      {[...entries].reverse().map((entry) => <li key={entry.id}>
        <strong>{momentLabel(entry)}</strong>{" "}
        {summary(entry.shown).map((line, index) => <span key={index} className="information-log-line">{line}</span>)}
        {entry.versions.length > 0 && <span className="behavior-help"> Corrected {entry.versions.length} time{entry.versions.length === 1 ? "" : "s"}.</span>}
        {!ended && entry.shown.text !== undefined && (editing === entry.id
          ? <div className="information-correct">
            <textarea className="input" rows={2} maxLength={4000} value={draft} aria-label="Corrected information"
              onChange={(event) => { setDraft(event.target.value); setError(null); }} />
            <button className="btn btn-sm" onClick={() => {
              const text = draft.trim();
              const { text: _old, ...rest } = entry.shown;
              const result = correct(entry.id, { ...rest, ...(text ? { text } : {}) });
              if (result.ok) { setEditing(null); setError(null); } else setError(result.message);
            }}>Replace what the player sees</button>
            <button className="btn btn-sm" onClick={() => { setEditing(null); setError(null); }}>Cancel</button>
            <p className="behavior-help">The player sees the corrected text as if it was always sent. This cannot be undone.</p>
          </div>
          : <button className="btn btn-sm" onClick={() => { setEditing(entry.id); setDraft(entry.shown.text ?? ""); setError(null); }}>Correct</button>)}
      </li>)}
    </ol>
    {error && <p className="field-error" role="alert">{error}</p>}
  </details>;
}
