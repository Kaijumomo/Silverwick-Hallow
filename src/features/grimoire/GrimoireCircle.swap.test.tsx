import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { GrimoireCircle } from "./GrimoireCircle";
import { PlayersWorkspace } from "@/features/players/PlayersWorkspace";

const state = () => store.getState();
const position = (id: string) => {
  const token = document.querySelector<HTMLElement>(`[data-player-id="${id}"]`)!;
  return { left: token.style.left, top: token.style.top };
};
const board = () => render(<PlayersWorkspace enabled roles={setupScript.characters} onMore={vi.fn()} advancedPlayerId={null}><GrimoireCircle /></PlayersWorkspace>);
const swapWith = (id: string) => {
  act(() => state().selectPlayer("p0"));
  fireEvent.click(screen.getByRole("button", { name: "Swap seat" }));
  fireEvent.click(screen.getByRole("button", { name: new RegExp(state().game!.players[id]!.name) }));
};
beforeEach(() => {
  localStorage.clear(); usePrivacyStore.getState().reset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  store.setState({ game: setupGame(standardRoles(5), { setupRolesDealt: true }), lobby: null,
    terminalClose: null, undoStack: [], seatSwapUndo: [], tokenPositions: {}, grimoireMode: "ring",
    customScripts: { [setupScript.id]: setupScript }, localSeq: 0, sync: null, selectedPlayerId: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("allows swapping a newly added freely movable player and undoing it", () => {
  act(() => state().setTokenPosition("p0", 100, 100));
  board();
  act(() => state().addPlayer("New arrival"));
  const id = state().game!.seatOrder.at(-1)!;
  expect(screen.getByRole("button", { name: /New arrival/ })).toBeInTheDocument();
  const game = structuredClone(state().game);
  const positions = structuredClone(state().tokenPositions);
  const beforeVisual = { first: position("p0"), added: position(id) };
  swapWith(id);
  expect(state().game!.seatOrder[0]).toBe(id);
  expect(state().game!.players.p0!.participantId).toBe(game!.players.p0!.participantId);
  expect(state().tokenPositions.p0).toBeDefined();
  expect(state().tokenPositions[id]).toEqual(positions.p0);
  expect(position("p0")).toEqual(beforeVisual.added);
  expect(position(id)).toEqual(beforeVisual.first);
  act(() => state().undo());
  expect(state().game).toEqual(game);
  expect(state().tokenPositions.p0).toEqual(positions.p0);
  expect(position("p0")).toEqual(beforeVisual.first);
  expect(position(id)).toEqual(beforeVisual.added);
});

it("restores visible coordinates on Undo after swapping untouched canonical positions", () => {
  board();
  expect(state().tokenPositions).toEqual({});
  swapWith("p1");
  const swapped = structuredClone(state().tokenPositions);
  const swappedVisual = { first: position("p0"), second: position("p1") };
  expect(swapped.p0).not.toEqual(swapped.p1);
  act(() => state().undo());
  expect(state().game!.seatOrder.slice(0, 2)).toEqual(["p0", "p1"]);
  expect(state().tokenPositions.p0).toEqual(swapped.p1);
  expect(state().tokenPositions.p1).toEqual(swapped.p0);
  expect(position("p0")).toEqual(swappedVisual.second);
  expect(position("p1")).toEqual(swappedVisual.first);
});

it("keeps the canonical swap inverse through reload and a later ordinary Undo", async () => {
  const view = board();
  swapWith("p1");
  const swapped = structuredClone(state().tokenPositions);
  act(() => state().renamePlayer("p2", "Later edit"));
  const saved = localStorage.getItem("new-blood-st")!;
  view.unmount();
  store.setState({ game: null, undoStack: [], seatSwapUndo: [], tokenPositions: {} });
  localStorage.setItem("new-blood-st", saved);
  await store.persist.rehydrate();
  board();
  act(() => state().undo());
  expect(state().tokenPositions).toEqual(swapped);
  act(() => state().undo());
  expect(state().game!.seatOrder.slice(0, 2)).toEqual(["p0", "p1"]);
  expect(state().tokenPositions.p0).toEqual(swapped.p1);
  expect(state().tokenPositions.p1).toEqual(swapped.p0);
});

it("preserves the swap inverse after resetting saved positions without a layout mode switch", () => {
  board();
  fireEvent.click(screen.getByRole("button", { name: "Players" }));
  fireEvent.click(screen.getByRole("button", { name: "Reset Token Positions" }));
  fireEvent.click(screen.getByRole("button", { name: "Close Players panel" }));
  expect(state().tokenPositions).toEqual({});
  swapWith("p1");
  expect(state().grimoireMode).toBe("freeRoam");
  const swapped = structuredClone(state().tokenPositions);
  act(() => state().undo());
  expect(state().tokenPositions.p0).toEqual(swapped.p1);
  expect(state().tokenPositions.p1).toEqual(swapped.p0);
});
