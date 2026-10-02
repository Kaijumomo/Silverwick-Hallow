// Phase 10F, Slice 1: store / game schema v24 -- the v23 -> v24 step
// (participant-scoped Night progress; ambiguous seat-addressed progress is
// dropped, never re-keyed), the strict v24 Information Delivery shape with an
// AUTHORIZED performedRole and resolutionId, per-entry routing for Current
// State / every Undo snapshot / remote checkpoint recovery, fail-closed
// current-version data, seat-reuse safety and the Night public-Life boundary.
// Traceability: 10F-AC-09, 10F-AC-17, 10F-AC-18, 10F-AC-22, 10F-AC-29,
// 10F-AC-35.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { usePlayerStore } from "./playerStore";
import { InformationDeliveryRecordSchema, StorytellerGamePersistedSchema } from "./schemas";
import { detectLegacyGameVersion, hasV24Evidence, migrateGameEntry } from "./gameMigration";
import { planInformationDelivery } from "./informationDelivery";
import { isParticipantScopedStepKey, migrateNightProgressV23ToV24, participantStepKey, travelerArrivalStepKey } from "./nightProgress";
import { projectLobbyToPublic } from "./projections";
import { publicLifeStateOf } from "./lifeState";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { asV23, withV24Guided } from "@/test/v20Migration";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { decodePublicSnapshot } from "@/firebase/snapshots";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { SessionWriter } from "@/firebase/writer";
import { startStorytellerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import type { StorytellerLobbyRecord } from "./types";

const code = "GUID2345";
const root = `lobbies/${code}`;
const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
type Raw = Record<string, unknown>;
const disposals: (() => void | Promise<void>)[] = [];
const done = { status: "done" as const, notes: "" };

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript } });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  localStorage.clear();
  takeMigrationResetFlag();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

/** A Night-2 current (v24) game: seat p0 is the Washerwoman, p1 a Drunk shown
 * the Empath. */
const ROLES = ["washerwoman", "drunk", "chef", "empath", "fortuneteller", "poisoner", "imp"];
function nightGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true, code, storytellerUid: "host", ...over });
  const drunk = Object.values(g.players).find((p) => p.actualRole === "drunk")!;
  g.players[drunk.id] = { ...drunk, shownRole: "empath", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" };
  return g;
}
const seatOf = (g: StorytellerLobbyRecord, role: string) => Object.values(g.players).find((p) => p.actualRole === role)!;

/** A v23 entry as a v23 writer stored it: seat-addressed participant steps
 * next to global / custom steps, marker 23. */
function v23Entry(): Raw {
  const g = nightGame() as unknown as Raw;
  const [p0, p1] = ["p0", "p1"];
  g.nightProgress = {
    [`2:p:${p0}:washerwoman`]: done,
    [`2:travelerArrival:${p1}:thief`]: done,
    [`2:lunaticInfo:${p1}`]: done,
    [`2:admin:${p0}:king`]: done,
    [`1:p:${p0}:washerwoman`]: done,
    "2:demonInfo": done,
    "2:modifier:toymaker": { status: "skipped", notes: "kept" },
    "2:manual:custom-1": { status: "pending", notes: "Wake the Gossip's target" },
  };
  g.informationDeliveries = [{
    id: "d-legacy", recipient: { kind: "participant", participantId: "fixture-participant-p0", playerId: "p0", nameAtTime: "Player 0" },
    actualRole: "washerwoman", informationActionId: "washerwoman-first-night", moment: { phase: "night", day: 1 }, values: [],
  }];
  return asV23(g);
}

describe("10F-AC-35: v23 -> v24 participant-scoped Night progress", () => {
  it("drops every seat-addressed participant step, keeps global and custom steps exactly, stamps 24, invents nothing", () => {
    const v23 = v23Entry();
    const copy = structuredClone(v23);
    migrateGameEntry(copy, 23, { kind: "canonical-only" });
    expect(copy.gameSchemaVersion).toBe(24);
    expect(copy.nightProgress).toEqual({
      "2:demonInfo": done,
      "2:modifier:toymaker": { status: "skipped", notes: "kept" },
      "2:manual:custom-1": { status: "pending", notes: "Wake the Gossip's target" },
    });
    // Nothing else changes -- in particular Information Delivery is preserved
    // byte-for-byte: no performedRole, no resolutionId is invented.
    const { nightProgress: _a, gameSchemaVersion: _b, ...rest } = copy;
    const { nightProgress: _c, gameSchemaVersion: _d, ...before } = v23;
    expect(rest).toEqual(before);
    expect(JSON.stringify(copy.informationDeliveries)).toBe(JSON.stringify(v23.informationDeliveries));
    expect(copy).toEqual(withV24Guided(v23));
    expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(true);
  });

  it("is deterministic and idempotent (a second pass is a no-op) and never re-keys onto the current occupant", () => {
    const a = structuredClone(v23Entry());
    const b = structuredClone(v23Entry());
    migrateGameEntry(a, 23, { kind: "canonical-only" });
    migrateGameEntry(b, 23, { kind: "canonical-only" });
    expect(a).toEqual(b);
    const again = structuredClone(a);
    migrateGameEntry(again, 24, { kind: "canonical-only" });
    expect(again).toEqual(a);
    // The current occupant of p0 never acquires the old completion.
    const occupant = (a.players as Record<string, Raw>).p0!.participantId as string;
    expect(Object.keys(a.nightProgress as Raw).some((k) => k.includes(occupant))).toBe(false);
  });

  it("the progress helper returns the same object when nothing is participant-scoped", () => {
    const progress = { "1:demonInfo": done, "1:manual:x": done };
    expect(migrateNightProgressV23ToV24(progress)).toBe(progress);
    for (const key of ["p:x:chef", "travelerArrival:x:thief", "lunaticInfo:x", "lunaticTargets:x", "admin:x:king", "missingOrder:x", "invalid:x", "orderConflict:x"]) {
      expect(isParticipantScopedStepKey(key)).toBe(true);
    }
    for (const key of ["demonInfo", "minionInfo", "modifier:toymaker", "manual:abc", "poppyInfo", "p"]) expect(isParticipantScopedStepKey(key)).toBe(false);
  });

  it("Current State and EVERY Undo snapshot migrate independently in a v23 envelope", () => {
    const v23 = v23Entry();
    const current = nightGame() as unknown as Raw;
    const result = migrateStoreState({ game: structuredClone(v23), undoStack: [structuredClone(v23), structuredClone(current), structuredClone(v23)] }, 23) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(withV24Guided(v23));
    expect(result.undoStack[0]).toEqual(withV24Guided(v23));
    expect(result.undoStack[1]).toEqual(current); // marker 24: untouched
    expect(result.undoStack[2]).toEqual(withV24Guided(v23));
  });

  it("a genuine v23 localStorage blob rehydrates as v24 and is written back as v24", async () => {
    localStorage.setItem("new-blood-st", JSON.stringify({ version: 23, state: { game: v23Entry(), undoStack: [v23Entry()] } }));
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(game().gameSchemaVersion).toBe(24);
    expect(state().undoStack[0]!.gameSchemaVersion).toBe(24);
    expect(Object.keys(game().nightProgress).sort()).toEqual(["2:demonInfo", "2:manual:custom-1", "2:modifier:toymaker"]);
    state().setNotes(game().seatOrder[0]!, "x");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(JSON.parse(localStorage.getItem("new-blood-st")!).version).toBe(24);
  });

  async function recoverFrom(entry: Raw) {
    const b = new MemoryRoomBackend();
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: entry, roster: {} }));
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.getState().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    return { start: () => startStorytellerSession(b, lobby, writer) };
  }

  it("a v23 remote checkpoint recovers to the SAME v24 result local migration reaches (two independent recoveries agree)", async () => {
    const entry = v23Entry();
    const local = migrateStoreState({ game: structuredClone(entry), undoStack: [] }, 23) as { game: Raw };
    const first = await recoverFrom(structuredClone(entry));
    const recovered = await first.start();
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    const once = structuredClone(game());
    expect(once).toEqual(withV24Guided(entry));
    expect(JSON.parse(JSON.stringify(once))).toEqual(JSON.parse(JSON.stringify(local.game)));
    for (const dispose of disposals.splice(0).reverse()) await dispose();
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const second = await recoverFrom(structuredClone(entry));
    const again = await second.start();
    disposals.push(() => again.stop());
    expect(game()).toEqual(once);
  });
});

describe("10F-AC-35: malformed current-version data fails closed", () => {
  const rejectedLocally = (g: Raw, envelope = 23) => {
    migrateStoreState({ game: structuredClone(g), undoStack: [] }, envelope);
    return takeMigrationResetFlag();
  };

  it("v24 evidence (performedRole / resolutionId) under marker 23 is never migrated or stamped: rejected", () => {
    for (const field of [{ performedRole: "empath" }, { resolutionId: "r-1" }]) {
      const g = v23Entry();
      Object.assign((g.informationDeliveries as Raw[])[0]!, field);
      expect(hasV24Evidence(g)).toBe(true);
      expect(detectLegacyGameVersion(g)).toBe(23); // the marker stays decisive
      const copy = structuredClone(g);
      migrateGameEntry(copy, 23, { kind: "canonical-only" });
      expect(copy).toEqual(g); // untouched, unstamped
      expect(rejectedLocally(g)).toBe(true);
      // Marker-less, the same evidence is current data -- never treated as legacy.
      const markerless = structuredClone(g);
      delete markerless.gameSchemaVersion;
      expect(detectLegacyGameVersion(markerless)).toBe(24);
    }
  });

  it("a marker-23 entry whose nightProgress is not an object is left unstamped and rejected", () => {
    const g = v23Entry();
    g.nightProgress = ["not", "a", "map"];
    const copy = structuredClone(g);
    migrateGameEntry(copy, 23, { kind: "canonical-only" });
    expect(copy).toEqual(g);
    expect(rejectedLocally(g)).toBe(true);
  });

  it.each([
    ["an unknown key on a delivery", (d: Raw) => { d.stray = 1; }],
    ["a performedRole equal to the Actual Role", (d: Raw) => { d.performedRole = d.actualRole; }],
    ["an empty performedRole", (d: Raw) => { d.performedRole = ""; }],
    ["an empty resolutionId", (d: Raw) => { d.resolutionId = ""; }],
    ["an over-long resolutionId", (d: Raw) => { d.resolutionId = "x".repeat(201); }],
    ["a non-string resolutionId", (d: Raw) => { d.resolutionId = 7; }],
  ])("a v24 game with %s is rejected (strict delivery shape), never stripped", (_label, corrupt) => {
    const g = withV24Guided(v23Entry());
    corrupt((g.informationDeliveries as Raw[])[0]!);
    expect(StorytellerGamePersistedSchema.safeParse(g).success).toBe(false);
    expect(rejectedLocally(g, 24)).toBe(true);
  });

  it("a valid v24 delivery with performedRole and resolutionId passes the strict schema", () => {
    const delivery = { ...(v23Entry().informationDeliveries as Raw[])[0]!, actualRole: "drunk", performedRole: "empath", informationActionId: "empath-first-night", resolutionId: "r-1" };
    expect(InformationDeliveryRecordSchema.safeParse(delivery).success).toBe(true);
  });

  it("unsupported / newer markers are never reinterpreted", () => {
    for (const marker of [25, "24", null, { v: 24 }]) {
      const g = nightGame() as unknown as Raw;
      g.gameSchemaVersion = marker;
      expect(detectLegacyGameVersion(g)).toBe(24);
      const copy = structuredClone(g);
      migrateGameEntry(copy, 13, { kind: "canonical-only" });
      expect(copy).toEqual(g);
      expect(rejectedLocally(g)).toBe(true);
    }
  });
});

describe("10F-AC-09 / AC-22: participant-scoped Night progress never transfers across seat reuse", () => {
  function liveSeats() {
    store.setState({ game: nightGame(), undoStack: [] });
  }
  const wakeOf = (playerId: string) => computeNightOrder(game().players, game().seatOrder, setupScript, false, game())
    .find((s) => s.kind === "player" && s.playerId === playerId);

  it("the same participant keeps their completion; a new participant in the same seat starts pending", () => {
    liveSeats();
    const empath = seatOf(game(), "empath");
    const step = wakeOf(empath.id)!;
    expect(step.stepKey).toBe(participantStepKey(empath.participantId!, "empath"));
    state().setNightStepStatus(2, step.stepKey, "done");
    expect(game().nightProgress[`2:${wakeOf(empath.id)!.stepKey}`]?.status).toBe("done"); // same participant
    // The participant leaves; someone new sits in the same seat with the same Role.
    expect(state().unseatPlayer(empath.id)).toBe(true);
    state().addPlayerToSeat("Newcomer");
    const fresh = game().players[empath.id]!;
    expect(fresh.participantId).not.toBe(empath.participantId);
    store.setState({ game: { ...game(), players: { ...game().players, [empath.id]: { ...fresh, actualRole: "empath", shownRole: "empath" } } } });
    const next = wakeOf(empath.id)!;
    expect(next.stepKey).toBe(participantStepKey(fresh.participantId!, "empath"));
    expect(game().nightProgress[`2:${next.stepKey}`]).toBeUndefined(); // pending -- never inherited
    // The departed participant's marker is still the departed participant's.
    expect(game().nightProgress[`2:${step.stepKey}`]?.status).toBe("done");
  });

  it("a Traveler's arrival step is participation-bound: completing it never touches a later occupant of the seat", () => {
    liveSeats();
    state().addPlayer("Zed");
    const zed = game().seatOrder.at(-1)!;
    state().assignRole(zed, "apprentice");
    state().setTravelerAlignment(zed, "good");
    const first = game().players[zed]!;
    const key = travelerArrivalStepKey(first.participantId!, "apprentice");
    expect(computeNightOrder(game().players, game().seatOrder, setupScript, false, game()).some((s) => s.stepKey === key)).toBe(true);
    // A replacement Traveler occupies the same seat.
    expect(state().unseatPlayer(zed)).toBe(true);
    state().addPlayerToSeat("Yan");
    state().assignRole(zed, "apprentice");
    state().setTravelerAlignment(zed, "good");
    const second = game().players[zed]!;
    expect(second.participantId).not.toBe(first.participantId);
    // Presenting the OLD participant's arrival key completes nothing for the new one.
    state().setNightStepStatus(2, key, "done");
    expect(game().players[zed]!.travelerArrival?.firstNightComplete).toBe(false);
    // Their own key does.
    state().setNightStepStatus(2, travelerArrivalStepKey(second.participantId!, "apprentice"), "done");
    expect(game().players[zed]!.travelerArrival).toMatchObject({ firstNightComplete: true, completedAtNight: 2 });
  });
});

describe("10F-AC-18: simulated Information Delivery (performedRole)", () => {
  it("a Drunk shown the Empath records Actual Role drunk + performedRole empath, creating no Current State", () => {
    store.setState({ game: nightGame(), undoStack: [] });
    const drunk = seatOf(game(), "drunk");
    const before = game();
    const result = planInformationDelivery(game(), {
      recipientPlayerId: drunk.id, informationActionId: "empath-other-night", performedRole: "empath", resolutionId: "res-7",
      values: [{ requirementId: "evilNeighbors", kind: "number", value: 1 }],
    }, { registry, deliveryId: () => "d-sim" });
    expect(result).toMatchObject({ ok: true, record: { id: "d-sim", actualRole: "drunk", performedRole: "empath", informationActionId: "empath-other-night", resolutionId: "res-7" } });
    if (!result.ok) return;
    expect(InformationDeliveryRecordSchema.safeParse(result.record).success).toBe(true);
    expect(game()).toBe(before);
    expect(game().players[drunk.id]).toBe(before.players[drunk.id]);
  });

  it("refuses a performedRole that is not the recipient's current simulated wake (no smuggling)", () => {
    store.setState({ game: nightGame(), undoStack: [] });
    const g = game();
    const drunk = seatOf(g, "drunk");
    const washer = seatOf(g, "washerwoman");
    const attempt = (recipientPlayerId: string, performedRole: unknown, informationActionId = "empath-other-night") => planInformationDelivery(g, {
      recipientPlayerId, informationActionId, performedRole: performedRole as string,
      values: [{ requirementId: "evilNeighbors", kind: "number", value: 0 }],
    }, { registry });
    // An arbitrary Role the Drunk is not shown.
    expect(attempt(drunk.id, "chef", "chef-first-night")).toMatchObject({ ok: false });
    // A non-simulated participant cannot claim another Role's procedure.
    expect(attempt(washer.id, "empath")).toMatchObject({ ok: false });
    // Malformed input.
    expect(attempt(drunk.id, 42)).toMatchObject({ ok: false });
    expect(attempt(drunk.id, "")).toMatchObject({ ok: false });
    // Without performedRole the Drunk's Actual Role has no Empath action.
    expect(planInformationDelivery(g, { recipientPlayerId: drunk.id, informationActionId: "empath-other-night",
      values: [{ requirementId: "evilNeighbors", kind: "number", value: 0 }] }, { registry })).toMatchObject({ ok: false });
    // A performedRole equal to the Actual Role is the ordinary case (never stored).
    const ordinary = planInformationDelivery(g, { recipientPlayerId: washer.id, informationActionId: "washerwoman-first-night", performedRole: "washerwoman",
      values: [{ requirementId: "players", kind: "player", playerIds: [drunk.id, seatOf(g, "imp").id] }, { requirementId: "role", kind: "role", roleId: "empath" }] }, { registry });
    expect(ordinary.ok).toBe(false); // Night 2: a first-night action is out of timing...
    // ...and the record would never carry performedRole either way.
    const firstNight = planInformationDelivery({ ...g, day: 1 }, { recipientPlayerId: washer.id, informationActionId: "washerwoman-first-night", performedRole: "washerwoman",
      values: [{ requirementId: "players", kind: "player", playerIds: [drunk.id, seatOf(g, "imp").id] }, { requirementId: "role", kind: "role", roleId: "empath" }] }, { registry });
    expect(firstNight.ok && "performedRole" in firstNight.record).toBe(false);
  });

  it("refuses a malformed resolutionId", () => {
    store.setState({ game: nightGame(), undoStack: [] });
    const drunk = seatOf(game(), "drunk");
    for (const resolutionId of ["", "x".repeat(201), 3]) {
      expect(planInformationDelivery(game(), { recipientPlayerId: drunk.id, informationActionId: "empath-other-night", performedRole: "empath",
        resolutionId: resolutionId as string, values: [{ requirementId: "evilNeighbors", kind: "number", value: 0 }] }, { registry }))
        .toEqual({ ok: false, message: "Invalid resolution id." });
    }
  });
});

describe("10F-AC-29: Night public-Life withholding", () => {
  function withDeath() {
    const g = nightGame();
    const imp = seatOf(g, "imp");
    const chef = seatOf(g, "chef");
    g.players[chef.id] = { ...chef, alive: false, ghostVote: false };
    g.players[imp.id] = { ...imp, alive: false, ghostVote: true, exiled: true };
    return g;
  }

  it("during Night the public projection carries NO Life field for any player; Day restores it from Current State", () => {
    const night = withDeath();
    const pub = projectLobbyToPublic(night, {});
    for (const p of Object.values(pub.players)) {
      expect(p).not.toHaveProperty("alive");
      expect(p).not.toHaveProperty("ghostVote");
      expect(p).not.toHaveProperty("exiled");
      expect(publicLifeStateOf(p)).toBeNull();
    }
    // The Storyteller's authoritative state is untouched.
    expect(seatOf(night, "chef").alive).toBe(false);
    const day = projectLobbyToPublic({ ...night, phase: "day" }, {});
    expect(day.players[seatOf(night, "chef").id]).toMatchObject({ alive: false, ghostVote: false });
    expect(day.players[seatOf(night, "imp").id]).toMatchObject({ alive: false, ghostVote: true, exiled: true });
    expect(day.players[seatOf(night, "empath").id]).toMatchObject({ alive: true, ghostVote: true });
    // Every non-Night phase projects Life.
    for (const phase of ["setup", "ended"] as const) {
      expect(Object.values(projectLobbyToPublic({ ...night, phase }, {}).players).every((p) => typeof p.alive === "boolean")).toBe(true);
    }
  });

  it("the projection is identical for a dead and a living player at Night (nothing distinguishes them)", () => {
    const pub = projectLobbyToPublic(withDeath(), {});
    const shape = (p: Raw) => Object.keys(p).sort().join(",");
    const shapes = new Set(Object.values(pub.players).filter((p) => !p.isTraveler).map((p) => shape(p as unknown as Raw)));
    expect(shapes.size).toBe(1);
  });

  it("the public wire decoder fails closed: Life sent at Night is dropped; Life missing outside Night is incomplete", () => {
    const night = withDeath();
    const leaked = projectLobbyToPublic({ ...night, phase: "day" }, {});
    const atNight = decodePublicSnapshot({ ...leaked, phase: "night" }, code);
    expect(atNight.status).toBe("ready");
    if (atNight.status !== "ready") return;
    for (const p of Object.values(atNight.data.players)) {
      expect(p).not.toHaveProperty("alive");
      expect(p).not.toHaveProperty("exiled");
    }
    const withheld = projectLobbyToPublic(night, {});
    expect(decodePublicSnapshot({ ...withheld, phase: "day" }, code)).toEqual({ status: "invalid", issues: [{ path: ["players"], code: "life_missing" }] });
    expect(decodePublicSnapshot(withheld, code).status).toBe("ready");
  });
});
