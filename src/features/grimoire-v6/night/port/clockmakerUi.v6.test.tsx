// SV-5a -- the Clockmaker's first-night step on the existing Night card: the Chef's card (the number, Next records it), the
// Spy/Recluse question offering only the possible numbers, the impaired choice, the Completed pill, Undo and Privacy Mode.
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
import { impair, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
beforeEach(() => { vi.useFakeTimers(); useSessionRuntime.setState({ backend: null }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shows the counted number, records it only on Next, and Undo takes it back", () => {
  // Demon p1, Poisoner p4: 3 steps either way round the six seats.
  open(proofGame(["clockmaker", "imp", "chef", "monk", "poisoner", "empath"], "night", 1));
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("3");
  expect(game().informationDeliveries).toHaveLength(0);
  next();
  expect(game().informationDeliveries).toHaveLength(1);
  expect(game().informationDeliveries.at(-1)).toMatchObject({ informationActionId: "clockmaker-first-night", values: [{ requirementId: "steps", value: 3 }] });
  expect(store.getState().undoStack).toHaveLength(1);
  store.getState().undo();
  expect(game().informationDeliveries).toHaveLength(0);
});

it("a Spy beside another Minion: the card offers only the numbers the registrations allow", () => {
  open(proofGame(["clockmaker", "imp", "spy", "chef", "witch", "monk", "empath", "saint"], "night", 1));
  expect(screen.queryByRole("status")).toBeNull();
  const choices = screen.getByRole("group", { name: "Information to communicate" });
  expect([...choices.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["1", "3"]);
  expect(screen.getByText(/may register differently, so the Clockmaker could learn 1 or 3/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "3" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ requirementId: "steps", value: 3 }] });
  expect(screen.getByText("Completed")).toBeInTheDocument();
});

it("a poisoned Clockmaker: the Storyteller picks any number of steps this table can have", () => {
  open(impair(proofGame(["clockmaker", "imp", "chef", "monk", "poisoner", "empath"], "night", 1), "p0"));
  const choices = screen.getByRole("group", { name: "Information to communicate" });
  expect([...choices.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["1", "2", "3"]);
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ requirementId: "steps", value: 1 }] });
});

it("Privacy Mode hides the number", () => {
  open(proofGame(["clockmaker", "imp", "chef", "monk", "poisoner", "empath"], "night", 1));
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByLabelText("Information to communicate")).toBeNull();
});
