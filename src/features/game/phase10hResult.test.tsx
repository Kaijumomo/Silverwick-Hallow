// Phase 10H, Slice 5: the Storyteller-declared result, its confirmation, the
// cinematic post-game summary and the read-only review (contract §§14, 15,
// 19; S4). Traceability: 10H-AC-045, -046, -047, -051 (UI side), -023.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const close = vi.fn<() => Promise<{ alreadyEnded: boolean }>>();
vi.mock("@/firebase/storytellerSync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/firebase/storytellerSync")>();
  return { ...actual, closeMultiplayerSession: () => close() };
});

import { GameScreen } from "./GameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useShellStore } from "@/stores/shellStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { finishGame } from "@/test/finishGame";
import type { StorytellerLobbyRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "imp", "empath", "chef", "poisoner", "saint", "washerwoman"];
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "day", day: 3, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const [index, p] of Object.values(g.players).entries()) { p.actualAlignment = registry.alignmentOf(p.actualRole); p.name = NAMES[index]!; }
  return g;
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  close.mockReset();
  close.mockResolvedValue({ alreadyEnded: false });
  usePrivacyStore.setState({ enabled: false });
  useShellStore.getState().reset();
  useSessionRuntime.setState({ backend: null });
  store.setState({ game: liveGame(), lobby: null, undoStack: [], localSeq: 0, sync: null, terminalClose: null,
    customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("10H-AC-045 / AC-047: the Storyteller declares the result -- nothing is inferred", () => {
  it("Finish game offers Good victory, Evil victory and the exceptional End Without Result, with nothing preselected", () => {
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Finish game" }));
    const dialog = screen.getByRole("dialog", { name: "Finish the game" });
    expect(dialog).toHaveAttribute("aria-modal", "true"); // a TRUE confirmation stays modal
    expect(within(dialog).getByText("Declare who won. Silverwick does not decide the winner.")).toBeInTheDocument();
    const choices = within(within(dialog).getByRole("group", { name: "Result" })).getAllByRole("button");
    expect(choices.map((b) => b.textContent)).toEqual(["Good winsDeclare Good victory", "Evil winsDeclare Evil victory"]);
    expect(choices.every((b) => !b.hasAttribute("aria-pressed"))).toBe(true);
    expect(within(dialog).getByRole("button", { name: "End without a result…" })).toBeInTheDocument();
    // Choosing only moves to the confirmation; Back returns; nothing ended yet.
    fireEvent.click(choices[1]!);
    expect(screen.getByRole("dialog", { name: "Declare Evil victory?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Finish the game" })).toBeInTheDocument();
    expect(game().phase).toBe("day");
    expect(close).not.toHaveBeenCalled();
  });

  it.each([["good", "Good wins"], ["evil", "Evil wins"]] as const)("Declare %s: ONE terminal commit, Undo-free, with the declared winner and moment", async (winner, headline) => {
    render(<GameScreen />);
    await finishGame({ choice: winner, review: false });
    expect(game()).toMatchObject({ phase: "ended", result: { winner, declaredAt: { phase: "day", day: 3 } } });
    expect(state().undoStack).toEqual([]);
    const summary = screen.getByRole("region", { name: headline });
    expect(within(summary).getByText("Declared Day 3")).toBeInTheDocument();
    expect(within(summary).getByRole("heading", { name: `${winner === "good" ? "Good" : "Evil"} — winners` })).toBeInTheDocument();
  });

  it("End Without Result ends the game with NO result and says so", async () => {
    render(<GameScreen />);
    await finishGame({ review: false });
    expect(game().phase).toBe("ended");
    expect(game().result).toBeUndefined();
    const summary = screen.getByRole("region", { name: "The game is over" });
    expect(within(summary).getByText("No recorded result")).toBeInTheDocument();
    expect(within(summary).queryByText(/— winners/)).toBeNull();
  });
});

describe("§19: cinematic summary -> read-only final Grimoire -> History -> Home / New Game", () => {
  it("the summary lists both teams from the retained snapshot, and leads to the read-only review and back", async () => {
    render(<GameScreen />);
    await finishGame({ choice: "good", review: false });
    const summary = screen.getByRole("region", { name: "Good wins" });
    expect(within(summary).getByText("Alice")).toBeInTheDocument();
    expect(within(summary).getByText("Imp")).toBeInTheDocument();
    fireEvent.click(within(summary).getByRole("button", { name: "Review the final Grimoire" }));
    expect(screen.getByRole("status")).toHaveTextContent("Finished game — read-only review of the final state.");
    expect(screen.queryByRole("button", { name: "↶ Undo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Game summary" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Good wins" })).getByRole("button", { name: "Return Home" }));
    expect(state().view).toBe("home");
  });

  it("Privacy Mode: the summary (which names every character) is DOM-absent", async () => {
    render(<GameScreen />);
    await finishGame({ choice: "evil", review: false });
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("region", { name: "Evil wins" })).toBeNull();
    expect(document.body).not.toHaveTextContent(/Imp|Poisoner|Washerwoman/);
  });
});

describe("10H-AC-051 (UI side): while the close is in flight the game cannot be finished twice", () => {
  it("the dialog shows Ending…, its controls are disabled, and a failure keeps the game live with a retry", async () => {
    let fail!: (error: Error) => void;
    close.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    store.setState({ lobby: { code: "ABCD", uid: "st", sessionId: "s1", status: "live" } });
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Finish game" }));
    fireEvent.click(screen.getByRole("button", { name: /^Good wins/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Declare Good Victory" })); });
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("Ending the game…");
    expect(screen.getByRole("button", { name: "Declare Good Victory" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(state().terminalClose).toMatchObject({ status: "closing" });
    await act(async () => { fail(new Error("network down")); });
    expect(game().phase).toBe("day");
    expect(screen.getByRole("alert")).toHaveTextContent(/could not be ended/);
    expect(screen.getByRole("button", { name: "Try again: Declare Good Victory" })).toBeEnabled();
  });
});

describe("Discard setup is a true confirmation (no window.confirm)", () => {
  it("asks in a styled dialog, and Cancel keeps the setup", () => {
    store.setState({ game: liveGame({ phase: "setup", day: 0, setupRolesRevealed: false }) });
    const confirmSpy = vi.spyOn(window, "confirm");
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Discard setup" }));
    const dialog = screen.getByRole("dialog", { name: "Discard this setup?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(game().phase).toBe("setup");
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
