import { beforeEach, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { bind, openInStore, proofGame } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { LifeControls } from "./LifeControls";
import { VotingCard, VotingProvider, useVotingInteraction } from "@/features/voting/VotingWorkspace";

beforeEach(() => { usePrivacyStore.getState().reset(); store.setState({ terminalClose: null }); });
it("a normal recorded Imp death resolves Scarlet Woman through existing Life controls", () => {
  const game = proofGame(["imp", "scarletwoman", "chef", "slayer", "soldier"], "day", 2);
  openInStore(game); render(<LifeControls player={game.players.p0!} />);
  fireEvent.click(screen.getByRole("button", { name: "Record death" }));
  expect(store.getState().game!.players.p1!.actualRole).toBe("imp");
  expect(store.getState().undoStack).toHaveLength(1);
});
it("an exceptional recorded outcome displays the manual consequence notice without extra controls", () => {
  const game = proofGame(["imp", "scarletwoman", "scarletwoman", "slayer", "soldier"], "day", 2);
  openInStore(game); render(<LifeControls player={game.players.p0!} />);
  fireEvent.click(screen.getByRole("button", { name: "Record death" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Outcome recorded. Resolve any character consequences using the official instructions and existing game controls.");
  expect(store.getState().game!.players.p1!.actualRole).toBe("scarletwoman");
  expect(store.getState().game!.players.p2!.actualRole).toBe("scarletwoman");
  expect(screen.queryByRole("button", { name: /succession|manual|automated/i })).toBeNull();
});

function RecordedExecution() {
  const ui = useVotingInteraction()!;
  return <><button onClick={() => { ui.show("finish"); ui.run({ kind: "execution", target: bind(store.getState().game!, "p0"), outcome: "died" }, undefined, true); }}>Confirm execution</button><VotingCard inline /></>;
}
it("Voting keeps an exceptional execution notice visible before advancing to Night", () => {
  openInStore(proofGame(["imp", "scarletwoman", "scarletwoman", "slayer", "soldier"], "day", 2));
  render(<VotingProvider><RecordedExecution /></VotingProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Confirm execution" }));
  expect(store.getState().game!.phase).toBe("day");
  expect(store.getState().game!.players.p0!.alive).toBe(false);
  expect(screen.getByText(/Outcome recorded\. Resolve any character consequences/)).toBeVisible();
});
