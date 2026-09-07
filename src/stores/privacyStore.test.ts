import { beforeEach, describe, expect, it } from "vitest";
import { usePrivacyStore } from "./privacyStore";
import { useStorytellerStore as storyteller } from "./storytellerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { projectToPublic, projectToSelf } from "./projections";

beforeEach(() => {
  usePrivacyStore.setState({ enabled: false });
  storyteller.setState({ game: null, lobby: null, undoStack: [] });
});

describe("Storyteller privacy presentation state", () => {
  it("toggles independently of the game and undo history", () => {
    storyteller.getState().newGame("tb");
    storyteller.getState().addPlayer("Alice");
    const before = structuredClone(storyteller.getState().game);
    const undoCount = storyteller.getState().undoStack.length;

    usePrivacyStore.getState().setEnabled(true);

    expect(usePrivacyStore.getState().enabled).toBe(true);
    expect(storyteller.getState().game).toEqual(before);
    expect(storyteller.getState().undoStack).toHaveLength(undoCount);
  });

  it("reveals current state after hidden updates and resets for a new game", () => {
    storyteller.getState().newGame("tb");
    storyteller.getState().addPlayer("Alice");
    const id = storyteller.getState().game!.seatOrder[0]!;
    usePrivacyStore.getState().setEnabled(true);

    storyteller.getState().assignRole(id, "chef");
    storyteller.getState().setReminders(id, ["Updated while hidden"]);
    expect(usePrivacyStore.getState().enabled).toBe(true);

    usePrivacyStore.getState().setEnabled(false);
    expect(storyteller.getState().game!.players[id]!.actualRole).toBe("chef");
    expect(storyteller.getState().game!.players[id]!.reminders).toEqual(["Updated while hidden"]);

    usePrivacyStore.getState().setEnabled(true);
    storyteller.getState().newGame("tb");
    expect(usePrivacyStore.getState().enabled).toBe(false);
  });

  it("does not alter player or public projections", () => {
    storyteller.getState().newGame("tb");
    storyteller.getState().addPlayer("Alice");
    const id = storyteller.getState().game!.seatOrder[0]!;
    storyteller.getState().assignRole(id, "chef");
    storyteller.getState().setShownRole(id, "chef");
    const player = storyteller.getState().game!.players[id]!;
    const registry = buildRegistry(troubleBrewing);
    const self = projectToSelf(player, registry);
    const publicView = projectToPublic(player, true);

    usePrivacyStore.getState().setEnabled(true);

    expect(projectToSelf(player, registry)).toEqual(self);
    expect(projectToPublic(player, true)).toEqual(publicView);
  });
});
