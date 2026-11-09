import { act, fireEvent, renderHook, screen } from "@testing-library/react";
import { createRulesQuery } from "@/stores/rulesQuery";
import { useShellStore } from "@/stores/shellStore";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { participantStepKey } from "@/stores/nightProgress";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../../GrimoireV6Screen";
import { useV6Ctx } from "../../ctx";
import { playerMarks, removeMark, type Mark } from "../../board/marks";
import { useV6Ui } from "../../v6Store";
import { useNightPos } from "../nightPos";

/**
 * Test helpers for scenarios written against the retired Night Order rows: they drive the unified
 * Grimoire's Night card instead. A step is selected by the character shown to its player, the card is
 * opened, and "Continue action" opens the (unchanged) ability workspace.
 */
export function NightScreen() {
  return <VotingProvider><GrimoireV6Screen /></VotingProvider>;
}

/** Fresh UI state for the Night card (call from beforeEach, after the game is installed or before). */
export function resetNightUi() {
  useShellStore.getState().reset();
  useNightPos.getState().go(0, null, null);
  useV6Ui.getState().reset();
  useV6Ui.getState().set({ panel: "night" });
}

/** Moves the Night cursor to a player's step (the character they are shown as) and opens the card. */
export function selectNightStep(playerId: string, roleId?: string) {
  const game = store.getState().game!;
  const player = game.players[playerId]!;
  act(() => {
    useShellStore.getState().setNightCursor({ day: game.day, stepKey: participantStepKey(player.participantId!, roleId ?? player.shownRole ?? player.actualRole) });
    useV6Ui.getState().set({ panel: "night" });
  });
}

/** The old row's "Guide": opens the ability workspace for the current step. */
export const continueAction = () => fireEvent.click(screen.getByRole("button", { name: "Continue action" }));

export const workspace = () => document.querySelector(".ability-workspace") as HTMLElement;

/** The marks the unified board draws on a player's token (notation and Effects), from the live game. */
export function marksOn(playerId: string): Mark[] {
  return renderHook(() => {
    const game = store((s) => s.game)!;
    const ctx = useV6Ctx(game);
    const query = ctx.script ? createRulesQuery(game, { script: ctx.script, registry: ctx.registry }) : null;
    return playerMarks({ game, script: ctx.script, registry: ctx.registry, query }, game.players[playerId]!);
  }).result.current;
}

/** Takes one drawn mark away through the live command (the board's two-tap arming is UI only). */
export function removeMarkLabelled(playerId: string, label: RegExp) {
  const mark = marksOn(playerId).find((m) => label.test(m.label));
  if (!mark) throw new Error(`no ${label} mark on ${playerId}`);
  return removeMark(playerId, store.getState().game!.players[playerId]!.participantId, mark);
}
