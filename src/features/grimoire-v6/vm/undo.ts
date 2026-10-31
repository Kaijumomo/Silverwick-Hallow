import { useStorytellerStore } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { deriveNightWork, stepResolved } from "@/features/nightOrder/nightWork";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";

/**
 * The dock's Undo. The same command and the same recovery behaviour as before: it cancels a pending target
 * pick, clears the selection, and after a Night undo puts the Night cursor back on the step it reopened.
 */
export function useUndo(ctx: V6Ctx) {
  const undoDepth = useStorytellerStore((s) => s.undoStack.length);
  const canUndoEnding = useStorytellerStore((s) => s.canUndoFinishedGame);
  const { game, privacy, mutationLocked, ended, script, registry, ui } = ctx;
  const disabled = privacy || mutationLocked || (ended ? !canUndoEnding : undoDepth === 0);

  const run = () => {
    if (privacy || mutationLocked) return;
    const state = useStorytellerStore.getState();
    const before = state.game;
    if (!before) return;
    try {
      useTargetPicker.getState().cancel();
      if (state.selectedPlayerId !== null) state.selectPlayer(null);
      ui.set({ card: false, swapFrom: null, picker: null, show: null, slay: null, shownNumber: null });
      if (before.phase === "ended") {
        const result = state.undoFinishedGame();
        if (!result.ok) flash(result.message);
        else if (result.message) flash(result.message);
        return;
      }
      const undoResult = state.undo();
      if (undoResult && !undoResult.ok) { flash(undoResult.message); return; }
      const after = useStorytellerStore.getState().game;
      if (after && after !== before && after.phase === "night") {
        const work = deriveNightWork(after, { script: script ?? null, registry, semantics: CANONICAL_ABILITY_SEMANTICS });
        const reopened = work.steps.find((step) => !stepResolved(after, step) && (before.day !== after.day || before.phase !== "night" || stepResolved(before, step)));
        if (reopened) useShellStore.getState().setNightCursor({ day: after.day, stepKey: reopened.stepKey });
      }
      flash("Undone.");
    } catch {
      flash("This device could not save Undo. Check browser storage before continuing.");
    }
  };
  void game;
  return { run, disabled, title: disabled ? "Nothing to undo" : "Undo last change (Ctrl+Z)" };
}
