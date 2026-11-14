// SV-1a -- the Sage's Night step in the existing Night panel (board picker, QuestionBlock, Undo).
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { bind, impair, openInStore, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
function show() {
  const g = game();
  const work = deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  const row = work.steps.find(step => step.kind === "player" && step.playerId === "p0");
  expect(row).toBeDefined();
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: row?.stepKey ?? participantStepKey(g.players.p0!.participantId!, "sage") });
  return render(<StrictMode><Guide /></StrictMode>);
}
// p0 sage, p1 imp, p2 chef, p3 monk, p4 empath
const ROLES = ["sage", "imp", "chef", "monk", "empath"];
function demonKill(poisoned = false) {
  const g = proofGame(ROLES);
  openInStore(poisoned ? impair(g, "p0") : g);
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [] }); return show();
}
function handDeath() {
  openInStore(proofGame(ROLES));
  expect(store.getState().resolveLife({ intents: [{ kind: "death", playerId: "p0" }] }).ok).toBe(true);
  store.setState({ undoStack: [] }); return show();
}
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("killed by the Demon: the board picker asks for two players and refuses a pair without the Demon", () => {
  demonKill();
  expect(useTargetPicker.getState().active?.label ?? "").toContain("Point at two players, one of them the Demon");
  expect(screen.getByText("Point at two players, one of them the Demon")).toBeInTheDocument();
  tap("p2"); tap("p3");
  expect(screen.getByRole("alert")).toHaveTextContent("One of the two must be the Demon that killed the Sage.");
  expect(game().informationDeliveries).toHaveLength(0);
  tap("p2"); tap("p1");
  expect(game().informationDeliveries).toHaveLength(1);
  expect(game().informationDeliveries.at(-1)).toMatchObject({ actualRole: "sage", informationActionId: "sage-triggered" });
  expect(store.getState().undoStack).toHaveLength(1);
  expect(screen.getByText("Completed")).toBeInTheDocument();
});

it("a poisoned Sage: any two players are accepted", () => {
  demonKill(true); tap("p2"); tap("p3");
  expect(game().informationDeliveries).toHaveLength(1);
});

it("a death entered by hand: the Storyteller answers first; No closes the step with nothing delivered", () => {
  handDeath();
  expect(screen.getByText(`Did the Demon kill ${game().players.p0!.name}?`)).toBeInTheDocument();
  expect(screen.getByText("Silverwick did not record what killed the Sage. The Sage wakes only if the Demon killed them.")).toBeInTheDocument();
  expect(useTargetPicker.getState().active).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "No" }));
  expect(game().informationDeliveries).toHaveLength(0);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(screen.getByText("Completed")).toBeInTheDocument();
});

it("a death entered by hand: Yes opens the board picker; one of the two must be able to register as the Demon", () => {
  handDeath();
  fireEvent.click(screen.getByRole("button", { name: "Yes" }));
  expect(useTargetPicker.getState().active).not.toBeNull();
  tap("p2"); tap("p3");
  expect(screen.getByRole("alert")).toHaveTextContent("One of the two must be the Demon that killed the Sage.");
  expect(screen.queryByText(`Did the Demon kill ${game().players.p0!.name}?`)).toBeNull();
  tap("p1"); tap("p2");
  expect(game().informationDeliveries).toHaveLength(1);
  store.getState().undo();
  expect(game().informationDeliveries).toHaveLength(0);
});

it("the Night list shows the Sage only on the night the Demon killed them", () => {
  const steps = (g = game()) => deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS }).steps
    .filter(step => step.kind === "player" && step.playerId === "p0");
  openInStore(proofGame(ROLES)); expect(steps()).toHaveLength(0);
  cleanup(); demonKill(); expect(steps()).toHaveLength(1);
});
