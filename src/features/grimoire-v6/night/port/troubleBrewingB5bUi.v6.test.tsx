import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "./testGuide";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { impair, openInStore, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const next = () => fireEvent.click(screen.getByRole("button", { name: "Next" }));
function show() {
  const g = game();
  const work = deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  const row = work.steps.find(step => step.kind === "player" && step.playerId === "p0");
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: row?.stepKey ?? participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
function undertaker(poisoned = false) {
  openInStore(proofGame(["undertaker", "chef", "imp", "monk", "baron"], "day", 1));
  expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p1", outcome: "died" }] }).ok).toBe(true);
  store.getState().setPhase("night");
  if (poisoned) store.setState({ game: impair(game(), "p0") });
  store.setState({ undoStack: [] }); return show();
}
function ravenkeeper(poisoned = false, simulated = false) {
  const g = proofGame([simulated ? "drunk" : "ravenkeeper", "imp", "chef", "monk", "baron"]);
  if (simulated) g.players.p0 = { ...g.players.p0!, shownRole: "ravenkeeper", behaviorMode: "drunk_fake_role_behavior" };
  openInStore(poisoned ? impair(g, "p0") : g);
  expect(store.getState().resolveLife({ intents: [{ kind: "death", playerId: "p0" }] }).ok).toBe(true);
  store.setState({ undoStack: [] }); return show();
}
const reveal = () => fireEvent.click(screen.getByRole("button", { name: "Reveal a Token" }));
const closeReveal = () => fireEvent.click(screen.getByRole("button", { name: "Return to Grimoire" }));
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("Undertaker deliberately reveals the verified token with one delivery and Undo", () => {
  undertaker(); expect(game().informationDeliveries).toHaveLength(0); reveal();
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Chef");
  expect(game().informationDeliveries.at(-1)?.values).toContainEqual({ requirementId: "role", kind: "role", roleId: "chef" });
  expect(store.getState().undoStack).toHaveLength(1); closeReveal(); const accepted = game(); next(); expect(game()).toBe(accepted);
});
it("impaired Undertaker uses the existing character chooser and can show a true token", () => {
  undertaker(true); reveal(); expect(game().informationDeliveries).toHaveLength(0);
  expect(screen.getByRole("searchbox", { name: "Search chooser characters" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Chef" }));
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Chef");
  expect(game().informationDeliveries).toHaveLength(1);
});
it("Next without a character reveal never claims that information was delivered", () => {
  undertaker(); next(); expect(game().informationDeliveries).toHaveLength(0);
});
it("Ravenkeeper's real Night death leads from board target to the existing reveal", () => {
  ravenkeeper(); expect(useTargetPicker.getState().active).not.toBeNull(); tap("p2");
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Chef");
  expect(game().informationDeliveries).toHaveLength(1); expect(store.getState().undoStack).toHaveLength(1);
  closeReveal(); const accepted = game(); reveal(); closeReveal(); next(); expect(game()).toBe(accepted);
});
it("impaired Ravenkeeper targets first, then chooses any script token without granting its mechanics", () => {
  ravenkeeper(true); const before = game(); tap("p2"); expect(game()).toBe(before);
  fireEvent.click(screen.getByRole("button", { name: "Sage" }));
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Sage");
  expect(game().players).toEqual(before.players);
  expect(game().informationDeliveries.at(-1)?.values).toContainEqual({ requirementId: "role", kind: "role", roleId: "sage" });
});
it("Drunk shown Ravenkeeper waits for manual initiation and shares the reveal workflow", () => {
  ravenkeeper(false, true); expect(useTargetPicker.getState().active).toBeNull(); const before = game();
  reveal(); expect(game()).toBe(before); tap("p2"); fireEvent.click(screen.getAllByRole("button", { name: "Imp" }).at(-1)!);
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Imp");
  expect(game().informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "ravenkeeper", provenance: { reason: "manual" } });
  expect(game().lifeEventWindow).toEqual(before.lifeEventWindow);
  expect(Object.keys(game().nightProgress).some(key => key.includes("trigger"))).toBe(false);
  closeReveal(); next(); expect(game().informationDeliveries).toHaveLength(1);
});
it("the target tap's compatibility click cannot also select an impaired character token", () => {
  ravenkeeper(true); tap("p2"); const before = game();
  const token = screen.getByRole("button", { name: "Gossip" });
  fireEvent.click(token, { detail: 1 });
  expect(game()).toBe(before); expect(screen.getByRole("searchbox")).toBeInTheDocument();
  fireEvent.pointerDown(token, { pointerType: "touch", pointerId: 2 });
  fireEvent.click(token, { detail: 1 });
  expect(game().informationDeliveries).toHaveLength(1);
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Gossip");
});
it("Privacy Mode masks an open character reveal and cancels a pending chooser", () => {
  undertaker(); reveal(); act(() => usePrivacyStore.getState().setEnabled(true));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Chef" })).toBeNull();
});
it("a corrected execution invalidates the open Undertaker picker without delivery", () => {
  undertaker(true); reveal();
  act(() => store.setState({ game: { ...game(), lifeEventWindow: { ...game().lifeEventWindow!, events: [] } } }));
  expect(screen.queryByRole("searchbox")).toBeNull(); expect(game().informationDeliveries).toHaveLength(0);
});
it("failed persistence neither reveals nor completes Undertaker", () => {
  undertaker(); const before = game();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  reveal(); expect(game()).toBe(before); expect(screen.queryByRole("dialog")).toBeNull(); expect(screen.getByRole("alert")).toBeInTheDocument();
});
it("Undo of Ravenkeeper restores its exact opportunity and dismisses stale information", () => {
  ravenkeeper(); tap("p2"); closeReveal(); act(() => store.getState().undo());
  expect(game().informationDeliveries).toHaveLength(0); expect(useTargetPicker.getState().active).not.toBeNull();
});
