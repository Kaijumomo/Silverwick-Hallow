import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { registerVotingAuthorityReader } from "@/firebase/votingAuthority";
import { useTargetPicker, pickSeatIfPicking } from "@/features/abilities/abilityUi";
import { bind, impair, proofGame, proofScript, reseat } from "@/test/proofFixtures";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { projectLobbyToPublic } from "@/stores/projections";
import { PlayerPopover } from "./PlayerPopover";
import { PlayersWorkspace } from "./PlayersWorkspace";

// Independently authored from the approved R1 protections, before checkpoint review.
beforeEach(() => {
  localStorage.clear();
  usePrivacyStore.getState().reset(); useShellStore.getState().reset();
  useTargetPicker.getState().cancel();
  useSessionRuntime.setState({ backend: null, status: "idle" });
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null,
    selectedPlayerId: null, customScripts: { [proofScript.id]: proofScript, [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); registerVotingAuthorityReader(() => null); });
function Popover() {
  const player = store(s => s.game!.players.p0!);
  return <PlayerPopover player={player} onChangeCharacter={() => {}} onSwapSeats={() => {}} onMore={() => {}} onClose={() => {}} />;
}

it("independent: Recluse shot offers both explicit outcomes and Cancel preserves the unspent ability", () => {
  const g = proofGame(["slayer", "recluse", "imp", "chef", "monk"], "day");
  store.setState({ game: g }); render(<Popover />);
  fireEvent.click(screen.getByRole("button", { name: "Use Slayer ability" }));
  act(() => { pickSeatIfPicking(g, "p1"); });
  expect(store.getState().game).toBe(g); expect(store.getState().undoStack).toEqual([]);
  expect(useTargetPicker.getState().active).toBeNull();
  const dialog = screen.getByRole("region", { name: "Resolve Slayer shot" });
  expect(within(dialog).getByRole("button", { name: "No death — does not register as Demon" })).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "Registers as Demon — resolve death" })).toBeVisible();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel shot" }));
  expect(screen.queryByRole("region", { name: "Resolve Slayer shot" })).toBeNull();
  expect(store.getState().game).toBe(g); expect(store.getState().undoStack).toEqual([]);
  expect(store.getState().game!.players.p0!.abilityUsed).toBe(false);
  expect(store.getState().game!.players.p1!.alive).toBe(true);
  expect(screen.getByRole("button", { name: "Use Slayer ability" })).toBeVisible();
});

it("independent R1: held Slayer callback cannot hit a replacement participant", () => {
  const g = proofGame(["slayer", "imp", "chef", "monk", "soldier"], "day");
  store.setState({ game: g }); render(<Popover />);
  fireEvent.click(screen.getByRole("button", { name: "Use Slayer ability" }));
  const held = useTargetPicker.getState().active!;
  const replaced = reseat(g, "p1");
  act(() => store.setState({ game: replaced }));
  act(() => held.onPick(bind(g, "p1")));
  expect(store.getState().game).toBe(replaced); expect(store.getState().undoStack).toEqual([]);
  expect(useTargetPicker.getState().active).toBeNull();
});

it.each(["dead", "spent"])("independent R1: %s Slayer has no ordinary ability action", condition => {
  const g = proofGame(["slayer", "imp", "chef", "monk", "soldier"], "day");
  if (condition === "dead") g.players.p0!.alive = false;
  else g.players.p0!.abilityUsed = true;
  store.setState({ game: g }); render(<Popover />);
  expect(screen.queryByRole("button", { name: "Use Slayer ability" })).toBeNull();
  expect(store.getState().game).toBe(g);
});

it("independent R1: poisoned Slayer spends one shot without death and Undo restores it", () => {
  const g = impair(proofGame(["slayer", "imp", "chef", "monk", "soldier"], "day"), "p0");
  store.setState({ game: g }); render(<Popover />);
  fireEvent.click(screen.getByRole("button", { name: "Use Slayer ability" }));
  act(() => { pickSeatIfPicking(g, "p1"); });
  expect(store.getState().game!.players.p0!.abilityUsed).toBe(true);
  expect(store.getState().game!.players.p1!.alive).toBe(true);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => store.getState().undo());
  expect(store.getState().game).toEqual(g);
});

it("independent R1: Drunk shown identity survives reload privately and is undoable without changing composition", async () => {
  const g = setupGame(["drunk", "chef", "empath", "monk", "soldier", "saint", "poisoner", "imp"],
    { setupRolesDealt: true, setupRolesRevealed: false });
  store.setState({ game: g, selectedPlayerId: "p0" });
  const view = render(<PlayersWorkspace enabled roles={setupScript.characters} advancedPlayerId={null} onMore={() => {}}>Board</PlayersWorkspace>);
  fireEvent.click(screen.getByRole("button", { name: "Choose shown character" }));
  const chooser = screen.getByRole("dialog", { name: "Choose shown character" });
  for (const name of ["Chef", "Empath", "Saint", "Imp"]) expect(within(chooser).queryByRole("button", { name })).toBeNull();
  fireEvent.click(within(chooser).getByRole("button", { name: "Librarian" }));
  const after = store.getState().game!;
  expect(after.players.p0).toMatchObject({ actualRole: "drunk", shownRole: "librarian", participantId: g.players.p0!.participantId });
  expect(after.players.p0!.actualAlignment).toBe(g.players.p0!.actualAlignment);
  expect(Object.values(after.players).map(p => p.actualRole)).toEqual(Object.values(g.players).map(p => p.actualRole));
  expect(JSON.stringify(projectLobbyToPublic(after, {}))).not.toMatch(/drunk|librarian|actualRole|shownRole/);
  const persisted = localStorage.getItem("new-blood-st")!;
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByRole("dialog")).toBeNull();
  view.unmount();
  await act(async () => { localStorage.setItem("new-blood-st", persisted); await store.persist.rehydrate(); });
  expect(store.getState().game).toEqual(after);
  act(() => store.getState().undo());
  expect(store.getState().game!.players.p0!.shownRole).toBe(g.players.p0!.shownRole);
  expect(store.getState().game!.players.p0!.actualRole).toBe("drunk");
});

it("independent R1: Drunk chooser refuses a changed writer without a game-object change", () => {
  const g = setupGame(["drunk", "chef", "empath", "monk", "soldier", "saint", "poisoner", "imp"],
    { code: "TEST2345", storytellerUid: "host", setupRolesDealt: true, setupRolesRevealed: false });
  let writer = "writer-one";
  registerVotingAuthorityReader(() => writer);
  store.setState({ game: g, selectedPlayerId: "p0", lobby: { code: g.code, uid: "host", sessionId: "session", status: "live" } });
  render(<PlayersWorkspace enabled roles={setupScript.characters} advancedPlayerId={null} onMore={() => {}}>Board</PlayersWorkspace>);
  fireEvent.click(screen.getByRole("button", { name: "Choose shown character" }));
  writer = "writer-two";
  fireEvent.click(within(screen.getByRole("dialog", { name: "Choose shown character" })).getByRole("button", { name: "Librarian" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Setup changed");
  expect(store.getState().game).toBe(g); expect(store.getState().undoStack).toEqual([]);
});
