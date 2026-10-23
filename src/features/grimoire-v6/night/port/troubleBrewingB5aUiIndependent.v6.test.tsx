import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "./testGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { impair, proofGame, proofScript } from "@/test/proofFixtures";
import { withRedHerring } from "@/test/redHerringFixture";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, customScripts: { [proofScript.id]: proofScript } });
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<Guide />);
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
beforeEach(() => { localStorage.clear(); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.getState().reset(); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("independent: failed healthy Chef save does not advance or mark the displayed information delivered", () => {
  const g = proofGame(["chef", "imp", "baron", "monk", "soldier"], "night", 1); open(g);
  const cursor = useShellStore.getState().nightCursor; const saved = localStorage.getItem("new-blood-st");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  next(); expect(game()).toBe(g); expect(useShellStore.getState().nightCursor).toEqual(cursor);
  expect(store.getState().undoStack).toEqual([]); expect(localStorage.getItem("new-blood-st")).toBe(saved);
  expect(screen.getByRole("alert")).toBeInTheDocument();
});

it("independent: Next with only one Fortune Teller target records no partial information", () => {
  const g = withRedHerring(proofGame(["fortuneteller", "imp", "baron", "monk", "soldier"]), "p4"); open(g);
  tap("p1"); const held = useTargetPicker.getState().active!; next();
  const continued = game(); expect(continued.informationDeliveries).toEqual([]); expect(continued.players).toEqual(g.players);
  act(() => held.onPick({ playerId: "p2", participantId: g.players.p2!.participantId! }));
  expect(game()).toBe(continued); expect(game().informationDeliveries).toEqual([]);
});

it("R1: relevant Recluse selected second exposes Yes/No and commits only the explicit answer", () => {
  const g = withRedHerring(proofGame(["fortuneteller", "recluse", "baron", "monk", "soldier"]), "p4"); open(g);
  tap("p2"); tap("p1"); expect(game()).toBe(g); expect(store.getState().undoStack).toEqual([]);
  expect(screen.getByRole("button", { name: "YES" })).toBeInTheDocument(); expect(useTargetPicker.getState().active).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "NO" }));
  expect(game().informationDeliveries).toHaveLength(1);
  expect(game().informationDeliveries[0]!.values).toContainEqual({ requirementId: "isDemon", kind: "boolean", value: false });
  expect(game().players).toEqual(g.players); expect(store.getState().undoStack).toHaveLength(1);
});

it("independent: Privacy removes a completed deliberately false answer from text and accessibility", () => {
  const g = impair(proofGame(["empath", "imp", "baron", "monk", "soldier"]), "p0"); open(g);
  fireEvent.click(screen.getByRole("button", { name: "2" })); expect(screen.getByLabelText("Information to communicate")).toHaveTextContent("2");
  const accepted = game(); act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByLabelText("Information to communicate")).toBeNull(); expect(screen.queryByText("Empath")).toBeNull();
  expect(screen.queryByText("Player 0")).toBeNull(); expect(game()).toBe(accepted);
});

it.each(["empath", "chef"])("R1: %s Recluse choice saves atomically, survives reload and Undo, and stays private", async role => {
  const g = proofGame([role, "recluse", "imp", "monk", "soldier"], "night", 1);
  const view = open(g);
  expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
  expect(game()).toBe(g); expect(game().informationDeliveries).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "1" }));
  const accepted = game(); const saved = localStorage.getItem("new-blood-st")!;
  expect(accepted.informationDeliveries).toHaveLength(1); expect(accepted.players).toEqual(g.players);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(accepted.nightProgress[`1:${participantStepKey(g.players.p0!.participantId!, role)}`]).toMatchObject({ status: "done" });
  act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByLabelText("Information to communicate")).toBeNull();
  view.unmount();
  await act(async () => { localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate(); });
  expect(game()).toEqual(accepted);
  act(() => store.getState().undo());
  expect(game().informationDeliveries).toEqual(g.informationDeliveries); expect(game().nightProgress).toEqual(g.nightProgress);
});

it("independent: reopening a manually completed unchosen picker never invents a result", () => {
  const g = impair(proofGame(["empath", "imp", "baron", "monk", "soldier"]), "p0"); const view = open(g); next();
  const completed = game(); view.unmount(); open(completed);
  expect(screen.queryByLabelText("Information to communicate")).toBeNull(); expect(game().informationDeliveries).toEqual([]);
  next(); expect(game().informationDeliveries).toEqual([]);
});
