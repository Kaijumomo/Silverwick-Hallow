// Phase 10G, Slice 6: Finish Game UI, the read-only ended review and Home
// (PHASE10G Sections 17-18, 24). Traceability: 10G-AC-33, AC-34, AC-37,
// AC-38, AC-47; proof areas 10-11.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const close = vi.fn<() => Promise<void>>();
vi.mock("@/firebase/storytellerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/storytellerSync")>();
  return { ...actual, closeMultiplayerSession: () => close() };
});

import { GameScreen } from "./GameScreen";
import { HomeScreen } from "@/features/home/HomeScreen";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import type { StorytellerLobbyRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "imp", "empath", "chef", "poisoner", "saint", "washerwoman"];
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];
let narrow = false;

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "day", day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const [index, p] of Object.values(g.players).entries()) { p.actualAlignment = registry.alignmentOf(p.actualRole); p.name = NAMES[index]!; }
  return g;
}
beforeEach(() => {
  narrow = false;
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, get matches() { return narrow; }, addEventListener() {}, removeEventListener() {} })));
  vi.spyOn(window, "confirm").mockReturnValue(true);
  close.mockReset();
  close.mockResolvedValue(undefined);
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.setState({ active: null });
  store.setState({ game: liveGame(), lobby: null, undoStack: [], localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Finish Game is terminal and distinct from Setup discard", () => {
  it("live play offers Finish game; Setup offers Discard setup instead", () => {
    const view = render(<GameScreen />);
    expect(screen.getByRole("button", { name: "Finish game" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Discard setup" })).toBeNull();
    view.unmount();
    store.setState({ game: liveGame({ phase: "setup", day: 0 }) });
    render(<GameScreen />);
    expect(screen.getByRole("button", { name: "Discard setup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish game" })).toBeNull();
  });

  it("offline: Finish game retains the read-only ended snapshot (no Undo, no live controls)", async () => {
    state().setAbilityUsed("p0", true);
    render(<GameScreen />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Finish game" })); });
    expect(game().phase).toBe("ended");
    expect(game().players.p0!.abilityUsed).toBe(true);
    expect(state().undoStack).toEqual([]);
    expect(screen.getByRole("status")).toHaveTextContent("Finished game — read-only review of the final state.");
    for (const name of ["↶ Undo", "Finish game", "Go live", "Day resolution", "Life events", "→ Night", "Game ended"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /Add player|Add Traveler|New seat/ })).toBeNull();
  });

  it("proof area 11: a failed authoritative close leaves the local game live and unchanged", async () => {
    store.setState({ lobby: { code: "ABCD", uid: "st", sessionId: "s1", status: "live" } });
    close.mockRejectedValue(new Error("close failed"));
    const before = game();
    render(<GameScreen />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Finish game" })); });
    expect(game()).toBe(before);
    expect(state().lobby).not.toBeNull();
    expect(screen.getByRole("button", { name: "Finish game" })).toBeInTheDocument();
  });

  it("a successful authoritative close (which detaches the lobby) is followed by the terminal finish", async () => {
    store.setState({ lobby: { code: "ABCD", uid: "st", sessionId: "s1", status: "live" } });
    close.mockImplementation(async () => { store.getState().setLobby(null); });
    render(<GameScreen />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Finish game" })); });
    expect(close).toHaveBeenCalledTimes(1);
    expect(game().phase).toBe("ended");
    expect(state().lobby).toBeNull();
  });
});

describe("10G-AC-37: the ended review is inspectable and read-only", () => {
  beforeEach(() => {
    state().recordDeath("p2");
    state().addReminder("p2", { label: "Knows" });
    state().addReminder("p2", { label: "Knows" });
    state().finishGame();
  });

  it("a participant opens a read-only final-state view (no drawer controls)", () => {
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: /^Carol, seat 3/ }));
    const dialog = screen.getByRole("dialog", { name: "Carol — final state" });
    expect(dialog).toHaveTextContent("Empath");
    expect(dialog).toHaveTextContent("Knows ×2");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Danger zone")).toBeNull();
  });

  it("Activity is available as the final, read-only record", () => {
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    const dialog = screen.getByRole("dialog", { name: "Activity (final)" });
    expect(dialog).toHaveTextContent("Carol: died");
    expect(within(dialog).queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("10G-AC-38: Home offers Review finished game; New Game is the explicit replacement", () => {
    render(<HomeScreen />);
    expect(screen.queryByRole("button", { name: /Continue current game/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review finished game" }));
    expect(state().view).toBe("game");
    expect(game().phase).toBe("ended");
  });
});

describe("10G-AC-47: narrow viewport -- new surfaces stay operable", () => {
  it("Activity, Finish game and the Rule-Fact strip are reachable from the narrow overflow menu", async () => {
    narrow = true;
    store.setState({ game: { ...game(), fabled: ["toymaker"] } });
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("button", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish game" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Game rule facts" })).getByRole("button", { name: "Record Demon skip" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getByRole("dialog", { name: "Activity" })).toBeInTheDocument();
  });

  it("Night Order + Grimoire target picking still works at narrow width", () => {
    narrow = true;
    store.setState({ game: liveGame({ phase: "night", day: 2 }) });
    const Night = () => <NightOrderPanel game={store((s) => s.game)!} script={setupScript} onClose={() => {}} />;
    render(<><Night /><GrimoireCircle /></>);
    const monk = screen.getAllByText("Monk", { selector: ".step-role-name" })[0]!.closest(".step-card") as HTMLElement;
    fireEvent.click(within(monk).getByRole("button", { name: "Pick on Grimoire" }));
    fireEvent.click(screen.getByRole("button", { name: /^Carol, seat 3/ }));
    expect(within(monk).getByRole("combobox")).toHaveValue("p2");
  });
});
