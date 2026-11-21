// SV-2a/SV-2c -- the Snake Charmer's Night step in the existing Night panel: tapped on the board like the Imp's. A Recluse's
// registration is asked on the Night card in the Barber card's compact style (PO review 2026-11-21); the answer is the action (one
// Undo). After a swap the card offers YOU ARE for both players, and the counter stays on the Snake Charmer's row.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
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

it("a Recluse: a compact Yes or No on the Night card (no workspace); nothing changes before the answer, Yes swaps in one commit, No changes nothing, Choose again drops the tap", () => {
  const recluse = patchPlayer(proofGame(ROLES), "p4", { actualRole: "recluse", shownRole: "recluse", actualAlignment: "good" });
  show(recluse);
  tap("p4");
  expect(game().players.p0!.actualRole).toBe("snakecharmer");
  expect(screen.getByText("Does Player 4 register as a Demon?")).toBeInTheDocument();
  expect(screen.queryByText("On Table")).toBeNull();
  expect(screen.queryByRole("radiogroup")).toBeNull();
  expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue action" })).toBeNull();
  // PO 2026-11-21: "Choose again" sits beside the question, and the card has no grey explanation line.
  const prompt = screen.getByText("Does Player 4 register as a Demon?").closest(".gv-choice-prompt") as HTMLElement;
  expect(within(prompt).getByRole("button", { name: "Choose again" })).toHaveClass("is-small");
  expect(document.querySelector(".gv-choice-note")).toBeNull();
  expect(screen.queryByText(/swaps characters and alignments/)).toBeNull();
  // Choose again: the tap is dropped and the board asks again.
  fireEvent.click(screen.getByRole("button", { name: "Choose again" }));
  expect(screen.queryByText("Does Player 4 register as a Demon?")).toBeNull();
  expect(useTargetPicker.getState().active?.label).toBe("Choose an alive player");
  tap("p4");
  fireEvent.click(within(screen.getByRole("group", { name: "Your ruling" })).getByRole("button", { name: "No" }));
  expect(game().players.p0!.actualRole).toBe("snakecharmer");
  expect(game().nightProgress[`2:${participantStepKey(game().players.p0!.participantId!, "snakecharmer")}`]?.status).toBe("done");
  act(() => { store.getState().undo(); });
  tap("p4");
  fireEvent.click(within(screen.getByRole("group", { name: "Your ruling" })).getByRole("button", { name: "Yes" }));
  expect(game().players.p0).toMatchObject({ actualRole: "recluse", actualAlignment: "good" });
  expect(game().players.p4).toMatchObject({ actualRole: "snakecharmer", actualAlignment: "good" });
  expect(store.getState().undoStack).toHaveLength(1);
});

it("after a swap: YOU ARE for the new Demon and the new Snake Charmer, each with their alignment; the counter stays on the Snake Charmer's row; Undo removes the rows", () => {
  show();
  const counter = () => screen.getByText(/^\d+ \/ \d+$/).textContent;
  const before = counter();
  tap("p1");
  // PO 2026-11-21: one row per player, the YOU ARE character token and the alignment token side by side.
  const newDemon = screen.getByRole("group", { name: "Wake Player 0" });
  const newCharmer = screen.getByRole("group", { name: "Wake Player 1" });
  expect(within(newDemon).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Wake Player 0: You Are", "Wake Player 0: You Are Evil"]);
  expect(within(newCharmer).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual(["Wake Player 1: You Are", "Wake Player 1: You Are Good"]);
  // Each token opens the existing player-safe reveal, unchanged.
  fireEvent.click(within(newDemon).getByRole("button", { name: "Wake Player 0: You Are" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "You Are", roleId: game().players.p0!.actualRole });
  fireEvent.click(within(newDemon).getByRole("button", { name: "Wake Player 0: You Are Evil" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "text", title: "You Are Evil" });
  expect(counter()).toBe(before);
  act(() => { store.getState().undo(); });
  expect(screen.queryByRole("button", { name: /^Wake Player 0: You Are/ })).toBeNull();
});
