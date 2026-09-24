// Phase 9R.6: interrupted membership revocation recovery.
//
// Astra's P1: the Storyteller's Firebase-first removal/unseat commits on the
// server (roster/{uid}, rosterParticipants/{uid} and player/{playerId}
// deleted, outcomes/{uid} = "revoked", leave request cleared), then the
// process dies before the local unseatPlayer()/removePlayer() lands. The
// persisted local game still holds Alice as the occupant; reconnect picks
// KEEP_LOCAL (no prior roster to diff against), roster absence alone cannot
// distinguish her from a legitimately unbound local player, and the initial
// flush republished her seat, identity, and private packet into a new
// checkpoint -- destroying the evidence a later fresh device needed.
//
// The fix: the revocation commit itself carries a Storyteller-only receipt,
// membershipRevocations/{uid} = {playerId, participantId, action}, and
// reconnect completes exactly that action for exactly that ParticipantId
// before the initial flush.
//
// Every step is a real production entry point (startStorytellerSession and
// its own debounced flush, the SeatAssignPopup seating sequence,
// revokePlayerAndCommit / acceptLeaveRequest with the production
// storytellerOccupancyCompletion, the real persisted localStorage image).
// The interruption is modeled exactly: the local completion throws where the
// process would have died, the live session stops before any later flush
// can run, and (lost-ack variant) the server commit lands while the writer's
// acknowledgement is never recorded.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { newParticipantId } from "@/stores/participants";
import type { ParticipantRef, PlayerId, StorytellerLobbyRecord } from "@/stores/types";
import type { Json, RoomBackend } from "./backend";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby, knockOnLobby, MembershipConflictError, revokePlayerMembership, seatPlayer } from "./lobby";
import { leavePath, requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { resolveReconnectConflict, startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import {
  acceptLeaveRequest,
  MembershipOperationError,
  revokePlayerAndCommit,
  seatPlayerAndCommit,
  storytellerOccupancyCompletion,
  type OccupancyCompletion,
} from "./membershipCommands";
import { decideReconnect } from "./reconnectDecision";
import { membershipRevocationPath, rosterParticipantPath } from "./paths";
import { startPlayerHandshake } from "./playerSync";

const code = "RVKE2345";
const root = `lobbies/${code}`;
const STORAGE_KEY = "new-blood-st";
const ALICE = "uid-alice";
const disposals: (() => void | Promise<void>)[] = [];
const store = () => useStorytellerStore.getState();
const game = () => store().game!;

function resetStore() {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: {},
  });
}
beforeEach(() => {
  localStorage.clear();
  resetStore();
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
});
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

type Lobby = { code: string; uid: string; sessionId: string; status: "live" };

async function openLobby(b: MemoryRoomBackend): Promise<{ lobby: Lobby; sessionId: string }> {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  return { lobby: { code, uid: "host", sessionId: session.id, status: "live" }, sessionId: session.id };
}

/** The Storyteller UI's seating sequence (SeatAssignPopup's handleAssign). */
async function seatLikeProduction(backend: RoomBackend, uid: string, seatId: PlayerId) {
  const participant = { participantId: newParticipantId(), name: store().game!.pendingPlayers[uid]! };
  await seatPlayerAndCommit(backend, code, uid, seatId, null,
    () => store().assignPendingToSeat(uid, seatId, participant.participantId), participant);
  expect(game().players[seatId]!.participantId).toBe(participant.participantId);
  return participant.participantId;
}

async function knock(b: MemoryRoomBackend, uid: string, name: string, watched: boolean) {
  await knockOnLobby(b, code, uid, name);
  if (watched) await waitFor(() => expect(game().pendingPlayers[uid]).toBe(name));
  else store().addToPendingQueue(uid, name);
}

const checkpointOf = async (b: MemoryRoomBackend) =>
  JSON.parse(await b.get(`${root}/checkpoint`) as string) as { game: StorytellerLobbyRecord; roster: Record<string, string> };

async function waitForAckedCheckpoint(b: MemoryRoomBackend, predicate: (g: StorytellerLobbyRecord) => boolean) {
  await waitFor(async () => {
    expect(predicate((await checkpointOf(b)).game)).toBe(true);
    expect(store().localSeq).toBe(store().sync!.ackedGameSeq);
  });
}

class ProcessDied extends Error {}
/** The exact interruption: the server revocation commits, then the process
 * dies where the local completion would have run. Everything else --
 * including the durable `action` and the `occupant` read -- is production's. */
const interrupted = (completion: OccupancyCompletion): OccupancyCompletion => ({
  ...completion,
  commit: () => { throw new ProcessDied("process died before the local completion"); },
});

const ref = (participantId: string, playerId: string, nameAtTime: string): ParticipantRef =>
  ({ kind: "participant", participantId, playerId, nameAtTime });

/**
 * A live Storyteller device: Alice seated at p1 through real membership,
 * Carol/Dave/Eve/Frank typed locally by the Storyteller (never bound). With
 * `night`, the game is dealt, revealed, in Night 1, Alice's washerwoman
 * packet is published, and live History / Information Delivery / Effect
 * source records name her. Returns once an ACKNOWLEDGED checkpoint holds
 * all of it. The session keeps running -- the interruption happens in it.
 */
async function liveDeviceWithAlice(b: MemoryRoomBackend, lobby: Lobby, sessionId: string, night: boolean) {
  store().newGame("tb", { plannedPlayerCount: 5 });
  store().setLobby(lobby);
  const writer = new SessionWriter(b, code, sessionId);
  const manager = await startStorytellerSession(b, lobby, writer);
  let crashed = false;
  /** Process death: no later flush can run. (Releasing the lease is
   * equivalent, for data, to letting a dead tab's lease expire.) */
  const crash = async () => { if (crashed) return; crashed = true; manager.stop(); await writer.dispose(); };
  disposals.push(crash);
  const p1 = game().seatOrder[0]!;
  await knock(b, ALICE, "Alice", true);
  const PA = await seatLikeProduction(writer, ALICE, p1);
  for (const name of ["Carol", "Dave", "Eve", "Frank"]) store().addPlayerToSeat(name);
  const [carol, dave] = [game().seatOrder[1]!, game().seatOrder[2]!];
  if (night) {
    store().setRolePool(["washerwoman", "librarian", "chef", "poisoner", "imp"]);
    expect(store().dealRolePool().ok).toBe(true);
    const holder = Object.values(game().players).find((p) => p.actualRole === "washerwoman")!.id;
    if (holder !== p1) expect(store().swapSetupRoles(p1, holder).ok).toBe(true);
    for (const id of game().seatOrder) store().showAssignedRole(id);
    expect(store().revealRoles().ok).toBe(true);
    expect(store().beginNightOne().ok).toBe(true);
    store().setStatus(p1, "poisoned", true);
    store().addEffect(carol, { type: "marked", sourcePlayer: p1, lifetime: { kind: "manual" } });
    expect(store().recordInformationDelivery(p1, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [carol, dave] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ], { provenance: { sourcePlayer: p1 } }).ok).toBe(true);
    await waitForAckedCheckpoint(b, (g) => g.informationDeliveries.length === 1 && g.players[p1]!.participantId === PA);
    expect(await b.get(`${root}/player/${p1}`)).toEqual({ shownRole: "washerwoman", shownAlignment: "good" });
  } else {
    await waitForAckedCheckpoint(b, (g) => g.players[p1]!.participantId === PA
      && Object.values(g.players).filter((p) => !p.isEmpty).length === 5);
  }
  const unbound = Object.fromEntries(game().seatOrder.slice(1).map((id) => [id, structuredClone(game().players[id]!)]));
  return {
    writer, manager, crash, p1, PA, carol, dave, unbound,
    history: structuredClone(game().history),
    deliveries: structuredClone(game().informationDeliveries),
  };
}

/** A real reload of the persisted local image (the crashed tab reopening). */
async function reloadLocalImage() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  const raw = localStorage.getItem(STORAGE_KEY)!;
  expect(JSON.parse(raw).version).toBe(17);
  resetStore();
  localStorage.setItem(STORAGE_KEY, raw);
  await useStorytellerStore.persist.rehydrate();
  return raw;
}

async function decisionNow(b: MemoryRoomBackend, sessionId: string) {
  return decideReconnect({
    localGameInScope: store().game?.code === code,
    localSeq: store().localSeq,
    sync: store().sync,
    scope: { code, sessionId },
    checkpoint: { kind: "valid" },
    remoteGuard: (await b.get(`${root}/writeGuard`)) as never,
  });
}

/** Reconnect through the real session startup, capturing the exact payload
 * of its INITIAL projection flush (the one that used to resurrect Alice). */
async function reconnect(b: MemoryRoomBackend, lobby: Lobby, sessionId: string) {
  const flushes: Record<string, Json>[] = [];
  const original = b.update.bind(b);
  b.update = async (updates) => {
    if (`${root}/checkpoint` in updates) flushes.push(structuredClone(updates));
    return original(updates);
  };
  const writer = new SessionWriter(b, code, sessionId);
  try {
    const manager = await startStorytellerSession(b, lobby, writer);
    let released = false;
    const release = async () => { if (released) return; released = true; manager.stop(); await writer.dispose(); };
    disposals.push(release);
    expect(manager.outcome).toBe("live");
    expect(flushes.length).toBeGreaterThan(0);
    return { initialFlush: flushes[0]!, release };
  } finally {
    b.update = original;
  }
}

async function freshDevice(b: MemoryRoomBackend, lobby: Lobby, sessionId: string) {
  localStorage.clear();
  resetStore();
  store().setLobby(lobby);
  return reconnect(b, lobby, sessionId);
}

function expectDepartedByUnseat(g: StorytellerLobbyRecord, p1: PlayerId, PA: string) {
  expect(g.players[p1]).toBeDefined();
  expect(g.players[p1]!.isEmpty).toBe(true);
  expect("participantId" in g.players[p1]!).toBe(false);
  expect(Object.values(g.players).some((p) => !p.isEmpty && p.participantId === PA)).toBe(false);
}

function expectInitialFlushDoesNotResurrect(flush: Record<string, Json>, p1: PlayerId, PA: string, removed: boolean) {
  const checkpoint = JSON.parse(flush[`${root}/checkpoint`] as string) as { game: StorytellerLobbyRecord; roster: Record<string, string> };
  if (removed) {
    expect(checkpoint.game.players[p1]).toBeUndefined();
    expect(checkpoint.game.seatOrder).not.toContain(p1);
  } else {
    expectDepartedByUnseat(checkpoint.game, p1, PA);
  }
  expect(checkpoint.roster[ALICE]).toBeUndefined();
  expect(Object.values(checkpoint.game.players).some((p) => p.participantId === PA)).toBe(false);
  // Her private packet is never republished: no player/{p1} write at all.
  expect(`${root}/player/${p1}` in flush).toBe(false);
  // The public view does not show her seat as occupied.
  const pub = flush[`${root}/public`] as { players: Record<string, { name: string }>; seatOrder: string[] };
  expect(pub.players[p1]).toBeUndefined();
  expect(pub.seatOrder).not.toContain(p1);
  expect(JSON.stringify(pub)).not.toContain("Alice");
}

async function expectServerRevoked(b: MemoryRoomBackend, p1: PlayerId) {
  expect((await b.get(`${root}/roster`)) ?? {}).toEqual({});
  expect(await b.get(rosterParticipantPath(code, ALICE))).toBeUndefined();
  expect(await b.get(`${root}/player/${p1}`)).toBeUndefined();
  expect(await b.get(`${root}/outcomes/${ALICE}`)).toBe("revoked");
}

describe("Phase 9R.6 A: KEEP_LOCAL -- acknowledged revocation interrupted before the local unseat", () => {
  it("completes Alice's unseat before the initial flush; nothing of hers is republished; unbound players, History and a later fresh device all agree", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);

    await expect(revokePlayerAndCommit(d.writer, code, d.p1, interrupted(storytellerOccupancyCompletion("unseat", d.p1))))
      .rejects.toThrow(ProcessDied);
    await d.crash();
    // The server revocation committed (acknowledged), with its receipt.
    await expectServerRevoked(b, d.p1);
    expect(await b.get(membershipRevocationPath(code, ALICE))).toEqual({ playerId: d.p1, participantId: d.PA, action: "unseat" });
    expect(store().sync!.lastAttempt).toBeNull();
    expect(store().sync!.ackedGuard).toEqual(await b.get(`${root}/writeGuard`));

    await reloadLocalImage();
    // The persisted local image still holds Alice -- the exact Astra state.
    expect(game().players[d.p1]).toMatchObject({ name: "Alice", participantId: d.PA, isEmpty: false });
    expect(await decisionNow(b, sessionId)).toEqual({ type: "KEEP_LOCAL", reason: "baseline_current" });

    const { initialFlush, release } = await reconnect(b, lobby, sessionId);
    expectInitialFlushDoesNotResurrect(initialFlush, d.p1, d.PA, false);
    const g = game();
    expectDepartedByUnseat(g, d.p1, d.PA);
    expect(g.plannedPlayerCount).toBe(5); // unseat never touches the plan
    for (const [id, record] of Object.entries(d.unbound)) expect(g.players[id]).toEqual(record);
    // History, Information Deliveries and Effect source snapshots stay historical.
    expect(g.history).toEqual(d.history);
    expect(g.history[0]!.participant).toEqual(ref(d.PA, d.p1, "Alice"));
    expect(g.informationDeliveries).toEqual(d.deliveries);
    expect(g.players[d.carol]!.effects.find((e) => e.type === "marked")!.sourceParticipant).toEqual(ref(d.PA, d.p1, "Alice"));
    await expectServerRevoked(b, d.p1);
    expectDepartedByUnseat((await checkpointOf(b)).game, d.p1, d.PA);

    // G: a later fresh device recovers from THAT checkpoint -- with the
    // receipt retained, and with it gone -- and Alice stays departed.
    await release();
    const first = await freshDevice(b, lobby, sessionId);
    expectDepartedByUnseat(game(), d.p1, d.PA);
    expect(game().history).toEqual(d.history);
    await first.release();
    await b.set(membershipRevocationPath(code, ALICE), null);
    await freshDevice(b, lobby, sessionId);
    expectDepartedByUnseat(game(), d.p1, d.PA);
    for (const [id, record] of Object.entries(d.unbound)) expect(game().players[id]).toEqual(record);
  });
});

describe("Phase 9R.6 B: KEEP_LOCAL -- lost acknowledgement of the revocation commit", () => {
  it("the commit landed but its acknowledgement never did: lost-ack recovery stays valid AND the unseat completes -- no resurrection", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);

    const original = b.update.bind(b);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let intercepted = false;
    b.update = async (updates) => {
      if (intercepted || !(membershipRevocationPath(code, ALICE) in updates)) return original(updates);
      intercepted = true;
      await original(updates); // lands on the server...
      await gate; // ...but the response is never processed
    };
    const revoking = revokePlayerAndCommit(d.writer, code, d.p1, interrupted(storytellerOccupancyCompletion("unseat", d.p1)));
    await waitFor(() => expect(intercepted).toBe(true));
    const ackedBefore = store().sync!.ackedGuard;
    d.manager.stop(); // dies before onAck (stops the writer synchronously)
    release();
    await revoking.catch(() => {});
    await d.crash();
    b.update = original;
    await expectServerRevoked(b, d.p1);
    expect(store().sync!.ackedGuard).toEqual(ackedBefore);
    expect(store().sync!.lastAttempt).toEqual(await b.get(`${root}/writeGuard`));

    await reloadLocalImage();
    expect(game().players[d.p1]).toMatchObject({ name: "Alice", participantId: d.PA });
    const decision = await decisionNow(b, sessionId);
    expect(decision).toMatchObject({ type: "KEEP_LOCAL", reason: "lost_ack_recovered" });

    const { initialFlush, release: stop } = await reconnect(b, lobby, sessionId);
    expectInitialFlushDoesNotResurrect(initialFlush, d.p1, d.PA, false);
    expectDepartedByUnseat(game(), d.p1, d.PA);
    for (const [id, record] of Object.entries(d.unbound)) expect(game().players[id]).toEqual(record);
    expect(game().history).toEqual(d.history);
    // Lost-ack recovery itself remained valid: the recovered guard was
    // promoted, and the initial flush was acknowledged on top of it.
    expect(store().sync!.ackedGuard!.revision).toBeGreaterThan((decision as { recoveredGuard: { revision: number } }).recoveredGuard.revision);
    expect(store().sync!.lastAttempt).toBeNull();

    await stop();
    await freshDevice(b, lobby, sessionId);
    expectDepartedByUnseat(game(), d.p1, d.PA);
  });
});

describe("Phase 9R.6 C: an interrupted explicit Remove player completes as a REMOVAL", () => {
  async function interruptedRemoval(night: boolean) {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, night);
    await expect(revokePlayerAndCommit(d.writer, code, d.p1, interrupted(storytellerOccupancyCompletion("remove", d.p1))))
      .rejects.toThrow(ProcessDied);
    await d.crash();
    expect(await b.get(membershipRevocationPath(code, ALICE))).toEqual({ playerId: d.p1, participantId: d.PA, action: "remove" });
    // What the Storyteller's own removePlayer() would have produced from
    // this exact persisted image -- the recovery must equal it.
    const raw = await reloadLocalImage();
    expect(store().removePlayer(d.p1)).toBe(true);
    const expected = structuredClone(game());
    resetStore();
    localStorage.setItem(STORAGE_KEY, raw);
    await useStorytellerStore.persist.rehydrate();
    expect(game().players[d.p1]).toMatchObject({ name: "Alice", participantId: d.PA });
    return { b, lobby, sessionId, d, expected };
  }

  function expectRemovedLike(expected: StorytellerLobbyRecord, p1: PlayerId, PA: string) {
    const g = game();
    expect(g.players[p1]).toBeUndefined();
    expect(g.seatOrder).not.toContain(p1);
    expect(g.players).toEqual(expected.players);
    expect(g.seatOrder).toEqual(expected.seatOrder);
    expect(g.plannedPlayerCount).toBe(expected.plannedPlayerCount);
    expect(g.plannedTravelerCount).toBe(expected.plannedTravelerCount);
    // Contiguous seat geometry.
    expect(g.seatOrder.map((id) => g.players[id]!.seat)).toEqual(g.seatOrder.map((_, i) => i));
    expect(Object.values(g.players).some((p) => p.participantId === PA)).toBe(false);
  }

  it("Night 1: the seat/PlayerId itself is removed, geometry stays contiguous, History stays historical, and a fresh device agrees", async () => {
    const { b, lobby, sessionId, d, expected } = await interruptedRemoval(true);
    expect(await decisionNow(b, sessionId)).toEqual({ type: "KEEP_LOCAL", reason: "baseline_current" });
    const { initialFlush, release } = await reconnect(b, lobby, sessionId);
    expectInitialFlushDoesNotResurrect(initialFlush, d.p1, d.PA, true);
    expectRemovedLike(expected, d.p1, d.PA);
    expect(game().plannedPlayerCount).toBe(5); // post-Reveal: removal never touches the plan
    expect(Object.keys(game().players)).toHaveLength(4); // 9R.5: exactly one record deleted
    expect(game().history).toEqual(d.history);
    expect(game().informationDeliveries).toEqual(d.deliveries);
    await release();
    await freshDevice(b, lobby, sessionId);
    expectRemovedLike(expected, d.p1, d.PA);
  });

  it("before Reveal: removal gives back one unit of planned capacity (9R.3), exactly like the original command", async () => {
    const { b, lobby, sessionId, d, expected } = await interruptedRemoval(false);
    expect(expected.plannedPlayerCount).toBe(4);
    await reconnect(b, lobby, sessionId);
    expectRemovedLike(expected, d.p1, d.PA);
    for (const [id, record] of Object.entries(d.unbound)) {
      const { seat: _seat, ...rest } = record;
      const { seat: _recovered, ...survivor } = game().players[id]!;
      expect(survivor).toEqual(rest); // only renumbered, never otherwise touched
    }
  });
});

describe("Phase 9R.6 D: an interrupted accepted leave request completes as an UNSEAT", () => {
  it("the seat survives empty -- never removed", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
    await b.set(leavePath(code, ALICE), true); // what the player's own leaveLobby() writes
    await expect(acceptLeaveRequest(d.writer, code, ALICE,
      (pid) => interrupted(storytellerOccupancyCompletion("unseat", pid)))).rejects.toThrow(ProcessDied);
    await d.crash();
    expect(await b.get(leavePath(code, ALICE))).toBeUndefined();
    expect(await b.get(membershipRevocationPath(code, ALICE))).toEqual({ playerId: d.p1, participantId: d.PA, action: "unseat" });

    await reloadLocalImage();
    const { initialFlush } = await reconnect(b, lobby, sessionId);
    expectInitialFlushDoesNotResurrect(initialFlush, d.p1, d.PA, false);
    expectDepartedByUnseat(game(), d.p1, d.PA);
    expect(game().seatOrder).toContain(d.p1);
    expect(game().plannedPlayerCount).toBe(5);
  });

  it("an accepted leave request refuses a remove completion before anything is written", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, false);
    await b.set(leavePath(code, ALICE), true);
    await expect(acceptLeaveRequest(d.writer, code, ALICE, (pid) => storytellerOccupancyCompletion("remove", pid)))
      .rejects.toThrow(MembershipOperationError);
    expect(await b.get(`${root}/roster/${ALICE}`)).toBe(d.p1);
    expect(await b.get(membershipRevocationPath(code, ALICE))).toBeUndefined();
    expect(game().players[d.p1]).toMatchObject({ name: "Alice", participantId: d.PA });
  });
});

describe("Phase 9R.6 E: legitimately unbound local players are never treated as departed", () => {
  it("roster absence alone never unseats a Storyteller-typed participant -- through KEEP_LOCAL and a fresh-device RESTORE", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
    // No binding and no participant record exists for any unbound seat.
    expect(await b.get(`${root}/roster`)).toEqual({ [ALICE]: d.p1 });
    await expect(revokePlayerAndCommit(d.writer, code, d.p1, interrupted(storytellerOccupancyCompletion("unseat", d.p1))))
      .rejects.toThrow(ProcessDied);
    await d.crash();
    // Only Alice's receipt exists -- nothing speaks for any unbound player.
    expect(Object.keys((await b.get(`${root}/membershipRevocations`)) as object)).toEqual([ALICE]);
    await reloadLocalImage();
    const { release } = await reconnect(b, lobby, sessionId);
    for (const [id, record] of Object.entries(d.unbound)) expect(game().players[id]).toEqual(record);
    expect(Object.values(game().players).filter((p) => !p.isEmpty)).toHaveLength(4);
    await release();
    await freshDevice(b, lobby, sessionId);
    for (const [id, record] of Object.entries(d.unbound)) expect(game().players[id]).toEqual(record);
  });
});

describe("Phase 9R.6 F: PlayerId reuse -- an old receipt never acts on a later participant", () => {
  async function aliceRevokedThenReused(b: MemoryRoomBackend, lobby: Lobby, sessionId: string, occupy: (d: Awaited<ReturnType<typeof liveDeviceWithAlice>>) => Promise<string>) {
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
    await revokePlayerAndCommit(d.writer, code, d.p1, storytellerOccupancyCompletion("unseat", d.p1)); // completes normally
    expect(await b.get(membershipRevocationPath(code, ALICE))).toEqual({ playerId: d.p1, participantId: d.PA, action: "unseat" });
    const newcomer = await occupy(d);
    expect(newcomer).not.toBe(d.PA);
    await waitForAckedCheckpoint(b, (g) => g.players[d.p1]!.participantId === newcomer);
    const occupant = structuredClone(game().players[d.p1]!);
    await d.crash();
    return { d, occupant };
  }

  it.each([
    ["a Firebase-seated Bob", async (b: MemoryRoomBackend, d: Awaited<ReturnType<typeof liveDeviceWithAlice>>) => {
      await knock(b, "uid-bob", "Bob", true);
      return seatLikeProduction(d.writer, "uid-bob", d.p1);
    }],
    ["a locally typed, never-bound 'Alice' (same name)", async (_b: MemoryRoomBackend, d: Awaited<ReturnType<typeof liveDeviceWithAlice>>) => {
      store().addPlayerToSeat("Alice");
      return game().players[d.p1]!.participantId!;
    }],
  ])("%s at Alice's old PlayerId survives same-device and fresh-device recovery", async (_label, occupyWith) => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const { d, occupant } = await aliceRevokedThenReused(b, lobby, sessionId, (dd) => occupyWith(b, dd));
    expect(await b.get(membershipRevocationPath(code, ALICE))).toEqual({ playerId: d.p1, participantId: d.PA, action: "unseat" });
    await reloadLocalImage();
    const { release } = await reconnect(b, lobby, sessionId);
    expect(game().players[d.p1]).toEqual(occupant);
    await release();
    await freshDevice(b, lobby, sessionId);
    expect(game().players[d.p1]).toEqual(occupant);
    expect(game().history).toEqual(d.history);
  });

  it("a stale checkpoint still holding Alice while Bob is now bound at her PlayerId: Alice's receipt ends Alice only, Bob is restored with his own identity", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
    await d.crash();
    // Same Storyteller, no projection lands: revoke Alice, seat Bob at p1.
    const w2 = new SessionWriter(b, code, sessionId);
    await w2.start();
    disposals.push(() => w2.dispose());
    await revokePlayerAndCommit(w2, code, d.p1, storytellerOccupancyCompletion("unseat", d.p1));
    await knock(b, "uid-bob", "Bob", false);
    const PB = await seatLikeProduction(w2, "uid-bob", d.p1);
    await w2.dispose();
    expect((await checkpointOf(b)).game.players[d.p1]!.participantId).toBe(d.PA);

    await freshDevice(b, lobby, sessionId);
    expect(game().players[d.p1]).toMatchObject({ name: "Bob", participantId: PB, shownRole: null });
    expect(game().history).toEqual(d.history);
  });
});

describe("Phase 9R.6: reconciliation precedence and deduplication", () => {
  it("a fresh device RESTOREing the pre-revocation checkpoint honors a REMOVE receipt -- never degraded to the prior-roster unseat", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
    await expect(revokePlayerAndCommit(d.writer, code, d.p1, interrupted(storytellerOccupancyCompletion("remove", d.p1))))
      .rejects.toThrow(ProcessDied);
    await d.crash();
    // The checkpoint's embedded roster still binds Alice at p1 -- the
    // RESTORE prior-roster inference alone would only UNSEAT her.
    expect((await checkpointOf(b)).roster).toEqual({ [ALICE]: d.p1 });
    await freshDevice(b, lobby, sessionId);
    expect(game().players[d.p1]).toBeUndefined();
    expect(game().seatOrder).not.toContain(d.p1);
    expect(game().seatOrder.map((id) => game().players[id]!.seat)).toEqual([0, 1, 2, 3]);
  });

  it("an unseat receipt and the prior-roster inference for the same seat apply ONE unseat, not two", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
    await expect(revokePlayerAndCommit(d.writer, code, d.p1, interrupted(storytellerOccupancyCompletion("unseat", d.p1))))
      .rejects.toThrow(ProcessDied);
    await d.crash();
    localStorage.clear();
    resetStore();
    store().setLobby(lobby);
    const unseat = store().unseatPlayer;
    const calls: PlayerId[] = [];
    useStorytellerStore.setState({ unseatPlayer: (id: PlayerId) => { calls.push(id); return unseat(id); } });
    try {
      await reconnect(b, lobby, sessionId);
    } finally {
      useStorytellerStore.setState({ unseatPlayer: unseat });
    }
    expect(calls).toEqual([d.p1]);
    expectDepartedByUnseat(game(), d.p1, d.PA);
  });

  it("explicit conflict resolution (keepLocal) completes the receipt too; useRemote adopts the already-completed remote game", async () => {
    for (const choice of ["keepLocal", "useRemote"] as const) {
      const b = new MemoryRoomBackend();
      const { lobby, sessionId } = await openLobby(b);
      const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
      await expect(revokePlayerAndCommit(d.writer, code, d.p1, interrupted(storytellerOccupancyCompletion("unseat", d.p1))))
        .rejects.toThrow(ProcessDied);
      await d.crash();
      const raw = await reloadLocalImage();
      // Another Storyteller device recovers meanwhile (and, with the fix,
      // publishes a checkpoint in which Alice has departed)...
      const other = await freshDevice(b, lobby, sessionId);
      expectDepartedByUnseat(game(), d.p1, d.PA);
      await other.release();
      // ...while this device, still holding Alice, made a local edit.
      resetStore();
      localStorage.setItem(STORAGE_KEY, raw);
      await useStorytellerStore.persist.rehydrate();
      store().setNotes(d.carol, "unflushed local edit");
      const w = new SessionWriter(b, code, sessionId);
      const manager = await startStorytellerSession(b, lobby, w);
      disposals.push(async () => { manager.stop(); await w.dispose(); });
      expect(manager.outcome).toBe("conflict");
      expect(await resolveReconnectConflict(choice)).toBe("applied");
      expectDepartedByUnseat(game(), d.p1, d.PA);
      expect(game().players[d.carol]!.stNotes).toBe(choice === "keepLocal" ? "unflushed local edit" : "");
      await waitForAckedCheckpoint(b, (g) => g.players[d.p1]!.isEmpty === true);
      expect(await b.get(`${root}/player/${d.p1}`)).toBeUndefined();
      manager.stop(); await w.dispose();
      resetStore();
    }
  });
});

describe("Phase 9R.6: failure atomicity at every interruption point", () => {
  it("1. a denied/failed server revocation writes no receipt and never mutates local occupancy", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, false);
    const original = b.update.bind(b);
    b.update = async (updates) => {
      if (membershipRevocationPath(code, ALICE) in updates) throw new Error("PERMISSION_DENIED: permission_denied");
      return original(updates);
    };
    await expect(revokePlayerAndCommit(d.writer, code, d.p1, storytellerOccupancyCompletion("remove", d.p1))).rejects.toThrow(/permission/i);
    b.update = original;
    expect(game().players[d.p1]).toMatchObject({ name: "Alice", participantId: d.PA, isEmpty: false });
    expect(await b.get(`${root}/roster/${ALICE}`)).toBe(d.p1);
    expect(await b.get(membershipRevocationPath(code, ALICE))).toBeUndefined();
  });

  it.each(["unseat", "remove"] as const)("3/4. %s: the local completion landed but no flush did -- reconnect applies nothing twice", async (action) => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
    await revokePlayerAndCommit(d.writer, code, d.p1, storytellerOccupancyCompletion(action, d.p1));
    await d.crash(); // before the debounced flush
    expect((await checkpointOf(b)).game.players[d.p1]!.participantId).toBe(d.PA); // checkpoint still holds her
    await reloadLocalImage();
    const local = structuredClone(game());
    const same = await reconnect(b, lobby, sessionId);
    expect(game().players).toEqual(local.players);
    expect(game().seatOrder).toEqual(local.seatOrder);
    expect(Object.keys(game().players)).toHaveLength(action === "remove" ? 4 : 5);
    await same.release();
    // And a fresh device, from the pre-completion checkpoint, still completes it.
    await freshDevice(b, lobby, sessionId);
    if (action === "remove") expect(game().players[d.p1]).toBeUndefined();
    else expectDepartedByUnseat(game(), d.p1, d.PA);
  });

  it("6. the receipt is retained across repeated reconnects and stays inert once completed", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const d = await liveDeviceWithAlice(b, lobby, sessionId, true);
    await expect(revokePlayerAndCommit(d.writer, code, d.p1, interrupted(storytellerOccupancyCompletion("remove", d.p1))))
      .rejects.toThrow(ProcessDied);
    await d.crash();
    await reloadLocalImage();
    const first = await reconnect(b, lobby, sessionId);
    const completed = structuredClone(game());
    await first.release();
    await reloadLocalImage();
    await reconnect(b, lobby, sessionId);
    expect(game().players).toEqual(completed.players);
    expect(game().seatOrder).toEqual(completed.seatOrder);
    expect(await b.get(membershipRevocationPath(code, ALICE))).toEqual({ playerId: d.p1, participantId: d.PA, action: "remove" });
  });
});

describe("Phase 9R.6: receipt evidence at the membership boundary", () => {
  async function hostWithSeat() {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    store().newGame("tb", { plannedPlayerCount: 5 });
    store().setLobby(lobby);
    const writer = new SessionWriter(b, code, sessionId);
    await writer.start();
    disposals.push(() => writer.dispose());
    const p1 = game().seatOrder[0]!;
    return { b, writer, p1 };
  }

  it("a modern binding's receipt names its rosterParticipants ParticipantId", async () => {
    const { b, writer, p1 } = await hostWithSeat();
    await knock(b, ALICE, "Alice", false);
    const PA = await seatLikeProduction(writer, ALICE, p1);
    await revokePlayerAndCommit(writer, code, p1, storytellerOccupancyCompletion("unseat", p1));
    expect(await b.get(membershipRevocationPath(code, ALICE))).toEqual({ playerId: p1, participantId: PA, action: "unseat" });
  });

  it("a legacy record-less binding's receipt names the local occupant this writer lineage publishes to it", async () => {
    const { b, writer, p1 } = await hostWithSeat();
    store().addPlayerToSeat("Alice");
    const PA = game().players[p1]!.participantId!;
    await knockOnLobby(b, code, ALICE, "Alice");
    await seatPlayer(writer, code, ALICE, p1, null); // no participant record
    expect(await b.get(rosterParticipantPath(code, ALICE))).toBeUndefined();
    await revokePlayerAndCommit(writer, code, p1, storytellerOccupancyCompletion("remove", p1));
    expect(await b.get(membershipRevocationPath(code, ALICE))).toEqual({ playerId: p1, participantId: PA, action: "remove" });
    expect(game().players[p1]).toBeUndefined();
  });

  it("an occupant contradicting the binding's record, or a record naming another seat, refuses the whole revocation before any write", async () => {
    const { b, writer, p1 } = await hostWithSeat();
    await knock(b, ALICE, "Alice", false);
    await seatLikeProduction(writer, ALICE, p1);
    const record = await b.get(rosterParticipantPath(code, ALICE)) as { playerId: string; participantId: string; name: string };
    for (const tampered of [{ ...record, participantId: "pt-someone-else" }, { ...record, playerId: "p-elsewhere" }]) {
      await b.set(rosterParticipantPath(code, ALICE), tampered);
      await expect(revokePlayerAndCommit(writer, code, p1, storytellerOccupancyCompletion("unseat", p1)))
        .rejects.toThrow(MembershipConflictError);
      expect(await b.get(`${root}/roster/${ALICE}`)).toBe(p1);
      expect(await b.get(membershipRevocationPath(code, ALICE))).toBeUndefined();
      expect(game().players[p1]!.isEmpty).toBe(false);
    }
  });

  it("no binding (an unbound local player), and revocations with no local completion owed, write no receipt", async () => {
    const { b, writer, p1 } = await hostWithSeat();
    store().addPlayerToSeat("Zed");
    await revokePlayerAndCommit(writer, code, p1, storytellerOccupancyCompletion("remove", p1));
    expect((await b.get(`${root}/membershipRevocations`)) ?? {}).toEqual({});
    const p2 = game().seatOrder[0]!;
    await knock(b, ALICE, "Alice", false);
    await seatLikeProduction(writer, ALICE, p2);
    await revokePlayerMembership(writer, code, p2); // compensation / reconciliation shape
    expect((await b.get(`${root}/membershipRevocations`)) ?? {}).toEqual({});
  });

  it("seating the same UID into a new participation instance retires its receipt in the same update", async () => {
    const { b, writer, p1 } = await hostWithSeat();
    await knock(b, ALICE, "Alice", false);
    const PA = await seatLikeProduction(writer, ALICE, p1);
    await revokePlayerAndCommit(writer, code, p1, storytellerOccupancyCompletion("unseat", p1));
    expect(await b.get(membershipRevocationPath(code, ALICE))).toBeDefined();
    await knock(b, ALICE, "Alice", false);
    const writes: Record<string, Json>[] = [];
    const original = b.update.bind(b);
    b.update = async (updates) => { writes.push(updates); return original(updates); };
    const PA2 = await seatLikeProduction(writer, ALICE, p1);
    b.update = original;
    expect(PA2).not.toBe(PA);
    expect(await b.get(membershipRevocationPath(code, ALICE))).toBeUndefined();
    const seatWrite = writes.find((u) => `${root}/roster/${ALICE}` in u)!;
    expect(seatWrite[membershipRevocationPath(code, ALICE)]).toBeNull();
    expect(seatWrite[rosterParticipantPath(code, ALICE)]).toMatchObject({ participantId: PA2 });
  });

  it("the player-facing outcome stays the simple 'revoked' string and the revoked client terminates as before", async () => {
    const { b, writer, p1 } = await hostWithSeat();
    await knock(b, ALICE, "Alice", false);
    await seatLikeProduction(writer, ALICE, p1);
    usePlayerStore.getState().setSession({ code, uid: ALICE, requestedName: "Alice" });
    disposals.push(startPlayerHandshake(b, code, ALICE));
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("seated"));
    await revokePlayerAndCommit(writer, code, p1, storytellerOccupancyCompletion("remove", p1));
    expect(await b.get(`${root}/outcomes/${ALICE}`)).toBe("revoked");
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("revoked"));
    expect(usePlayerStore.getState().self).toBeNull();
  });
});
