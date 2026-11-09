import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AbilityWorkspace } from "./AbilityWorkspace";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { proofGame, proofScript } from "@/test/proofFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { FIXTURE_SEMANTICS, FIXTURE_SIMPLE_MARK } from "@/test/abilityFixtures";
import { choose } from "@/test/pickers";
import { useTargetPicker } from "./abilityUi";

beforeEach(() => {
  store.setState({ game: proofGame(["monk", "chef", "imp"]), lobby: null, terminalClose: null, undoStack: [], localSeq: 0,
    customScripts: { [proofScript.id]: proofScript } });
  usePrivacyStore.getState().reset(); useTargetPicker.getState().cancel();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("strict gameplay reports a refused browser save and a fresh explicit choice can retry once", () => {
  const game = store.getState().game!; const resolved = vi.fn();
  render(<AbilityWorkspace game={game} script={proofScript} registry={buildRegistry(proofScript)} semantics={FIXTURE_SEMANTICS}
    target={{ actorId: "p0", roleId: "monk", roleName: "Monk", invocationPath: "nightOrder" }}
    descriptor={FIXTURE_SIMPLE_MARK} manualReason="" strictGameplay onClose={() => {}} onResolved={resolved} />);
  const dialog = screen.getByRole("dialog", { name: "Monk" });
  expect(screen.queryByRole("button", { name: /Resolve|Confirm and record/ })).toBeNull();
  const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
  choose("the player to mark", "p1", dialog);
  expect(screen.getByRole("alert")).toHaveTextContent("could not save");
  expect(store.getState().game).toBe(game); expect(store.getState().undoStack).toEqual([]); expect(resolved).not.toHaveBeenCalled();
  // The refused choice must not silently retry on unrelated rendering.
  fireEvent.click(screen.getByRole("heading", { name: "Choose a player to mark" }));
  expect(resolved).not.toHaveBeenCalled(); write.mockRestore();
  choose("the player to mark", "p2", dialog);
  expect(store.getState().game!.players.p2!.effects).toHaveLength(1);
  expect(store.getState().game!.players.p1!.effects).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(1); expect(resolved).toHaveBeenCalledTimes(1);
});

it("an open strict action refuses a state change after capture and reports it without effects", () => {
  const game = store.getState().game!; const resolved = vi.fn();
  render(<AbilityWorkspace game={game} script={proofScript} registry={buildRegistry(proofScript)} semantics={FIXTURE_SEMANTICS}
    target={{ actorId: "p0", roleId: "monk", roleName: "Monk", invocationPath: "nightOrder" }}
    descriptor={FIXTURE_SIMPLE_MARK} manualReason="" strictGameplay onClose={() => {}} onResolved={resolved} />);
  store.getState().setNotes("p1", "A later decision"); const current = store.getState().game;
  choose("the player to mark", "p1", screen.getByRole("dialog", { name: "Monk" }));
  expect(screen.getByRole("alert")).toHaveTextContent("game changed");
  expect(store.getState().game).toBe(current); expect(resolved).not.toHaveBeenCalled();
  expect(store.getState().game!.players.p1!.effects).toEqual([]);
});
