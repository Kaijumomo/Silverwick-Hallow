// Phase 10C: Reminders are Storyteller-private notation. Ported from the retired reminderUi test (Package 4): the
// public and self projections (all the Public Display renders from) never carry a Reminder label, note or cue.
import { beforeEach, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: setupGame(["chef", "poisoner", "monk"], { phase: "night", day: 2 }), lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
});

it("no Reminder data reaches the public or self projections", () => {
  const game = () => store.getState().game!;
  const bind = (id: string) => ({ playerId: id, participantId: game().players[id]!.participantId! });
  store.getState().resolveReminders({ intents: [{ kind: "place", target: bind("p2"), reminder: { label: "SECRET-LABEL", note: "SECRET-NOTE", source: bind("p0"),
    sourceCharacter: "fortuneteller", cleanup: { kind: "nextPhase" } } } as never] });
  expect(game().players.p2!.reminders).toHaveLength(1);
  const pub = JSON.stringify(projectLobbyToPublic(game(), {}));
  const self = JSON.stringify(projectLobbyToSelfMap(game(), buildRegistry(setupScript)));
  for (const leak of ["SECRET-LABEL", "SECRET-NOTE", "reminders", "cleanupCue", "createdAt"]) {
    expect(pub).not.toContain(leak);
    expect(self).not.toContain(leak);
  }
});
