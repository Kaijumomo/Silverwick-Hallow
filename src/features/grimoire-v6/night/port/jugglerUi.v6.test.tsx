// SV-5f -- the Juggler's step on the existing Night card: the Oracle's card (the counted number, Next records it and clears the guesses),
// the impaired choice, the "not marked done" choice, the Vortox's false number, Undo and Privacy Mode.
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
import { withGuesses } from "@/test/jugglerFixtures";
import { JUGGLER_GUESS } from "@/abilities/characters/juggler";
import type { StorytellerLobbyRecord } from "@/stores/types";

// p0 juggler, p1 fanggu, p2 clockmaker, p3 cerenovus, p4 savant, p5 artist
const ROLES = ["juggler", "fanggu", "clockmaker", "cerenovus", "savant", "artist"];
const THREE = [{ who: "p2", role: "clockmaker", correct: true }, { who: "p1", role: "nodashii", correct: false }, { who: "p4", role: "savant", correct: true }];
const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, "juggler") });
  return render(<StrictMode><Guide /></StrictMode>);
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
const choices = () => [...screen.getByRole("group", { name: "Information to communicate" }).querySelectorAll("button")].map((button) => button.textContent);
const guesses = () => game().players.p0!.effects.filter((effect) => effect.type === JUGGLER_GUESS);
beforeEach(() => { vi.useFakeTimers(); useSessionRuntime.setState({ backend: null }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shows the count of correct guesses; Next records it and removes the guesses; one Undo restores both", () => {
  open(withGuesses(proofGame(ROLES, "night", 2), "p0", THREE));
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("2");
  expect(game().informationDeliveries).toHaveLength(0);
  next();
  expect(game().informationDeliveries.at(-1)).toMatchObject({ informationActionId: "juggler-other-night", values: [{ requirementId: "correct", value: 2 }] });
  expect(guesses()).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => { store.getState().undo(); });
  expect(game().informationDeliveries).toHaveLength(0);
  expect(guesses()).toHaveLength(3);
});

it("a poisoned Juggler: the Storyteller picks any number 0 to 5", () => {
  open(impair(withGuesses(proofGame(ROLES, "night", 2), "p0", THREE), "p0"));
  expect(choices()).toEqual(["0", "1", "2", "3", "4", "5"]);
  fireEvent.click(screen.getByRole("button", { name: "4" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ requirementId: "correct", value: 4 }] });
  expect(screen.getByText("Completed")).toBeInTheDocument();
});

it("guesses not marked done: the card says so and the Storyteller picks the number", () => {
  open(withGuesses(proofGame(ROLES, "night", 2), "p0", THREE, false));
  expect(screen.getByText("The guesses were not marked done on the Day card.")).toBeInTheDocument();
  expect(choices()).toEqual(["0", "1", "2", "3", "4", "5"]);
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ value: 1 }] });
});

it("a Vortox: the true count is not offered", () => {
  open(withGuesses(proofGame(["juggler", "vortox", "clockmaker", "cerenovus", "savant", "artist"], "night", 2), "p0", THREE));
  expect(choices()).toEqual(["0", "1", "3", "4", "5"]);
  fireEvent.click(screen.getByRole("button", { name: "5" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ value: 5 }] });
});

it("Privacy Mode hides the number", () => {
  open(withGuesses(proofGame(ROLES, "night", 2), "p0", THREE));
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByLabelText("Information to communicate")).toBeNull();
});
