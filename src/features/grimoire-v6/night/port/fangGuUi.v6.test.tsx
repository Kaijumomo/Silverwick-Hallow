// SV-2b -- the Fang Gu's Night step in the existing Night panel: tapped on the board like the Imp's; the jump is one commit; once ONCE
// is recorded the Fang Gu's row says so in the card's existing note line.
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
import { openInStore, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
function Guide() { const g = store(s => s.game)!; return <ModernNightPanel game={g} script={proofScript} visible onClose={() => {}} />; }
const tap = (id: string) => act(() => { pickSeatIfPicking(game(), id); });
// p0 fanggu, p1 sweetheart, p2 chef, p3 monk, p4 mutant
const ROLES = ["fanggu", "sweetheart", "chef", "monk", "mutant"];
function show(g: StorytellerLobbyRecord, actor = "p0") {
  openInStore(g);
  useShellStore.getState().setNightCursor({ day: g.day, stepKey: participantStepKey(g.players[actor]!.participantId!, "fanggu") });
  return render(<StrictMode><Guide /></StrictMode>);
}
beforeEach(() => { localStorage.clear(); store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [] }); useSessionRuntime.setState({ backend: null, status: "idle" }); useShellStore.getState().reset(); usePrivacyStore.setState({ enabled: false }); useTargetPicker.getState().cancel(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("tapping the first Outsider: the Fang Gu dies, the Outsider becomes the evil Fang Gu, ONCE is recorded, in one commit", () => {
  show(proofGame(ROLES));
  expect(useTargetPicker.getState().active?.label).toBe("Choose a player to kill");
  tap("p4");
  expect(game().players.p0!.alive).toBe(false);
  expect(game().players.p4).toMatchObject({ alive: true, actualRole: "fanggu", actualAlignment: "evil" });
  expect(game().gameRuleFacts.map((f) => f.type)).toEqual(["fangGuOnce"]);
  expect(store.getState().undoStack).toHaveLength(1);
  act(() => { store.getState().undo(); });
  expect(game().players.p4!.actualRole).toBe("mutant");
  expect(game().gameRuleFacts).toEqual([]);
});

it("the next night, the new Fang Gu's card says ONCE is recorded; its Outsider kill is an ordinary death", () => {
  show(proofGame(ROLES)); tap("p4"); cleanup();
  const next = { ...game(), day: 3 };
  show(next, "p4");
  expect(screen.getByText(/ONCE: a Fang Gu has already taken an Outsider's place\. An Outsider it kills now dies\./)).toBeInTheDocument();
  tap("p1");
  expect(game().players.p1).toMatchObject({ alive: false, actualRole: "sweetheart" });
});
