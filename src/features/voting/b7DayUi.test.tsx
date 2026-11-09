import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { proofGame, proofScript, impair } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { activeVotingRound } from "@/stores/voting";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { VotingCard, VotingDayControls, VotingProvider, useVotingInteraction } from "./VotingWorkspace";

const game = () => store.getState().game!;
function Table() { const ui = useVotingInteraction()!; return <><VotingDayControls />{["p0", "p1"].map(id => <button key={id} onClick={() => ui.tap(id)}>Seat {id}</button>)}<VotingCard inline /></>; }
const begin = () => { fireEvent.click(screen.getByRole("button", { name: "Nominate" })); fireEvent.click(screen.getByRole("button", { name: "Seat p1" })); fireEvent.click(screen.getByRole("button", { name: "Seat p0" })); fireEvent.click(screen.getByRole("button", { name: "Begin the vote" })); };
beforeEach(() => {
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null }); useTargetPicker.getState().cancel();
  store.setState({ game: proofGame(["virgin", "chef", "soldier", "poisoner", "imp"], "day", 1), lobby: null, terminalClose: null, undoStack: [], customScripts: { [proofScript.id]: proofScript } });
});
afterEach(() => { cleanup(); useTargetPicker.getState().cancel(); });

it("verified Virgin nomination asks only for death outcome and records no ordinary vote", () => {
  render(<StrictMode><VotingProvider><Table /></VotingProvider></StrictMode>); begin();
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(screen.getByText("Player 1 is executed. Did they die?")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue voting" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Executed · survived" }));
  expect(game().players.p1!.alive).toBe(true);
  expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
  expect(game().phase).toBe("night");
  expect(game().voting!.rounds[0]!.responses).toEqual([]);
});

it("impaired Virgin consumes immediately and continues to ordinary Yes/No controls", () => {
  store.setState({ game: impair(game(), "p0") });
  render(<VotingProvider><Table /></VotingProvider>); begin();
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(screen.queryByRole("button", { name: "Execute · died" })).toBeNull();
  expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
});

it("changed pending ability context conceals automatic death choices and cannot be re-acknowledged", () => {
  render(<VotingProvider><Table /></VotingProvider>); begin();
  act(() => store.setState({ game: impair(game(), "p0") }));
  expect(activeVotingRound(game())!.virginPending).toBe(true);
  expect(screen.queryByRole("button", { name: "Execute · died" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Use current table" })).toBeNull();
  expect(screen.getByText(/Use Undo to restore it/)).toBeTruthy();
});
