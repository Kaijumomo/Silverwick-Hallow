import { useEffect, useId, useRef, useState } from "react";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";
import { captureBinding, isCurrentBinding, useTargetPicker } from "@/features/abilities/abilityUi";

/**
 * Phase 10H (contract §§2.2, 8.3-8.4; 10H-AC-014, AC-017): ONE participant
 * slot, chosen on the Table or the Roster -- never a dropdown.
 *
 * The eligible candidates are computed once by the caller (the planner's /
 * constraint filter) and rendered TWICE from that same list: as this slot's
 * Roster pick-strip, and as the Grimoire's pickable seats ("Choose on Table"
 * starts the shared target picker with exactly these participants eligible).
 * Either path captures the SAME ParticipantBinding through captureBinding.
 *
 * Preserved SOL-10F-B1 semantics: the slot's value is the binding captured the
 * instant it was chosen; a captured binding whose seat now holds someone else
 * is KEPT (so the coordinator refuses it as stale) and SHOWN as stale -- never
 * relabelled as the replacement occupant -- until the Storyteller chooses
 * again.
 */
export function ParticipantPicker({ game, value, candidates, label, disabled = false, optionDisabled, onChange, hint, defaultOpen }: {
  game: StorytellerLobbyRecord;
  value: ParticipantBinding | null;
  candidates: readonly STPlayerRecord[];
  label: string;
  disabled?: boolean;
  optionDisabled?: (player: STPlayerRecord) => boolean;
  onChange: (binding: ParticipantBinding | null) => void;
  /** Short constraint text ("living players only"). */
  hint?: string;
  /** Show the Roster strip even when a value is chosen. */
  defaultOpen?: boolean;
}) {
  const headingId = useId();
  const stale = value !== null && !isCurrentBinding(game, value);
  const chosen = value && !stale ? game.players[value.playerId] : undefined;
  const [open, setOpen] = useState(defaultOpen ?? value === null);
  // Keyboard continuity: a choice collapses the strip, so focus moves to the
  // slot's own "Change" control instead of falling to the page.
  const changeRef = useRef<HTMLButtonElement>(null);
  const [refocus, setRefocus] = useState(false);
  useEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    changeRef.current?.focus({ preventScroll: true });
  }, [refocus]);
  const picking = useTargetPicker((s) => s.active);
  const pickingHere = picking?.owner === headingId;
  useEffect(() => () => { if (useTargetPicker.getState().active?.owner === headingId) useTargetPicker.getState().cancel(); }, [headingId]);
  const name = (p: STPlayerRecord) => p.name || `Seat ${p.seat + 1}`;
  const choose = (playerId: string) => {
    const binding = captureBinding(game, playerId);
    if (!binding) return;
    onChange(binding);
    setOpen(false);
    setRefocus(true);
  };
  const allowed = candidates.filter((p) => !optionDisabled?.(p));
  const startTablePick = () => {
    if (pickingHere) { useTargetPicker.getState().cancel(); return; }
    useTargetPicker.getState().start(label, (binding) => { onChange(binding); setOpen(false); }, {
      owner: headingId,
      eligible: new Set(allowed.map((p) => p.participantId!).filter(Boolean)),
    });
  };
  return (
    <div className={`pick-slot${stale ? " stale" : ""}`} role="group" aria-labelledby={headingId} data-pick-slot={label}
      data-chosen-player={value === null ? "" : stale ? "stale" : value.playerId}>
      <div className="pick-slot-head">
        <span id={headingId} className="pick-slot-label">{label}</span>
        {hint && <span className="pick-slot-hint">{hint}</span>}
      </div>
      <div className="pick-slot-value">
        {chosen ? (
          <span className="pick-chip" data-chosen={chosen.id}>{name(chosen)} <span className="pick-chip-seat">seat {chosen.seat + 1}</span></span>
        ) : stale ? (
          <span className="pick-chip pick-chip-stale">No longer in that seat — choose again</span>
        ) : (
          <span className="pick-empty">Not chosen</span>
        )}
        {!disabled && (
          <span className="pick-slot-actions">
            <button type="button" className="btn btn-sm" aria-pressed={pickingHere} onClick={startTablePick}
              aria-label={pickingHere ? `Cancel choosing ${label} on the Table` : `Choose ${label} on the Table`}>
              {pickingHere ? "Cancel" : "On Table"}
            </button>
            {(value !== null || !open) && (
              <button ref={changeRef} type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}
                aria-label={open ? `Hide the Roster for ${label}` : `Change ${label} from the Roster`}>
                {open ? "Hide list" : "Change"}
              </button>
            )}
            {value !== null && (
              <button type="button" className="btn btn-sm" aria-label={`Clear ${label}`} onClick={() => { onChange(null); setOpen(true); }}>Clear</button>
            )}
          </span>
        )}
      </div>
      {stale && <span className="behavior-help" role="status">The player chosen for {label} is no longer in that seat — choose again.</span>}
      {open && !disabled && (
        <ul className="pick-strip" aria-label={`${label}: Roster`}>
          {candidates.map((p) => {
            const isChosen = !!chosen && chosen.id === p.id;
            return (
              <li key={p.id}>
                <button type="button" className={`pick-option${isChosen ? " chosen" : ""}`} aria-pressed={isChosen}
                  data-player-id={p.id} disabled={optionDisabled?.(p)} onClick={() => choose(p.id)}>
                  <span className="pick-option-name">{name(p)}</span>
                  <span className="pick-option-seat">seat {p.seat + 1}</span>
                </button>
              </li>
            );
          })}
          {candidates.length === 0 && <li className="pick-empty">No eligible players.</li>}
        </ul>
      )}
    </div>
  );
}
