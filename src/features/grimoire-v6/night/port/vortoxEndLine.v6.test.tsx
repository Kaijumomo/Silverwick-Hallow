// SV-5l -- the Vortox's no-execution ending on the existing End control: the "!" line and the End dialog's "Possible game end" box,
// shown through the Night after a Day with no execution, hidden in Privacy Mode. Only the Storyteller's choice there ends the game.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../../GrimoireV6Screen";
import { useV6Ui } from "../../v6Store";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const LINE = "No one was executed today and the Vortox is alive. Evil wins. Check before ending the game";
const game = () => store.getState().game!;
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
}
const toNight = () => act(() => { expect(store.getState().advancePhase()).toMatchObject({ ok: true }); });

beforeEach(() => {
  vi.useFakeTimers();
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useV6Ui.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("no execution today: that Night the End control carries the line, the dialog's box repeats it, and nothing ends by itself", () => {
  open(proofGame(["vortox", "chef", "empath", "oracle", "saint", "mutant"], "day", 2));
  expect(screen.queryByTitle(/No one was executed/)).toBeNull();
  toNight();
  expect(game()).toMatchObject({ phase: "night", day: 3 });
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(game().phase).toBe("night");
  fireEvent.click(screen.getByTitle(`End game · ${LINE}`));
  expect(screen.getByRole("note", { name: "Possible game end" })).toHaveTextContent(`Possible game end${LINE}.`);
  expect(game().phase).toBe("night");
  expect(game().result).toBeUndefined();
});

it("an execution today: no line", () => {
  open(proofGame(["vortox", "chef", "empath", "oracle", "saint", "mutant"], "day", 2));
  act(() => { expect(store.getState().recordExecution("p1", "survived")).toMatchObject({ ok: true }); });
  toNight();
  expect(screen.queryByTitle(/No one was executed/)).toBeNull();
  fireEvent.click(screen.getByTitle(/^End game/));
  expect(screen.getByRole("dialog", { name: "End game" })).not.toHaveTextContent(/Vortox/);
});

it("Privacy Mode hides the line; Undo of the advance takes it away", () => {
  open(proofGame(["vortox", "chef", "empath", "oracle", "saint", "mutant"], "day", 2));
  toNight();
  expect(screen.getByTitle(`End game · ${LINE}`)).toBeInTheDocument();
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(screen.queryByTitle(/No one was executed/)).toBeNull();
  act(() => { usePrivacyStore.setState({ enabled: false }); });
  act(() => { store.getState().undo(); });
  expect(game().phase).toBe("day");
  expect(screen.queryByTitle(/No one was executed/)).toBeNull();
});
