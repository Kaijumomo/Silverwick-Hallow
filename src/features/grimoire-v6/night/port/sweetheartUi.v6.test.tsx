// SV-1b -- the Sweetheart's Night step in the existing Night panel (the ability workspace), and Undo.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { bind, openInStore, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const rows = (g = game()) => deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS }).steps
  .filter(step => step.kind === "player" && step.playerId === "p0");
function show() {
  const row = rows()[0];
  expect(row).toBeDefined();
  useShellStore.getState().setNightCursor({ day: game().day, stepKey: row!.stepKey });
  return render(<StrictMode><Guide /></StrictMode>);
}
// p0 sweetheart, p1 imp, p2 chef, p3 monk, p4 empath
const ROLES = ["sweetheart", "imp", "chef", "monk", "empath"];
function demonKill() {
  openInStore(proofGame(ROLES));
  expect(store.getState().resolveAbility(request(game(), "p1", "imp", { target: { kind: "participant", participants: [bind(game(), "p0")] } }))).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [] });
}
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const drunk = () => game().players.p2!.effects.filter(e => e.type === "drunk" && e.sourceCharacter === "sweetheart");

it("killed tonight: her step asks for the player who becomes drunk; one tap applies the DRUNK token; Undo removes it", () => {
  demonKill(); show();
  expect(screen.getAllByText("Choose a player to be drunk from now on").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Continue action" }));
  expect(screen.getAllByText("The player who becomes drunk").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "Player 2 seat 3" }));
  expect(drunk()).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Seat 3, Player 2, Chef, 1 reminder" })).toBeInTheDocument();
  expect(store.getState().undoStack).toHaveLength(1);
  store.getState().undo();
  expect(drunk()).toHaveLength(0);
});

it("the Night list shows her step only on the night she died (or after a Day death not yet resolved)", () => {
  openInStore(proofGame(ROLES)); expect(rows()).toHaveLength(0);
  demonKill(); expect(rows()).toHaveLength(1);
  openInStore(proofGame(ROLES, "day", 1));
  expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }).ok).toBe(true);
  store.getState().setPhase("night"); expect(rows()).toHaveLength(1);
});
