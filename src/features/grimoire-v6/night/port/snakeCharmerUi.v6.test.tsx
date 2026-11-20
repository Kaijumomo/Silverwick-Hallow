// SV-2a -- the Snake Charmer's Night step in the existing Night panel: tapped on the board like the Imp's; a Recluse's registration
// falls back to the existing ability workspace, whose final answer is the action (strict gameplay: no second dialog; Undo reverts).
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { openInStore, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
// p0 snakecharmer, p1 imp, p2 chef, p3 monk, p4 empath
const ROLES = ["snakecharmer", "imp", "chef", "monk", "empath"];
function show(g = proofGame(ROLES)) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, "snakecharmer") });
  return render(<StrictMode><Guide /></StrictMode>);
}
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("the step is tapped on the board; choosing the Demon swaps both players in one commit", () => {
  show();
  expect(useTargetPicker.getState().active?.label).toBe("Choose an alive player");
  tap("p1");
  expect(game().players.p0).toMatchObject({ actualRole: "imp", actualAlignment: "evil" });
  expect(game().players.p1).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good" });
  expect(game().players.p1!.effects.map((e) => [e.type, e.sourceCharacter])).toEqual([["poisoned", "snakecharmer"]]);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => { store.getState().undo(); });
  expect(game().players.p0!.actualRole).toBe("snakecharmer");
  expect(game().players.p1!.effects).toEqual([]);
});

it("choosing a player who is not the Demon closes the step and changes nothing", () => {
  show();
  const before = game().players;
  tap("p2");
  expect(game().players).toEqual(before);
  expect(game().nightProgress[`2:${participantStepKey(game().players.p0!.participantId!, "snakecharmer")}`]?.status).toBe("done");
});

it("a Recluse: the Storyteller rules in the existing workspace; nothing changes before the answer, and Yes swaps in one commit", () => {
  show(patchPlayer(proofGame(ROLES), "p4", { actualRole: "recluse", shownRole: "recluse", actualAlignment: "good" }));
  tap("p4");
  expect(game().players.p0!.actualRole).toBe("snakecharmer");
  // The workspace's "Further choices" row carries the question; nothing is recorded before the answer.
  expect(screen.getByText("Player 4 registers as a Demon")).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole("radiogroup", { name: "Player 4 registers as a Demon" })).getByRole("radio", { name: "Yes" }));
  expect(game().players.p0).toMatchObject({ actualRole: "recluse", actualAlignment: "good" });
  expect(game().players.p4).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good" });
  expect(store.getState().undoStack).toHaveLength(1);
});
