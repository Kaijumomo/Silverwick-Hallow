// PR-10H-003 (Sol R3): the Night cursor is GAME-SCOPED UI state. Night step
// keys repeat across games (the Night 1 "minionInfo" / "demonInfo" global steps
// exist in every standard game), so a cursor left by Game A must never select
// a matching row in Game B. The cursor is cleared at the store's new-game /
// end-game lifecycle boundary -- never persisted, never game state -- while
// same-game hide/show/remount and Privacy Mode keep it.
//
// Both games are driven through the real store commands (newGame -> seat ->
// deal -> reveal -> beginNightOne). Package 4: the cursor assertions are made on the
// shell store directly; the legacy NightOrderPanel that used to display it is retired.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";

const state = () => store.getState();
const game = () => state().game!;
const shell = () => useShellStore.getState();

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  localStorage.clear();
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.setState({ active: null, refused: null });
  shell().reset();
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, terminalClose: null,
    customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** A new game, played through the real Setup commands to Night 1. */
function playToNightOne(names: string[]) {
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  names.forEach((name) => state().addPlayerToSeat(name));
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(game().players[id]!.actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  expect([game().phase, game().day]).toEqual(["night", 1]);
}
const GAME_A = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"];
const GAME_B = ["Hana", "Ivan", "Jade", "Kurt", "Lena", "Milo", "Nora"];

/** Game A, Night 1, with the cursor moved to the reusable later global step. */
function gameAOnDemonInfo() {
  playToNightOne(GAME_A);
  act(() => { shell().setNightCursor({ day: 1, stepKey: "demonInfo" }); });
  expect(shell().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
}

describe("PR-10H-003: a previous game's Night cursor never selects a step in a new game", () => {
  const BOUNDARIES: { name: string; leave: () => void }[] = [
    { name: "New Game replaces Game A", leave: () => {} },
    { name: "End Game (discard), then New Game", leave: () => state().endGame() },
    { name: "a declared result ends Game A, then New Game", leave: () => {
      expect(state().beginTerminalClose({ kind: "declare", winner: "good" })).toBe(true);
      expect(state().finishGame({ kind: "declare", winner: "good" }).ok).toBe(true);
    } },
  ];

  it.each(BOUNDARIES)("$name: Game B starts with no cursor; it then reflects only Game B", ({ leave }) => {
    gameAOnDemonInfo();
    act(() => { leave(); });
    playToNightOne(GAME_B);
    // The boundary cleared the game-scoped cursor before Game B's Night began.
    expect(shell().nightCursor).toBeNull();
    act(() => { shell().setNightCursor({ day: 1, stepKey: "demonInfo" }); });
    expect(shell().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
  });

  it("the boundary clears the cursor and its action context, but keeps the Storyteller's view preferences", () => {
    playToNightOne(GAME_A);
    const p0 = game().players[game().seatOrder[0]!]!;
    useShellStore.setState({ nightCursor: { day: 1, stepKey: "demonInfo" }, litActor: { playerId: p0.id, participantId: p0.participantId!, stepKey: "demonInfo" },
      actionOpen: true, lens: "roster", dockTab: "seat", inspectorDetent: "expanded" });
    state().newGame(setupScript.id, { plannedPlayerCount: 7 });
    expect(shell()).toMatchObject({ nightCursor: null, litActor: null, actionOpen: false, lens: "roster", dockTab: "seat", inspectorDetent: "expanded" });
    useShellStore.setState({ nightCursor: { day: 1, stepKey: "demonInfo" }, actionOpen: true, lens: "labels" });
    state().endGame();
    expect(shell()).toMatchObject({ nightCursor: null, litActor: null, actionOpen: false, lens: "labels", dockTab: "seat", inspectorDetent: "expanded" });
  });

  it("the cursor stays UI-only: it never enters the game record, Undo or the persisted store", () => {
    gameAOnDemonInfo();
    expect(JSON.stringify(game())).not.toContain("nightCursor");
    expect(JSON.stringify(state().undoStack)).not.toContain("nightCursor");
    expect(localStorage.getItem("new-blood-st") ?? "").not.toContain("nightCursor");
  });
});

describe("PR-10H-003: same-game continuity is unchanged", () => {
  it("ordinary same-game mutations keep the current Night step", () => {
    gameAOnDemonInfo();
    act(() => { state().setNotes(game().seatOrder[2]!, "watch this one"); });
    expect(shell().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
  });

  it("Privacy Mode on then off keeps the cursor", () => {
    gameAOnDemonInfo();
    act(() => { usePrivacyStore.setState({ enabled: true }); });
    expect(shell().litActor).toBeNull();
    act(() => { usePrivacyStore.setState({ enabled: false }); });
    expect(shell().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
  });
});
