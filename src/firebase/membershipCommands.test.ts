import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import type { Json } from "./backend";
import { joinRequestPath, playerPath, rosterEntryPath } from "./paths";
import {
  revokePlayerMembership,
  seatPlayer,
} from "./lobby";
import { revokePlayerAndCommit, seatPlayerAndCommit } from "./membershipCommands";
import { usePlayerSync } from "./playerSync";

class FailingUpdateBackend extends MemoryRoomBackend {
  async update(_updates: Record<string, Json>): Promise<void> {
    throw new Error("offline");
  }
}

function resetStores() {
  useStorytellerStore.setState({
    game: null,
    view: "home",
    undoStack: [],
    selectedPlayerId: null,
    pendingKnocks: [],
    lobby: null,
  });
  usePlayerStore.getState().reset();
}

function prepareSeat(uid = "uid-alice") {
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
  const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
  useStorytellerStore.getState().addToPendingQueue(uid, "Alice");
  return { uid, playerId };
}

describe("membership commands", () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it("seats a pending player remotely before committing the local seat", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();

    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );

    expect(await backend.get(rosterEntryPath("ROOM", uid))).toBe(playerId);
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(false);
    expect(useStorytellerStore.getState().game!.pendingPlayers).toEqual({});
  });

  it("leaves local state untouched when seating fails remotely", async () => {
    const backend = new FailingUpdateBackend();
    const { uid, playerId } = prepareSeat();

    await expect(
      seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
        useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
      ),
    ).rejects.toThrow("offline");
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(true);
    expect(useStorytellerStore.getState().game!.pendingPlayers).toEqual({ [uid]: "Alice" });
  });

  it("rejects a second UID attempting to claim an active seat", async () => {
    const backend = new MemoryRoomBackend();
    const { playerId } = prepareSeat("uid-first");
    await backend.set(rosterEntryPath("ROOM", "uid-first"), playerId);
    await backend.set(joinRequestPath("ROOM", "uid-second"), "Second");

    await expect(seatPlayer(backend, "ROOM", "uid-second", playerId, null)).rejects.toThrow(/already bound/);
    expect(await backend.get(rosterEntryPath("ROOM", "uid-second"))).toBeUndefined();
  });

  it("unseats a player by atomically revoking membership and clearing private data", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    await backend.set(playerPath("ROOM", playerId), { shownRole: "chef", shownAlignment: "good" });

    await revokePlayerAndCommit(backend, "ROOM", playerId, () =>
      useStorytellerStore.getState().unseatPlayer(playerId),
    );

    expect(await backend.get(rosterEntryPath("ROOM", uid))).toBeUndefined();
    expect(await backend.get(playerPath("ROOM", playerId))).toBeUndefined();
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(true);
  });

  it("removes a player after remote revocation and makes repeated revocation safe", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    await backend.set(playerPath("ROOM", playerId), { shownRole: "chef", shownAlignment: "good" });

    await revokePlayerAndCommit(backend, "ROOM", playerId, () =>
      useStorytellerStore.getState().removePlayer(playerId),
    );
    await expect(revokePlayerMembership(backend, "ROOM", playerId)).resolves.toEqual({ uid: null });

    expect(await backend.get(rosterEntryPath("ROOM", uid))).toBeUndefined();
    expect(await backend.get(playerPath("ROOM", playerId))).toBeUndefined();
    expect(useStorytellerStore.getState().game!.players[playerId]).toBeUndefined();
  });

  it("does not change local state when unseating or removing cannot reach Firebase", async () => {
    const backend = new FailingUpdateBackend();
    const { uid, playerId } = prepareSeat();
    await backend.set(rosterEntryPath("ROOM", uid), playerId);
    const player = useStorytellerStore.getState().game!.players[playerId]!;
    useStorytellerStore.setState({
      game: {
        ...useStorytellerStore.getState().game!,
        players: { ...useStorytellerStore.getState().game!.players, [playerId]: { ...player, name: "Alice", isEmpty: false } },
        pendingPlayers: {},
      },
    });

    await expect(revokePlayerAndCommit(backend, "ROOM", playerId, () =>
      useStorytellerStore.getState().unseatPlayer(playerId),
    )).rejects.toThrow("offline");
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(false);

    await expect(revokePlayerAndCommit(backend, "ROOM", playerId, () =>
      useStorytellerStore.getState().removePlayer(playerId),
    )).rejects.toThrow("offline");
    expect(useStorytellerStore.getState().game!.players[playerId]).toBeDefined();
  });

  it("keeps membership-affecting changes out of generic undo while ordinary edits remain undoable", () => {
    const { uid, playerId } = prepareSeat();
    const before = useStorytellerStore.getState().undoStack.length;
    useStorytellerStore.getState().addPlayer("Before membership");
    expect(useStorytellerStore.getState().undoStack).toHaveLength(before + 1);
    expect(useStorytellerStore.getState().assignPendingToSeat(uid, playerId)).toBe(true);
    expect(useStorytellerStore.getState().undoStack).toHaveLength(before);
    expect(useStorytellerStore.getState().unseatPlayer(playerId)).toBe(true);
    expect(useStorytellerStore.getState().undoStack).toHaveLength(before);
    useStorytellerStore.getState().undo();
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(true);

    useStorytellerStore.getState().addPlayer("Bob");
    expect(useStorytellerStore.getState().undoStack).toHaveLength(before + 1);
    useStorytellerStore.getState().undo();
    expect(Object.values(useStorytellerStore.getState().game!.players)).toHaveLength(2);
  });

  it("moves an already-seated client to a controlled removed state after revocation", async () => {
    const backend = new MemoryRoomBackend();
    const uid = "uid-alice";
    const playerId = "p-alice";
    await backend.set(rosterEntryPath("ROOM", uid), playerId);
    await backend.set(playerPath("ROOM", playerId), { shownRole: "chef", shownAlignment: "good" });
    usePlayerStore.getState().setSession({ code: "ROOM", uid, requestedName: "Alice" });

    renderHook(() => usePlayerSync(backend));
    await waitFor(() => expect(usePlayerStore.getState().playerId).toBe(playerId));

    await act(async () => {
      await revokePlayerMembership(backend, "ROOM", playerId);
    });
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("error"));
    expect(usePlayerStore.getState().error).toBe("Removed from lobby.");
    expect(usePlayerStore.getState().playerId).toBeNull();
    expect(usePlayerStore.getState().self).toBeNull();
  });
});
