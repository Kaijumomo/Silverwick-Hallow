import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { impair, openInStore, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
function show() {
  const g = game();
  const work = deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
  const row = work.steps.find(step => step.kind === "player" && step.playerId === "p0");
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: row?.stepKey ?? participantStepKey(g.players.p0!.participantId!, g.players.p0!.shownRole!) });
  return render(<StrictMode><Guide /></StrictMode>);
}
function undertaker(roles = ["undertaker", "chef", "imp", "monk", "baron"], executed = true) {
  openInStore(proofGame(roles, "day", 1));
  if (executed) expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p1", outcome: "died" }] }).ok).toBe(true);
  store.getState().setPhase("night");
  store.setState({ undoStack: [] }); return show();
}
function ravenkeeper(roles: string[], dies = true) {
  openInStore(proofGame(roles));
  if (dies) expect(store.getState().resolveLife({ intents: [{ kind: "death", playerId: "p0" }] }).ok).toBe(true);
  store.setState({ undoStack: [] }); return show();
}
const reveal = () => fireEvent.click(screen.getByRole("button", { name: "Reveal a Token" }));
import { useV6Ui } from "../../v6Store";
beforeEach(() => { useV6Ui.getState().set({ picker: null }); localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const hasReveal = () => !!screen.queryByRole("button", { name: "Reveal a Token" });
it("manual game (an unreviewed character in play): the Undertaker still reveals the executed token", () => {
  undertaker(["undertaker", "chef", "imp", "monk", "sage"]); expect(hasReveal()).toBe(true);
  expect(screen.getByText("Chef")).toBeInTheDocument(); reveal();
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Chef");
  expect(game().informationDeliveries).toHaveLength(0);
});
it("manual game: an executed Recluse or Spy is the Storyteller's choice on the board picker", () => {
  for (const role of ["recluse", "spy"]) {
    cleanup(); undertaker(["undertaker", role, "imp", "monk", "baron"]); expect(hasReveal()).toBe(true);
    reveal(); expect(screen.getByText(/choose a character to show/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sage" }));
    expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Sage");
    expect(game().informationDeliveries).toHaveLength(0);
  }
});
it("manual game: a poisoned Undertaker gets no preview, only the picker", () => {
  undertaker(["undertaker", "chef", "imp", "monk", "sage"]); cleanup(); store.setState({ game: impair(game(), "p0") }); show();
  expect(hasReveal()).toBe(true); expect(screen.queryByText("Chef")).toBeNull(); reveal();
  expect(screen.getByText(/choose a character to show/)).toBeInTheDocument();
});
it("manual game: a Vortox in play means no preview, only the picker", () => {
  undertaker(["undertaker", "chef", "vortox", "monk", "baron"]); expect(hasReveal()).toBe(true); expect(screen.queryByText("Chef")).toBeNull(); reveal();
  expect(screen.getByText(/choose a character to show/)).toBeInTheDocument();
});
it("manual game: no execution means no reveal row", () => {
  undertaker(["undertaker", "chef", "imp", "monk", "sage"], false); expect(hasReveal()).toBe(false);
});
it("manual game: the Ravenkeeper gets the board picker", () => {
  ravenkeeper(["ravenkeeper", "imp", "chef", "monk", "sage"]); expect(hasReveal()).toBe(true);
  reveal(); expect(screen.getByText(/choose a character to show/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Mayor" }));
  expect(screen.getByRole("dialog", { name: "This Character" })).toHaveTextContent("Mayor");
});
it("manual game: a living Ravenkeeper has no reveal row", () => {
  ravenkeeper(["ravenkeeper", "imp", "chef", "monk", "sage"], false); expect(hasReveal()).toBe(false);
});
