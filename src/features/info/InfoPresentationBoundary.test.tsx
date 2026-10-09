import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useShellLayout } from "@/components/useShellLayout";
import { PlayersWorkspace } from "@/features/players/PlayersWorkspace";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";

let width: number;
let media: Map<string, { matches: boolean; listeners: Set<() => void> }>;
function resize(next: number) {
  act(() => {
    width = next;
    for (const [query, entry] of media) {
      entry.matches = width <= Number(query.match(/\d+/)![0]);
      entry.listeners.forEach(listener => listener());
    }
  });
}
function ResponsiveWorkspace() {
  const layout = useShellLayout();
  return <PlayersWorkspace enabled={layout !== "phone"} roles={setupScript.characters} onMore={() => {}} advancedPlayerId={null}>
    <main data-testid="private-board">Secret grimoire<button>Private action</button></main>
  </PlayersWorkspace>;
}
beforeEach(() => {
  width = 1280; media = new Map();
  vi.stubGlobal("matchMedia", (query: string) => {
    if (!media.has(query)) media.set(query, { matches: width <= Number(query.match(/\d+/)![0]), listeners: new Set() });
    const entry = media.get(query)!;
    return { get matches() { return entry.matches; }, media: query,
      addEventListener: (_: string, listener: () => void) => entry.listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => entry.listeners.delete(listener) };
  });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ status: "idle", backend: null });
  store.setState({ game: setupGame(undefined, { phase: "night", day: 1 }), lobby: null, terminalClose: null,
    undoStack: [], selectedPlayerId: null, customScripts: { [setupScript.id]: setupScript } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function show() {
  render(<ResponsiveWorkspace />);
  fireEvent.click(screen.getByRole("button", { name: "Info" }));
  fireEvent.click(screen.getByRole("button", { name: "You Are Good" }));
}
function expectProtected(name = "You Are Good") {
  expect(screen.getByRole("dialog", { name })).toBeVisible();
  expect(screen.getByTestId("private-board").closest("[inert]")).not.toBeNull();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: /Return to Grimoire/ }));
}
describe("Info player-safe screen across actual shell breakpoints (INFO-IND-001)", () => {
  it("survives 761→760 and narrow→wide transitions until explicit Return, without state or Undo changes", () => {
    const game = store.getState().game, undo = store.getState().undoStack;
    show(); expectProtected();
    const dialog = screen.getByRole("dialog");
    for (const next of [1024, 761, 760, 640, 1280]) {
      resize(next); expectProtected();
      expect(screen.getByRole("dialog")).toBe(dialog);
    }
    fireEvent.click(screen.getByRole("button", { name: /Return to Grimoire/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("private-board").closest("[inert]")).toBeNull();
    expect(store.getState().game).toBe(game); expect(store.getState().undoStack).toBe(undo);
  });
  it("can explicitly dismiss on the narrow layout and does not reopen on widening", () => {
    show(); resize(760); expectProtected();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("private-board").closest("[inert]")).toBeNull();
    resize(1280);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Info" })).toHaveAttribute("aria-expanded", "false");
  });
  it.each(["game", "privacy", "session"])("keeps a safe stale notice for a %s change while the panel is unmounted", kind => {
    show(); resize(760);
    act(() => {
      if (kind === "game") store.setState({ game: { ...store.getState().game!, notes: "changed" } });
      if (kind === "privacy") usePrivacyStore.setState({ enabled: true });
      if (kind === "session") store.setState({ lobby: { code: "CHANGED" } as NonNullable<ReturnType<typeof store.getState>["lobby"]> });
    });
    expectProtected("Information changed");
    expect(screen.queryByRole("dialog", { name: "You Are Good" })).toBeNull();
    expect(store.getState().undoStack).toHaveLength(0);
  });
});
