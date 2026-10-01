import { useEffect, useState } from "react";
import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { buildRegistry, type RoleRegistry } from "@/data/roleRegistry";
import { isInitialRevealComplete } from "@/stores/identity";
import { alignmentChangeOpen, changeAlignmentIntent, correctAlignmentIntent, type AlignmentIntent } from "@/stores/alignmentResolution";
import { shownAlignmentIntent } from "@/stores/roleResolution";
import { projectIdentity } from "@/stores/projections";
import type { Alignment, ParticipantId, ShownAlignment, STPlayerRecord } from "@/stores/types";

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
 *    explicit overrides are progressively disclosed, and a MEANINGFUL departure
 *    from Normal shows a concise "View overridden" cue (PHASE10E.md 15/25).
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

/**
 * The alignment Normal (`shownAlignment: null`) would CURRENTLY tell this
 * participant -- undefined when Normal tells none. An ordinary participant's
 * derives from their valid Shown Role (exactly the projection's own rule,
 * never the Actual Alignment); a Traveler's is their current Actual Alignment
 * (none while unresolved).
 */
export function normalAlignmentOf(player: STPlayerRecord, registry: RoleRegistry | null): Alignment | undefined {
  if (player.isTraveler) return player.actualAlignment;
  return registry ? projectIdentity({ ...player, shownAlignment: null }, registry)?.shownAlignment : undefined;
}

/**
 * SOL-10E-R1 (PHASE10E.md 15/25, 10E-AC-41): whether the player-facing
 * alignment MEANINGFULLY departs from Normal -- a semantic cue, never a
 * raw-storage warning. Not told (`undisclosed`) always does; an explicit
 * Good/Evil does only while it differs from what Normal currently tells (so a
 * stored value identical to Normal -- e.g. Setup's dealt perception -- shows
 * nothing, and one that later diverges because Normal changed shows the cue
 * then); Normal itself never does. Read-only: nothing is normalized.
 */
export function alignmentViewOverridden(player: STPlayerRecord, registry: RoleRegistry | null): boolean {
  if (player.shownAlignment === null) return false;
  if (player.shownAlignment === "undisclosed") return true;
  return player.shownAlignment !== normalAlignmentOf(player, registry);
}

/** SOL-10E-A4: ONE unresolved gameplay-disclosure question -- which
 * participation instance a gameplay change was made to, and the Actual
 * Alignment it produced. Never a sticky flag whose meaning outlives it. */
type GameplayDisclosureCue = { participantId: ParticipantId; alignment: Alignment };

export function ActualAlignmentControls({ player }: { player: STPlayerRecord }) {
  const game = useStorytellerStore((s) => s.game);
  const script = useStorytellerStore((s) => (game ? selectScriptById(s, game.scriptId) : undefined));
  const resolveAlignments = useStorytellerStore((s) => s.resolveAlignments);
  const hidden = usePrivacyStore((s) => s.enabled);
  const [error, setError] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  // SOL-10E-R2 / SOL-10E-A4: the "Player view differs" advisory is one
  // unresolved gameplay-disclosure question. It is armed only by an accepted
  // GAMEPLAY change (changeActualAlignment) of an ORDINARY participant, and is
  // pending only while it still describes this participation instance, the
  // Actual Alignment that change produced, and a player view that differs. It
  // is resolved (disarmed) the moment any of that stops being true -- the view
  // comes into agreement, the participant is replaced, or the Actual moves --
  // and an accepted correction clears it outright: a correction never arms,
  // revives or carries forward a gameplay advisory.
  const [gameplayCue, setGameplayCue] = useState<GameplayDisclosureCue | null>(null);
  // What the player is currently told (their projected self alignment)
  // against the Actual Alignment. It never decides whether a mechanic
  // requires disclosure.
  const registry = script ? buildRegistry(script) : null;
  const told = !player.isTraveler && registry ? projectIdentity(player, registry) : null;
  const viewDiffers = !!told && !!player.actualAlignment && told.shownAlignment !== player.actualAlignment;
  const cuePending = gameplayCue !== null && gameplayCue.participantId === player.participantId &&
    player.actualAlignment === gameplayCue.alignment && viewDiffers;
  useEffect(() => {
    if (gameplayCue !== null && !cuePending) setGameplayCue(null);
  }, [gameplayCue, cuePending]);
  if (!game || hidden || player.isEmpty || !player.participantId) return null;
  const participantId = player.participantId;

  const run = (intent: AlignmentIntent) => {
    const result = resolveAlignments({ intents: [intent] });
    setError(result.ok ? null : result.message);
    if (!result.ok) return;
    if (intent.kind === "correctActualAlignment") setGameplayCue(null);
    else if (result.changed && !player.isTraveler) setGameplayCue({ participantId, alignment: intent.actualAlignment });
  };
  const current = player.actualAlignment;
  const ended = game.phase === "ended";
  const changeOpen = alignmentChangeOpen(game, player);
  // A correction is meaningful once the starting record is committed (after
  // Reveal) or in Live Play; before Reveal a plain change already repairs it.
  const correctionAvailable = !ended && (game.phase !== "setup" || isInitialRevealComplete(game));
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
    {cuePending && <p role="status" className="behavior-help alignment-view-cue">
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
  const registry = script ? buildRegistry(script) : null;
  const overridden = alignmentViewOverridden(player, registry);
  const [open, setOpen] = useState(overridden);
  const [error, setError] = useState<string | null>(null);
  if (!game || hidden || player.isEmpty || !player.participantId) return null;

  const run = (shownAlignment: ShownAlignment | null) => {
    const result = resolveRoles({ intents: [shownAlignmentIntent(player, shownAlignment)] });
    setError(result.ok ? null : result.message);
  };
  // What Normal currently means for this participant (the same definition
  // the override cue compares against).
  const normalAlignment = normalAlignmentOf(player, registry);
  const normal = normalAlignment ? alignmentLabel(normalAlignment) : player.isTraveler ? "not chosen" : "—";

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
