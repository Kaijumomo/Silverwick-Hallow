import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { endGameWithIntent } from "@/firebase/terminal";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { makeSTPlayer } from "@/test/fixtures";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { applyBluff, confirmEnd, presentMessage, useEndStatus } from "./actions";
import { useInfoShow } from "./showStore";

vi.mock("@/firebase/terminal", () => ({ endGameWithIntent: vi.fn() }));
const end = vi.mocked(endGameWithIntent);

const EVIL = new Set(["poisoner", "scarletwoman", "spy", "imp"]);
function seatedGame(roles: string[], over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const base = setupGame(roles, { phase: "night", day: 2, ...over });
  const players = Object.fromEntries(Object.entries(base.players).map(([id, p]) => [id, makeSTPlayer({ ...p, actualAlignment: EVIL.has(p.actualRole) ? "evil" : "good" })]));
  return { ...base, players };
}

function reset(game: StorytellerLobbyRecord) {
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ status: "idle", backend: null });
  useV6Ui.getState().reset();
  useInfoShow.getState().clear();
  useEndStatus.setState({ busy: false, error: null });
  store.setState({ game, lobby: null, terminalClose: null, undoStack: [], selectedPlayerId: null, customScripts: { [setupScript.id]: setupScript } });
}
const ui = (patch: Parameters<ReturnType<typeof useV6Ui.getState>["set"]>[0]) => act(() => { useV6Ui.getState().set(patch); });

beforeEach(() => { end.mockReset(); end.mockResolvedValue({ ok: true }); reset(seatedGame(standardRoles(9))); });
afterEach(cleanup);

describe("4F Info card", () => {
  it("shows the table's counts and composition and the four first-night entries", () => {
    render(<GrimoireV6Screen />);
    ui({ panel: "info" });
    const card = document.body;
    const stat = (label: string) => within(card).getByText(label).closest("div")!.textContent;
    expect(stat("Alive")).toBe("9Alive");
    expect(stat("To execute")).toBe("5To execute");
    expect(stat("Townsfolk")).toBe("5Townsfolk");
    expect(stat("Outsiders")).toBe("2Outsiders");
    expect(stat("Minion")).toBe("1Minion");
    expect(stat("Demon")).toBe("1Demon");
    for (const label of ["Evil Traveller Information", "Demon Information", "Minion Information", "Demon Bluffs", "You Are", "This Player Is", "Selected You", "Reveal a Token", "Did You Vote Today?", "Did You Nominate Today?", "You Are Good", "You Are Evil"])
      expect(within(card).getByRole("button", { name: label })).toBeTruthy();
  });

  it("is absent from the DOM in Privacy Mode, even if its panel flag is set", () => {
    usePrivacyStore.setState({ enabled: true });
    render(<GrimoireV6Screen />);
    ui({ panel: "info" });
    expect(screen.queryByText("Information tokens")).toBeNull();
    expect(screen.queryByText("Demon bluffs")).toBeNull();
  });

  it("a text token opens the full-screen player view without touching the game, and Return closes it", () => {
    render(<GrimoireV6Screen />);
    ui({ panel: "info" });
    const before = store.getState().game, history = before!.history.length, stack = store.getState().undoStack;
    fireEvent.click(screen.getByRole("button", { name: "You Are Evil" }));
    const dialog = screen.getByRole("dialog", { name: "You Are Evil" });
    expect(within(dialog).getByText("You Are Evil")).toBeTruthy();
    expect(screen.queryByText("Information tokens")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: /Return to Grimoire/ }));
    expect(screen.queryByRole("dialog", { name: "You Are Evil" })).toBeNull();
    expect(screen.getByText("Information tokens")).toBeTruthy();
    expect(store.getState().game).toBe(before);
    expect(store.getState().game!.history.length).toBe(history);
    expect(store.getState().undoStack).toBe(stack);
  });

  it("Escape closes the player view", () => {
    render(<GrimoireV6Screen />);
    act(() => { presentMessage("vote", "Did You Vote Today?"); });
    expect(screen.getByRole("dialog", { name: "Did You Vote Today?" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Did You Vote Today?" })).toBeNull();
    expect(useInfoShow.getState().current).toBeNull();
  });

  it("character tokens ask the board's picker for a character first", () => {
    render(<GrimoireV6Screen />);
    ui({ panel: "info" });
    fireEvent.click(screen.getByRole("button", { name: "Reveal a Token" }));
    expect(useV6Ui.getState().picker).toEqual({ mode: "show", title: "This Character" });
  });

  it("the player view refuses to show anything once the game has changed underneath it", () => {
    render(<GrimoireV6Screen />);
    act(() => { presentMessage("good", "You Are Good"); });
    expect(screen.getByRole("dialog", { name: "You Are Good" })).toBeTruthy();
    act(() => { store.setState({ game: { ...store.getState().game!, notes: "changed" } }); });
    expect(screen.queryByRole("dialog", { name: "You Are Good" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Information changed" })).toBeTruthy();
  });

  it("Demon Information shows the Minions and the Demon's bluffs, player-safe", () => {
    const game = seatedGame(standardRoles(9));
    const demon = Object.values(game.players).find((p) => p.actualRole === "imp")!;
    reset(game);
    act(() => { store.getState().setBluffs(demon.id, ["mayor", "soldier", "chef"]); });
    render(<GrimoireV6Screen />);
    ui({ panel: "info" });
    fireEvent.click(screen.getByRole("button", { name: "Demon Information" }));
    const dialog = screen.getByRole("dialog", { name: "Demon Information" });
    expect(within(dialog).getByText("Your Minions")).toBeTruthy();
    expect(within(dialog).getByText("These Characters Are Not in Play")).toBeTruthy();
    for (const name of ["Mayor", "Soldier", "Chef"]) expect(within(dialog).getByText(name)).toBeTruthy();
    // Names only: nothing about which character anyone is.
    expect(within(dialog).queryByText(/Imp|Poisoner|Washerwoman/)).toBeNull();
  });

  it("explains a refused setup information in the design's toast instead of opening a view", () => {
    reset(seatedGame(["chef", "empath", "monk", "saint", "poisoner", "imp"]));
    render(<GrimoireV6Screen />);
    ui({ panel: "info" });
    fireEvent.click(screen.getByRole("button", { name: "Demon Information" }));
    expect(screen.queryByRole("dialog", { name: "Demon Information" })).toBeNull();
    expect(screen.getByText(/fewer than 7 residents/i)).toBeTruthy();
  });

  it("with no evil Traveller seated, Evil Traveller Information says why", () => {
    render(<GrimoireV6Screen />);
    ui({ panel: "info" });
    fireEvent.click(screen.getByRole("button", { name: "Evil Traveller Information" }));
    expect(screen.getByText(/No living, non-exiled evil Traveller/)).toBeTruthy();
  });

  it("a bluff slot opens the picker for that slot; with no Demon it asks for one", () => {
    const game = seatedGame(standardRoles(9));
    reset(game);
    render(<GrimoireV6Screen />);
    ui({ panel: "info" });
    fireEvent.click(screen.getByRole("button", { name: "Add Demon bluff 2" }));
    expect(useV6Ui.getState().picker).toEqual({ mode: "bluff", slot: 1 });
    ui({ picker: null });
    const noDemon = seatedGame(["chef", "empath", "monk", "saint", "poisoner"]);
    reset(noDemon);
    ui({ panel: "info" });
    fireEvent.click(screen.getByRole("button", { name: "Add Demon bluff 1" }));
    expect(useV6Ui.getState().picker).toBeNull();
    expect(screen.getByText("Assign a Demon or apparent Demon to choose bluffs.")).toBeTruthy();
  });
});

describe("4F bluff commands", () => {
  it("sets and clears a bluff through the existing command; refuses an in-play character", () => {
    const game = seatedGame(standardRoles(9));
    const demon = Object.values(game.players).find((p) => p.actualRole === "imp")!;
    reset(game);
    expect(applyBluff(0, "mayor")).toBeUndefined();
    expect(store.getState().game!.players[demon.id]!.privateInfo?.bluffs).toEqual(["mayor"]);
    expect(applyBluff(1, "chef")).toMatch(/in play|out-of-play/i);
    expect(store.getState().game!.players[demon.id]!.privateInfo?.bluffs).toEqual(["mayor"]);
    expect(applyBluff(0)).toBeUndefined();
    expect(store.getState().game!.players[demon.id]!.privateInfo?.bluffs).toBeUndefined();
  });

  it("refuses to change bluffs once the game has ended", () => {
    reset(seatedGame(standardRoles(9), { phase: "ended", result: { winner: "good", declaredAt: { phase: "day", day: 2 } } }));
    expect(applyBluff(0, "mayor")).toMatch(/changed/i);
  });
});

describe("4F Reference", () => {
  it("lists the script's characters by team, searches name and ability, and offers Clear search", () => {
    render(<GrimoireV6Screen />);
    ui({ panel: "reference" });
    const dialog = screen.getByRole("dialog", { name: "Character reference" });
    for (const team of ["Townsfolk", "Outsiders", "Minions", "Demons"]) expect(within(dialog).getAllByText(team).length).toBeGreaterThan(0);
    fireEvent.input(within(dialog).getByPlaceholderText("Search characters or abilities"), { target: { value: "poison" } });
    expect(within(dialog).getByRole("button", { name: "Poisoner" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Imp" })).toBeNull();
    fireEvent.input(within(dialog).getByPlaceholderText("Search characters or abilities"), { target: { value: "zzzz" } });
    expect(within(dialog).getByText(/No characters match/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear search" }));
    expect(useV6Ui.getState().refQuery).toBe("");
  });

  it("marks characters in play and names their holders; shows reminder tokens and the wiki link", () => {
    render(<GrimoireV6Screen />);
    ui({ panel: "reference" });
    const dialog = screen.getByRole("dialog", { name: "Character reference" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Poisoner" }));
    expect(within(dialog).getByText(/^In play · Player \d/)).toBeTruthy();
    expect(within(dialog).getByText("Reminder tokens")).toBeTruthy();
    expect(within(dialog).getByRole("link", { name: /Poisoner wiki/ })).toHaveAttribute("href", "https://wiki.bloodontheclocktower.com/Poisoner");
    fireEvent.click(within(dialog).getByRole("button", { name: "Baron" }));
    expect(within(dialog).getByText("Not in play")).toBeTruthy();
  });

  it("is hidden entirely in Privacy Mode so in-play characters cannot leak", () => {
    usePrivacyStore.setState({ enabled: true });
    render(<GrimoireV6Screen />);
    ui({ panel: "reference" });
    expect(screen.queryByRole("dialog", { name: "Character reference" })).toBeNull();
  });
});

describe("4F End game", () => {
  it("declares only the Storyteller's explicit choice, through the terminal seam", async () => {
    render(<GrimoireV6Screen />);
    ui({ endOpen: true });
    const dialog = screen.getByRole("dialog", { name: "End game" });
    expect(end).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Evil wins" })); });
    expect(end).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ kind: "declare", winner: "evil" });
    expect(useV6Ui.getState().endOpen).toBe(false);
    expect(useV6Ui.getState().winScene).toBe(true);
  });

  it("Keep playing, a backdrop tap and Escape leave the game running", () => {
    render(<GrimoireV6Screen />);
    ui({ endOpen: true });
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(useV6Ui.getState().endOpen).toBe(false);
    ui({ endOpen: true });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useV6Ui.getState().endOpen).toBe(false);
    expect(end).not.toHaveBeenCalled();
  });

  it("ends without a result (no scene) and ignores a second tap while one is in flight", async () => {
    let resolve!: (r: { ok: true }) => void;
    end.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    let first!: Promise<boolean>;
    act(() => { first = confirmEnd("noResult"); });
    expect(await confirmEnd("good")).toBe(false);
    await act(async () => { resolve({ ok: true }); await first; });
    expect(end).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ kind: "noResult" });
    expect(useV6Ui.getState().winScene).toBe(false);
  });

  it("keeps the dialog open and reports the refusal when the ending fails", async () => {
    end.mockResolvedValueOnce({ ok: false, message: "Please retry the failed closure." });
    render(<GrimoireV6Screen />);
    ui({ endOpen: true });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Good wins" })); });
    expect(useV6Ui.getState().endOpen).toBe(true);
    expect(useV6Ui.getState().winScene).toBe(false);
    expect(screen.getAllByText("Please retry the failed closure.").length).toBeGreaterThan(0);
  });

  it("an interrupted ending reopens the dialog and can only retry its recorded outcome", async () => {
    store.setState({ terminalClose: { status: "failed", intent: { kind: "declare", winner: "evil" }, message: "An ending was interrupted.", recoveryPending: true } });
    render(<GrimoireV6Screen />);
    expect(useV6Ui.getState().endOpen).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Keep playing" }));
    expect(useV6Ui.getState().endOpen).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(useV6Ui.getState().endOpen).toBe(true);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry saving result" })); });
    expect(end).toHaveBeenCalledOnce();
    expect(end).toHaveBeenCalledWith({ kind: "declare", winner: "evil" });
  });

  it("is not offered in Privacy Mode or on a finished game", () => {
    render(<GrimoireV6Screen />);
    usePrivacyStore.setState({ enabled: true });
    ui({ endOpen: true });
    expect(screen.queryByRole("dialog", { name: "End game" })).toBeNull();
    usePrivacyStore.setState({ enabled: false });
    act(() => { store.setState({ game: { ...store.getState().game!, phase: "ended", result: { winner: "good", declaredAt: { phase: "day", day: 2 } } } }); });
    expect(screen.queryByRole("dialog", { name: "End game" })).toBeNull();
  });
});

describe("4F victory scene and the ended review", () => {
  const ended = (winner: "good" | "evil", demonAlive: boolean) => {
    const base = seatedGame(standardRoles(9), { phase: "ended", day: 3, result: { winner, declaredAt: { phase: winner === "good" ? "day" : "night", day: 3 } } });
    const players = Object.fromEntries(Object.entries(base.players).map(([id, p]) => [id, p.actualRole === "imp" ? { ...p, alive: demonAlive } : p]));
    return { ...base, players };
  };

  it("Good wins: the slain Demon, the winning team and the way back to the review", () => {
    reset(ended("good", false));
    render(<GrimoireV6Screen />);
    ui({ winScene: true });
    const scene = screen.getByRole("dialog", { name: "Good Wins" });
    expect(within(scene).getByText("Day 3 · Dawn over Silverwick Hollow")).toBeTruthy();
    expect(within(scene).getByText(/The Imp has been found and slain\. The town of Silverwick Hollow will see another dawn\./)).toBeTruthy();
    expect(within(scene).queryByText("Player 8")).toBeNull(); // the Imp (seat 8) is evil
    expect(within(scene).getByText("Player 0")).toBeTruthy();
    fireEvent.click(within(scene).getByRole("button", { name: "Review the Grimoire" }));
    expect(screen.queryByRole("dialog", { name: "Good Wins" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Good wins. Finished game, read-only review.");
  });

  it("Return Home sits beside Review the Grimoire, keeps the finished game and leaves the Grimoire", () => {
    reset(ended("good", false));
    render(<GrimoireV6Screen />);
    ui({ winScene: true });
    const scene = screen.getByRole("dialog", { name: "Good Wins" });
    expect(within(scene).getByRole("button", { name: "Review the Grimoire" })).toBeTruthy();
    fireEvent.click(within(scene).getByRole("button", { name: "Return Home" }));
    const state = store.getState();
    expect(state.view).toBe("home");
    expect(state.game?.phase).toBe("ended");
    expect(state.game?.result?.winner).toBe("good");
    expect(useV6Ui.getState().winScene).toBe(false);
  });

  it("Evil wins lists the evil team; it does not claim a dead Demon walks free", () => {
    reset(ended("evil", true));
    render(<GrimoireV6Screen />);
    ui({ winScene: true });
    let scene = screen.getByRole("dialog", { name: "Evil Wins" });
    expect(within(scene).getByText("Night 3 · The last candle gutters")).toBeTruthy();
    expect(within(scene).getByText(/The Imp walks free and the town has fallen\. Silverwick Hollow belongs to the dark\./)).toBeTruthy();
    expect(within(scene).getByText("Player 8")).toBeTruthy();
    cleanup();
    reset(ended("evil", false));
    render(<GrimoireV6Screen />);
    ui({ winScene: true });
    scene = screen.getByRole("dialog", { name: "Evil Wins" });
    expect(within(scene).queryByText(/walks free/)).toBeNull();
    expect(within(scene).getByText("Silverwick Hollow belongs to the dark.")).toBeTruthy();
  });

  it("a game ended without a result has no scene, and Privacy Mode hides the scene", () => {
    reset(seatedGame(standardRoles(9), { phase: "ended", day: 3 }));
    render(<GrimoireV6Screen />);
    ui({ winScene: true });
    expect(screen.queryByRole("dialog", { name: /Wins/ })).toBeNull();
    cleanup();
    reset(ended("good", false));
    usePrivacyStore.setState({ enabled: true });
    render(<GrimoireV6Screen />);
    ui({ winScene: true });
    expect(screen.queryByRole("dialog", { name: "Good Wins" })).toBeNull();
  });

  it("reopening a saved finished game goes straight to the review (no scene until an ending)", () => {
    reset(ended("good", false));
    render(<GrimoireV6Screen />);
    expect(screen.queryByRole("dialog", { name: "Good Wins" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Finished game, read-only review.");
  });
});
