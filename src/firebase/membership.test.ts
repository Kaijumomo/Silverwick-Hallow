import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { usePlayerStore } from "@/stores/playerStore";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { cancelJoinRequest, knockOnLobby, revokeMembership, seatPlayer } from "./lobby";
import { joinLobby, usePlayerSync } from "./playerSync";
import { useStorytellerSync } from "./storytellerSync";

beforeEach(() => {
  usePlayerStore.getState().reset();
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [] });
});
afterEach(cleanup);

describe("membership join-flow compatibility (real hooks, memory transport)", () => {
  it("waits for a request, then accepts a binding even when the name equals the player ID", async () => {
    const b = new MemoryRoomBackend();
    await b.set("lobbies/ROOM/public", { code: "ROOM", players: {}, seatOrder: [] });
    renderHook(() => usePlayerSync(b));
    expect(b.subscribePaths).not.toContain("lobbies/ROOM/public");

    await act(async () => { await joinLobby(b, "ROOM", "bob", "p-alice"); });
    await waitFor(() => expect(usePlayerStore.getState().publicLobby).not.toBeNull());
    expect(usePlayerStore.getState().status).toBe("waiting");
    expect(usePlayerStore.getState().playerId).toBeNull();
    expect(b.subscribePaths).not.toContain("lobbies/ROOM/player/p-alice");

    await act(async () => {
      await seatPlayer(b, "ROOM", "bob", "p-alice", { shownRole: "chef", shownAlignment: "good" });
    });
    await waitFor(() => expect(usePlayerStore.getState().self?.shownRole).toBe("chef"));
    expect(usePlayerStore.getState().status).toBe("seated");
    expect(usePlayerStore.getState().playerId).toBe("p-alice");

    await act(async () => { await revokeMembership(b, "ROOM", "bob"); });
    expect(usePlayerStore.getState().playerId).toBeNull();
    expect(usePlayerStore.getState().self).toBeNull();
  });

  it("restores pending public access from the request after refresh", async () => {
    const b = new MemoryRoomBackend();
    await knockOnLobby(b, "ROOM", "bob", "Bob");
    await b.set("lobbies/ROOM/public", { code: "ROOM", players: {}, seatOrder: [] });
    usePlayerStore.getState().setSession({ code: "ROOM", uid: "bob", requestedName: "Bob" });
    renderHook(() => usePlayerSync(b));
    await waitFor(() => expect(usePlayerStore.getState().publicLobby).not.toBeNull());
    expect(usePlayerStore.getState().playerId).toBeNull();
  });

  it("Storyteller queues requests only, consumes seated requests, and removes cancelled requests", async () => {
    const b = new MemoryRoomBackend();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 5 });
    useStorytellerStore.getState().setLobby({ code: "ROOM", uid: "st", status: "live" });
    await b.set("lobbies/ROOM/roster/old-uid", "unknown-player-id");
    renderHook(() => useStorytellerSync(b));
    expect(useStorytellerStore.getState().game?.pendingPlayers).toEqual({});

    await act(async () => { await knockOnLobby(b, "ROOM", "bob", "Bob"); });
    expect(useStorytellerStore.getState().game?.pendingPlayers).toEqual({ bob: "Bob" });
    const seat = useStorytellerStore.getState().game!.seatOrder[0]!;
    await act(async () => {
      expect(useStorytellerStore.getState().assignPendingToSeat("bob", seat)).toBe(true);
      await seatPlayer(b, "ROOM", "bob", seat, null);
    });
    expect(useStorytellerStore.getState().game?.pendingPlayers).toEqual({});
    expect(await b.get("lobbies/ROOM/roster/bob")).toBe(seat);

    await act(async () => { await knockOnLobby(b, "ROOM", "eve", "Eve"); });
    expect(useStorytellerStore.getState().game?.pendingPlayers).toEqual({ eve: "Eve" });
    await act(async () => { await cancelJoinRequest(b, "ROOM", "eve"); });
    expect(useStorytellerStore.getState().game?.pendingPlayers).toEqual({});
  });
});
