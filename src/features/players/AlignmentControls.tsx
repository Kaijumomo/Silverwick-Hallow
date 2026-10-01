import { useState } from "react";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { buildRegistry, deriveAlignment } from "@/data/roleRegistry";
import { isInitialRevealComplete } from "@/stores/identity";
import { alignmentChangeOpen, changeAlignmentIntent, correctAlignmentIntent, type AlignmentIntent } from "@/stores/alignmentResolution";
import { shownAlignmentIntent } from "@/stores/roleResolution";
import { projectIdentity } from "@/stores/projections";
import type { Alignment, ShownAlignment, STPlayerRecord } from "@/stores/types";

/**
 * Phase 10E: Storyteller-private alignment controls.
 *
 * Two separate surfaces, two separate seams:
 *  - ActualAlignmentControls -- Actual Alignment truth, through the Phase 10E
 *    Alignment seam (resolveAlignments). The normal Good/Evil action is a
 *    gameplay change; "Correct the recorded alignment…" is progressively
 *    disclosed.
 *  - PlayerFacingAlignmentControls -- what the player is told, through the
 *    Phase 10D perception seam (setPerception). Normal is the default; the
 *    explicit overrides are progressively disclosed, and an active override
 *    shows a concise "View overridden" cue.
 *
 * Every action is built from the record THIS render shows (`player`) -- never
 * re-read at click time -- so a seat whose participant, alignment or Traveler
 * status changed in between is refused as stale (inline) and nothing changes.
 * Both return nothing under Privacy Mode.
 */

const alignmentLabel = (alignment: Alignment): string => alignment === "good" ? "Good" : "Evil";

/** DOM id of a participant's player-facing alignment group (the disclosure
 * cue directs the Storyteller there). */
export const playerFacingAlignmentId = (player: Pick<STPlayerRecord, "id">): string => `player-facing-alignment-${player.id}`;

export function ActualAlignmentControls({ player }: { player: STPlayerRecord }) {
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) => (game ? selectScriptById(s, game.scriptId) : undefined));
  const resolveAlignments = useStorytellerStore((s) => s.resolveAlignments);
  const hidden = usePrivacyStore((s) => s.enabled);
  const [error, setError] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  // Armed by a committed change of an ORDINARY participant's Actual
  // Alignment; the cue itself shows only while the player view still differs.
  const [cueArmed, setCueArmed] = useState(false);
  if (!game || hidden || player.isEmpty || !player.participantId) return null;

  const run = (intent: AlignmentIntent) => {
    const result = resolveAlignments({ intents: [intent] });
    setError(result.ok ? null : result.message);
    if (result.ok && result.changed && !player.isTraveler) setCueArmed(true);
  };
  const current = player.actualAlignment;
  const ended = game.phase === "ended";
  const changeOpen = alignmentChangeOpen(game, player);
  // A correction is meaningful once the starting record is committed (after
  // Reveal) or in Live Play; before Reveal a plain change already repairs it.
  const correctionAvailable = !ended && (game.phase !== "setup" || isInitialRevealComplete(game));
  // The ordinary disclosure advisory: what the player is currently told
  // (their projected self alignment) against the new Actual Alignment. It
  // never decides whether a mechanic requires disclosure.
  const registry = script ? buildRegistry(script) : null;
  const told = !player.isTraveler && registry ? projectIdentity(player, registry) : null;
  const viewDiffers = !!told && !!current && told.shownAlignment !== current;
  const focusPlayerView = () => {
    const target = document.getElementById(playerFacingAlignmentId(player));
    target?.scrollIntoView?.({ block: "center" });
    target?.focus();
  };

  return <div className="alignment-controls">
    <div className="drawer-row" role="group"
      aria-label={player.isTraveler ? "Actual Traveler alignment (Storyteller private)" : "Actual alignment (Storyteller private)"}>
      <span>Actual alignment</span>
      <span className="label">{current ? alignmentLabel(current) : "Unresolved"}</span>
      {!ended && (["good", "evil"] as const).map((alignment) => <button key={alignment} className="toggle-pill"
        aria-pressed={current === alignment} disabled={!changeOpen}
        onClick={() => run(changeAlignmentIntent(player, alignment))}>
        {alignmentLabel(alignment)}
      </button>)}
    </div>
    {ended
      ? <p className="behavior-help">This game has ended; alignments are frozen.</p>
      : !changeOpen && <p className="behavior-help">Roles are revealed; use a correction to repair the recorded alignment.</p>}
    {correctionAvailable && <details className="drawer-advanced" open={correctionOpen}
      onToggle={(e) => setCorrectionOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Correct the recorded alignment…</summary>
      {correctionOpen && <>
        <div className="drawer-row">
          {(["good", "evil"] as const).map((alignment) => <button key={alignment} className="btn btn-sm"
            disabled={current === alignment} onClick={() => run(correctAlignmentIntent(player, alignment))}>
            Correct to {alignmentLabel(alignment)}
          </button>)}
        </div>
        <p className="behavior-help">Use this when the recorded alignment was wrong. It is not a gameplay change; History shows a correction.</p>
      </>}
    </details>}
    {error && <p role="alert" className="field-error">{error}</p>}
    {cueArmed && viewDiffers && <p role="status" className="behavior-help alignment-view-cue">
      Player view differs from the new alignment.{" "}
      <button className="btn btn-sm" onClick={focusPlayerView}>Review player view</button>
    </p>}
  </div>;
}

const OVERRIDES: { value: ShownAlignment; label: string }[] = [
  { value: "good", label: "Shown Good" },
  { value: "evil", label: "Shown Evil" },
  { value: "undisclosed", label: "Not told" },
];

export function PlayerFacingAlignmentControls({ player }: { player: STPlayerRecord }) {
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) => (game ? selectScriptById(s, game.scriptId) : undefined));
  const resolveRoles = useStorytellerStore((s) => s.resolveRoles);
  const hidden = usePrivacyStore((s) => s.enabled);
  const overridden = player.shownAlignment !== null;
  const [open, setOpen] = useState(overridden);
  const [error, setError] = useState<string | null>(null);
  if (!game || hidden || player.isEmpty || !player.participantId) return null;

  const run = (shownAlignment: ShownAlignment | null) => {
    const result = resolveRoles({ intents: [shownAlignmentIntent(player, shownAlignment)] });
    setError(result.ok ? null : result.message);
  };
  // What Normal currently means for this participant: an ordinary player's
  // alignment derives from their Shown Role; a Traveler's follows their
  // Actual Alignment.
  const shownDef = !player.isTraveler && player.shownRole && script ? buildRegistry(script).get(player.shownRole) : undefined;
  const normal = player.isTraveler
    ? player.actualAlignment ? alignmentLabel(player.actualAlignment) : "not chosen"
    : shownDef && shownDef.type !== "traveler" && shownDef.type !== "fabled" && shownDef.type !== "loric"
      ? alignmentLabel(deriveAlignment(shownDef)) : "—";

  return <div className="alignment-perception">
    <div id={playerFacingAlignmentId(player)} tabIndex={-1} className="drawer-row" role="group" aria-label="Player-facing alignment">
      <span>Player-facing alignment</span>
      <button className="toggle-pill" aria-pressed={player.shownAlignment === null} onClick={() => run(null)}>
        Normal ({normal})
      </button>
      {overridden && <span className="label view-overridden">View overridden</span>}
    </div>
    <p className="behavior-help">{player.isTraveler
      ? "Normal: they are told their actual alignment."
      : "Normal: derived from the shown character."}</p>
    <details className="drawer-advanced" open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>Override what they are told…</summary>
      {open && <>
        <div className="drawer-row">
          {OVERRIDES.map(({ value, label }) => <button key={value} className="toggle-pill"
            aria-pressed={player.shownAlignment === value} onClick={() => run(value)}>{label}</button>)}
        </div>
        <p className="behavior-help">Only for a mechanic that misstates or withholds alignment. Not told shows their character without an alignment.</p>
      </>}
    </details>
    {error && <p role="alert" className="field-error">{error}</p>}
  </div>;
}
