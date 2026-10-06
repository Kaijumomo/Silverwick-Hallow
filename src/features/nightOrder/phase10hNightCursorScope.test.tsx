// PR-10H-003 (Sol R3): the Night cursor is GAME-SCOPED UI state. Night step
// keys repeat across games (the Night 1 "minionInfo" / "demonInfo" global steps
// exist in every standard game), so a cursor left by Game A must never select
// a matching row in Game B. The cursor is cleared at the store's new-game /
// end-game lifecycle boundary -- never persisted, never game state -- while
// same-game hide/show/remount and Privacy Mode keep it.
//
// Both games are driven through the real store commands (newGame -> seat ->
// deal -> reveal -> beginNightOne), and the real NightOrderPanel.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NightOrderPanel } from "./NightOrderPanel";
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
const MINION_INFO = "Minions — learn each other & the Demon";
const DEMON_INFO = "Demon — learns Minions & Bluffs";

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
function Night() {
  const current = store((s) => s.game);
  return current?.phase === "night" ? <NightOrderPanel game={current} script={setupScript} onClose={() => {}} /> : null;
}
const currentCard = () => document.querySelector<HTMLElement>('.step-card[aria-current="step"]');
const makeCurrent = (label: string) => fireEvent.click(screen.getByRole("button", { name: `Make ${label} the current step` }));
const GAME_A = ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"];
const GAME_B = ["Hana", "Ivan", "Jade", "Kurt", "Lena", "Milo", "Nora"];

/** Game A, Night 1, with the cursor moved to the reusable later global step. */
function gameAOnDemonInfo() {
  playToNightOne(GAME_A);
  const view = render(<Night />);
  expect(currentCard()).toHaveTextContent(MINION_INFO); // the first unresolved step
  makeCurrent(DEMON_INFO);
  expect(currentCard()).toHaveTextContent(DEMON_INFO);
  expect(shell().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
  return view;
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

  it.each(BOUNDARIES)("$name: Game B starts at its own first unresolved step; the cursor then reflects only Game B", ({ leave }) => {
    const view = gameAOnDemonInfo();
    act(() => { leave(); });
    view.unmount();
    playToNightOne(GAME_B);
    // The boundary cleared the game-scoped cursor before Game B's Night began.
    expect(shell().nightCursor).toBeNull();
    render(<Night />);
    // Game B has the SAME reusable step key, yet starts at its first step.
    expect(screen.getByRole("button", { name: `Make ${DEMON_INFO} the current step` })).toBeInTheDocument();
    expect(currentCard()).toHaveTextContent(MINION_INFO);
    expect(currentCard()).not.toHaveTextContent(DEMON_INFO);
    expect(document.querySelectorAll('.step-card[aria-current="step"]')).toHaveLength(1);
    // From here on the cursor reflects Game B's interaction only.
    makeCurrent(DEMON_INFO);
    expect(shell().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
    expect(currentCard()).toHaveTextContent(DEMON_INFO);
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
  it("hide/show (unmount/remount) within the same game keeps the current Night step", () => {
    const view = gameAOnDemonInfo();
    view.unmount();
    expect(shell().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
    render(<Night />);
    expect(currentCard()).toHaveTextContent(DEMON_INFO);
  });

  it("ordinary same-game mutations keep the current Night step", () => {
    gameAOnDemonInfo();
    act(() => { state().setNotes(game().seatOrder[2]!, "watch this one"); });
    expect(shell().nightCursor).toEqual({ day: 1, stepKey: "demonInfo" });
    expect(currentCard()).toHaveTextContent(DEMON_INFO);
  });

  it("Privacy Mode on then off: the dashboard is withdrawn, then returns on the same step (behavior unchanged)", () => {
    gameAOnDemonInfo();
    act(() => { usePrivacyStore.setState({ enabled: true }); });
    expect(currentCard()).toBeNull();
    expect(screen.getByText("Privacy Mode On")).toBeInTheDocument();
    expect(shell().litActor).toBeNull();
    act(() => { usePrivacyStore.setState({ enabled: false }); });
    expect(currentCard()).toHaveTextContent(DEMON_INFO);
  });
});
