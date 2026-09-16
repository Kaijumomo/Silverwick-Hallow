import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { useSessionRuntime } from "./storytellerSync";
import { useApplyTravelerChoices } from "./StorytellerSession";
import { rosterEntryPath } from "./paths";
import { travelerChoicePath } from "./lifecycle";

// Phase 9 Setup finalization B4: the player-side Traveler character choice
// is applied automatically, with no Storyteller click, through the exact
// same assignRole() command the Storyteller's own manual override uses.

function resetStores() {
  useStorytellerStore.setState({ game: null, undoStack: [], selectedPlayerId: null, lobby: null });
  useSessionRuntime.setState({ travelerChoices: {} });
}

beforeEach(resetStores);
afterEach(() => { cleanup(); resetStores(); });

describe("useApplyTravelerChoices", () => {
  it("applies an observed choice via assignRole and clears the Firebase request, with no Storyteller click", async () => {
    const backend = new MemoryRoomBackend();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice");
    useStorytellerStore.getState().setIsTraveler(playerId, true);
    await backend.set(rosterEntryPath("ROOM", "uid-alice"), playerId);
    useSessionRuntime.setState({ travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });

    renderHook(() => useApplyTravelerChoices(backend, "ROOM"));

    await waitFor(() => expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("thief"));
    await waitFor(async () => expect(await backend.get(travelerChoicePath("ROOM", "uid-alice"))).toBeUndefined());
  });

  it("never applies a choice for a player who is no longer a Traveler", async () => {
    const backend = new MemoryRoomBackend();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice"); // ordinary, never marked Traveler
    await backend.set(rosterEntryPath("ROOM", "uid-alice"), playerId);
    useSessionRuntime.setState({ travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });

    renderHook(() => useApplyTravelerChoices(backend, "ROOM"));

    await waitFor(async () => expect(await backend.get(travelerChoicePath("ROOM", "uid-alice"))).toBeUndefined());
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("");
  });

  it("skips unresolved requests without throwing", () => {
    const backend = new MemoryRoomBackend();
    useSessionRuntime.setState({ travelerChoices: { "uid-alice": { playerId: null, roleId: "thief" } } });
    expect(() => renderHook(() => useApplyTravelerChoices(backend, "ROOM"))).not.toThrow();
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("does nothing without a connected backend or code", () => {
    useSessionRuntime.setState({ travelerChoices: { "uid-alice": { playerId: "p1", roleId: "thief" } } });
    expect(() => renderHook(() => useApplyTravelerChoices(null, undefined))).not.toThrow();
  });
});
