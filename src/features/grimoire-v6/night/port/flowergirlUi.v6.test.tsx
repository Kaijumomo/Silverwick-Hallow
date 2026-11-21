// SV-5d -- the Flowergirl's step on the existing Night card: the Town Crier's card (YES / NO read from the Day's votes, Next records
// it), the one Storyteller question when a voter may have been a Demon, the impaired choice, Undo and the derived tokens left untouched.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { impair, patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import type { VotingRound } from "@/stores/votingTypes";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const ref = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, playerId: id, participantId: g.players[id]!.participantId!, nameAtTime: g.players[id]!.name });
const round = (g: StorytellerLobbyRecord, nominator: string, nominee: string, voters: string[]): VotingRound => {
  const at = g.seatOrder.indexOf(nominee);
  const order = [...g.seatOrder.slice(at + 1), ...g.seatOrder.slice(0, at + 1)].map((id) => ref(g, id));
  return { id: `r-${nominator}-${nominee}`, mode: "nomination", nominator: ref(g, nominator), nominee: ref(g, nominee), order,
    responses: order.map((voter) => ({ voter, choice: voters.includes(voter.playerId) ? "yes" as const : "no" as const, weight: voters.includes(voter.playerId) ? 1 : 0,
      spentGhostVote: false, refundSafe: false, lifeSafe: true })),
    threshold: 20, status: "acknowledged", result: "belowThreshold", tally: voters.length, virginPending: false, contextStamp: "", executionEventIds: [] };
};
/** Night 3, after Day 2's votes. */
function open(g: StorytellerLobbyRecord, votes: [string, string, string[]][]) {
  const voting = { day: 2, revision: 1, coverage: "known" as const, rounds: votes.map(([from, to, voters]) => round(g, from, to, voters)), activeRoundId: null, block: null, modifiers: [] };
  store.setState({ game: { ...g, voting }, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
beforeEach(() => { vi.useFakeTimers(); useSessionRuntime.setState({ backend: null }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

// p0 flowergirl, p1 fanggu (the Demon), p2 witch, p3 sage, p4 mutant, p5 clockmaker, p6 recluse
const ROLES = ["flowergirl", "fanggu", "witch", "sage", "mutant", "clockmaker", "recluse"];

it("wakes every night but the first", () => {
  const rows = (day: number) => deriveNightWork(proofGame(ROLES, "night", day), { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS }).steps
    .filter((step) => step.kind === "player" && step.playerId === "p0");
  expect(rows(1)).toHaveLength(0);
  expect(rows(2)).toHaveLength(1);
});

it("the Demon voted: shows YES, records it only on Next, and Undo takes it back", () => {
  open(proofGame(ROLES, "night", 3), [["p3", "p4", ["p2"]], ["p5", "p3", ["p1", "p5"]]]);
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("YES");
  expect(game().informationDeliveries).toHaveLength(0);
  next();
  expect(game().informationDeliveries.at(-1)).toMatchObject({ informationActionId: "flowergirl-other-night", values: [{ requirementId: "demonVoted", value: true }] });
  expect(store.getState().undoStack).toHaveLength(1);
  // The DEMON VOTED token is read from the votes, so recording the answer writes no reminder.
  expect(game().players.p0!.reminders).toHaveLength(0);
  store.getState().undo();
  expect(game().informationDeliveries).toHaveLength(0);
});

it("nobody but non-Demons voted: NO", () => {
  open(proofGame(ROLES, "night", 3), [["p3", "p4", ["p2", "p3", "p5"]]]);
  expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("NO");
});

it("a Recluse voted: one Yes / No question to the Storyteller, which is the answer", () => {
  open(proofGame(ROLES, "night", 3), [["p3", "p4", ["p6"]]]);
  expect(screen.queryByRole("status", { name: "Information to communicate" })).toBeNull();
  expect(screen.getByText("Did a Demon vote today?")).toBeInTheDocument();
  expect(screen.getByText(/Player 6 voted and may register as a Demon\./)).toBeInTheDocument();
  // The generic YES / NO row is not shown beside the question.
  expect(screen.queryByRole("button", { name: "YES" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ requirementId: "demonVoted", value: false }] });
  expect(screen.getByRole("status", { name: "Information to communicate" })).toHaveTextContent("NO");
  expect(screen.queryByText("Did a Demon vote today?")).toBeNull();
});

it("a poisoned Flowergirl: the Storyteller picks YES or NO", () => {
  open(impair(proofGame(ROLES, "night", 3), "p0"), [["p5", "p3", ["p1"]]]);
  fireEvent.click(screen.getByRole("button", { name: "NO" }));
  expect(game().informationDeliveries.at(-1)).toMatchObject({ values: [{ requirementId: "demonVoted", value: false }] });
});

it("a dead Flowergirl does not wake", () => {
  const g = patchPlayer(proofGame(ROLES, "night", 3), "p0", { alive: false });
  const rows = deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS }).steps
    .filter((step) => step.kind === "player" && step.playerId === "p0");
  expect(rows).toHaveLength(0);
});
