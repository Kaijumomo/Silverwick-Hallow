import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { participantRefOf, refersToParticipant } from "./participants";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import type { ParticipantRef, PlayerId, StorytellerLobbyRecord } from "./types";

// Phase 9R.2: Historical Participant Identity. A seat/slot (PlayerId) may be
// reused; a historical participant identity (ParticipantId) never is. Every
// History / Provenance / Information Delivery / Effect / Reminder record
// keeps referring to the PERSON it originally described, even after that
// person leaves and someone else fills the same seat. All of this is driven
// through the real store commands -- never hand-built records.

const registry = buildRegistry(setupScript);
const game = () => store.getState().game!;
const state = () => store.getState();
const STORAGE_KEY = "new-blood-st";

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
});

const NAMES = ["Alice", "Carol", "Dave", "Eve", "Frank", "Grace", "Heidi"] as const;
type Name = (typeof NAMES)[number];
const POOL = ["washerwoman", "fortuneteller", "investigator", "chef", "empath", "poisoner", "imp"];

const idOf = (name: string): PlayerId => {
  const player = Object.values(game().players).find((p) => p.name === name && !p.isEmpty);
  if (!player) throw new Error(`no seated player named ${name}`);
  return player.id;
};
const participantIdOf = (id: PlayerId) => game().players[id]!.participantId!;

/** Moves `role` onto `playerId` with a composition-neutral Setup Swap. */
function placeRole(playerId: PlayerId, role: string) {
  const holder = Object.values(game().players).find((p) => p.actualRole === role)!.id;
  if (holder !== playerId) expect(state().swapSetupRoles(playerId, holder).ok).toBe(true);
}

/** A 7-player Night 1 game with deterministic roles on named players:
 * Alice=washerwoman, Carol=fortuneteller, Dave=chef, Eve=poisoner. */
function liveGame(roles: Partial<Record<Name, string>> = { Alice: "washerwoman", Carol: "fortuneteller", Dave: "chef", Eve: "poisoner" }) {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (const name of NAMES) state().addPlayerToSeat(name);
  state().setRolePool(POOL);
  expect(state().dealRolePool().ok).toBe(true);
  for (const [name, role] of Object.entries(roles)) placeRole(idOf(name), role);
  for (const id of game().seatOrder) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
}

const aliceSnapshot = (playerId: PlayerId, participantId: string): ParticipantRef =>
  ({ kind: "participant", participantId, playerId, nameAtTime: "Alice" });

describe("Phase 9R.2: participant generation and empty-seat semantics", () => {
  it("every real occupancy path generates a fresh, distinct ParticipantId; empty planned seats never get one", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 3, plannedTravelerCount: 0 });
    // newGame: three empty planned seats, no participant identity at all.
    for (const id of game().seatOrder) {
      expect(game().players[id]!.isEmpty).toBe(true);
      expect("participantId" in game().players[id]!).toBe(false);
    }
    state().addPlayerToSeat("Alice"); // fills an existing empty seat
    state().addToPendingQueue("uid-carol", "Carol");
    expect(state().assignPendingToSeat("uid-carol", game().seatOrder[1]!)).toBe(true); // knock -> seat
    state().addPlayer("Dave"); // brand-new occupied seat
    state().addEmptySeat(); // deliberate empty planned seat
    state().addTravelerSeat(); // planned Traveler reservation (still empty)
    state().addPlayerToSeat("Eve"); // fills the remaining original empty seat

    const occupied = Object.values(game().players).filter((p) => !p.isEmpty);
    const empty = Object.values(game().players).filter((p) => p.isEmpty);
    expect(occupied.map((p) => p.name).sort()).toEqual(["Alice", "Carol", "Dave", "Eve"]);
    expect(empty).toHaveLength(2);
    for (const p of occupied) expect(p.participantId).toMatch(/^pt-./);
    for (const p of empty) expect("participantId" in p).toBe(false);
    const ids = occupied.map((p) => p.participantId);
    expect(new Set(ids).size).toBe(ids.length);
    // Never derived from the seat, name, uid, or joinedAt.
    for (const p of occupied) {
      expect(p.participantId).not.toContain(p.id);
      expect(p.participantId).not.toContain(p.name);
    }
  });

  it("participantRefOf snapshots exactly participantId/playerId/nameAtTime, and returns null for an empty seat, a nonexistent id, an inherited prototype key, or a malformed id", () => {
    liveGame();
    const alice = idOf("Alice");
    const ref = participantRefOf(game(), alice);
    expect(ref).toEqual({ kind: "participant", participantId: participantIdOf(alice), playerId: alice, nameAtTime: "Alice" });
    expect(participantRefOf(game(), alice)).not.toBe(ref); // a fresh, caller-owned snapshot each call
    expect(participantRefOf(game(), "not-a-player")).toBeNull();
    expect(participantRefOf(game(), "toString")).toBeNull();
    expect(participantRefOf(game(), 42)).toBeNull();
    expect(state().unseatPlayer(alice)).toBe(true);
    expect(participantRefOf(game(), alice)).toBeNull(); // empty seat names nobody
    // An occupied seat missing its identity is never papered over.
    const carol = idOf("Carol");
    const broken = structuredClone(game());
    delete broken.players[carol]!.participantId;
    expect(participantRefOf(broken, carol)).toBeNull();
  });
});

describe("Phase 9R.2: identity is preserved across ordinary change", () => {
  it("seat movement, reordering, rename, Role/alignment changes, death, and Traveler exile never change a participant's ParticipantId", () => {
    liveGame();
    const alice = idOf("Alice");
    const A = participantIdOf(alice);
    state().movePlayer(alice, "right");
    expect(participantIdOf(alice)).toBe(A);
    state().setSeatOrder([...game().seatOrder].reverse());
    expect(participantIdOf(alice)).toBe(A);
    state().renamePlayer(alice, "Alicia");
    expect(participantIdOf(alice)).toBe(A);
    state().assignRole(alice, "imp");
    state().setActualAlignment(alice, "evil");
    state().setAlive(alice, false);
    state().setStatus(alice, "drunk", true);
    expect(participantIdOf(alice)).toBe(A);

    state().addPlayerToSeat("Tess"); // post-Reveal arrival: a Traveler
    const tess = idOf("Tess");
    const T = participantIdOf(tess);
    state().assignRole(tess, "thief");
    state().setTravelerAlignment(tess, "evil");
    state().exileTraveler(tess);
    expect(game().players[tess]!.exiled).toBe(true);
    expect(participantIdOf(tess)).toBe(T);
  });

  it("ordinary <-> Traveler conversion (a Setup-time Role change) keeps the same participant", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 6, plannedTravelerCount: 0 });
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    const before = participantIdOf(id);
    expect(state().setIsTraveler(id, true).ok).toBe(true);
    expect(participantIdOf(id)).toBe(before);
  });

  it("moving a seat never rewrites an already-recorded snapshot's historical seat context", () => {
    liveGame();
    const alice = idOf("Alice");
    state().setStatus(alice, "poisoned", true);
    const recorded = structuredClone(game().history.at(-1)!.participant);
    state().setSeatOrder([...game().seatOrder].reverse());
    state().movePlayer(alice, "left");
    expect(game().history.find((h) => h.category === "effect")!.participant).toEqual(recorded);
  });
});

describe("Phase 9R.2: rename never rewrites history", () => {
  it("records made as \"Alice\" keep nameAtTime \"Alice\" after a rename; later records snapshot \"Alicia\"; the ParticipantId never changes", () => {
    liveGame();
    const alice = idOf("Alice");
    const A = participantIdOf(alice);
    state().setStatus(alice, "poisoned", true);
    const delivered = state().recordInformationDelivery(alice, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [idOf("Carol"), idOf("Dave")] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(delivered.ok).toBe(true);

    state().renamePlayer(alice, "Alicia");
    expect(game().players[alice]!.name).toBe("Alicia");
    expect(game().history[0]!.participant).toEqual(aliceSnapshot(alice, A));
    expect(game().informationDeliveries[0]!.recipient).toEqual(aliceSnapshot(alice, A));

    state().setStatus(alice, "poisoned", false);
    expect(game().history[1]!.participant).toEqual({ kind: "participant", participantId: A, playerId: alice, nameAtTime: "Alicia" });
    expect(game().history[0]!.participant).toEqual(aliceSnapshot(alice, A)); // still untouched
  });
});

// ---------------------------------------------------------------------------
// Section 17: the central closure proof.
// ---------------------------------------------------------------------------
describe("Phase 9R.2 core regression: Alice leaves, Bob fills her seat -- history never re-attaches to Bob", () => {
  it.each([
    ["addPlayerToSeat", () => state().addPlayerToSeat("Bob")],
    ["assignPendingToSeat (knock -> seat)", (seat: PlayerId) => {
      state().addToPendingQueue("uid-bob", "Bob");
      expect(state().assignPendingToSeat("uid-bob", seat)).toBe(true);
    }],
  ] as const)("refill via %s", (_label, refill) => {
    liveGame();
    const P = idOf("Alice");
    const carol = idOf("Carol");
    const dave = idOf("Dave");
    const seatIndex = game().seatOrder.indexOf(P);
    // 1-2. Alice occupies PlayerId P with ParticipantId A.
    const A = participantIdOf(P);
    const alice = aliceSnapshot(P, A);

    // 3. Live Play records involving Alice.
    state().setStatus(P, "poisoned", true); // History targeting Alice
    state().setGhostVote(P, false); // History targeting Alice (another category)
    expect(state().recordInformationDelivery(P, "washerwoman-first-night", [ // Delivery TO Alice
      { requirementId: "players", kind: "player", playerIds: [carol, dave] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ], { provenance: { sourcePlayer: P, reason: "Alice's own first-night wake" } }).ok).toBe(true);
    expect(state().recordInformationDelivery(carol, "fortuneteller-first-night", [ // Player-valued Information containing Alice
      { requirementId: "players", kind: "player", playerIds: [P, dave] },
      { requirementId: "isDemon", kind: "boolean", value: false },
    ]).ok).toBe(true);
    state().setAlive(dave, false, { provenance: { sourcePlayer: P, reason: "caused by Alice" } }); // Provenance from Alice (Mutation Context)
    state().addReminder(carol, { label: "Townsfolk", sourceCharacter: "washerwoman", sourcePlayer: P, lifetime: { kind: "manual" } }); // Reminder sourced by Alice
    state().addEffect(dave, { type: "marked", sourcePlayer: P, lifetime: { kind: "manual" } }); // Effect sourced by Alice
    const historyBefore = game().history.length;
    const deliveriesBefore = game().informationDeliveries.length;

    // 4-5. Unseat Alice: the seat survives as an empty seat, same PlayerId.
    expect(state().unseatPlayer(P)).toBe(true);
    expect(game().seatOrder[seatIndex]).toBe(P);
    expect(game().players[P]!.isEmpty).toBe(true);
    expect("participantId" in game().players[P]!).toBe(false);

    // 6-8. Bob fills P and receives a DIFFERENT ParticipantId B.
    refill(P);
    expect(game().players[P]!.name).toBe("Bob");
    expect(game().seatOrder[seatIndex]).toBe(P);
    const B = participantIdOf(P);
    expect(B).toBeTruthy();
    expect(B).not.toBe(A);

    // Every historical record from step 3 still identifies A / "Alice" -- never Bob.
    const history = game().history.slice(0, historyBefore);
    expect(history.filter((h) => h.participant.playerId === P).map((h) => h.participant)).toEqual([alice, alice]);
    const deliveries = game().informationDeliveries.slice(0, deliveriesBefore);
    expect(deliveries[0]!.recipient).toEqual(alice);
    expect(deliveries[0]!.provenance?.sourceParticipant).toEqual(alice);
    const fortune = deliveries[1]!.values.find((v) => v.kind === "player")!;
    expect(fortune.kind === "player" && fortune.participants[0]).toEqual(alice);
    const daveDeath = history.find((h) => h.category === "life" && h.participant.playerId === dave)!;
    expect(daveDeath.provenance?.sourceParticipant).toEqual(alice);
    expect(game().players[carol]!.reminders.find((r) => r.label === "Townsfolk")!.sourceParticipant).toEqual(alice);
    expect(game().players[dave]!.effects.find((e) => e.type === "marked")!.sourceParticipant).toEqual(alice);
    const allHistorical = JSON.stringify({ history, deliveries, carol: game().players[carol], dave: game().players[dave] });
    expect(allHistorical).not.toContain(B);
    expect(allHistorical).not.toContain("Bob");

    // New records involving Bob use B.
    state().setStatus(P, "drunk", true);
    const bobRecord = game().history.at(-1)!;
    expect(bobRecord.participant).toEqual({ kind: "participant", participantId: B, playerId: P, nameAtTime: "Bob" });
    state().addEffect(carol, { type: "hexed", sourcePlayer: P, lifetime: { kind: "manual" } });
    expect(game().players[carol]!.effects.find((e) => e.type === "hexed")!.sourceParticipant)
      .toEqual({ kind: "participant", participantId: B, playerId: P, nameAtTime: "Bob" });
    // ...and Alice's records are still hers.
    expect(game().history.filter((h) => refersToParticipant(h.participant, A))).toHaveLength(2);
    expect(game().history.filter((h) => refersToParticipant(h.participant, B))).toHaveLength(1);
  });

  it("removePlayer ends the seat and its occupant, but every historical snapshot of them survives intact", () => {
    liveGame();
    const alice = idOf("Alice");
    const A = participantIdOf(alice);
    state().setStatus(alice, "poisoned", true);
    state().addReminder(idOf("Carol"), { label: "Wrong", sourcePlayer: alice, lifetime: { kind: "manual" } });
    expect(state().removePlayer(alice)).toBe(true);
    expect(game().players[alice]).toBeUndefined();
    expect(game().history[0]!.participant).toEqual(aliceSnapshot(alice, A));
    expect(game().players[idOf("Carol")]!.reminders[0]!.sourceParticipant).toEqual(aliceSnapshot(alice, A));
  });

  it("a person who leaves and returns is a NEW participation instance -- never re-matched by name", () => {
    liveGame();
    const P = idOf("Alice");
    const A = participantIdOf(P);
    state().setStatus(P, "poisoned", true);
    state().unseatPlayer(P);
    state().addPlayerToSeat("Alice"); // same name, same seat
    const A2 = participantIdOf(P);
    expect(A2).not.toBe(A);
    expect(refersToParticipant(game().history[0]!.participant, A2)).toBe(false);
  });
});

describe("Phase 9R.2: Effect/Reminder source references (Poisoner Alice poisons Carol)", () => {
  it("Carol's Poisoned Effect keeps naming Alice as its source after Alice leaves and Bob takes her seat -- including the History of its later removal", () => {
    liveGame({ Alice: "poisoner", Carol: "fortuneteller" });
    const P = idOf("Alice");
    const carol = idOf("Carol");
    const A = participantIdOf(P);
    const effectId = state().addEffect(carol, { type: "poisoned", sourceCharacter: "poisoner", sourcePlayer: P, lifetime: { kind: "untilDawn" } })!;
    expect(effectId).not.toBeNull();
    state().unseatPlayer(P);
    state().addPlayerToSeat("Bob");
    const B = participantIdOf(P);
    const effect = game().players[carol]!.effects.find((e) => e.id === effectId)!;
    expect(effect.sourceParticipant).toEqual(aliceSnapshot(P, A));
    expect(refersToParticipant(effect.sourceParticipant, B)).toBe(false);
    // Removing it now derives Provenance from the stored snapshot -- Alice,
    // never re-resolved to Bob through seat P.
    state().removeEffect(carol, effectId);
    expect(game().history.at(-1)!.provenance).toEqual({ sourceCharacter: "poisoner", sourceParticipant: aliceSnapshot(P, A) });
  });

  it("a live source that is not a current participant (empty seat, nonexistent id) is refused atomically -- never dropped, never fabricated", () => {
    liveGame();
    const alice = idOf("Alice");
    const carol = idOf("Carol");
    state().unseatPlayer(alice);
    const before = game();
    const seq = state().localSeq;
    expect(state().addEffect(carol, { type: "poisoned", sourcePlayer: alice, lifetime: { kind: "manual" } })).toBeNull();
    expect(state().addReminder(carol, { label: "Wrong", sourcePlayer: "nobody", lifetime: { kind: "manual" } })).toBeNull();
    expect(game()).toBe(before);
    expect(state().localSeq).toBe(seq);
  });

  it("a caller can never smuggle in its own pre-built sourceParticipant snapshot", () => {
    liveGame();
    const carol = idOf("Carol");
    const forged = { kind: "participant", participantId: "pt-forged", playerId: "x", nameAtTime: "Mallory" };
    const effectId = state().addEffect(carol, { type: "hexed", lifetime: { kind: "manual" }, ...({ sourceParticipant: forged } as object) } as never)!;
    expect(game().players[carol]!.effects.find((e) => e.id === effectId)).not.toHaveProperty("sourceParticipant");
    state().setAlive(carol, false, { provenance: { reason: "r", ...({ sourceParticipant: forged } as object) } });
    expect(game().history.at(-1)!.provenance).toEqual({ reason: "r" });
    expect(JSON.stringify(game())).not.toContain("pt-forged");
  });

  it("setReminders can carry forward a reminder's existing source snapshot, but never introduce a new one", () => {
    liveGame();
    const alice = idOf("Alice");
    const carol = idOf("Carol");
    state().addReminder(carol, { id: "r1", label: "Townsfolk", sourcePlayer: alice, lifetime: { kind: "manual" } });
    const existing = game().players[carol]!.reminders;
    // Reordering/editing labels while keeping the held snapshot is fine.
    state().setReminders(carol, [{ ...existing[0]!, label: "Townsfolk (edited)" }]);
    expect(game().players[carol]!.reminders[0]!.sourceParticipant).toEqual(existing[0]!.sourceParticipant);
    // A new/hand-built snapshot is refused outright (nothing changes).
    const before = game();
    state().setReminders(carol, [{ id: "r2", label: "Forged", lifetime: { kind: "manual" },
      sourceParticipant: { kind: "participant", participantId: "pt-forged", playerId: carol, nameAtTime: "Mallory" } }]);
    expect(game()).toBe(before);
  });
});

describe("Phase 9R.2: History / Provenance / Information refusal and atomicity", () => {
  it("a Live Play mutation targeting an empty seat is refused atomically -- no Current State change, no Undo entry, no History against nobody", () => {
    liveGame();
    const alice = idOf("Alice");
    state().unseatPlayer(alice); // clears Undo (membership boundary)
    state().setStatus(idOf("Carol"), "drunk", true); // one ordinary Undo entry
    const before = game();
    const undoDepth = state().undoStack.length;
    const seq = state().localSeq;
    state().setAlive(alice, false);
    state().setStatus(alice, "poisoned", true);
    state().setActualAlignment(alice, "evil");
    expect(state().addEffect(alice, { type: "x", lifetime: { kind: "manual" } })).toBeNull();
    expect(game()).toBe(before);
    expect(state().undoStack).toHaveLength(undoDepth);
    expect(state().localSeq).toBe(seq);
  });

  it("Mutation Context Provenance naming a non-participant source is refused atomically in Live Play", () => {
    liveGame();
    const alice = idOf("Alice");
    const carol = idOf("Carol");
    state().unseatPlayer(alice);
    const before = game();
    state().setAlive(carol, false, { provenance: { sourcePlayer: alice } });
    state().assignRole(carol, "imp", { provenance: { sourcePlayer: "ghost" } });
    expect(game()).toBe(before);
    expect(state().recordInformationDelivery(carol, "fortuneteller-first-night", [
      { requirementId: "players", kind: "player", playerIds: [idOf("Dave"), idOf("Eve")] },
      { requirementId: "isDemon", kind: "boolean", value: false },
    ], { provenance: { sourcePlayer: alice } })).toEqual({ ok: false, message: "The Provenance source Player is not seated." });
    expect(game()).toBe(before);
  });

  it("Information Delivery refuses an empty-seat recipient and empty-seat Player-valued Information", () => {
    liveGame();
    const alice = idOf("Alice");
    const carol = idOf("Carol");
    state().unseatPlayer(alice);
    expect(state().recordInformationDelivery(alice, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [carol, idOf("Dave")] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]).ok).toBe(false);
    const result = state().recordInformationDelivery(carol, "fortuneteller-first-night", [
      { requirementId: "players", kind: "player", playerIds: [alice, idOf("Dave")] },
      { requirementId: "isDemon", kind: "boolean", value: false },
    ]);
    expect(result.ok).toBe(false);
    expect(game().informationDeliveries).toEqual([]);
  });

  it("Setup boundary unchanged: no History is recorded in Setup, so Setup commands never consult participant identity", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 5, plannedTravelerCount: 0 });
    const empty = game().seatOrder[0]!;
    state().setAlive(empty, false, { provenance: { sourcePlayer: "nobody" } });
    expect(game().players[empty]!.alive).toBe(false);
    expect(game().history).toEqual([]);
  });
});

describe("Phase 9R.2: stored snapshots are owned (Section 23)", () => {
  it("caller mutation of Provenance/values input after acceptance never changes stored historical identity", () => {
    liveGame();
    const alice = idOf("Alice");
    const carol = idOf("Carol");
    const dave = idOf("Dave");
    const provenance = { sourcePlayer: alice as string, reason: "r" };
    state().setAlive(dave, false, { provenance });
    const playerIds = [alice, dave];
    expect(state().recordInformationDelivery(carol, "fortuneteller-first-night", [
      { requirementId: "players", kind: "player", playerIds },
      { requirementId: "isDemon", kind: "boolean", value: true },
    ]).ok).toBe(true);
    provenance.sourcePlayer = carol;
    playerIds[0] = carol;
    expect(game().history.at(-1)!.provenance!.sourceParticipant).toEqual(participantRefOf(game(), alice));
    const value = game().informationDeliveries[0]!.values[0]!;
    expect(value.kind === "player" && value.participants.map((p) => p.kind === "participant" && p.nameAtTime)).toEqual(["Alice", "Dave"]);
  });

  it("an Effect's sourceParticipant and its History Provenance are independent owned copies", () => {
    liveGame();
    const alice = idOf("Alice");
    const carol = idOf("Carol");
    const effectId = state().addEffect(carol, { type: "poisoned", sourcePlayer: alice, lifetime: { kind: "manual" } })!;
    const effectRef = game().players[carol]!.effects.find((e) => e.id === effectId)!.sourceParticipant!;
    const historyRef = game().history.at(-1)!.provenance!.sourceParticipant!;
    expect(historyRef).toEqual(effectRef);
    expect(historyRef).not.toBe(effectRef);
    expect((game().history.at(-1)!.change as unknown as { item: { sourceParticipant: unknown } }).item.sourceParticipant).not.toBe(effectRef);
  });
});

describe("Phase 9R.2: Traveler lifecycle", () => {
  it("a Traveler who leaves keeps every historical reference; a Traveler who later fills the same seat is a different participant", () => {
    liveGame();
    const alice = idOf("Alice");
    state().addPlayerToSeat("Tess"); // post-Reveal arrival -- a Traveler, on a new seat
    const T = idOf("Tess");
    expect(game().players[T]!.isTraveler).toBe(true);
    const tess = participantIdOf(T);
    const tessSnapshot: ParticipantRef = { kind: "participant", participantId: tess, playerId: T, nameAtTime: "Tess" };
    state().assignRole(T, "thief");
    state().setTravelerAlignment(T, "evil", { provenance: { sourcePlayer: T, reason: "Storyteller selection" } });
    state().addReminder(alice, { label: "Negative vote", sourceCharacter: "thief", sourcePlayer: T, lifetime: { kind: "manual" } });
    state().exileTraveler(T);
    const tessHistory = game().history.filter((h) => h.participant.playerId === T);
    expect(tessHistory.map((h) => h.category)).toEqual(["identity", "alignment", "life"]);

    // Traveler leaves; the seat keeps its Traveler reservation, same PlayerId.
    expect(state().unseatPlayer(T)).toBe(true);
    expect(game().players[T]).toMatchObject({ isEmpty: true, plannedTravelerSeat: true });
    expect("participantId" in game().players[T]!).toBe(false);
    state().addPlayerToSeat("Uma");
    expect(game().players[T]).toMatchObject({ name: "Uma", isTraveler: true });
    const uma = participantIdOf(T);
    expect(uma).not.toBe(tess);

    for (const h of tessHistory) expect(game().history.find((x) => x.id === h.id)!.participant).toEqual(tessSnapshot);
    expect(game().history.find((h) => h.category === "alignment" && h.participant.playerId === T)!.provenance!.sourceParticipant).toEqual(tessSnapshot);
    expect(game().players[alice]!.reminders.find((r) => r.label === "Negative vote")!.sourceParticipant).toEqual(tessSnapshot);
    state().assignRole(T, "beggar");
    expect(game().history.at(-1)!.participant).toEqual({ kind: "participant", participantId: uma, playerId: T, nameAtTime: "Uma" });
  });
});

describe("Phase 9R.2: Undo", () => {
  it("Undo restores snapshots with their participant identities intact; refilling after an undone fill always mints a fresh one", () => {
    liveGame();
    const alice = idOf("Alice");
    const A = participantIdOf(alice);
    state().renamePlayer(alice, "Alicia");
    state().undo();
    expect(game().players[alice]!.name).toBe("Alice");
    expect(participantIdOf(alice)).toBe(A);

    state().setStatus(alice, "poisoned", true);
    const record = structuredClone(game().history.at(-1)!);
    state().setStatus(idOf("Carol"), "drunk", true);
    state().undo();
    expect(game().history.at(-1)).toEqual(record);

    state().unseatPlayer(alice); // clears Undo
    state().addPlayerToSeat("Bob"); // pushes the empty-seat snapshot
    const B = participantIdOf(alice);
    state().undo();
    expect(game().players[alice]!.isEmpty).toBe(true);
    expect("participantId" in game().players[alice]!).toBe(false);
    state().addPlayerToSeat("Bob");
    const B2 = participantIdOf(alice);
    expect(B2).not.toBe(B);
    expect(B2).not.toBe(A);
    expect(game().history.find((h) => h.id === record.id)!.participant).toEqual(aliceSnapshot(alice, A));
  });
});

describe("Phase 9R.2: local persistence / rehydrate", () => {
  it("participant identities and every historical snapshot survive a real localStorage round trip unchanged -- never regenerated", async () => {
    liveGame();
    const alice = idOf("Alice");
    state().setStatus(alice, "poisoned", true);
    state().addEffect(idOf("Carol"), { type: "marked", sourcePlayer: alice, lifetime: { kind: "manual" } });
    state().unseatPlayer(alice);
    state().addPlayerToSeat("Bob");
    state().setStatus(alice, "drunk", true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = localStorage.getItem(STORAGE_KEY)!;
    expect(JSON.parse(raw).version).toBe(17);
    const beforeGame = structuredClone(game());
    const beforeUndo = structuredClone(state().undoStack);

    store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null });
    localStorage.setItem(STORAGE_KEY, raw);
    await store.persist.rehydrate();

    expect(game()).toEqual(beforeGame);
    expect(state().undoStack).toEqual(beforeUndo);
    const ids = (g: StorytellerLobbyRecord) => Object.values(g.players).map((p) => p.participantId);
    expect(ids(game())).toEqual(ids(beforeGame));
  });
});

describe("Phase 9R.2: privacy", () => {
  it("ParticipantIds and historical snapshots never reach the public or player-self projections", () => {
    liveGame();
    const alice = idOf("Alice");
    state().setStatus(alice, "poisoned", true);
    expect(state().recordInformationDelivery(alice, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [idOf("Carol"), idOf("Dave")] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]).ok).toBe(true);
    const publicJson = JSON.stringify(projectLobbyToPublic(game(), {}));
    const selfJson = JSON.stringify(projectLobbyToSelfMap(game(), registry));
    for (const leak of ["participant", "nameAtTime", "recipient", "pt-", ...Object.values(game().players).map((p) => p.participantId!)]) {
      expect(publicJson).not.toContain(leak);
      expect(selfJson).not.toContain(leak);
    }
  });
});

describe("Phase 9R.2 (Astra R1): supplied-identity occupancy entry points", () => {
  it("assignPendingToSeat uses a supplied, never-used ParticipantId -- and refuses (changing nothing) any id this game has already used, current or historical", () => {
    liveGame();
    const alice = idOf("Alice");
    const A = participantIdOf(alice);
    state().setStatus(alice, "poisoned", true); // A now also lives in History
    state().unseatPlayer(alice); // A survives only in History
    state().addToPendingQueue("uid-bob", "Bob");
    const before = game();
    // Reusing Alice's historical identity for Bob is refused outright.
    expect(state().assignPendingToSeat("uid-bob", alice, A)).toBe(false);
    // ...and so is any current occupant's identity.
    expect(state().assignPendingToSeat("uid-bob", alice, participantIdOf(idOf("Carol")))).toBe(false);
    expect(state().assignPendingToSeat("uid-bob", alice, "")).toBe(false);
    expect(game()).toBe(before);
    // A fresh id is accepted and becomes Bob's participation identity.
    expect(state().assignPendingToSeat("uid-bob", alice, "pt-fresh-bob")).toBe(true);
    expect(game().players[alice]).toMatchObject({ name: "Bob", participantId: "pt-fresh-bob" });
    expect(game().pendingPlayers["uid-bob"]).toBeUndefined();
  });

  it("restoreSeatedMember occupies an empty seat with the authoritative identity, and refuses an occupied/nonexistent seat, a blank name, or an identity another occupant holds", () => {
    liveGame();
    const alice = idOf("Alice");
    const carol = idOf("Carol");
    state().unseatPlayer(alice);
    state().addToPendingQueue("uid-bob", "Bob");
    const before = game();
    expect(state().restoreSeatedMember("uid-bob", carol, "Bob", "pt-bob")).toBe(false); // occupied
    expect(state().restoreSeatedMember("uid-bob", "toString", "Bob", "pt-bob")).toBe(false); // inherited key, not a seat
    expect(state().restoreSeatedMember("uid-bob", alice, "   ", "pt-bob")).toBe(false);
    expect(state().restoreSeatedMember("uid-bob", alice, "Bob", participantIdOf(carol))).toBe(false); // held by Carol
    expect(game()).toBe(before);
    state().setStatus(carol, "drunk", true); // an ordinary Undo entry
    expect(state().restoreSeatedMember("uid-bob", alice, "Bob", "pt-bob")).toBe(true);
    expect(game().players[alice]).toMatchObject({ name: "Bob", participantId: "pt-bob", isEmpty: false });
    expect(game().pendingPlayers["uid-bob"]).toBeUndefined(); // no longer waiting
    expect(state().undoStack).toEqual([]); // a membership boundary, like assignPendingToSeat
    // One authoritative instance can never be seated twice.
    state().unseatPlayer(idOf("Dave"));
    expect(state().restoreSeatedMember("uid-bob", game().seatOrder.find((id) => game().players[id]!.isEmpty)!, "Bob", "pt-bob")).toBe(false);
  });
});
