// BM-1c -- the Exorcist's Night step in the existing Night panel: the Storyteller taps a player on the board (one Undo), the card shows the
// chosen player and, when the Demon was told, the Cerenovus's "Wake" row with ONE reveal token (Selected You, Exorcist) and the line
// "Then point to the Exorcist". The exorcised Demon's own step then shows Not waking. https://wiki.bloodontheclocktower.com/Exorcist
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { useInfoShow } from "@/features/grimoire-v6/info/showStore";
import { impair, openInStore, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
// p0 exorcist, p1 chef, p2 imp, p3 monk, p4 recluse
const ROLES = ["exorcist", "chef", "imp", "monk", "recluse"];
const stepOf = (g: StorytellerLobbyRecord, id: string, role: string) => participantStepKey(g.players[id]!.participantId!, role);
function show(g = proofGame(ROLES), at: [string, string] = ["p0", "exorcist"]) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: stepOf(g, ...at) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const chosenOn = (id: string) => game().players[id]!.effects.filter((e) => e.type === "exorcistChosen");

beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); useV6Ui.getState().set({ picker: null }); useInfoShow.getState().clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("tapping the Demon commits at once (one Undo): CHOSEN, the step done, the Wake row with one token, and the point-to line", () => {
  show();
  expect(useTargetPicker.getState().active?.label).toBe("Choose a player");
  tap("p2");
  expect(chosenOn("p2")).toHaveLength(1);
  expect(game().nightProgress[`2:${stepOf(game(), "p0", "exorcist")}`]?.status).toBe("done");
  expect(store.getState().undoStack).toHaveLength(1);
  const row = screen.getByRole("group", { name: "Wake Player 2" });
  expect(within(row).getByRole("button", { name: "Wake Player 2: Selected You" })).toBeInTheDocument();
  expect(within(row).getByText("Exorcist")).toBeInTheDocument();
  expect(screen.getByText("Then point to the Exorcist: Player 0.")).toBeInTheDocument();
  act(() => { store.getState().undo(); });
  expect(chosenOn("p2")).toEqual([]);
  expect(screen.queryByRole("group", { name: "Wake Player 2" })).toBeNull();
});

it("the token opens the existing player-safe reveal and never shows the Exorcist's name; showing records nothing", () => {
  show();
  tap("p2");
  fireEvent.click(screen.getByRole("button", { name: "Wake Player 2: Selected You" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "Selected You", roleId: "exorcist" });
  expect(JSON.stringify(useInfoShow.getState().current?.payload)).not.toContain("Player 0");
  expect(store.getState().undoStack).toHaveLength(1);
});

it("a player who is not the Demon: no Wake row, nothing else changes", () => {
  show();
  tap("p1");
  expect(chosenOn("p1")).toHaveLength(1);
  expect(screen.queryByRole("group", { name: "Wake Player 1" })).toBeNull();
  expect(screen.queryByText(/Then point to the Exorcist/)).toBeNull();
});

it("the Demon's own step then says Not waking, with the reason", () => {
  show();
  tap("p2");
  cleanup();
  useShellStore.getState().setNightCursor({ day: 2, stepKey: stepOf(game(), "p2", "imp") });
  render(<StrictMode><Guide /></StrictMode>);
  expect(screen.getByText("Not waking")).toBeInTheDocument();
  expect(document.body.textContent).toContain("The Exorcist chose the Demon tonight. The Demon does not use their ability tonight.");
});

it("a Recluse is the Storyteller's one ruling, asked on the card with nothing pre-selected; Yes shows the Wake row", () => {
  show();
  tap("p4");
  expect(screen.getByText("Does Player 4 register as a Demon?")).toBeInTheDocument();
  expect(chosenOn("p4")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(chosenOn("p4")).toHaveLength(1);
  expect(screen.getByRole("group", { name: "Wake Player 4" })).toBeInTheDocument();
});

it("last night's player is refused with the plain sentence and nothing changes; a different player works", () => {
  show();
  tap("p1");
  cleanup();
  act(() => { store.setState({ game: { ...game(), day: 3 } }); });
  useShellStore.getState().setNightCursor({ day: 3, stepKey: stepOf(game(), "p0", "exorcist") });
  render(<StrictMode><Guide /></StrictMode>);
  const before = game();
  tap("p1");
  expect(document.body.textContent).toContain("Player 1 was chosen last night. Choose a different player.");
  expect(game()).toBe(before);
  tap("p3");
  expect(chosenOn("p3")).toHaveLength(1);
  expect(chosenOn("p1")).toEqual([]);
});

it("a drunk or poisoned Exorcist: the card says the Demon is not affected, CHOSEN is placed, and no Wake row appears", () => {
  show(impair(proofGame(ROLES), "p0", "poisoned"));
  expect(screen.getByText("Player 0 is drunk or poisoned: the choice is made, but the Demon is not affected.")).toBeInTheDocument();
  tap("p2");
  expect(chosenOn("p2")).toHaveLength(1);
  expect(screen.queryByRole("group", { name: "Wake Player 2" })).toBeNull();
});

it("the first night has no Exorcist step", () => {
  const g = proofGame(ROLES, "night", 1);
  openInStore(g);
  render(<StrictMode><Guide /></StrictMode>);
  expect(screen.queryByText("Choose a player")).toBeNull();
});

it("privacy: once tokens are hidden nothing about the pick stays on screen", () => {
  show();
  tap("p2");
  expect(document.body.textContent).toContain("Selected You");
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  const after = document.body.textContent ?? "";
  for (const word of ["Selected You", "Exorcist", "Then point", "Wake Player 2"]) expect(after, word).not.toContain(word);
});
