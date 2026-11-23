// SV-5k -- the Vortox's Night step in the existing Night panel: tapped on the board like the Imp's; the death, the Vortox's DEAD token
// and the step's Completed pill in one commit (one Undo). Drunk or poisoned: the choice is made and nobody dies.
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ModernNightPanel } from "@/test/nightTestGuide";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { pickSeatIfPicking, useTargetPicker } from "@/features/abilities/abilityUi";
import { impair, openInStore, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
// p0 vortox, p1 clockmaker, p2 monk, p3 sage, p4 mutant
const ROLES = ["vortox", "clockmaker", "monk", "sage", "mutant"];
function show(g: StorytellerLobbyRecord) {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, "vortox") });
  return render(<StrictMode><Guide /></StrictMode>);
}
const deadTokens = (id: string) => game().players[id]!.reminders.filter((r) => r.label === "Dead" && r.sourceCharacter === "vortox");
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("Night 2: one tap on the board kills, places the Vortox's DEAD token and shows Completed; Undo takes it all back", () => {
  show(proofGame(ROLES));
  expect(useTargetPicker.getState().active?.label).toBe("Choose a player to kill");
  tap("p1");
  expect(game().players.p1!.alive).toBe(false);
  expect(deadTokens("p1")).toHaveLength(1);
  expect(screen.getByText("Completed")).toBeInTheDocument();
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => { store.getState().undo(); });
  expect(game().players.p1!.alive).toBe(true);
  expect(deadTokens("p1")).toHaveLength(0);
});

it("a poisoned Vortox: the tap is recorded and nobody dies", () => {
  show(impair(proofGame(ROLES), "p0"));
  tap("p1");
  expect(game().players.p1!.alive).toBe(true);
  expect(deadTokens("p1")).toHaveLength(0);
});
