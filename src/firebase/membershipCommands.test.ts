import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import type { Json } from "./backend";
import { joinRequestPath, playerPath, rosterEntryPath, rosterParticipantPath } from "./paths";
import { selectSetupContext } from "@/features/setup/setupContext";
import { needsShownIdentity } from "@/stores/identity";
import { newParticipantId } from "@/stores/participants";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { leavePath, travelerChoicePath } from "./lifecycle";
import {
  revokePlayerMembership,
  seatPlayer,
} from "./lobby";
import { acceptLeaveRequest, applyTravelerChoice, rejectLeaveRequest, revokePlayerAndCommit, seatPlayerAndCommit } from "./membershipCommands";
import { usePlayerSync } from "./playerSync";

class FailingUpdateBackend extends MemoryRoomBackend {
  async update(_updates: Record<string, Json>): Promise<void> {
    throw new Error("offline");
  }
}

class FailingSetBackend extends MemoryRoomBackend {
  async set(_path: string, _value: Json): Promise<void> {
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

  it("Phase 9C.4: production seating (selfRecord=null) never seeds a player self identity during Setup", async () => {
    // Mirrors the production call site (SeatAssignPopup.tsx), which always
    // passes null here. Setup identity publication is governed exclusively
    // by the Phase 9C.4 projection barrier (projectLobbyToSelfMap), never by
    // seating itself — seatPlayer's selfRecord parameter remains structurally
    // capable of writing one directly, but production must never use it to.
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    expect(await backend.get(playerPath("ROOM", playerId))).toBeUndefined();
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
    await backend.set("lobbies/ROOM/session", { version: 2, id: "test-session", state: "active" });
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
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("revoked"));
    expect(usePlayerStore.getState().error).toBe("Removed from lobby.");
    expect(usePlayerStore.getState().playerId).toBeNull();
    expect(usePlayerStore.getState().self).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Phase 9C.3 (OPUS-003): explicit Storyteller accept/reject commands.
  // -------------------------------------------------------------------------

  it("accepts a leave request through the existing Firebase-first revocation path, preserving the seat as empty", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    await backend.set(playerPath("ROOM", playerId), { shownRole: "chef", shownAlignment: "good" });
    await backend.set(leavePath("ROOM", uid), true);

    await acceptLeaveRequest(backend, "ROOM", uid, (pid) => useStorytellerStore.getState().unseatPlayer(pid));

    expect(await backend.get(rosterEntryPath("ROOM", uid))).toBeUndefined();
    expect(await backend.get(playerPath("ROOM", playerId))).toBeUndefined();
    expect(await backend.get(leavePath("ROOM", uid))).toBeUndefined();
    expect(await backend.get("lobbies/ROOM/outcomes/" + uid)).toBe("revoked");
    // The seat itself survives as an empty/planned seat — never removed.
    expect(useStorytellerStore.getState().game!.players[playerId]).toBeDefined();
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(true);
  });

  it("acceptance always re-resolves uid -> playerId from the CURRENT roster, never a caller-assumed id", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId: firstSeat } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, firstSeat, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, firstSeat),
    );
    // An unrelated, genuinely occupied local seat with no uid binding at all
    // (a Storyteller-typed name) — this must never be touched.
    useStorytellerStore.getState().addPlayerToSeat("Bob");
    const secondSeat = useStorytellerStore.getState().game!.seatOrder.find(
      (id) => id !== firstSeat && !useStorytellerStore.getState().game!.players[id]!.isEmpty,
    )!;
    await backend.set(leavePath("ROOM", uid), true);
    // Simulate the live roster resolving this uid to a DIFFERENT seat than
    // whatever a caller might otherwise have assumed (firstSeat).
    await backend.set(rosterEntryPath("ROOM", uid), secondSeat);

    await acceptLeaveRequest(backend, "ROOM", uid, (pid) => useStorytellerStore.getState().unseatPlayer(pid));

    // The CURRENT (re-resolved) binding was revoked/unseated...
    expect(await backend.get(rosterEntryPath("ROOM", uid))).toBeUndefined();
    expect(useStorytellerStore.getState().game!.players[secondSeat]!.isEmpty).toBe(true);
    // ...while the original seat, never re-resolved to by this acceptance,
    // is untouched.
    expect(useStorytellerStore.getState().game!.players[firstSeat]!.isEmpty).toBe(false);
  });

  it("clears a stale leave request with no current roster binding without touching any local seat (stale cleanup)", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await backend.set(leavePath("ROOM", "uid-ghost"), true);
    let commitLocalCalled = false;

    await acceptLeaveRequest(backend, "ROOM", "uid-ghost", () => { commitLocalCalled = true; return true; });

    expect(commitLocalCalled).toBe(false);
    expect(await backend.get(leavePath("ROOM", "uid-ghost"))).toBeUndefined();
    // The unrelated pending player/seat is untouched.
    expect(useStorytellerStore.getState().game!.pendingPlayers).toEqual({ [uid]: "Alice" });
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(true);
  });

  it("repeated acceptance is safe once the binding is already resolved (idempotent)", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    await backend.set(leavePath("ROOM", uid), true);
    const commitLocal = (pid: string) => useStorytellerStore.getState().unseatPlayer(pid);

    await acceptLeaveRequest(backend, "ROOM", uid, commitLocal);
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(true);

    await expect(acceptLeaveRequest(backend, "ROOM", uid, commitLocal)).resolves.toBeUndefined();
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(true);
  });

  it("does not change the local seat when accepting a leave request cannot reach Firebase", async () => {
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

    await expect(
      acceptLeaveRequest(backend, "ROOM", uid, (pid) => useStorytellerStore.getState().unseatPlayer(pid)),
    ).rejects.toThrow("offline");
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(false);
  });

  it("rejects (\"keeps seated\") a leave request by clearing only leaveRequests/{uid}", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    await backend.set(playerPath("ROOM", playerId), { shownRole: "chef", shownAlignment: "good" });
    await backend.set(leavePath("ROOM", uid), true);

    await rejectLeaveRequest(backend, "ROOM", uid);

    expect(await backend.get(leavePath("ROOM", uid))).toBeUndefined();
    expect(await backend.get(rosterEntryPath("ROOM", uid))).toBe(playerId);
    expect(await backend.get(playerPath("ROOM", playerId))).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(await backend.get("lobbies/ROOM/outcomes/" + uid)).toBeUndefined();
    expect(useStorytellerStore.getState().game!.players[playerId]!.isEmpty).toBe(false);
  });

  it("repeated rejection is safe once the leave request is already cleared (idempotent)", async () => {
    const backend = new MemoryRoomBackend();
    await backend.set(leavePath("ROOM", "uid-alice"), true);

    await rejectLeaveRequest(backend, "ROOM", "uid-alice");
    expect(await backend.get(leavePath("ROOM", "uid-alice"))).toBeUndefined();

    await expect(rejectLeaveRequest(backend, "ROOM", "uid-alice")).resolves.toBeUndefined();
    expect(await backend.get(leavePath("ROOM", "uid-alice"))).toBeUndefined();
  });

  it("leaves the leave request unresolved when rejection cannot reach Firebase", async () => {
    const backend = new FailingSetBackend();
    await backend.update({ [leavePath("ROOM", "uid-alice")]: true });

    await expect(rejectLeaveRequest(backend, "ROOM", "uid-alice")).rejects.toThrow("offline");
    expect(await backend.get(leavePath("ROOM", "uid-alice"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Phase 9 Setup finalization B4: player-side Traveler character choice,
  // applied automatically (no Storyteller click) through the exact same
  // assignRole() command the Storyteller's own manual override uses.
  // -------------------------------------------------------------------------

  // Precedence (Phase 9 Setup finalization B4 revision): a current
  // Storyteller-assigned Traveler character always wins over an older
  // pending player choice -- this mirrors StorytellerSession's real
  // commitLocal exactly, so these tests exercise the actual precedence
  // rule, not a simplified stand-in.
  const commitLocal = (pid: string, role: string) => {
    const p = useStorytellerStore.getState().game!.players[pid]!;
    if (p.isTraveler && !p.actualRole) useStorytellerStore.getState().assignRole(pid, role);
  };
  // setIsTraveler (Phase 9 Setup finalization B4 revision) refuses ordinary
  // -> Traveler once occupied ordinary would drop below 5 -- seed enough
  // extra ordinary players that prepareSeat()'s single seat can convert
  // without tripping that floor. Unrelated to the roster/membership plumbing
  // these tests actually exercise.
  const seedExtraOrdinary = (n: number) => {
    for (let i = 0; i < n; i++) useStorytellerStore.getState().addPlayer("Extra " + i);
  };

  it("applies a player's chosen Traveler character through assignRole and clears the request", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    await backend.set(travelerChoicePath("ROOM", uid), "thief");

    await applyTravelerChoice(backend, "ROOM", uid, "thief", commitLocal);

    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("thief");
    expect(await backend.get(travelerChoicePath("ROOM", uid))).toBeUndefined();
  });

  it("a current Storyteller-assigned character wins over a stale pending choice, which is cleared without changing the role", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    // Player requests Thief...
    await backend.set(travelerChoicePath("ROOM", uid), "thief");
    // ...but before the request is processed, the Storyteller assigns Gunslinger.
    useStorytellerStore.getState().assignRole(playerId, "gunslinger");

    await applyTravelerChoice(backend, "ROOM", uid, "thief", commitLocal);

    // Gunslinger remains; the stale Thief request is cleared, not applied.
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("gunslinger");
    expect(await backend.get(travelerChoicePath("ROOM", uid))).toBeUndefined();
  });

  it("still applies normally when no Traveler character is assigned yet", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    await backend.set(travelerChoicePath("ROOM", uid), "scapegoat");

    await applyTravelerChoice(backend, "ROOM", uid, "scapegoat", commitLocal);

    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("scapegoat");
  });

  it("re-resolves uid -> playerId from the CURRENT roster, never a caller-assumed id", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId: firstSeat } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, firstSeat, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, firstSeat),
    );
    useStorytellerStore.getState().addPlayerToSeat("Bob");
    const secondSeat = useStorytellerStore.getState().game!.seatOrder.find(
      (id) => id !== firstSeat && !useStorytellerStore.getState().game!.players[id]!.isEmpty,
    )!;
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(secondSeat, true).ok).toBe(true);
    await backend.set(rosterEntryPath("ROOM", uid), secondSeat);

    const applied: string[] = [];
    await applyTravelerChoice(backend, "ROOM", uid, "thief", (pid) => { applied.push(pid); });

    expect(applied).toEqual([secondSeat]);
  });

  it("clears a stale request with no current roster binding, touching no local seat (stale cleanup)", async () => {
    const backend = new MemoryRoomBackend();
    await backend.set(travelerChoicePath("ROOM", "uid-ghost"), "thief");
    let called = false;

    await applyTravelerChoice(backend, "ROOM", "uid-ghost", "thief", () => { called = true; });

    expect(called).toBe(false);
    expect(await backend.get(travelerChoicePath("ROOM", "uid-ghost"))).toBeUndefined();
  });

  it("never applies to a player who is no longer a Traveler -- a Storyteller override or status change wins", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    // Never marked a Traveler at all -- e.g. the Storyteller already
    // converted them back to ordinary before this request was applied.
    await backend.set(travelerChoicePath("ROOM", uid), "thief");

    await applyTravelerChoice(backend, "ROOM", uid, "thief", commitLocal);

    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("");
    expect(await backend.get(travelerChoicePath("ROOM", uid))).toBeUndefined();
  });

  it("the Storyteller's manual Traveler override remains available after a player choice applies -- not a lock", async () => {
    const backend = new MemoryRoomBackend();
    const { uid, playerId } = prepareSeat();
    await seatPlayerAndCommit(backend, "ROOM", uid, playerId, null, () =>
      useStorytellerStore.getState().assignPendingToSeat(uid, playerId),
    );
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    await backend.set(travelerChoicePath("ROOM", uid), "thief");
    await applyTravelerChoice(backend, "ROOM", uid, "thief", commitLocal);
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("thief");

    // Storyteller manually overrides to a different Traveler character --
    // the exact same generic assignRole() command, unrestricted.
    useStorytellerStore.getState().assignRole(playerId, "scapegoat");
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("scapegoat");
  });
});

// Phase 9R.3 (B7): the waiting-player seating path composes the real
// production pieces -- seatPlayerAndCommit (Firebase first) then
// assignPendingToSeat (local commit). Participant 20 is legal; a capacity-
// rejected seating must return false locally so the EXISTING compensation
// revokes the remote membership it just wrote, leaving nothing behind.
describe("Phase 9R.3: waiting-player seating respects the 20-participant total", () => {
  beforeEach(() => {
    resetStores();
    useStorytellerStore.setState({ customScripts: { [setupScript.id]: setupScript } });
  });

  const st = () => useStorytellerStore.getState();
  const occupiedCount = () => {
    const p = selectSetupContext(st().game!).population;
    return p.occupiedNonTravelerCount + p.occupiedTravelerCount;
  };

  function seatViaMembership(backend: MemoryRoomBackend, uid: string, seatId: string) {
    const name = st().game!.pendingPlayers[uid]!;
    const participant = { participantId: newParticipantId(), name };
    return {
      participant,
      run: seatPlayerAndCommit(backend, "ROOM", uid, seatId, null,
        () => st().assignPendingToSeat(uid, seatId, participant.participantId), participant),
    };
  }

  // 15 ordinary seated and revealed, 4 late Travellers, then one post-Reveal
  // empty seat for the waiting player: 20 seats, 19 occupied.
  function revealedTableWithOneOpenSeat() {
    st().newGame(setupScript.id, { plannedPlayerCount: 15 });
    for (let i = 0; i < 15; i++) st().addPlayerToSeat("Player " + i);
    st().setRolePool(standardRoles(15));
    expect(st().dealRolePool().ok).toBe(true);
    st().game!.seatOrder.forEach(id => {
      if (needsShownIdentity(st().game!.players[id]!.actualRole)) st().setShownRole(id, "chef");
      else st().showAssignedRole(id);
    });
    expect(st().revealRoles().ok).toBe(true);
    for (let i = 0; i < 4; i++) st().addPlayer("Late " + i);
    st().addEmptySeat();
    expect(st().game!.seatOrder).toHaveLength(20);
    expect(occupiedCount()).toBe(19);
    return st().game!.seatOrder.find(id => st().game!.players[id]!.isEmpty)!;
  }

  it("the pending-player path legally seats participant 20 after Reveal, with a matching remote membership", async () => {
    const backend = new MemoryRoomBackend();
    const seatId = revealedTableWithOneOpenSeat();
    st().addToPendingQueue("uid-20", "Twenty");
    const { participant, run } = seatViaMembership(backend, "uid-20", seatId);
    await run;
    expect(occupiedCount()).toBe(20);
    expect(st().game!.players[seatId]!.participantId).toBe(participant.participantId);
    expect(st().game!.players[seatId]!.isTraveler).toBe(true); // post-Reveal arrival
    expect(st().game!.pendingPlayers).toEqual({});
    expect(await backend.get(rosterEntryPath("ROOM", "uid-20"))).toBe(seatId);
    expect(await backend.get(rosterParticipantPath("ROOM", "uid-20")))
      .toEqual({ playerId: seatId, participantId: participant.participantId, name: "Twenty" });
  });

  it("a capacity-rejected seating (participant 21) reports failure and leaves no local or remote partial membership", async () => {
    const backend = new MemoryRoomBackend();
    const seatId = revealedTableWithOneOpenSeat();
    st().addToPendingQueue("uid-20", "Twenty");
    await seatViaMembership(backend, "uid-20", seatId).run;
    expect(occupiedCount()).toBe(20);

    // Malformed/legacy state: an extra (21st) physical seat, empty.
    const current = st().game!;
    const extra = "extra-empty";
    useStorytellerStore.setState({ game: { ...current,
      players: { ...current.players, [extra]: { ...current.players[seatId]!, id: extra, name: "", seat: 20,
        isEmpty: true, isTraveler: false, actualRole: "", participantId: undefined } },
      seatOrder: [...current.seatOrder, extra] } });
    st().addToPendingQueue("uid-21", "Overflow");
    const before = st().game!;

    await expect(seatViaMembership(backend, "uid-21", extra).run).rejects.toThrow(/rolled back/);

    // Local: nothing committed; the waiting player is still waiting.
    expect(st().game).toBe(before);
    expect(st().game!.players[extra]!.isEmpty).toBe(true);
    expect(st().game!.pendingPlayers).toEqual({ "uid-21": "Overflow" });
    expect(occupiedCount()).toBe(20);
    // Remote: the binding, its participant record, and any private
    // projection for the rejected seat are gone.
    expect(await backend.get(rosterEntryPath("ROOM", "uid-21"))).toBeUndefined();
    expect(await backend.get(rosterParticipantPath("ROOM", "uid-21"))).toBeUndefined();
    expect(await backend.get(playerPath("ROOM", extra))).toBeUndefined();
    // Participant 20's membership is untouched by the compensation.
    expect(await backend.get(rosterEntryPath("ROOM", "uid-20"))).toBe(seatId);
    expect(await backend.get(rosterParticipantPath("ROOM", "uid-20"))).toBeTruthy();
  });
});
