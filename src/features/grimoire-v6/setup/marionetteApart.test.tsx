// WP-8 (F-08): the Prepare the Town card says so when the Marionette is not seated next to the Demon.
import { afterEach, beforeEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { useShellStore } from "@/stores/shellStore";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { captureCharacterActionContext } from "@/stores/storytellerStore";
import { setupGame, setupScript } from "@/test/setupFixtures";

const ROLES = ["marionette", "chef", "imp", "empath", "washerwoman", "monk", "saint"];
function load(roles: string[]) {
  const g = setupGame(roles, { phase: "setup", day: 0, setupRolesDealt: true, setupRolesRevealed: false });
  g.players.p0!.shownRole = "chef"; g.players.p0!.shownAlignment = "good";
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, tokenPositions: {}, seatSwapUndo: [], customScripts: { [setupScript.id]: setupScript } });
}
beforeEach(() => { useShellStore.getState().reset(); useV6Ui.getState().reset(); });
afterEach(() => cleanup());

it("blocks the reveal when the Marionette is apart from the Demon, and not when they are neighbours; it never moves a role", () => {
  load(ROLES);
  useV6Ui.getState().set({ panel: "players" });
  const before = store.getState().game!;
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
  expect(screen.getByText(/Marionette must sit next to the Demon/)).toBeInTheDocument();
  expect(store.getState().game).toBe(before);
  const refused = store.getState().revealRoles(captureCharacterActionContext());
  expect(refused).toMatchObject({ ok: false, message: expect.stringContaining("Marionette must sit next to the Demon") });
  expect(store.getState().game).toBe(before);
  act(() => { load(["marionette", "imp", "chef", "empath", "washerwoman", "monk", "saint"]); });
  expect(screen.queryByText(/Marionette must sit next to the Demon/)).toBeNull();
});
