// SV-4c -- the Evil Twin's Night step in the existing Night panel, in the Philosopher card's language: the "Wake" rows with each Twin's one
// reveal token, and Done; or, when the pair broke, the Storyteller taps the new Good Twin on the board. https://wiki.bloodontheclocktower.com/Evil_Twin
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
import { applyEffectPlan, planEffectTransaction } from "@/stores/effectResolution";
import { goodTwinIntents, twinMarkers, twinPairOf } from "@/stores/twinPair";
import { openInStore, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
// p0 eviltwin, p1 imp, p2 chef (the Good Twin), p3 empath, p4 saint
const ROLES = ["eviltwin", "imp", "chef", "empath", "saint"];
const stepKey = (g: StorytellerLobbyRecord) => participantStepKey(g.players.p0!.participantId!, "eviltwin");
function twinned(g: StorytellerLobbyRecord, good = "p2"): StorytellerLobbyRecord {
  const built = goodTwinIntents(g, { playerId: "p0", participantId: g.players.p0!.participantId! }, { playerId: good, participantId: g.players[good]!.participantId! });
  if (!built.ok) throw new Error(built.message);
  const result = planEffectTransaction(g, { intents: built.intents }, { historyId: () => `h-${good}`, effectId: () => `fx-${good}` });
  if (!result.ok || !result.changed) throw new Error("not a changing plan");
  return applyEffectPlan(g, result.plan);
}
function show(g = twinned(proofGame(ROLES, "night", 1))) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: stepKey(g) });
  return render(<StrictMode><Guide /></StrictMode>);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const markers = () => twinMarkers(game().players).map(({ holder }) => holder.id);

beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); useV6Ui.getState().set({ picker: null }); useInfoShow.getState().clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("a valid pair: one Wake row per Twin, each with its one reveal token -- the Evil Twin's character to the Good Twin, the Good Twin's character to the Evil Twin", () => {
  show();
  const toGood = screen.getByRole("group", { name: "Wake Player 2" });
  expect(within(toGood).getByRole("button", { name: "Wake Player 2: This Character" })).toBeInTheDocument();
  expect(within(toGood).getByText("Evil Twin")).toBeInTheDocument();
  const toEvil = screen.getByRole("group", { name: "Wake Player 0" });
  expect(within(toEvil).getByRole("button", { name: "Wake Player 0: This Character" })).toBeInTheDocument();
  expect(within(toEvil).getByText("Chef")).toBeInTheDocument();
  // Showing records nothing.
  fireEvent.click(within(toGood).getByRole("button", { name: "Wake Player 2: This Character" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "This Character", roleId: "eviltwin" });
  act(() => { useV6Ui.getState().set({ show: null }); });
  fireEvent.click(within(toEvil).getByRole("button", { name: "Wake Player 0: This Character" }));
  expect(useV6Ui.getState().show).toMatchObject({ kind: "char", title: "This Character", roleId: "chef" });
  expect(store.getState().undoStack).toHaveLength(0);
});

it("Done completes the step, in one Undo; a reload keeps the rows (derived), and the step is then done", () => {
  show();
  expect(game().nightProgress[`1:${stepKey(game())}`]?.status).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(game().nightProgress[`1:${stepKey(game())}`]?.status).toBe("done");
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  expect(store.getState().undoStack).toHaveLength(1);
  cleanup();
  useShellStore.getState().setNightCursor({ day: 1, stepKey: stepKey(game()) });
  render(<StrictMode><Guide /></StrictMode>);
  expect(screen.getByRole("group", { name: "Wake Player 2" })).toBeInTheDocument();
  act(() => { store.getState().undo(); });
  expect(game().nightProgress[`1:${stepKey(game())}`]?.status).toBeUndefined();
});

it("the Evil Twin is shown the Good Twin's TRUE character: a Drunk Good Twin shown as the Chef is the Drunk", () => {
  show(twinned(patchPlayer(proofGame(ROLES, "night", 1), "p2", { actualRole: "drunk", shownRole: "chef" })));
  expect(within(screen.getByRole("group", { name: "Wake Player 0" })).getByText("Drunk")).toBeInTheDocument();
});

it("a broken pair (both the same alignment): the card says so and asks for the new Good Twin; tapping the board moves the TWIN token in one Undo", () => {
  const broken = patchPlayer(twinned(proofGame(ROLES, "night", 1)), "p2", { actualAlignment: "evil" });
  show(broken);
  expect(screen.getByText("Both Twins are now the same alignment. Choose the new Good Twin.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Choose Good Twin" }));
  expect(useTargetPicker.getState().active?.label).toBe("the new Good Twin");
  // An evil player or the Evil Twin cannot be tapped; a good player can.
  tap("p1");
  expect(markers()).toEqual(["p2"]);
  tap("p3");
  expect(markers()).toEqual(["p3"]);
  expect(twinPairOf(game().players)).toMatchObject({ valid: true });
  expect(store.getState().undoStack).toHaveLength(1);
  expect(screen.getByRole("group", { name: "Wake Player 3" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  act(() => { store.getState().undo(); });
  expect(markers()).toEqual(["p2"]);
});

it("no Good Twin chosen at all (a Pit-Hag-made Evil Twin): the card asks for one", () => {
  show(proofGame(ROLES, "night", 2));
  expect(screen.getByText("No player is marked as the Good Twin. Choose the new Good Twin.")).toBeInTheDocument();
});

it("Privacy Mode hides the card and every reveal on it", () => {
  show();
  expect(screen.getByRole("group", { name: "Wake Player 2" })).toBeInTheDocument();
  act(() => { usePrivacyStore.setState({ enabled: true }); });
  const after = document.body.textContent ?? "";
  for (const word of ["Wake Player 2", "Wake Player 0", "Evil Twin", "This Character", "Done"]) expect(after, word).not.toContain(word);
});
