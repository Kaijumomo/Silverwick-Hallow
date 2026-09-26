// Phase 9R.2 Astra remediation R1: stale-checkpoint (or stale local game) +
// current membership. A reusable seat (PlayerId) whose occupant changed after
// the last successful projection must never recover with the EARLIER
// participation instance as its current occupant: membership reconciliation
// may keep a recovered occupant only when it is PROVEN -- by ParticipantId,
// through the Storyteller-only rosterParticipants record written with the
// binding -- to be the instance the live binding seats. Never by a matching
// PlayerId, UID, name, or seat.
//
// Every step below is a real production entry point: the managed session
// (startStorytellerSession + its own debounced flush), the real seating
// sequence the Storyteller UI runs (SeatAssignPopup: mint the participant
// once, seatPlayerAndCommit + assignPendingToSeat), revokePlayerAndCommit,
// and fresh-device / same-device / conflict recovery. "Lost projections" are
// modeled exactly as they happen: the device that made the membership
// changes stops before any later flush lands (a lease-holding writer with no
// flush loop commits the membership writes), so the surviving checkpoint is
// the earlier one while the roster has moved on.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { newParticipantId, refersToParticipant } from "@/stores/participants";
import type { ParticipantRef, PlayerId, StorytellerLobbyRecord } from "@/stores/types";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby, knockOnLobby, revokePlayerMembership, seatPlayer } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { resolveReconnectConflict, startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { revokePlayerAndCommit, seatPlayerAndCommit, storytellerOccupancyCompletion } from "./membershipCommands";
import { startPlayerHandshake } from "./playerSync";
import { writeProjections } from "./sync";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import type { RoomBackend } from "./backend";

const code = "MEMB2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];
const store = () => useStorytellerStore.getState();
const game = () => store().game!;

function resetStore() {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: {},
  });
}
beforeEach(() => {
  resetStore();
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
});
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
  releaseRecovered = null;
});

type Lobby = { code: string; uid: string; sessionId: string; status: "live" };

async function openLobby(b: MemoryRoomBackend): Promise<{ lobby: Lobby; sessionId: string }> {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  return { lobby: { code, uid: "host", sessionId: session.id, status: "live" }, sessionId: session.id };
}

/** Exactly the Storyteller UI's seating sequence (SeatAssignPopup's
 * handleAssign, backend branch): mint the participation instance once, then
 * seat remotely with it and commit locally with the same ParticipantId. */
async function seatLikeProduction(backend: RoomBackend, uid: string, seatId: PlayerId) {
  const name = store().game!.pendingPlayers[uid]!;
  expect(name).toBeTruthy();
  const participant = { participantId: newParticipantId(), name };
  await seatPlayerAndCommit(backend, code, uid, seatId, null,
    () => store().assignPendingToSeat(uid, seatId, participant.participantId), participant);
  expect(store().game!.players[seatId]!.participantId).toBe(participant.participantId);
  return participant.participantId;
}

/** A player knocks and the Storyteller's own join-request watcher (or, for
 * a writer with no session loop, the same addToPendingQueue call that watcher
 * makes) queues them. */
async function knock(b: MemoryRoomBackend, uid: string, name: string, watched: boolean) {
  await knockOnLobby(b, code, uid, name);
  if (watched) await waitFor(() => expect(store().game!.pendingPlayers[uid]).toBe(name));
  else store().addToPendingQueue(uid, name);
}

async function waitForCheckpoint(b: MemoryRoomBackend, predicate: (g: StorytellerLobbyRecord) => boolean) {
  await waitFor(async () => {
    const raw = await b.get(`${root}/checkpoint`);
    expect(typeof raw).toBe("string");
    expect(predicate(JSON.parse(raw as string).game)).toBe(true);
  });
}

const ref = (participantId: string, playerId: string, nameAtTime: string): ParticipantRef =>
  ({ kind: "participant", participantId, playerId, nameAtTime });

/**
 * Device 1, fully live: a 5-seat Trouble Brewing game in Night 1 where
 * Alice was seated through real membership at `p1` (washerwoman, revealed
 * shown role) and live History / Information / Provenance / Effect records
 * name her. Returns once the real debounced flush has landed a checkpoint
 * containing all of it -- the last projection that will ever succeed.
 */
async function device1WithAlice(b: MemoryRoomBackend, sessionId: string, lobby: Lobby) {
  store().newGame("tb", { plannedPlayerCount: 5 });
  store().setLobby(lobby);
  const writer = new SessionWriter(b, code, sessionId);
  const manager = await startStorytellerSession(b, lobby, writer);
  const p1 = game().seatOrder[0]!;
  await knock(b, "uid-alice", "Alice", true);
  const PA = await seatLikeProduction(writer, "uid-alice", p1);
  for (const name of ["Carol", "Dave", "Eve", "Frank"]) store().addPlayerToSeat(name);
  store().setRolePool(["washerwoman", "librarian", "chef", "poisoner", "imp"]);
  expect(store().dealRolePool().ok).toBe(true);
  const holder = Object.values(game().players).find((p) => p.actualRole === "washerwoman")!.id;
  if (holder !== p1) expect(store().swapSetupRoles(p1, holder).ok).toBe(true);
  for (const id of game().seatOrder) store().showAssignedRole(id);
  expect(store().revealRoles().ok).toBe(true);
  expect(store().beginNightOne().ok).toBe(true);
  const carol = game().seatOrder[1]!;
  const dave = game().seatOrder[2]!;
  store().setStatus(p1, "poisoned", true); // History about Alice
  store().addEffect(carol, { type: "marked", sourcePlayer: p1, lifetime: { kind: "manual" } }); // Alice as source
  expect(store().recordInformationDelivery(p1, "washerwoman-first-night", [
    { requirementId: "players", kind: "player", playerIds: [carol, dave] },
    { requirementId: "role", kind: "role", roleId: "chef" },
  ], { provenance: { sourcePlayer: p1 } }).ok).toBe(true);
  await waitForCheckpoint(b, (g) => g.informationDeliveries.length === 1 && g.players[p1]!.participantId === PA);
  expect(await b.get(`${root}/player/${p1}`)).toEqual({ shownRole: "washerwoman", shownAlignment: "good" });
  const aliceHistory = structuredClone(game().history);
  const aliceDelivery = structuredClone(game().informationDeliveries[0]!);
  manager.stop();
  await writer.dispose();
  return { p1, PA, carol, dave, aliceHistory, aliceDelivery };
}

/** The same Storyteller keeps working, but none of its projections land:
 * a lease-holding writer with no session/flush loop commits the membership
 * writes (roster, rosterParticipants, outcomes, player path) exactly as the
 * live UI would, while the local game follows the local commits. */
async function unflushedWriter(b: MemoryRoomBackend, sessionId: string) {
  const writer = new SessionWriter(b, code, sessionId);
  await writer.start();
  disposals.push(() => writer.dispose());
  return writer;
}

let releaseRecovered: (() => Promise<void>) | null = null;
async function freshDeviceRecovery(b: MemoryRoomBackend, lobby: Lobby, sessionId: string) {
  // A previous recovered session in this test gives up its lease first, as
  // closing that device would.
  if (releaseRecovered) await releaseRecovered();
  resetStore();
  store().setLobby(lobby);
  const writer = new SessionWriter(b, code, sessionId);
  const recovered = await startStorytellerSession(b, lobby, writer);
  let released = false;
  releaseRecovered = async () => { if (released) return; released = true; recovered.stop(); await writer.dispose(); };
  disposals.push(releaseRecovered);
  expect(recovered.outcome).toBe("live");
  return game();
}

async function playerView(b: MemoryRoomBackend, uid: string, name: string) {
  usePlayerStore.getState().setSession({ code, uid, requestedName: name });
  disposals.push(startPlayerHandshake(b, code, uid));
  await waitFor(() => expect(usePlayerStore.getState().status).toBe("seated"));
  return usePlayerStore.getState();
}

describe("R1-A: single reuse -- A leaves p1, B is seated at p1, the recoverable checkpoint still holds A", () => {
  it("fresh-device recovery seats B with B's own recorded ParticipantId; A's history stays A's; B inherits nothing of A; the result republishes safely", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const { p1, PA, carol, aliceHistory, aliceDelivery } = await device1WithAlice(b, sessionId, lobby);

    const w2 = await unflushedWriter(b, sessionId);
    await revokePlayerAndCommit(w2, code, p1, storytellerOccupancyCompletion("unseat", p1));
    await knock(b, "uid-bob", "Bob", false);
    const PB = await seatLikeProduction(w2, "uid-bob", p1);
    expect(PB).not.toBe(PA);
    await w2.dispose();
    // The surviving checkpoint is still device 1's: A at p1.
    const stale = JSON.parse(await b.get(`${root}/checkpoint`) as string).game as StorytellerLobbyRecord;
    expect(stale.players[p1]!.participantId).toBe(PA);
    expect(await b.get(`${root}/roster`)).toEqual({ "uid-bob": p1 });

    const recovered = await freshDeviceRecovery(b, lobby, sessionId);

    // Current seat is the current membership occupant, with B's authoritative identity.
    const seat = recovered.players[p1]!;
    expect(seat.isEmpty).toBe(false);
    expect(seat.name).toBe("Bob");
    expect(seat.participantId).toBe(PB);
    expect(seat.participantId).not.toBe(PA);
    // B inherits nothing of A's name / role / perception / private state.
    expect(seat.actualRole).toBe("");
    expect(seat.shownRole).toBeNull();
    expect(seat.shownAlignment).toBeNull();
    expect(seat.privateInfo).toBeUndefined();
    expect(seat.publishedPacket).toBeUndefined();
    expect(seat.effects).toEqual([]);
    expect(seat.reminders).toEqual([]);
    // A's historical records stay A's -- nothing rewritten, nothing rebound to B.
    expect(recovered.history).toEqual(aliceHistory);
    expect(recovered.history[0]!.participant).toEqual(ref(PA, p1, "Alice"));
    expect(recovered.informationDeliveries).toEqual([aliceDelivery]);
    expect(recovered.informationDeliveries[0]!.recipient).toEqual(ref(PA, p1, "Alice"));
    expect(recovered.players[carol]!.effects.find((e) => e.type === "marked")!.sourceParticipant).toEqual(ref(PA, p1, "Alice"));
    expect(recovered.history.some((h) => refersToParticipant(h.participant, PB))).toBe(false);

    // Republished safely: B's private seat path carries nothing of A's
    // role, the public seat shows B, and B's own client sees no role.
    expect(await b.get(`${root}/player/${p1}`)).toBeUndefined();
    const pub = await b.get(`${root}/public`) as { players: Record<string, { name: string }> };
    expect(pub.players[p1]!.name).toBe("Bob");
    const bob = await playerView(b, "uid-bob", "Bob");
    expect(bob.playerId).toBe(p1);
    expect(bob.self).toBeNull();
    expect(JSON.stringify(pub)).not.toMatch(/participant|nameAtTime|recipient/);

    // Repeated recovery (another fresh device) is stable: B stays B.
    const again = await freshDeviceRecovery(b, lobby, sessionId);
    expect(again.players[p1]!.participantId).toBe(PB);
    expect(again.history).toEqual(aliceHistory);
  });
});

describe("R1-B: multiple generations on one PlayerId, checkpoint lagging an earlier generation", () => {
  it("A -> B -> C with the checkpoint still holding A: C recovers as C; neither PA nor PB becomes current", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const { p1, PA, aliceHistory } = await device1WithAlice(b, sessionId, lobby);
    const w2 = await unflushedWriter(b, sessionId);
    await revokePlayerAndCommit(w2, code, p1, storytellerOccupancyCompletion("unseat", p1));
    await knock(b, "uid-bob", "Bob", false);
    const PB = await seatLikeProduction(w2, "uid-bob", p1);
    await revokePlayerAndCommit(w2, code, p1, storytellerOccupancyCompletion("unseat", p1));
    await knock(b, "uid-cara", "Cara", false);
    const PC = await seatLikeProduction(w2, "uid-cara", p1);
    await w2.dispose();

    const recovered = await freshDeviceRecovery(b, lobby, sessionId);
    expect(recovered.players[p1]!.participantId).toBe(PC);
    expect(recovered.players[p1]!.name).toBe("Cara");
    expect([PA, PB]).not.toContain(recovered.players[p1]!.participantId);
    expect(recovered.history).toEqual(aliceHistory);
  });

  it("checkpoint lagging the middle generation: B was checkpointed, then B left and C was seated -- C recovers, PB stays historical", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const { p1, PA } = await device1WithAlice(b, sessionId, lobby);
    // Device 1b: a live session that DOES flush B's generation.
    const w2 = new SessionWriter(b, code, sessionId);
    const m2 = await startStorytellerSession(b, lobby, w2);
    await revokePlayerAndCommit(w2, code, p1, storytellerOccupancyCompletion("unseat", p1));
    await knock(b, "uid-bob", "Bob", true);
    const PB = await seatLikeProduction(w2, "uid-bob", p1);
    store().setStatus(p1, "drunk", true); // History about B
    await waitForCheckpoint(b, (g) => g.players[p1]!.participantId === PB && g.history.length === 3);
    const bRecord = structuredClone(game().history.at(-1)!);
    m2.stop(); await w2.dispose();
    const w3 = await unflushedWriter(b, sessionId);
    await revokePlayerAndCommit(w3, code, p1, storytellerOccupancyCompletion("unseat", p1));
    await knock(b, "uid-cara", "Cara", false);
    const PC = await seatLikeProduction(w3, "uid-cara", p1);
    await w3.dispose();

    const recovered = await freshDeviceRecovery(b, lobby, sessionId);
    expect(recovered.players[p1]!.participantId).toBe(PC);
    expect([PA, PB]).not.toContain(recovered.players[p1]!.participantId);
    expect(recovered.history.at(-1)).toEqual(bRecord);
    expect(recovered.history.at(-1)!.participant).toEqual(ref(PB, p1, "Bob"));
  });
});

describe("R1-C: several reused seats, interleaved -- no cross-binding", () => {
  it("A@p1 and Carol@p2 both leave; Yann takes p1 and Bea takes p2 in interleaved order; each seat recovers its own live participant", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    store().newGame("tb", { plannedPlayerCount: 5 });
    store().setLobby(lobby);
    const w1 = new SessionWriter(b, code, sessionId);
    const m1 = await startStorytellerSession(b, lobby, w1);
    const [p1, p2] = game().seatOrder as [string, string];
    await knock(b, "uid-alice", "Alice", true);
    const PA = await seatLikeProduction(w1, "uid-alice", p1);
    await knock(b, "uid-carol", "Carol", true);
    const PCarol = await seatLikeProduction(w1, "uid-carol", p2);
    await waitForCheckpoint(b, (g) => g.players[p1]!.participantId === PA && g.players[p2]!.participantId === PCarol);
    m1.stop(); await w1.dispose();

    const w2 = await unflushedWriter(b, sessionId);
    await revokePlayerAndCommit(w2, code, p1, storytellerOccupancyCompletion("unseat", p1));
    await knock(b, "uid-bea", "Bea", false);
    await revokePlayerAndCommit(w2, code, p2, storytellerOccupancyCompletion("unseat", p2));
    const PBea = await seatLikeProduction(w2, "uid-bea", p2);
    await knock(b, "uid-yann", "Yann", false);
    const PYann = await seatLikeProduction(w2, "uid-yann", p1);
    await w2.dispose();

    const recovered = await freshDeviceRecovery(b, lobby, sessionId);
    expect(recovered.players[p1]).toMatchObject({ name: "Yann", participantId: PYann });
    expect(recovered.players[p2]).toMatchObject({ name: "Bea", participantId: PBea });
    const ids = Object.values(recovered.players).map((p) => p.participantId).filter(Boolean);
    expect(ids).not.toContain(PA);
    expect(ids).not.toContain(PCarol);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("R1-C2: a locally typed (never-bound) checkpoint occupant replaced by a member", () => {
  it("the checkpoint's roster never bound the seat at all -- the unbound occupant is still not kept for the member now bound there", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    store().newGame("tb", { plannedPlayerCount: 5 });
    store().addPlayerToSeat("Zed"); // typed by the Storyteller; no membership
    store().setLobby(lobby);
    const w1 = new SessionWriter(b, code, sessionId);
    const m1 = await startStorytellerSession(b, lobby, w1);
    const p1 = game().seatOrder[0]!;
    const PZ = game().players[p1]!.participantId!;
    store().setNotes(p1, "Zed's notes");
    await waitForCheckpoint(b, (g) => g.players[p1]!.stNotes === "Zed's notes");
    m1.stop(); await w1.dispose();
    const w2 = await unflushedWriter(b, sessionId);
    store().unseatPlayer(p1); // local-only: Zed was never a member
    await knock(b, "uid-bob", "Bob", false);
    const PB = await seatLikeProduction(w2, "uid-bob", p1);
    await w2.dispose();
    expect(JSON.parse(await b.get(`${root}/checkpoint`) as string).roster).toEqual({});

    const recovered = await freshDeviceRecovery(b, lobby, sessionId);
    expect(recovered.players[p1]).toMatchObject({ name: "Bob", participantId: PB, stNotes: "" });
    expect(recovered.players[p1]!.participantId).not.toBe(PZ);
  });
});

describe("R1-D: a later participant with the SAME display name", () => {
  it("a second 'Alice' seated at Alice's old seat is a new participation instance -- no historical continuity is inferred from the name", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const { p1, PA, aliceHistory } = await device1WithAlice(b, sessionId, lobby);
    const w2 = await unflushedWriter(b, sessionId);
    await revokePlayerAndCommit(w2, code, p1, storytellerOccupancyCompletion("unseat", p1));
    await knock(b, "uid-alice-2", "Alice", false);
    const PA2 = await seatLikeProduction(w2, "uid-alice-2", p1);
    await w2.dispose();

    const recovered = await freshDeviceRecovery(b, lobby, sessionId);
    expect(recovered.players[p1]).toMatchObject({ name: "Alice", participantId: PA2 });
    expect(PA2).not.toBe(PA);
    expect(recovered.players[p1]!.shownRole).toBeNull(); // not the first Alice's washerwoman
    expect(recovered.history).toEqual(aliceHistory);
    expect(recovered.history.some((h) => refersToParticipant(h.participant, PA2))).toBe(false);
  });
});

describe("R1-E: the SAME external UID seated again for a later participation instance", () => {
  // Production rules refuse a revoked UID's own new join request, but the
  // architecture does let the Storyteller seat that UID again: seatPlayer
  // itself clears a prior "revoked" outcome, so any pending entry for the UID
  // (here: a new knock, which the memory backend -- having no rules --
  // accepts) is seated through the ordinary path as a NEW instance.
  it("UID equality never revives the prior ParticipantId", async () => {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const { p1, PA, aliceHistory } = await device1WithAlice(b, sessionId, lobby);
    const w2 = await unflushedWriter(b, sessionId);
    await revokePlayerAndCommit(w2, code, p1, storytellerOccupancyCompletion("unseat", p1));
    await knock(b, "uid-alice", "Alice", false);
    const PA2 = await seatLikeProduction(w2, "uid-alice", p1);
    expect(PA2).not.toBe(PA);
    await w2.dispose();
    // Same UID, same seat as the checkpoint's binding -- still not proof.
    const stale = JSON.parse(await b.get(`${root}/checkpoint`) as string);
    expect(stale.roster).toEqual({ "uid-alice": p1 });
    expect(await b.get(`${root}/roster`)).toEqual({ "uid-alice": p1 });

    const recovered = await freshDeviceRecovery(b, lobby, sessionId);
    expect(recovered.players[p1]!.participantId).toBe(PA2);
    expect(recovered.players[p1]!.shownRole).toBeNull();
    expect(recovered.history).toEqual(aliceHistory);
    expect(recovered.history[0]!.participant).toEqual(ref(PA, p1, "Alice"));
  });
});

describe("R1: a stale LOCAL game (same-tab reconnect through an explicit CONFLICT choice)", () => {
  /** Device A holds Alice at p1 and has unflushed local work; meanwhile a
   * second Storyteller device revokes Alice, seats Bob at p1 (with his
   * participant record) and publishes its own checkpoint. */
  async function staleLocalConflict() {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const { p1, PA, aliceHistory } = await device1WithAlice(b, sessionId, lobby);
    store().setNotes(p1, "unflushed local work on device A"); // device A is now dirty
    const localStale = structuredClone(game());
    // Device B -- a different Storyteller device: membership + its own projection.
    const wB = new SessionWriter(b, code, sessionId);
    await wB.start();
    await revokePlayerMembership(wB, code, p1);
    const PB = newParticipantId();
    await knockOnLobby(b, code, "uid-bob", "Bob");
    await seatPlayer(wB, code, "uid-bob", p1, null, { participantId: PB, name: "Bob" });
    const foreign = structuredClone(localStale);
    foreign.players[p1] = {
      ...foreign.players[p1]!, name: "Bob", participantId: PB, actualRole: "", shownRole: null,
      shownAlignment: null, stNotes: "", effects: [], reminders: [],
    };
    delete foreign.players[p1]!.publishedPacket;
    foreign.notes = "device B's game";
    await writeProjections({ backend: wB, code, stState: foreign, registry: buildRegistry(troubleBrewing), online: {}, membership: { "uid-bob": p1 } });
    await wB.dispose();
    // Device A reconnects: remote advanced + local dirty -> CONFLICT.
    const wA = new SessionWriter(b, code, sessionId);
    const managerA = await startStorytellerSession(b, lobby, wA);
    disposals.push(async () => { managerA.stop(); await wA.dispose(); });
    expect(managerA.outcome).toBe("conflict");
    return { b, p1, PA, PB, aliceHistory };
  }

  it("keepLocal: the stale local occupant (A) is not kept for B's binding -- B is restored with B's recorded identity, A's history intact", async () => {
    const { b, p1, PA, PB, aliceHistory } = await staleLocalConflict();
    expect(await resolveReconnectConflict("keepLocal")).toBe("applied");
    const local = game();
    expect(local.players[p1]).toMatchObject({ name: "Bob", participantId: PB, shownRole: null });
    expect(local.players[p1]!.participantId).not.toBe(PA);
    expect(local.history).toEqual(aliceHistory);
    expect(local.notes).not.toBe("device B's game"); // still the local side
    expect(await b.get(`${root}/player/${p1}`)).toBeUndefined();
  });

  it("useRemote: the remote game's B is proven by B's record and kept exactly", async () => {
    const { p1, PB } = await staleLocalConflict();
    expect(await resolveReconnectConflict("useRemote")).toBe("applied");
    expect(game().notes).toBe("device B's game");
    expect(game().players[p1]).toMatchObject({ name: "Bob", participantId: PB });
  });
});

describe("R1: bindings with no participant record (created before records existed)", () => {
  async function legacyBoundAlice() {
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    store().newGame("tb", { plannedPlayerCount: 5 });
    store().addPlayerToSeat("Alice");
    store().setLobby(lobby);
    const writer = new SessionWriter(b, code, sessionId);
    const manager = await startStorytellerSession(b, lobby, writer);
    const p1 = game().seatOrder[0]!;
    await knock(b, "uid-alice", "Alice", true);
    await seatPlayer(writer, code, "uid-alice", p1, null); // legacy: no participant record
    // seatPlayer consumed the join request; the watcher drops the queue entry.
    await waitFor(() => expect(game().pendingPlayers["uid-alice"]).toBeUndefined());
    expect((await b.get(`${root}/rosterParticipants`)) ?? {}).toEqual({});
    store().setNotes(p1, "flush me");
    await waitForCheckpoint(b, (g) => g.players[p1]!.stNotes === "flush me");
    const PA = game().players[p1]!.participantId!;
    manager.stop(); await writer.dispose();
    return { b, lobby, sessionId, p1, PA };
  }

  it("same-device reconnect with no foreign commit (write lineage) keeps the legacy-bound occupant", async () => {
    const { b, lobby, sessionId, p1, PA } = await legacyBoundAlice();
    const writer = new SessionWriter(b, code, sessionId);
    const manager = await startStorytellerSession(b, lobby, writer);
    disposals.push(async () => { manager.stop(); await writer.dispose(); });
    expect(game().players[p1]).toMatchObject({ name: "Alice", participantId: PA });
    expect(await b.get(`${root}/roster`)).toEqual({ "uid-alice": p1 });
  });

  it("fresh-device recovery cannot prove the legacy binding's participant -- the occupant is not kept as current, and the unresolvable binding is revoked", async () => {
    const { b, lobby, sessionId, p1 } = await legacyBoundAlice();
    const recovered = await freshDeviceRecovery(b, lobby, sessionId);
    expect(recovered.players[p1]!.isEmpty).toBe(true);
    expect("participantId" in recovered.players[p1]!).toBe(false);
    expect((await b.get(`${root}/roster`)) ?? {}).toEqual({});
    expect(await b.get(`${root}/outcomes/uid-alice`)).toBe("revoked");
  });
});

describe("R1 recovery matrix: an unchanged, production-seated member keeps ONE participation identity through every recovery path", () => {
  it("local reload -> same-tab reconnect -> Undo -> repeated reload/reconnect -> fresh-device restore: always PA, History always intact", async () => {
    const STORAGE_KEY = "new-blood-st";
    const b = new MemoryRoomBackend();
    const { lobby, sessionId } = await openLobby(b);
    const { p1, PA, aliceHistory } = await device1WithAlice(b, sessionId, lobby);
    const expectAlice = (label: string) => {
      expect(game().players[p1], label).toMatchObject({ name: "Alice", participantId: PA, shownRole: "washerwoman" });
      expect(game().history, label).toEqual(aliceHistory);
    };
    const reload = async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const raw = localStorage.getItem(STORAGE_KEY)!;
      expect(JSON.parse(raw).version).toBe(20);
      resetStore();
      localStorage.setItem(STORAGE_KEY, raw);
      await useStorytellerStore.persist.rehydrate();
    };
    const reconnect = async () => {
      const writer = new SessionWriter(b, code, sessionId);
      const manager = await startStorytellerSession(b, lobby, writer);
      expect(manager.outcome).toBe("live");
      return async () => { manager.stop(); await writer.dispose(); };
    };

    await reload();
    expectAlice("after local hydration");
    let release = await reconnect(); // same-tab: KEEP_LOCAL, proven by Alice's record
    expectAlice("after same-tab reconnect");
    store().setNotes(game().seatOrder[1]!, "an ordinary edit");
    store().undo();
    expectAlice("after Undo");
    await release();
    await reload();
    release = await reconnect();
    expectAlice("after repeated reload + reconnect");
    await waitForCheckpoint(b, (g) => g.players[p1]!.participantId === PA);
    await release();
    await freshDeviceRecovery(b, lobby, sessionId); // RESTORE, proven by Alice's record
    expectAlice("after fresh-device restore");
    expect(await b.get(`${root}/roster`)).toEqual({ "uid-alice": p1 });
    expect(await b.get(`${root}/player/${p1}`)).toEqual({ shownRole: "washerwoman", shownAlignment: "good" });
  });
});
