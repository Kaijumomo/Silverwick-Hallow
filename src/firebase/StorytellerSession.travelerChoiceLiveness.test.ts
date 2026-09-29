// Phase 10D (CLOSURE-02): a valid Traveler request deferred ONLY because the
// matching local participation is not available yet must be retried
// automatically when that participation becomes available -- no polling, no
// second request write, no processing against an empty/unbound seat, and no
// weakening of the participation binding or request-freshness guards.
//
// Every step is a production entry point: the managed Storyteller session
// (startStorytellerSession: its real roster/travelerChoices watchers and the
// runtime view they derive), the production SessionWriter, the Storyteller
// UI's seating sequence (SeatAssignPopup: seatPlayerAndCommit +
// assignPendingToSeat with one minted ParticipantId), revocation, fresh-device
// recovery, and the auto-apply hook StorytellerSession mounts. The "server"
// (MemoryRoomBackend) applies each write immediately; only the Storyteller's
// ACKNOWLEDGMENT of the seating write is held, exactly the window in which the
// seat is bound remotely while the local seat is still empty.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { newParticipantId } from "@/stores/participants";
import type { ParticipantId, PlayerId } from "@/stores/types";
import type { Json } from "./backend";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby, knockOnLobby } from "./lobby";
import { requireActiveSession, travelerChoicePath } from "./lifecycle";
import { rosterEntryPath } from "./paths";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { revokePlayerAndCommit, seatPlayerAndCommit, storytellerOccupancyCompletion } from "./membershipCommands";
import { useApplyTravelerChoices } from "./StorytellerSession";

const code = "LIVE2345";
const TESS = "uid-tess";
const request = travelerChoicePath(code, TESS);
const store = () => useStorytellerStore.getState();
const game = () => store().game!;
const disposals: (() => void | Promise<void>)[] = [];

function resetStores() {
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: {} });
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" }, leaveRequests: {}, travelerChoices: {} });
}
beforeEach(resetStores);
afterEach(async () => {
  cleanup();
  for (const dispose of disposals.splice(0).reverse()) await dispose();
  resetStores();
});

/** The server applies every write at once. `holdSeatingAck` holds the
 * Storyteller's acknowledgment of the next seating write for `uid`;
 * `holdRequestRead` holds the next read of the Traveler request (the first
 * step of an auto-apply callback), so a second trigger can be observed while
 * the first callback is provably in flight. Reads of the request are counted:
 * each auto-apply callback begins with exactly one. */
class GatedBackend extends MemoryRoomBackend {
  requestReads = 0;
  private seatingAck: { path: string; gate: Promise<void> } | null = null;
  private requestRead: { gate: Promise<void>; reached: () => void } | null = null;
  holdSeatingAck(uid: string): () => void {
    let release!: () => void;
    this.seatingAck = { path: rosterEntryPath(code, uid), gate: new Promise<void>(resolve => { release = resolve; }) };
    return release;
  }
  holdRequestRead(): { reached: Promise<void>; release: () => void } {
    let release!: () => void;
    let reached!: () => void;
    const reachedPromise = new Promise<void>(resolve => { reached = resolve; });
    this.requestRead = { gate: new Promise<void>(resolve => { release = resolve; }), reached };
    return { reached: reachedPromise, release };
  }
  async update(updates: Record<string, Json>): Promise<void> {
    await super.update(updates);
    const held = this.seatingAck;
    if (held && Object.prototype.hasOwnProperty.call(updates, held.path)) { this.seatingAck = null; await held.gate; }
  }
  async get(path: string): Promise<unknown> {
    if (path === request) {
      this.requestReads++;
      const held = this.requestRead;
      if (held) { this.requestRead = null; held.reached(); await held.gate; }
    }
    return super.get(path);
  }
  /** Non-null writes of the request -- only ever the player's own. */
  playerRequestWrites(): number {
    return this.writeLog.filter(w => w.path === request && w.value != null).length;
  }
}

type Lobby = { code: string; uid: string; sessionId: string; status: "live" };

async function openLobby(b: MemoryRoomBackend): Promise<Lobby> {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  return { code, uid: "host", sessionId: session.id, status: "live" };
}

/** A live Trouble Brewing game in Night 1 (the initial ordinary Reveal has
 * committed, so every later arrival is a Traveler) with one empty seat for a
 * late arrival, served by a real managed session. */
async function liveGameWithArrivalSeat(b: MemoryRoomBackend, lobby: Lobby) {
  store().newGame("tb", { plannedPlayerCount: 5 });
  store().setLobby(lobby);
  for (const name of ["Ann", "Ben", "Cat", "Dan", "Eli"]) store().addPlayerToSeat(name);
  store().setRolePool(["washerwoman", "librarian", "chef", "poisoner", "imp"]);
  expect(store().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) store().showAssignedRole(id);
  expect(store().revealRoles().ok).toBe(true);
  expect(store().beginNightOne().ok).toBe(true);
  store().addEmptySeat();
  const seat = game().seatOrder[game().seatOrder.length - 1]!;
  expect(game().players[seat]).toMatchObject({ isEmpty: true });
  return { seat, ...(await session(b, lobby)) };
}

async function session(b: MemoryRoomBackend, lobby: Lobby) {
  const writer = new SessionWriter(b, code, lobby.sessionId);
  let manager!: Awaited<ReturnType<typeof startStorytellerSession>>;
  await act(async () => { manager = await startStorytellerSession(b, lobby, writer); });
  expect(manager.outcome).toBe("live");
  let released = false;
  const release = async () => { if (released) return; released = true; await act(async () => { manager.stop(); await writer.dispose(); }); };
  disposals.push(release);
  await waitFor(() => expect(useSessionRuntime.getState().backend).toBe(writer));
  return { writer, release };
}

async function knock(b: MemoryRoomBackend, uid: string, name: string) {
  await act(async () => { await knockOnLobby(b, code, uid, name); });
  await waitFor(() => expect(game().pendingPlayers[uid]).toBe(name));
}

/** SeatAssignPopup's seating sequence, with the local commit's participation
 * supplied explicitly (normally the SAME minted id as the remote record). */
function seat(writer: SessionWriter, uid: string, seatId: PlayerId, remote: ParticipantId, local: ParticipantId = remote) {
  const name = game().pendingPlayers[uid]!;
  expect(name).toBeTruthy();
  return seatPlayerAndCommit(writer, code, uid, seatId, null,
    () => store().assignPendingToSeat(uid, seatId, local), { participantId: remote, name });
}

/** Starts seating with the acknowledgment held; resolves (with the still
 * pending seating) once the server has applied the binding -- the window in
 * which the seat is bound remotely while the local seat is still empty. */
async function startHeldSeating(b: GatedBackend, writer: SessionWriter, uid: string, seatId: PlayerId, remote: ParticipantId, local: ParticipantId = remote) {
  const releaseAck = b.holdSeatingAck(uid);
  let seating!: Promise<void>;
  await act(async () => {
    seating = seat(writer, uid, seatId, remote, local);
    for (let i = 0; i < 100 && (await b.get(rosterEntryPath(code, uid))) !== seatId; i++) await new Promise(resolve => setTimeout(resolve, 5));
  });
  expect(await b.get(rosterEntryPath(code, uid))).toBe(seatId);
  return { seating, releaseAck };
}

/** The player's own Traveler request, written as the player writes it. */
const choose = (b: MemoryRoomBackend, roleId: string) => act(async () => { await b.set(request, roleId); });

const roleHistoryOf = (participantId: ParticipantId) =>
  game().history.filter(h => h.category === "role" && h.participant.kind === "participant" && h.participant.participantId === participantId);

describe("CLOSURE-02: deferred Traveler request liveness (production wiring)", () => {
  it("LIVE-1: a valid request observed while the local seat is still empty processes automatically once the seating acknowledgment lands -- no second request write", async () => {
    const b = new GatedBackend();
    const lobby = await openLobby(b);
    const { seat: seatId, writer } = await liveGameWithArrivalSeat(b, lobby);
    renderHook(() => useApplyTravelerChoices(code));
    await knock(b, TESS, "Tess");

    const P = newParticipantId();
    // The seat is bound remotely (the player can now write its request) while
    // the Storyteller's local seat is still empty.
    const { seating, releaseAck } = await startHeldSeating(b, writer, TESS, seatId, P);
    await choose(b, "thief");
    await waitFor(() => expect(useSessionRuntime.getState().travelerChoices[TESS]).toEqual({ playerId: seatId, roleId: "thief" }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    // Deferred, never processed against the empty seat: pending, unapplied.
    expect(game().players[seatId]).toMatchObject({ isEmpty: true });
    expect(await b.get(request)).toBe("thief");

    await act(async () => { releaseAck(); await seating; });
    expect(game().players[seatId]).toMatchObject({ isEmpty: false, participantId: P, isTraveler: true });

    await waitFor(() => expect(game().players[seatId]!.actualRole).toBe("thief"));
    await waitFor(async () => expect(await b.get(request)).toBeUndefined());
    expect(game().players[seatId]!.participantId).toBe(P);
    expect(roleHistoryOf(P)).toHaveLength(1);
    expect(b.playerRequestWrites()).toBe(1); // the player's single original write
  });

  it("LIVE-2: when the local participation that arrives is not the one the request belongs to, the retry validates against it and never crosses participation", async () => {
    const b = new GatedBackend();
    const lobby = await openLobby(b);
    const { seat: seatId, writer } = await liveGameWithArrivalSeat(b, lobby);
    renderHook(() => useApplyTravelerChoices(code));
    await knock(b, TESS, "Tess");

    // The authoritative record names P1; the local occupant that arrives is a
    // different participation instance (P2).
    const P1 = newParticipantId();
    const P2 = newParticipantId();
    const { seating, releaseAck } = await startHeldSeating(b, writer, TESS, seatId, P1, P2);
    await choose(b, "thief");
    await waitFor(() => expect(useSessionRuntime.getState().travelerChoices[TESS]).toEqual({ playerId: seatId, roleId: "thief" }));
    const readsBefore = b.requestReads;

    await act(async () => { releaseAck(); await seating; });
    expect(game().players[seatId]).toMatchObject({ participantId: P2, isTraveler: true, actualRole: "" });
    // The retry DID run (it re-read the request) -- and refused: the record
    // attributes the request to P1, not to the arrived P2.
    await waitFor(() => expect(b.requestReads).toBeGreaterThan(readsBefore));
    await act(async () => { await writer.runExclusive(async () => {}); });
    expect(game().players[seatId]).toMatchObject({ participantId: P2, actualRole: "" });
    expect(roleHistoryOf(P2)).toHaveLength(0);
    expect(await b.get(request)).toBe("thief"); // not consumed by P2's callback
    // A later trigger for the same occupant is refused the same way.
    await choose(b, "thief");
    await act(async () => { await writer.runExclusive(async () => {}); });
    expect(game().players[seatId]).toMatchObject({ participantId: P2, actualRole: "" });
    expect(await b.get(request)).toBe("thief");
  });

  it("LIVE-2 (same uid, new participation): the earlier participation's choice stays its own; the NEW participation's request, observed while its seat is still empty, processes for it once it arrives", async () => {
    const b = new GatedBackend();
    const lobby = await openLobby(b);
    const { seat: seatId, writer } = await liveGameWithArrivalSeat(b, lobby);
    renderHook(() => useApplyTravelerChoices(code));
    await knock(b, TESS, "Tess");

    // Participation P1: seated normally; its own choice applies to it.
    const P1 = newParticipantId();
    await act(async () => { await seat(writer, TESS, seatId, P1); });
    await choose(b, "thief");
    await waitFor(() => expect(game().players[seatId]).toMatchObject({ participantId: P1, actualRole: "thief" }));
    await waitFor(async () => expect(await b.get(request)).toBeUndefined());

    // P1 ends (fenced revocation + local unseat); the SAME uid is queued again
    // (as the ASTRA-10D-001 CHOICE1 proofs do) and seated as P2, with the
    // acknowledgment delayed past P2's own request.
    await act(async () => { await revokePlayerAndCommit(writer, code, seatId, storytellerOccupancyCompletion("unseat", seatId)); });
    expect(game().players[seatId]).toMatchObject({ isEmpty: true });
    store().addToPendingQueue(TESS, "Tess");
    const P2 = newParticipantId();
    const { seating, releaseAck } = await startHeldSeating(b, writer, TESS, seatId, P2);
    await choose(b, "gunslinger");
    await waitFor(() => expect(useSessionRuntime.getState().travelerChoices[TESS]).toEqual({ playerId: seatId, roleId: "gunslinger" }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(game().players[seatId]).toMatchObject({ isEmpty: true });
    expect(await b.get(request)).toBe("gunslinger");

    await act(async () => { releaseAck(); await seating; });
    await waitFor(() => expect(game().players[seatId]).toMatchObject({ participantId: P2, isTraveler: true, actualRole: "gunslinger" }));
    await waitFor(async () => expect(await b.get(request)).toBeUndefined());
    expect(roleHistoryOf(P1).map(h => h.change)).toEqual([{ kind: "value", from: { actualRole: "" }, to: { actualRole: "thief" } }]);
    expect(roleHistoryOf(P2).map(h => h.change)).toEqual([{ kind: "value", from: { actualRole: "" }, to: { actualRole: "gunslinger" } }]);
  });

  it("LIVE-2 (reachable path): a seat filled locally by someone else while the acknowledgment is held -- the retry for that occupant never takes the request, which the compensating revocation retires", async () => {
    const b = new GatedBackend();
    const lobby = await openLobby(b);
    const { seat: seatId, writer } = await liveGameWithArrivalSeat(b, lobby);
    renderHook(() => useApplyTravelerChoices(code));
    await knock(b, TESS, "Tess");

    const { seating, releaseAck } = await startHeldSeating(b, writer, TESS, seatId, newParticipantId());
    await choose(b, "thief");
    await waitFor(() => expect(useSessionRuntime.getState().travelerChoices[TESS]).toEqual({ playerId: seatId, roleId: "thief" }));
    // Meanwhile the Storyteller fills that seat locally with another person
    // (a late arrival, so a Traveler): a participation the request never
    // belonged to becomes observable at the seat.
    await act(async () => { store().addPlayerToSeat("Walk-in"); });
    const other = game().players[seatId]!;
    expect(other).toMatchObject({ name: "Walk-in", isTraveler: true, actualRole: "" });

    await act(async () => { releaseAck(); await expect(seating).rejects.toThrow(/rolled back/); });
    await act(async () => { await writer.runExclusive(async () => {}); });
    expect(game().players[seatId]).toMatchObject({ participantId: other.participantId, actualRole: "" });
    expect(roleHistoryOf(other.participantId!)).toHaveLength(0);
    expect(await b.get(rosterEntryPath(code, TESS))).toBeUndefined();
    expect(await b.get(request)).toBeUndefined();
  });

  it("LIVE-3: a request made while the Storyteller is offline survives reconnect and processes once recovery restores the matching participation from the authoritative record", async () => {
    const b = new GatedBackend();
    const lobby = await openLobby(b);
    const { seat: seatId, release: stopDevice1 } = await liveGameWithArrivalSeat(b, lobby);
    // The last checkpoint that lands still shows the arrival seat EMPTY.
    await waitFor(async () => {
      const raw = await b.get(`lobbies/${code}/checkpoint`);
      expect(typeof raw).toBe("string");
      expect(JSON.parse(raw as string).game.players[seatId].isEmpty).toBe(true);
    });
    await knock(b, TESS, "Tess");
    await stopDevice1();
    // The same Storyteller keeps working with a lease-holding writer whose
    // projections never land: Tess is seated remotely (binding + record).
    const unflushed = new SessionWriter(b, code, lobby.sessionId);
    const P = newParticipantId();
    await act(async () => {
      await unflushed.start();
      await seat(unflushed, TESS, seatId, P);
      await unflushed.dispose();
    });
    // Offline: Tess, bound, asks for Thief. Nobody is there to process it.
    await choose(b, "thief");

    // Fresh-device recovery: the checkpoint predates the seating, so the
    // occupant is restored from rosterParticipants during recovery.
    resetStores();
    store().setLobby(lobby);
    renderHook(() => useApplyTravelerChoices(code));
    await session(b, lobby);
    expect(game().players[seatId]).toMatchObject({ isEmpty: false, participantId: P, isTraveler: true });

    await waitFor(() => expect(game().players[seatId]!.actualRole).toBe("thief"));
    await waitFor(async () => expect(await b.get(request)).toBeUndefined());
    expect(game().players[seatId]!.participantId).toBe(P);
    expect(roleHistoryOf(P)).toHaveLength(1);
    expect(b.playerRequestWrites()).toBe(1);
  });

  it("LIVE-4: a participation arrival and a request update landing close together apply the choice exactly once", async () => {
    const b = new GatedBackend();
    const lobby = await openLobby(b);
    const { seat: seatId, writer } = await liveGameWithArrivalSeat(b, lobby);
    renderHook(() => useApplyTravelerChoices(code));
    await knock(b, TESS, "Tess");

    const P = newParticipantId();
    const { seating, releaseAck } = await startHeldSeating(b, writer, TESS, seatId, P);
    await choose(b, "thief");
    await waitFor(() => expect(useSessionRuntime.getState().travelerChoices[TESS]).toEqual({ playerId: seatId, roleId: "thief" }));

    // Trigger 1: the participation arrives; its callback is held at its read.
    const firstRead = b.holdRequestRead();
    const readsBefore = b.requestReads;
    await act(async () => { releaseAck(); await seating; });
    await firstRead.reached;
    // Trigger 2, close behind: the same request is re-emitted (the player
    // submits the same choice again) while the first callback is in flight.
    await choose(b, "thief");
    expect(b.requestReads - readsBefore).toBe(1); // the second callback waits in the writer queue

    await act(async () => { firstRead.release(); });
    await act(async () => { await writer.runExclusive(async () => {}); });
    expect(b.requestReads - readsBefore).toBe(2); // both callbacks ran...
    expect(game().players[seatId]).toMatchObject({ participantId: P, actualRole: "thief" });
    expect(roleHistoryOf(P)).toHaveLength(1); // ...exactly one application
    expect(await b.get(request)).toBeUndefined();
  });
});
