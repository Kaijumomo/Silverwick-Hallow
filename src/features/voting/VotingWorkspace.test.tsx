import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/config/trial", () => ({ isTabletTrial: true, TABLET_TRIAL_OFFLINE_MESSAGE: "Local trial" }));
import { seedTabletTrial } from "@/trial/seed";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { activeVotingRound, currentVoter } from "@/stores/voting";
import { VotingCard, VotingDayControls, VotingProvider, useVotingInteraction } from "./VotingWorkspace";

const state = () => store.getState();
const game = () => state().game!;
const player = (name: string) => Object.values(game().players).find(p => p.name === name)!;
function TableControls() {
  const ui = useVotingInteraction()!;
  const current = store(s => s.game)!;
  return <><VotingDayControls /><button onClick={() => ui.show("finish")}>Review day</button>
    {current.seatOrder.map(id => <button key={id} aria-label={`Token ${current.players[id]!.name}`} onClick={() => ui.tap(id)}>{current.players[id]!.name}</button>)}<VotingCard inline /></>;
}
function openTable() { render(<VotingProvider><TableControls /></VotingProvider>); }
function begin() {
  fireEvent.click(screen.getByRole("button", { name: "Nominate" }));
  fireEvent.click(screen.getByRole("button", { name: "Token Bartholomew" }));
  fireEvent.click(screen.getByRole("button", { name: "Token Dmitri" }));
  fireEvent.click(screen.getByRole("button", { name: "Begin the vote" }));
}
function complete(choice: "Yes" | "No") {
  for (let count = 0; currentVoter(game()) && count < 20; count++) fireEvent.click(screen.getByRole("button", { name: choice }));
  expect(activeVotingRound(game())?.status).toBe("outcome");
}
beforeEach(() => {
  localStorage.clear();
  usePrivacyStore.getState().reset();
  store.setState({ game: null, lobby: null, sync: null, terminalClose: null, undoStack: [], customScripts: {} });
  seedTabletTrial(15);
});
afterEach(cleanup);

describe("voting card uses the authoritative participant-bound workflow", () => {
  it("retains vote-weight overrides during ordinary voting and completed-round correction", () => {
    openTable(); begin();
    const voter = currentVoter(game())!;
    fireEvent.click(screen.getByRole("button", { name: "Voting corrections and options" }));
    fireEvent.click(screen.getByRole("button", { name: `Record 3 votes from ${voter.nameAtTime}` }));
    expect(activeVotingRound(game())!.responses[0]).toMatchObject({ voter, choice: "yes", weight: 3 });
    complete("No");
    fireEvent.click(screen.getByRole("button", { name: "Correct votes" }));
    fireEvent.click(screen.getByText(/Bartholomew → Dmitri/));
    fireEvent.click(screen.getByText("Adjust"));
    fireEvent.click(screen.getByRole("button", { name: `Count ${voter.nameAtTime} as 2 votes` }));
    expect(game().voting!.rounds[0]!.responses[0]).toMatchObject({ voter, choice: "yes", weight: 2 });
    expect(game().voting!.rounds[0]!.tally).toBe(2);
  });

  it("hides exile weight overrides in both the active card and history while keeping Yes/No corrections", () => {
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Nominate" }));
    fireEvent.click(screen.getByRole("button", { name: "Token Bartholomew" }));
    fireEvent.click(screen.getByRole("button", { name: "Token Oluwaseun" }));
    fireEvent.click(screen.getByRole("button", { name: "Begin exile" }));
    expect(activeVotingRound(game())!.mode).toBe("exile");
    fireEvent.click(screen.getByRole("button", { name: "Voting corrections and options" }));
    expect(screen.queryByText("Count this Yes as")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Record .* votes from/, hidden: true })).toBeNull();
    complete("Yes");
    const round = activeVotingRound(game())!;
    expect(round.responses.every(response => response.weight === 1 && !response.spentGhostVote)).toBe(true);
    expect(player("Hana").ghostVote).toBe(true);
    expect(game().voting!.block).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Correct votes" }));
    fireEvent.click(screen.getByText(/Bartholomew → Oluwaseun/));
    expect(screen.queryByText("Adjust")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Count .* as .* votes/, hidden: true })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No from Hana" }));
    expect(game().voting!.rounds[0]!.tally).toBe(round.tally - 1);
    expect(game().voting!.rounds[0]!.responses.find(response => response.voter.nameAtTime === "Hana"))
      .toMatchObject({ choice: "no", weight: 0, spentGhostVote: false });
    expect(player("Hana").ghostVote).toBe(true);
    expect(game().voting!.block).toBeNull();
  });

  it("closes and resumes the exact voter; Privacy hides the card without discarding accepted votes", () => {
    openTable(); begin();
    fireEvent.click(screen.getByRole("button", { name: "Yes" }));
    const accepted = game(); const voter = currentVoter(accepted);
    fireEvent.click(screen.getByRole("button", { name: "End nominations" }));
    expect(screen.queryByRole("region", { name: "Nomination card" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume vote" }));
    expect(currentVoter(game())).toEqual(voter);
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("region", { name: "Nomination card" })).toBeNull();
    expect(game()).toBe(accepted);
    act(() => usePrivacyStore.getState().setEnabled(false));
    fireEvent.click(screen.getByRole("button", { name: "Resume vote" }));
    expect(currentVoter(game())).toEqual(voter);
    expect(screen.getByRole("button", { name: "Yes" })).toBeEnabled();
  });

  it("corrects a completed dead Yes, refunds that participant, and updates its tally and block", () => {
    openTable(); begin(); complete("Yes");
    const oldTally = activeVotingRound(game())!.tally;
    expect(player("Hana").ghostVote).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Voting corrections and options" }));
    fireEvent.click(screen.getByRole("button", { name: "Correct votes" }));
    fireEvent.click(screen.getByText(/Bartholomew → Dmitri/));
    fireEvent.click(screen.getByRole("button", { name: "No from Hana" }));
    expect(player("Hana").ghostVote).toBe(true);
    expect(game().voting!.rounds[0]!.tally).toBe(oldTally - 1);
    expect(game().voting!.block?.tally).toBe(oldTally - 1);
  });

  it("acknowledges a completed round and enters Night without reconstructing votes or adding an execution", () => {
    openTable(); begin(); complete("No");
    const responses = activeVotingRound(game())!.responses;
    fireEvent.click(screen.getByRole("button", { name: "Review day" }));
    fireEvent.click(screen.getByRole("button", { name: "No execution · Begin Night 3" }));
    expect(game()).toMatchObject({ phase: "night", day: 3 });
    expect(game().voting!.activeRoundId).toBeNull();
    const recorded = game().voting!.rounds[0]!.responses;
    const facts = (values: typeof responses) => values.map(({ voter, choice, weight, spentGhostVote }) => ({ voter, choice, weight, spentGhostVote }));
    expect(facts(recorded)).toEqual(facts(responses));
    // Night prunes old Life evidence; it must conservatively close old correction rights.
    expect(recorded.find(r => r.voter.nameAtTime === "Hana")?.lifeSafe).toBe(false);
    expect(recorded.find(r => r.voter.nameAtTime === "Ignatius")?.lifeSafe).toBe(false);
    expect(game().lifeEventWindow.events.some(e => e.kind === "execution")).toBe(false);
  });

  it("requires a new outcome choice after the selected seat is replaced", () => {
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Review day" }));
    fireEvent.click(screen.getByText("Execution outcome · No execution"));
    fireEvent.click(screen.getByRole("button", { name: "Dmitri" }));
    const old = player("Dmitri");
    act(() => { expect(state().unseatPlayer(old.id)).toBe(true); state().addPlayerToSeat("Replacement", old.id); });
    expect(player("Replacement").participantId).not.toBe(old.participantId);
    expect(screen.getByRole("alert")).toHaveTextContent("selected participant changed");
    expect(screen.queryByRole("button", { name: "Yes · died" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "No execution · Begin Night 3" }));
    expect(game().phase).toBe("day");
    expect(player("Replacement").alive).toBe(true);
    expect(game().lifeEventWindow.events.some(e => e.kind === "execution")).toBe(false);
  });

  it("records the explicit survived execution and immediately continues to Night", () => {
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Review day" }));
    fireEvent.click(screen.getByText("Execution outcome · No execution"));
    fireEvent.click(screen.getByRole("button", { name: "Dmitri" }));
    fireEvent.click(screen.getByRole("button", { name: "No · survived" }));
    expect(game()).toMatchObject({ phase: "night", day: 3 });
    expect(player("Dmitri").alive).toBe(true);
    const executions = game().lifeEventWindow.events.filter(e => e.kind === "execution");
    expect(executions).toHaveLength(1);
    expect(executions[0]).toMatchObject({ outcome: "survived", subject: { participantId: player("Dmitri").participantId } });
  });

  it("resolves the Virgin, consumes her ability, executes the nominator, and continues to Night", () => {
    openTable();
    fireEvent.click(screen.getByRole("button", { name: "Nominate" }));
    fireEvent.click(screen.getByRole("button", { name: "Token Bartholomew" }));
    fireEvent.click(screen.getByRole("button", { name: "Token Alice" }));
    fireEvent.click(screen.getByRole("button", { name: "Begin the vote" }));
    expect(player("Alice").abilityUsed).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Execute · died" }));
    expect(game()).toMatchObject({ phase: "night", day: 3 });
    expect(player("Bartholomew").alive).toBe(false);
    expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
    expect(game().voting!.activeRoundId).toBeNull();
  });

  it("keeps an accepted execution when Night fails and retries after its participant leaves without executing the replacement", () => {
    const advancePhase = state().advancePhase;
    const failThenContinue = vi.fn().mockReturnValueOnce({ ok: false, message: "Could not save Night. Try again." }).mockImplementation(advancePhase);
    store.setState({ advancePhase: failThenContinue });
    try {
      openTable();
      fireEvent.click(screen.getByRole("button", { name: "Review day" }));
      fireEvent.click(screen.getByText("Execution outcome · No execution"));
      fireEvent.click(screen.getByRole("button", { name: "Dmitri" }));
      fireEvent.click(screen.getByRole("button", { name: "No · survived" }));
      expect(game().phase).toBe("day");
      expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
      expect(screen.getByRole("alert")).toHaveTextContent("Could not save Night");
      const executed = player("Dmitri");
      act(() => { expect(state().unseatPlayer(executed.id)).toBe(true); state().addPlayerToSeat("Replacement", executed.id); });
      fireEvent.click(screen.getByRole("button", { name: "Begin Night 3" }));
      expect(game()).toMatchObject({ phase: "night", day: 3 });
      expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
      expect(game().lifeEventWindow.events.find(e => e.kind === "execution")?.subject.participantId).toBe(executed.participantId);
      expect(player("Replacement").alive).toBe(true);
      expect(failThenContinue).toHaveBeenCalledTimes(2);
    } finally { store.setState({ advancePhase }); }
  });
});
