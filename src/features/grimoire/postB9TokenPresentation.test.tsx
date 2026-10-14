import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { GrimoireCircle } from "./GrimoireCircle";
import { PlayersInteraction } from "@/features/players/PlayersInteraction";
import { OfficialReminderToken } from "@/features/reminders/OfficialReminderToken";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { canonicalRoles } from "@/data/canonical";
import type { EffectRecord } from "@/stores/types";

const effect = (id: string, type: string, state: EffectRecord["state"] = "active"): EffectRecord => ({ id, type, state,
  lifetime: { kind: "manual" }, expiry: { kind: "none" }, sourceCharacter: "chef", note: `Source note ${id}` });
const token = () => document.querySelector<HTMLElement>('[data-player-id="p0"]')!;
const board = () => render(<PlayersInteraction.Provider value={{ active: true, swapping: false, tap: () => false }}><GrimoireCircle /></PlayersInteraction.Provider>);

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    constructor(private report: ResizeObserverCallback) {}
    observe() { this.report([{ contentRect: { width: 1200, height: 800 } } as ResizeObserverEntry], this as never); }
    disconnect() {}
  });
  usePrivacyStore.getState().reset();
  store.setState({ game: setupGame(["chef", "poisoner", "monk"], { setupRolesDealt: true }), lobby: null, undoStack: [],
    customScripts: { [setupScript.id]: setupScript }, tokenPositions: {}, grimoireMode: "freeRoam" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("R3 summarizes active families with game labels while preserving duplicate records and provenance", () => {
  const g = store.getState().game!;
  g.players.p0!.effects = [effect("a", "marked"), effect("b", "marked"), effect("c", "moon_blessing"), effect("d", "sleeping_curse", "suppressed")];
  const before = structuredClone(g); board();
  const badge = token().querySelector(".token-marker-effects")!;
  expect(badge).toHaveTextContent("Marked +1"); expect(badge).toHaveAttribute("data-effect-count", "2");
  expect(badge).toHaveAttribute("title", "Marked, 2 active effects, Moon blessing");
  expect(token()).toHaveAccessibleName(/Marked, 2 active effects; Moon blessing/);
  expect(token()).not.toHaveAccessibleName(/Sleeping curse/);
  expect(store.getState().game).toEqual(before); expect(store.getState().undoStack).toHaveLength(0);
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(token().querySelector(".token-marker-effects")).toBeNull();
  expect(token()).not.toHaveAccessibleName(/Marked|Moon blessing/);
  expect(store.getState().game).toEqual(before);
});

it("R3 suppressed-only custom effects remain stored without claiming an active badge", () => {
  const g = store.getState().game!; g.players.p0!.effects = [effect("inactive", "moon_blessing", "suppressed")];
  const before = structuredClone(g); board();
  expect(token().querySelector(".token-marker-effects")).toBeNull(); expect(store.getState().game).toEqual(before);
});

it("R3 actual role badge is concise while accessible identity stays explicit and private", () => {
  const g = setupGame(["drunk", "poisoner", "monk"], { setupRolesDealt: true });
  store.setState({ game: g }); board();
  expect(token().querySelector(".token-marker-divergence")).toHaveTextContent("Drunk");
  expect(token().querySelector(".token-marker-divergence")).toHaveAttribute("title", "Actual role: Drunk");
  expect(token()).toHaveAccessibleDescription(/Shown role: Washerwoman.*Actual role: Drunk \(differs from shown\)/);
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(token().querySelector(".token-marker-divergence")).toBeNull(); expect(token()).not.toHaveAccessibleDescription(/Drunk|Washerwoman/);
});

it("R3 unresolved shown identity remains a visible Prepare role task", () => {
  const g = setupGame(["drunk", "poisoner", "monk"], { setupRolesDealt: true });
  g.players.p0!.shownRole = null; store.setState({ game: g }); board();
  expect(token().querySelector(".token-needs-reveal")).toHaveTextContent("Prepare role");
  expect(token()).toHaveAccessibleDescription(/No shown role yet/);
});

it("R3 official notation keeps artwork and semantics without its decorative pen", () => {
  const { container } = render(<OfficialReminderToken role={canonicalRoles(["washerwoman"])[0]!} label="Townsfolk" notation count={2} />);
  const notation = container.querySelector(".official-reminder-notation")!;
  expect(notation).toHaveTextContent("Townsfolk ×2 (notation only)");
  expect(notation).toHaveAttribute("title", "Washerwoman: Townsfolk ×2 (notation only)");
  expect(notation.querySelector("img")).toBeTruthy(); expect(notation.querySelector(".official-reminder-pen")).toBeNull();
});

it("R3 custom reminder pen retains its note meaning and exact records", () => {
  const g = store.getState().game!; g.players.p0!.reminders = [{ id: "note", label: "Ask tomorrow", note: "Keep this context" }];
  const before = structuredClone(g); board();
  expect(token().querySelector(".token-custom-reminder-pen")).toHaveTextContent("✎");
  expect(token()).toHaveAccessibleName(/Ask tomorrow/); expect(store.getState().game).toEqual(before);
});
