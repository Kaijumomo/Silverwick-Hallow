import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ModernNightPanel } from "./testGuide";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { impair, openInStore, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function show() {
  const g = game(); const work = deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  const row = work.steps.find(step => step.kind === "player" && step.playerId === "p0")!;
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: row.stepKey });
  return render(<StrictMode><Guide /></StrictMode>);
}
function ravenkeeper(impaired = false, simulated = false) {
  let g = proofGame([simulated ? "drunk" : "ravenkeeper", "imp", "chef", "monk", "baron"]);
  if (simulated) g.players.p0 = { ...g.players.p0!, shownRole: "ravenkeeper", behaviorMode: "drunk_fake_role_behavior" };
  if (impaired) g = impair(g, "p0"); openInStore(g);
  expect(store.getState().resolveLife({ intents: [{ kind: "death", playerId: "p0" }] })).toMatchObject({ ok: true });
  store.setState({ undoStack: [] }); return show();
}
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
const reveal = () => fireEvent.click(screen.getByRole("button", { name: "Reveal a Token" }));
const close = () => fireEvent.click(screen.getByRole("button", { name: "Return to Grimoire" }));
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.getState().reset(); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("independent: dead Ravenkeeper can target itself and the intentional reveal contains no actor identity", () => {
  ravenkeeper(); tap("p0");
  const dialog = screen.getByRole("dialog", { name: "This Character" }); expect(dialog).toHaveTextContent("Ravenkeeper");
  expect(dialog).not.toHaveTextContent("Player 0"); expect(dialog).not.toHaveTextContent("actually");
  expect(within(dialog).queryByText(/poison|drunk/i)).toBeNull();
  expect(game().informationDeliveries).toHaveLength(1);
});

it("independent: Privacy while selecting an impaired token unmounts the chooser and produces no delivery", () => {
  ravenkeeper(true); tap("p2"); const before = game(); expect(screen.getByText(/choose a character to show/)).toBeInTheDocument();
  act(() => usePrivacyStore.getState().setEnabled(true)); expect(screen.queryByText(/choose a character to show/)).toBeNull(); expect(screen.queryByRole("dialog")).toBeNull();
  expect(game()).toBe(before); expect(game().informationDeliveries).toEqual([]);
});

it("independent: storage failure at token choice cannot reveal or consume the Ravenkeeper event", () => {
  ravenkeeper(true); tap("p2"); const before = game();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  fireEvent.click(screen.getByRole("button", { name: "Chef" }));
  expect(game()).toBe(before); expect(screen.getByText(/choose a character to show/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Return to Grimoire" })).toBeNull(); expect(store.getState().undoStack).toEqual([]);
});

it("independent: reopening a completed Drunk simulation reveals its recorded choice without rerunning a trigger", () => {
  const view = ravenkeeper(false, true); expect(useTargetPicker.getState().active).toBeNull(); reveal(); tap("p2");
  fireEvent.click(screen.getByRole("button", { name: "Baron" })); close(); const accepted = game();
  view.unmount(); show(); expect(useTargetPicker.getState().active).toBeNull(); reveal();
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Baron"); expect(game()).toBe(accepted);
  expect(game().informationDeliveries).toHaveLength(1); expect(Object.keys(game().nightProgress).some(key => key.includes("trigger"))).toBe(false);
});

it("independent: a corrected event masks an open safe reveal instead of displaying stale character information", () => {
  ravenkeeper(); tap("p2"); const accepted = game();
  act(() => { store.getState().resolveLife({ intents: [{ kind: "retractEvent", eventId: accepted.lifeEventWindow.events[0]!.id }] }); });
  const dialog = screen.queryByRole("dialog"); if (dialog) expect(dialog).not.toHaveTextContent("Chef");
  expect(screen.queryByRole("heading", { name: "Chef" })).toBeNull();
});

it("independent: a genuine second Ravenkeeper death receives a distinct unconsumed Night row", () => {
  ravenkeeper(); const firstCursor = useShellStore.getState().nightCursor!.stepKey; tap("p2"); close();
  act(() => {
    expect(store.getState().resolveLife({ intents: [{ kind: "resurrection", playerId: "p0" }] })).toMatchObject({ ok: true });
    expect(store.getState().resolveLife({ intents: [{ kind: "death", playerId: "p0" }] })).toMatchObject({ ok: true });
  });
  const work = deriveNightWork(game(), { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  const second = work.steps.find(step => step.kind === "player" && step.playerId === "p0")!;
  expect(second.stepKey).not.toBe(firstCursor); expect(game().nightProgress[`${game().day}:${second.stepKey}`]?.status).not.toBe("done");
  act(() => useShellStore.getState().setNightCursor({ day: game().day, stepKey: second.stepKey }));
  expect(useTargetPicker.getState().active).not.toBeNull(); tap("p3");
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Monk"); expect(game().informationDeliveries).toHaveLength(2);
});

it("independent: manual Next on a second Ravenkeeper death cannot reuse the first death's delivered token", () => {
  const view = ravenkeeper(); tap("p2"); close();
  act(() => {
    store.getState().resolveLife({ intents: [{ kind: "resurrection", playerId: "p0" }] });
    store.getState().resolveLife({ intents: [{ kind: "death", playerId: "p0" }] });
  });
  const work = deriveNightWork(game(), { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  const second = work.steps.find(step => step.kind === "player" && step.playerId === "p0")!;
  act(() => useShellStore.getState().setNightCursor({ day: game().day, stepKey: second.stepKey }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(game().informationDeliveries).toHaveLength(1); view.unmount(); show();
  expect(screen.queryByRole("button", { name: "Reveal a Token" })).toBeNull();
});
