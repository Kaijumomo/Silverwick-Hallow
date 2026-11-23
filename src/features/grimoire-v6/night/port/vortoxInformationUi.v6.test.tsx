// SV-5i -- the Vortox's false answers on the existing Night card: one note line in the note style, the opposite Yes / No shown at once,
// the number choices without the true one, the Completed pill, Undo and Privacy Mode.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
/** PO 2026-11-22: the Vortox pill beside the name, in the Drunk / Poisoned pill style. */
const vortoxPill = () => screen.queryByText(/· false info/);
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const noVotes = (g: StorytellerLobbyRecord): StorytellerLobbyRecord => ({ ...g, voting: { day: g.day - 1, revision: 1, coverage: "known", rounds: [], activeRoundId: null, block: null, modifiers: [] } });
beforeEach(() => { vi.useFakeTimers(); useSessionRuntime.setState({ backend: null }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("Town Crier: nobody nominated, so the card shows YES with the Vortox pill (no orange line); Next records it and Undo takes it back", () => {
  open(noVotes(proofGame(["towncrier", "vortox", "witch", "chef", "sage", "mutant"], "night", 2)));
  expect(vortoxPill()).toHaveTextContent(/^Vortox ?· false info$/);
  expect(screen.queryByText(/A Vortox is in play/)).toBeNull();
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("YES");
  next();
  expect(game().informationDeliveries.at(-1)).toMatchObject({ informationActionId: "towncrier-other-night", values: [{ value: true }] });
  store.getState().undo();
  expect(game().informationDeliveries).toHaveLength(0);
});

it("Oracle: one dead evil player, so the card offers every number but 1", () => {
  open(patchPlayer(patchPlayer(proofGame(["oracle", "vortox", "witch", "chef", "sage", "mutant"], "night", 3), "p2", { alive: false }), "p3", { alive: false }));
  expect(vortoxPill()).toBeInTheDocument();
  const choices = screen.getByRole("group", { name: "Information to communicate" });
  expect([...choices.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["0", "2"]);
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ requirementId: "deadEvil", value: 2 }] });
  expect(screen.getByText("Completed")).toBeInTheDocument();
  // Like the Drunk pill, it stays after Completed: it explains why the recorded answer is false.
  expect(vortoxPill()).toBeInTheDocument();
});

it("a drunk or poisoned Town Crier under a Vortox: only the Vortox pill (PO 2026-11-22), never \"any info\"", () => {
  for (const type of ["drunk", "poisoned"]) {
    const g = noVotes(proofGame(["towncrier", "vortox", "witch", "chef", "sage", "mutant"], "night", 2));
    const { unmount } = open(patchPlayer(g, "p0", { effects: [{ id: `fx-${type}`, type, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as never] }));
    expect(vortoxPill()).toHaveTextContent(/^Vortox ?· false info$/);
    expect(screen.queryByText(/· any info/)).toBeNull();
    expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("YES");
    unmount();
  }
});

it("no pill and the true answer once the Vortox is dead, drunk or poisoned; a drunk Town Crier then shows its own pill", () => {
  open(patchPlayer(noVotes(proofGame(["towncrier", "vortox", "witch", "chef", "sage", "mutant"], "night", 2)), "p1", { alive: false }));
  expect(vortoxPill()).toBeNull();
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("NO");
  cleanup();
  const poisonedVortox = noVotes(proofGame(["towncrier", "vortox", "witch", "chef", "sage", "mutant"], "night", 2));
  open(patchPlayer(poisonedVortox, "p1", { effects: [{ id: "fx-v", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as never] }));
  expect(vortoxPill()).toBeNull();
  cleanup();
  const both = noVotes(proofGame(["towncrier", "vortox", "witch", "chef", "sage", "mutant"], "night", 2));
  open(patchPlayer(patchPlayer(both, "p1", { alive: false }), "p0", { effects: [{ id: "fx-d", type: "drunk", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as never] }));
  expect(vortoxPill()).toBeNull();
  expect(screen.getByText(/· any info/)).toHaveTextContent(/^Drunk ?· any info$/);
});

it("Privacy Mode hides the pill and the answer", () => {
  open(noVotes(proofGame(["towncrier", "vortox", "witch", "chef", "sage", "mutant"], "night", 2)));
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(vortoxPill()).toBeNull();
  expect(screen.queryByLabelText("Information to communicate")).toBeNull();
});
