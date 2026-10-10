import { useEffect, useId, useRef, useState } from "react";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { captureCharacterActionContext, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import type { SetupContext } from "./setupContext";
import { redHerringSetup } from "./redHerringSetup";

export type RedHerringSelection = { choosing: boolean; error: string | null; choose: () => boolean; clearError: () => void };

/** Kept above dismissible panels so opening the board does not discard a
 * selection. State, privacy, session and owner changes still cancel it. */
export function useRedHerringSelection(context?: SetupContext): RedHerringSelection {
  const owner = useId();
  const hidden = usePrivacyStore(state => state.enabled);
  const picker = useTargetPicker(state => state.active);
  const refused = useTargetPicker(state => state.refused);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const authority = captureCharacterActionContext();
  useEffect(() => () => {
    generation.current++;
    if (useTargetPicker.getState().active?.owner === owner) useTargetPicker.getState().cancel();
  }, [context?.game, context?.script, hidden, owner, authority.lobby, authority.writerToken, authority.lifecycle]);
  const choosing = picker?.owner === owner;
  const choose = () => {
    setError(null);
    if (choosing) { generation.current++; useTargetPicker.getState().cancel(); return false; }
    if (!context || hidden) return false;
    const readiness = redHerringSetup(context);
    if (readiness.status !== "missing") return false;
    const captured = captureCharacterActionContext();
    const expectedScript = context.script;
    const expectedGeneration = ++generation.current;
    useTargetPicker.getState().start("Red Herring", target => {
      const current = useStorytellerStore.getState();
      if (generation.current !== expectedGeneration || usePrivacyStore.getState().enabled || current.game !== context.game ||
        current.game?.scriptId !== expectedScript?.id) return;
      generation.current++;
      const result = current.setSetupRedHerring(target, captured);
      setError(result.ok ? null : result.message ?? "The setup changed. Choose again.");
    }, { owner, eligible: new Set(readiness.eligible.map(target => target.participantId)) });
    return true;
  };
  return { choosing, error: error || choosing && refused || null, choose, clearError: () => setError(null) };
}

/** The existing Preparation row starts the same direct Grimoire picker used
 * by Night actions. It never chooses a target or edits state itself. */
export function RedHerringPreparation({ context, selection, onChoose }: {
  context: SetupContext; selection?: RedHerringSelection; onChoose?: () => void;
}) {
  const localSelection = useRedHerringSelection(selection ? undefined : context);
  const hidden = usePrivacyStore(state => state.enabled);
  const { choosing, error, choose } = selection ?? localSelection;
  const readiness = redHerringSetup(context);
  if (hidden || !readiness.required) return null;
  return <div className="setup-prep-row" aria-label="Fortune Teller preparation">
    <span className="setup-prep-name">Fortune Teller</span>
    <span className="setup-prep-need">{readiness.status === "ready"
      ? `Red Herring: ${context.game.players[readiness.target!.playerId]?.name || "selected player"}`
      : choosing ? "Tap a good player on the board." : readiness.message}</span>
    {readiness.status === "missing" && <button type="button" className="btn btn-sm" onClick={() => { if (choose()) onChoose?.(); }}>
      {choosing ? "Cancel selection" : "Choose Red Herring"}
    </button>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </div>;
}
