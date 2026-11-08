// A dead Moonchild still has to choose: the Day button carries the same discreet "!" as End until they have.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "../GrimoireV6Screen";
import { useV6Ui } from "../v6Store";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { useShellStore } from "@/stores/shellStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useTargetPicker } from "@/features/abilities/abilityUi";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { LifeEvent } from "@/stores/types";

const ROLES = ["godfather", "saint", "chef", "moonchild", "imp", "empath", "baron"];
const badge = () => screen.queryByLabelText("A Day action is waiting");

beforeEach(() => {
  vi.useFakeTimers();
  const base = proofGame(ROLES, "day", 3);
  const died = { id: "d-day", kind: "death", moment: { phase: "day", day: 3 }, actualRoleAtEvent: "moonchild",
    subject: { kind: "participant", playerId: "p3", participantId: base.players.p3!.participantId!, nameAtTime: "Player 3" } } as LifeEvent;
  store.setState({ game: { ...patchPlayer(base, "p3", { alive: false }), lifeEventWindow: { ...base.lifeEventWindow, events: [died] } }, lobby: null, undoStack: [], localSeq: 0,
    customScripts: { [proofScript.id]: proofScript } });
  useSessionRuntime.setState({ backend: null });
  useShellStore.getState().reset();
  useV6Ui.getState().reset();
  usePrivacyStore.setState({ enabled: false });
  useTargetPicker.getState().cancel();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("shows the '!' on the Day button while the Moonchild's choice is pending, and removes it once they have chosen", () => {
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
  expect(badge()).toBeInTheDocument();
  expect(badge()!.closest("button")).toHaveTextContent("Day");
  // Once the choice is recorded (the Moonchild's own Effect on the chosen player) the cue goes.
  const g = store.getState().game!;
  const p3 = g.players.p3!;
  act(() => {
    store.setState({ game: { ...g, players: { ...g.players, p2: { ...g.players.p2!, effects: [{ id: "mc1", type: "moonchildChoice", sourceCharacter: "moonchild", lifetime: { kind: "untilDawn" }, state: "active",
      sourceParticipant: { kind: "participant", playerId: "p3", participantId: p3.participantId!, nameAtTime: "Player 3" },
      expiry: { kind: "at", moment: { phase: "day", day: 4 } }, appliedAt: { phase: "day", day: 3 } }] } } } as never });
  });
  expect(badge()).toBeNull();
});

it("shows nothing when no dead Moonchild is waiting", () => {
  store.setState({ game: proofGame(ROLES, "day", 3) });
  render(<VotingProvider><GrimoireV6Screen /></VotingProvider>);
  expect(badge()).toBeNull();
});

