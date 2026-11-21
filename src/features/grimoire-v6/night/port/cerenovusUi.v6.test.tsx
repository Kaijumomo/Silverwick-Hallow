// SV-4a -- the Cerenovus's Night step in the existing Night panel, in the Philosopher card's language: the Storyteller taps a player on the
// board, then the board's character picker (Townsfolk and Outsiders, tokens only, no player names) commits at once (one Undo). Afterwards
// the card shows who is mad about which character and the "Wake" row with the two reveal tokens. https://wiki.bloodontheclocktower.com/Cerenovus
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
import { impair, openInStore, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
// p0 cerenovus, p1 imp, p2 chef, p3 empath, p4 witch
const ROLES = ["cerenovus", "imp", "chef", "empath", "witch"];
const stepKey = (g: StorytellerLobbyRecord) => participantStepKey(g.players.p0!.participantId!, "cerenovus");
function show(g = proofGame(ROLES)) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: stepKey(g) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const picker = () => useV6Ui.getState().picker;
const onPickOf = () => { const open = picker(); return open?.mode === "show" ? open.onPick : undefined; };
const pickCharacter = (roleId: string) => { let refusal: string | undefined; act(() => { refusal = onPickOf()?.(roleId) ?? undefined; }); return refusal; };
const madOn = (id: string) => game().players[id]!.effects.filter((e) => e.type === "mad");

beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); useV6Ui.getState().set({ picker: null }); useInfoShow.getState().clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("the card asks for a player on the board first; tapping one opens the character picker with tokens only and no player names", () => {
  show();
  expect(useTargetPicker.getState().active?.label).toBe("Choose a player");
  expect(picker()).toBeNull();
  tap("p2");
  expect(picker()).toMatchObject({ mode: "show", tokensOnly: true, title: "Choose a character", kicker: "The Cerenovus · a Townsfolk or an Outsider", types: ["townsfolk", "outsider"] });
  // Nothing is committed by the tap alone.
  expect(madOn("p2")).toEqual([]);
  expect(store.getState().undoStack).toHaveLength(0);
});

it("picking the character commits at once, in one Undo: MAD with the character, the step done, the card shows the pick and the Wake row", () => {
  show();
  tap("p2");
  expect(pickCharacter("sage")).toBeUndefined();
  expect(picker()).toBeNull();
  expect(madOn("p2")).toEqual([expect.objectContaining({ sourceCharacter: "cerenovus", parameters: { character: { kind: "role", roleIds: ["sage"] } } })]);
  expect(game().nightProgress[`2:${stepKey(game())}`]?.status).toBe("done");
  expect(store.getState().undoStack).toHaveLength(1);
  const slots = document.querySelector(".gv-choice-slots") as HTMLElement;
  expect(within(slots).getByText("Player 2")).toBeInTheDocument();
  expect(within(slots).getByText("Mad about being the Sage")).toBeInTheDocument();
  const row = screen.getByRole("group", { name: "Wake Player 2" });
  expect(within(row).getByRole("button", { name: "Wake Player 2: Selected You" })).toBeInTheDocument();
  expect(within(row).getByRole("button", { name: "Wake Player 2: This Character" })).toBeInTheDocument();
  expect(within(row).getByText("Cerenovus")).toBeInTheDocument();
  expect(within(row).getByText("Sage")).toBeInTheDocument();
  act(() => { store.getState().undo(); });
  expect(madOn("p2")).toEqual([]);
  expect(game().nightProgress[`2:${stepKey(game())}`]?.status).toBeUndefined();
  expect(screen.queryByRole("group", { name: "Wake Player 2" })).toBeNull();
});

it("the two tokens open the existing player-safe reveals: Selected You with the Cerenovus, then This Character with the madness character", () => {
  show();
  tap("p2");
  pickCharacter("sage");
  const row = screen.getByRole("group", { name: "Wake Player 2" });
  fireEvent.click(within(row).getByRole("button", { name: "Wake Player 2: Selected You" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "Selected You", roleId: "cerenovus" });
  expect(useInfoShow.getState().current?.payload).toMatchObject({ kind: "character", heading: "Selected You" });
  act(() => { useV6Ui.getState().set({ show: null }); });
  fireEvent.click(within(row).getByRole("button", { name: "Wake Player 2: This Character" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "This Character", roleId: "sage" });
  // Showing records nothing: no extra Undo step, the same game.
  expect(store.getState().undoStack).toHaveLength(1);
});

it("a reload keeps the pick on the card (it is read from MAD, not from the screen)", () => {
  show();
  tap("p2");
  pickCharacter("sage");
  cleanup();
  useShellStore.getState().setNightCursor({ day: 2, stepKey: stepKey(game()) });
  render(<StrictMode><Guide /></StrictMode>);
  expect(screen.getByText("Mad about being the Sage")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Wake Player 2" })).toBeInTheDocument();
});

it("a Minion or a Demon is refused inside the picker and nothing changes", () => {
  show();
  tap("p2");
  const before = game();
  expect(pickCharacter("witch")).toBe("Choose a Townsfolk or an Outsider of this script.");
  expect(pickCharacter("imp")).toBe("Choose a Townsfolk or an Outsider of this script.");
  expect(game()).toBe(before);
  expect(picker()).not.toBeNull();
});

it("a dead player may be chosen, and so may a Demon", () => {
  show(patchPlayer(proofGame(ROLES), "p3", { alive: false }));
  tap("p3");
  expect(pickCharacter("saint")).toBeUndefined();
  expect(madOn("p3")).toHaveLength(1);
});

it("a drunk or poisoned Cerenovus: the card says nobody goes mad, the pick is still made and shown, and no MAD is recorded", () => {
  show(impair(proofGame(ROLES), "p0", "poisoned"));
  expect(screen.getByText("Player 0 is drunk or poisoned: the choice is made, but nobody goes mad.")).toBeInTheDocument();
  tap("p2");
  expect(pickCharacter("sage")).toBeUndefined();
  expect(madOn("p2")).toEqual([]);
  expect(game().nightProgress[`2:${stepKey(game())}`]?.status).toBe("done");
  expect(screen.getByText("Mad about being the Sage: nobody goes mad")).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Wake Player 2" })).toBeInTheDocument();
});

it("Privacy Mode hides the card and refuses a pick that still arrives", () => {
  show();
  tap("p2");
  const onPick = onPickOf()!;
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  expect(screen.queryByText("Choose a player")).toBeNull();
  act(() => { onPick("sage"); });
  expect(madOn("p2")).toEqual([]);
});

it("every night from the first: the step is listed on Night 1 and Night 3", () => {
  for (const day of [1, 3]) {
    cleanup();
    const g = proofGame(ROLES, "night", day);
    useShellStore.getState().reset();
    show(g);
    expect(useTargetPicker.getState().active?.label).toBe("Choose a player");
  }
});

it("privacy: once tokens are hidden nothing about the madness stays on screen (the card, the Wake row, the MAD token)", () => {
  show();
  tap("p2");
  pickCharacter("sage");
  expect(document.body.textContent).toContain("Mad about being the Sage");
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  const after = document.body.textContent ?? "";
  for (const word of ["Mad about", "Sage", "Cerenovus", "Selected You", "This Character", "Wake Player 2"]) expect(after, word).not.toContain(word);
  expect(document.querySelector('[title*="Mad about"]')).toBeNull();
});
