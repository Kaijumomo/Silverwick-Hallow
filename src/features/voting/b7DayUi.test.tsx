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

it("a verified Virgin nomination by a Townsfolk whose execution certainly kills records the execution with no question", () => {
  render(<StrictMode><VotingProvider><Table /></VotingProvider></StrictMode>); begin();
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(screen.queryByText("Player 1 is executed. Did they die?")).toBeNull();
  expect(screen.queryByRole("button", { name: "Execute · died" })).toBeNull();
  expect(game().players.p1!.alive).toBe(false);
  expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
  expect(game().voting!.rounds[0]).toMatchObject({ status: "outcome", result: "virgin", virginPending: false, responses: [] });
});

it("one Undo reverses an automatic Virgin execution: the nominator lives, the ability is unused, no round remains", () => {
  render(<StrictMode><VotingProvider><Table /></VotingProvider></StrictMode>); begin();
  expect(game().players.p1!.alive).toBe(false);
  act(() => store.getState().undo());
  expect(game().players.p1!.alive).toBe(true);
  expect(game().players.p0!.abilityUsed).toBe(false);
  expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(0);
  expect(game().voting?.rounds ?? []).toHaveLength(0);
});

it("a living Pacifist keeps the question: the Storyteller decides whether the executed nominator dies", () => {
  store.setState({ game: proofGame(["virgin", "chef", "soldier", "poisoner", "pacifist"], "day", 1) });
  render(<StrictMode><VotingProvider><Table /></VotingProvider></StrictMode>); begin();
  expect(screen.getByRole("button", { name: "Execute · died" })).toBeTruthy();
  expect(game().players.p1!.alive).toBe(true);
  expect(game().voting!.rounds[0]).toMatchObject({ status: "voting", virginPending: true });
});

it("a verified Virgin nomination still asks for the death outcome when the rules cannot say (a Fool nominator)", () => {
  store.setState({ game: proofGame(["virgin", "fool", "soldier", "poisoner", "imp"], "day", 1) });
  render(<StrictMode><VotingProvider><Table /></VotingProvider></StrictMode>); begin();
  expect(game().players.p0!.abilityUsed).toBe(true);
  expect(screen.getByText("Player 1 is executed. Did they die?")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Continue voting" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Executed · survived" }));
  expect(game().players.p1!.alive).toBe(true);
  expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
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
  store.setState({ game: proofGame(["virgin", "fool", "soldier", "poisoner", "imp"], "day", 1) });
  render(<VotingProvider><Table /></VotingProvider>); begin();
  act(() => store.setState({ game: impair(game(), "p0") }));
  expect(activeVotingRound(game())!.virginPending).toBe(true);
  expect(screen.queryByRole("button", { name: "Execute · died" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Use current table" })).toBeNull();
  expect(screen.getByText(/Use Undo to restore it/)).toBeTruthy();
});
