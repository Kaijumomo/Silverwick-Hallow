import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { GrimoireCircle } from "./GrimoireCircle";
import { PlayersWorkspace } from "@/features/players/PlayersWorkspace";
import { VotingProvider, useVotingInteraction } from "@/features/voting/VotingWorkspace";

const state = () => store.getState();
let size = { width: 1000, height: 700 };
let resizeBoard: () => void;
const token = () => document.querySelector<HTMLElement>('[data-player-id="p0"]')!;
const canvas = () => document.querySelector<HTMLElement>(".grimoire")!;
const geometry = () => ({ left: token().style.left, top: token().style.top });
const board = () => render(<PlayersWorkspace enabled roles={setupScript.characters} onMore={vi.fn()} advancedPlayerId={null}><GrimoireCircle /></PlayersWorkspace>);

class TestPointerEvent extends MouseEvent {
  pointerId: number; pointerType: string; isPrimary: boolean;
  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options); this.pointerId = options.pointerId ?? 1;
    this.pointerType = options.pointerType ?? "mouse"; this.isPrimary = options.isPrimary ?? true;
  }
}
const point = (clientX: number, clientY: number, pointerType = "mouse") => ({ clientX, clientY, pointerId: 1, pointerType, button: 0 });
const offset = (value: string) => {
  const match = value.match(/50% ([+-]) ([\d.e+-]+)px/)!;
  return Number(match[2]) * (match[1] === "-" ? -1 : 1);
};
const start = (pointerType = "mouse") => {
  const x = offset(token().style.left);
  const y = offset(token().style.top);
  const origin = point(size.width / 2 + x, size.height / 2 + y, pointerType);
  fireEvent.pointerDown(token(), origin); return origin;
};
const dragTo = (x: number, y: number, pointerType = "mouse") => {
  start(pointerType); fireEvent.pointerMove(canvas(), point(x, y, pointerType));
  fireEvent.pointerUp(canvas(), point(x, y, pointerType));
};

beforeEach(() => {
  localStorage.clear(); usePrivacyStore.getState().reset(); useTargetPicker.getState().cancel();
  size = { width: 1000, height: 700 };
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  vi.stubGlobal("ResizeObserver", class {
    constructor(private report: ResizeObserverCallback) {}
    observe() { resizeBoard = () => this.report([{ contentRect: size } as ResizeObserverEntry], this as never); resizeBoard(); }
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ ...size, left: 0, top: 0, right: size.width, bottom: size.height, x: 0, y: 0, toJSON() {} }));
  store.setState({ game: setupGame(standardRoles(5), { setupRolesDealt: true }), lobby: null,
    terminalClose: null, undoStack: [], seatSwapUndo: [], localLayoutUndo: [], tokenPositions: {}, grimoireMode: "ring",
    customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, localSeq: 0, sync: null });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("opens legacy Ring saves as a single movable board without discarding saved coordinates", () => {
  store.setState({ tokenPositions: { p0: { x: 80, y: 90 } } });
  const before = state().game; board();
  expect(canvas()).toHaveAttribute("data-mode", "freeRoam");
  expect(state().tokenPositions.p0).toEqual({ x: 80, y: 90 });
  expect(state().game).toBe(before); expect(state().undoStack).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /Ring|Free Roam/ })).not.toBeInTheDocument();
  expect(token()).not.toHaveAttribute("draggable", "true");
});

it.each(["mouse", "touch", "pen"])("moves to all four exact board edges with %s without reordering or changing a participant", pointerType => {
  board(); const before = structuredClone(state().game);
  const maxX = (size.width - parseFloat(token().style.width)) / 2;
  const maxY = (size.height - parseFloat(token().style.height)) / 2;
  for (const [x, y, expectedX, expectedY] of [
    [-500, -500, -maxX, -maxY], [1500, -500, maxX, -maxY],
    [1500, 1500, maxX, maxY], [-500, 1500, -maxX, maxY],
  ]) {
    dragTo(x!, y!, pointerType);
    expect(state().tokenPositions.p0).toEqual({ x: expectedX, y: expectedY });
    expect(state().game).toEqual(before); expect(state().selectedPlayerId).toBeNull();
  }
  expect(state().undoStack).toHaveLength(4);
});

it("reset restores the starting ring and the next drag still works; positions survive reload", async () => {
  const view = board(); const canonical = geometry(); const before = state().game;
  dragTo(950, 660);
  const moved = structuredClone(state().tokenPositions);
  const saved = localStorage.getItem("new-blood-st")!;
  view.unmount(); store.setState({ tokenPositions: {}, game: null });
  localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate(); board();
  expect(state().tokenPositions).toEqual(moved);
  fireEvent.click(screen.getByRole("button", { name: "Players" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset Token Positions" }));
  fireEvent.click(screen.getByRole("button", { name: "Close Players panel" }));
  expect(geometry()).toEqual(canonical); expect(state().grimoireMode).toBe("freeRoam");
  expect(state().game).toEqual(before);
  dragTo(0, 0); expect(state().tokenPositions.p0).toBeDefined();
});

it("cancels an interrupted drag without saving or choosing its player", () => {
  board(); const canonical = geometry(); start();
  fireEvent.pointerMove(canvas(), point(990, 690)); fireEvent.pointerCancel(canvas(), point(990, 690));
  expect(geometry()).toEqual(canonical); expect(state().tokenPositions).toEqual({});
  expect(state().selectedPlayerId).toBeNull();
});

it("undoes one completed drag and one reset independently without changing gameplay", () => {
  board(); const canonical = geometry(); const game = state().game;
  dragTo(920, 620); const moved = structuredClone(state().tokenPositions);
  expect(state().undoStack).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Players" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset Token Positions" }));
  expect(state().undoStack).toHaveLength(2); expect(state().tokenPositions).toEqual({});
  act(() => state().undo()); expect(state().tokenPositions).toEqual(moved);
  act(() => state().undo()); expect(state().tokenPositions).toEqual({});
  expect(geometry()).toEqual(canonical); expect(state().game).toBe(game);
  expect(state().localSeq).toBe(0);
});

it("recalculates drag bounds after a panel narrows and restores the canvas without stale coordinates", () => {
  board(); dragTo(980, 680); const stored = structuredClone(state().tokenPositions);
  act(() => { size = { width: 802, height: 671 }; resizeBoard(); });
  expect(state().tokenPositions).toEqual(stored);
  expect(offset(token().style.left)).toBeLessThanOrEqual((size.width - parseFloat(token().style.width)) / 2);
  dragTo(-100, -100);
  expect(state().tokenPositions.p0).toEqual({ x: -(size.width - parseFloat(token().style.width)) / 2, y: -(size.height - parseFloat(token().style.height)) / 2 });
  act(() => { size = { width: 1280, height: 671 }; resizeBoard(); });
  dragTo(1500, 900);
  expect(state().tokenPositions.p0).toEqual({ x: (size.width - parseFloat(token().style.width)) / 2, y: (size.height - parseFloat(token().style.height)) / 2 });
});

it("does not activate a player after dragging away and back to the same point", () => {
  board(); const origin = start();
  fireEvent.pointerMove(canvas(), point(850, 500));
  fireEvent.pointerUp(canvas(), origin); fireEvent.click(token(), { detail: 1 });
  expect(state().selectedPlayerId).toBeNull();
  expect(state().tokenPositions.p0).toBeDefined();
});

it("a target tap fires once, dragging never chooses a target, and keyboard activation remains available", () => {
  board(); const choose = vi.fn();
  act(() => useTargetPicker.getState().start("a player", choose));
  dragTo(800, 500); fireEvent.click(token(), { detail: 1 });
  expect(choose).not.toHaveBeenCalled();
  const origin = start(); fireEvent.pointerUp(canvas(), origin); fireEvent.click(token(), { detail: 1 });
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith({ playerId: "p0", participantId: state().game!.players.p0!.participantId });
  act(() => { useTargetPicker.getState().cancel(); state().selectPlayer(null); });
  fireEvent.keyDown(token(), { key: "Enter" }); expect(state().selectedPlayerId).toBe("p0");
});

it("keeps the board and every target available on a crowded narrow screen", () => {
  size = { width: 355, height: 420 };
  store.setState({ game: setupGame(Array.from({ length: 20 }, () => "washerwoman"), { setupRolesDealt: true }) });
  board(); expect(canvas()).toBeInTheDocument();
  expect(canvas().querySelectorAll(".token")).toHaveLength(20);
  expect(document.querySelector(".table-replaced")).toBeNull();
  for (const seat of canvas().querySelectorAll<HTMLElement>(".token")) {
    expect(parseFloat(seat.style.width)).toBeGreaterThanOrEqual(44);
    expect(seat).toHaveAttribute("tabindex", "0");
  }
});

it("allows movement during nomination selection without selecting a player twice", () => {
  const Launcher = () => {
    const voting = useVotingInteraction()!;
    return <button onClick={() => voting.show()}>Open voting</button>;
  };
  store.setState({ game: { ...state().game!, phase: "day", day: 1, setupRolesRevealed: true } });
  render(<VotingProvider><Launcher /><PlayersWorkspace enabled roles={setupScript.characters} onMore={vi.fn()} advancedPlayerId={null}><GrimoireCircle /></PlayersWorkspace></VotingProvider>);
  fireEvent.click(screen.getByRole("button", { name: "Open voting" }));
  const slot = () => document.querySelector(".voting-slot")!;
  expect(slot()).toHaveTextContent("Tap a player");
  dragTo(50, 500); fireEvent.click(token(), { detail: 1 });
  expect(slot()).toHaveTextContent("Tap a player");
  const origin = start(); fireEvent.pointerUp(canvas(), origin); fireEvent.click(token(), { detail: 1 });
  expect(slot()).toHaveTextContent(state().game!.players.p0!.name);
  expect(document.querySelector(".voting-slot-nominee")).toHaveTextContent("Tap a player");
  expect(state().selectedPlayerId).toBeNull();
});

it("shows sourced official reminder labels as inward notation tokens without applying mechanics", () => {
  const game = state().game!;
  game.players.p0!.reminders = [
    { id: "red", label: "Red Herring", sourceCharacter: "fortuneteller", createdAt: { phase: "setup", day: 0 } },
    { id: "poison", label: "Poisoned", sourceCharacter: "poisoner", createdAt: { phase: "setup", day: 0 } },
    { id: "custom", label: "Ask later", createdAt: { phase: "setup", day: 0 } },
    { id: "executed", label: "Executed", sourceCharacter: "undertaker", createdAt: { phase: "setup", day: 0 } },
    { id: "executed2", label: "Executed", sourceCharacter: "undertaker", createdAt: { phase: "setup", day: 0 } },
  ];
  const before = structuredClone(game); board();
  const red = token().querySelector('[data-official-reminder="fortuneteller"]')!;
  expect(red).toHaveTextContent("Red Herring"); expect(red).toHaveAttribute("data-reminder-kind", "notation");
  expect(token().querySelector('[data-official-reminder="poisoner"]')).toHaveAttribute("data-reminder-kind", "notation");
  expect(token().querySelector(".token-reminder-count")).toBeNull();
  expect(token().querySelectorAll(".token-custom-reminder")).toHaveLength(2);
  expect(token().querySelector(".token-official-satellites")).toHaveTextContent("Executed ×2");
  expect(token().querySelector('[data-official-reminder="undertaker"]')).toBeNull();
  expect(token()).toHaveAccessibleName(/Ask later/);
  expect(state().game).toEqual(before); expect(game.players.p0!.effects).toHaveLength(0);
  const canonical = geometry();
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(token().querySelector(".token-official-satellites")).toBeNull();
  expect(token()).not.toHaveAccessibleName(/Red Herring|Poisoned|Ask later|Executed/);
  expect(geometry()).toEqual(canonical);
});
