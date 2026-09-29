// Phase 10D (ASTRA-10D-C01 / ASTRA-10D-C02, Sol-amended Life semantics):
// `exiled` means the participant's CURRENT death was caused by an exile. It is
// Life Current State, independent of the participant's current Role or
// Traveler status. Only a CURRENT Traveler can undergo a gameplay exile, but
// once that exile-death exists no Role change (gameplay or correction,
// ordinary <-> Traveler) reads or writes it; it ends only when the death ends
// (resurrection) or an explicit Life correction repairs it. A correction may
// set it, and a correction-recorded past exile event may name, a participant
// whatever their current Role.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "./identity";
import { participantRefOf } from "./participants";
import { applyLifePlan, planLifeTransaction } from "./lifeResolution";
import { applyRolePlan, changeRoleIntent, correctRoleIntent, planRoleTransaction, setPerceptionIntent, type RoleIntent } from "./roleResolution";
import { lifeHeadline, lifeStatusOf, publicLifeOf, publicLifeStateOf } from "./lifeState";
import { projectToPublic } from "./projections";
import { StorytellerGamePersistedSchema } from "./schemas";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { SessionWriter } from "@/firebase/writer";
import { startStorytellerSession } from "@/firebase/storytellerSync";
import type { PlayerId, StorytellerLobbyRecord, STPlayerRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const lifeHistory = () => game().history.filter((h) => h.category === "life");
const roleHistory = () => game().history.filter((h) => h.category === "role");
/** The CURRENT participation's ref (never a legacy ref) of a seated player. */
function refOf(id: PlayerId) {
  const ref = participantRefOf(game(), id);
  if (!ref || ref.kind !== "participant") throw new Error("not a seated participant");
  return ref;
}
const lifeOf = (p: STPlayerRecord) => ({ alive: p.alive, ghostVote: p.ghostVote, exiled: p.exiled });
const ids = { historyId: (() => { let n = 0; return () => `h-${++n}`; })(), packetEpoch: (() => { let n = 0; return () => `e-${++n}`; })() };
const disposals: (() => void | Promise<void>)[] = [];

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
  localStorage.clear();
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

/** A dealt, revealed 7-player game, now at Day 1, whose late Traveler (Tess,
 * Thief) was exiled and died. */
function exiledTraveler() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (let i = 0; i < 7; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  const ordinary = [...game().seatOrder];
  state().addPlayerToSeat("Tess");
  const tess = game().seatOrder.at(-1)!;
  expect(player(tess).isTraveler).toBe(true);
  expect(state().assignRole(tess, "thief")).toMatchObject({ ok: true, changed: true });
  expect(state().advancePhase().ok).toBe(true); // Day 1
  expect(state().recordExile(tess, "died")).toMatchObject({ ok: true, changed: true });
  store.setState({ undoStack: [] });
  expect(lifeOf(player(tess))).toEqual({ alive: false, ghostVote: true, exiled: true });
  return { tess, ordinary };
}

/** Traveler -> ordinary: the destination ordinary perception is explicit, in
 * the same atomic resolution (the Role seam never invents one). */
const toOrdinary = (p: STPlayerRecord, role: string, correction = false): RoleIntent[] => [
  correction ? correctRoleIntent(p, role) : changeRoleIntent(p, role),
  { ...setPerceptionIntent(p, { shownRole: role, shownAlignment: null }) },
];

/** Every assertion that the participant's Life is the exile-death, unchanged. */
function expectExileDeath(id: PlayerId, life: ReturnType<typeof lifeOf>) {
  const p = player(id);
  expect(lifeOf(p)).toEqual(life);
  const status = lifeStatusOf(p);
  expect(status.anomalies).toEqual([]); // no exiledNonTraveler (retired)
  expect(status.state).toBe(life.ghostVote ? "exiledVote" : "exiledVoteUsed");
  expect(lifeHeadline(status.state)).toBe("Exiled");
  const published = projectToPublic(p, false);
  expect(published).toMatchObject({ alive: false, ghostVote: life.ghostVote, exiled: true, isTraveler: p.isTraveler });
  expect(publicLifeStateOf(published)).toBe(status.state);
  expect(lifeHeadline(publicLifeStateOf(published))).toBe("Exiled");
}

describe("ASTRA-10D-C01: an exile-death survives every Role transition", () => {
  it("Traveler exiled and died -> gameplay Role change to ordinary: Life unchanged, Exiled for the Storyteller and publicly, no anomaly, no Life Event/History, Role History records only the Role", () => {
    const { tess } = exiledTraveler();
    const life = lifeOf(player(tess));
    const window = game().lifeEventWindow;
    const lifeRecords = lifeHistory().length;
    const planned = planRoleTransaction(game(), { intents: toOrdinary(player(tess), "chef") }, { script: setupScript, ids });
    expect(planned).toMatchObject({ ok: true, changed: true });
    if (planned.ok && planned.changed) {
      for (const field of ["alive", "ghostVote", "exiled"]) expect(planned.plan.players[tess]!.set).not.toHaveProperty(field);
    }
    expect(state().resolveRoles({ intents: toOrdinary(player(tess), "chef") })).toEqual({ ok: true, changed: true });
    expect(player(tess)).toMatchObject({ isTraveler: false, actualRole: "chef", shownRole: "chef" });
    expectExileDeath(tess, life);
    expect(game().lifeEventWindow).toBe(window);
    expect(lifeHistory()).toHaveLength(lifeRecords);
    expect(roleHistory().at(-1)!.change).toEqual({ kind: "value", from: { actualRole: "thief" }, to: { actualRole: "chef" } });
    expect(roleHistory().at(-1)!.correction).toBeUndefined();
  });

  it("the same through a Role CORRECTION (Traveler -> ordinary)", () => {
    const { tess } = exiledTraveler();
    const life = lifeOf(player(tess));
    const window = game().lifeEventWindow;
    const lifeRecords = lifeHistory().length;
    expect(state().resolveRoles({ intents: toOrdinary(player(tess), "chef", true) })).toEqual({ ok: true, changed: true });
    expect(player(tess)).toMatchObject({ isTraveler: false, actualRole: "chef" });
    expectExileDeath(tess, life);
    expect(game().lifeEventWindow).toBe(window);
    expect(lifeHistory()).toHaveLength(lifeRecords);
    expect(roleHistory().at(-1)).toMatchObject({ correction: true, change: { from: { actualRole: "thief" }, to: { actualRole: "chef" } } });
  });

  it("Traveler -> Traveler stays Exiled", () => {
    const { tess } = exiledTraveler();
    const life = lifeOf(player(tess));
    const window = game().lifeEventWindow;
    expect(state().resolveRoles({ intents: [changeRoleIntent(player(tess), "gunslinger")] })).toEqual({ ok: true, changed: true });
    expect(player(tess)).toMatchObject({ isTraveler: true, actualRole: "gunslinger" });
    expectExileDeath(tess, life);
    expect(game().lifeEventWindow).toBe(window);
  });

  it("round trip Traveler/exiled -> ordinary -> Traveler: Exiled at every step; Life Event Window and Life History untouched; each Undo restores the exact prior snapshot", () => {
    const { tess } = exiledTraveler();
    const life = lifeOf(player(tess));
    const window = game().lifeEventWindow;
    const lifeRecords = lifeHistory().length;
    const s0 = structuredClone(game());
    expectExileDeath(tess, life);

    expect(state().resolveRoles({ intents: toOrdinary(player(tess), "chef") })).toEqual({ ok: true, changed: true });
    const s1 = structuredClone(game());
    expect(player(tess).isTraveler).toBe(false);
    expectExileDeath(tess, life);

    expect(state().resolveRoles({ intents: [changeRoleIntent(player(tess), "thief")] })).toEqual({ ok: true, changed: true });
    expect(player(tess)).toMatchObject({ isTraveler: true, actualRole: "thief", shownRole: "thief" });
    expectExileDeath(tess, life);
    expect(game().lifeEventWindow).toBe(window);
    expect(lifeHistory()).toHaveLength(lifeRecords);
    expect(state().undoStack).toHaveLength(2);

    state().undo();
    expect(game()).toEqual(s1);
    expectExileDeath(tess, life);
    state().undo();
    expect(game()).toEqual(s0);
    expectExileDeath(tess, life);
    expect(state().undoStack).toHaveLength(0);
  });

  it("composition: a Life plan and a Role plan applied on one working snapshot, in either order, never make the Role status reinterpret `exiled`", () => {
    const { tess } = exiledTraveler();
    const start = game();
    const spend = { intents: [{ kind: "spendGhostVote" as const, playerId: tess }] };
    const role = { intents: toOrdinary(start.players[tess]!, "chef") };
    const planLife = (g: StorytellerLobbyRecord) => {
      const r = planLifeTransaction(g, spend);
      if (!r.ok || !r.changed) throw new Error("life plan");
      return applyLifePlan(g, r.plan);
    };
    const planRole = (g: StorytellerLobbyRecord) => {
      const r = planRoleTransaction(g, role, { script: setupScript, ids });
      if (!r.ok || !r.changed) throw new Error("role plan");
      return applyRolePlan(g, r.plan);
    };
    for (const final of [planRole(planLife(start)), planLife(planRole(start))]) {
      const p = final.players[tess]!;
      expect(p).toMatchObject({ isTraveler: false, actualRole: "chef", alive: false, ghostVote: false, exiled: true });
      expect(lifeStatusOf(p)).toEqual({ state: "exiledVoteUsed", anomalies: [] });
      expect(publicLifeOf(p)).toEqual({ alive: false, ghostVote: false, exiled: true });
      expect(final.lifeEventWindow).toBe(start.lifeEventWindow);
    }
  });

  it("resurrection clears the exile-death and returns the participant to Alive (after a Role change too)", () => {
    const { tess } = exiledTraveler();
    expect(state().resolveRoles({ intents: toOrdinary(player(tess), "chef") })).toEqual({ ok: true, changed: true });
    const events = game().lifeEventWindow.events.length;
    expect(state().resurrect(tess)).toMatchObject({ ok: true, changed: true });
    expect(player(tess).alive).toBe(true);
    expect(player(tess).ghostVote).toBe(true);
    expect(player(tess).exiled).toBeUndefined();
    expect(lifeStatusOf(player(tess))).toEqual({ state: "alive", anomalies: [] });
    expect(projectToPublic(player(tess), false)).not.toHaveProperty("exiled");
    expect(game().lifeEventWindow.events).toHaveLength(events + 1);
    expect(game().lifeEventWindow.events.at(-1)).toMatchObject({ kind: "resurrection" });
  });

  it("recovery: a dead, exiled, ORDINARY participant round-trips the current schema and local persistence unchanged -- no migration", async () => {
    const { tess } = exiledTraveler();
    expect(state().resolveRoles({ intents: toOrdinary(player(tess), "chef") })).toEqual({ ok: true, changed: true });
    const current = JSON.parse(JSON.stringify(game())) as StorytellerLobbyRecord;
    expect(current.gameSchemaVersion).toBe(22);
    expect(StorytellerGamePersistedSchema.parse(structuredClone(current))).toEqual(current);
    // The persisted-store migration at the current marker is a no-op.
    const migrated = migrateStoreState({ game: structuredClone(current), undoStack: [structuredClone(current)] }, 22) as { game: StorytellerLobbyRecord };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(migrated.game).toEqual(current);
    // A genuine localStorage blob rehydrates to the same exile-death.
    store.setState({ game: null, undoStack: [] });
    localStorage.setItem("new-blood-st", JSON.stringify({ version: 22, state: { game: current, undoStack: [] } }));
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(player(tess)).toMatchObject({ isTraveler: false, actualRole: "chef", alive: false, ghostVote: true, exiled: true });
    expectExileDeath(tess, { alive: false, ghostVote: true, exiled: true });
  });

  it("recovery: remote checkpoint recovery (the production startStorytellerSession chokepoint) adopts the same ordinary exile-death -- no migration", async () => {
    const { tess } = exiledTraveler();
    expect(state().resolveRoles({ intents: toOrdinary(player(tess), "chef") })).toEqual({ ok: true, changed: true });
    const code = "EXLE2345";
    const checkpointGame = { ...JSON.parse(JSON.stringify(game())), code } as StorytellerLobbyRecord;
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    const b = new MemoryRoomBackend();
    await b.set(`lobbies/${code}/checkpoint`, JSON.stringify({ game: checkpointGame, roster: {} }));
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    state().setLobby(lobby);
    const writer = new SessionWriter(b, code, session.id);
    disposals.push(() => writer.dispose());
    const recovered = await startStorytellerSession(b, lobby, writer);
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(game()).toEqual(checkpointGame);
    expectExileDeath(tess, { alive: false, ghostVote: true, exiled: true });
  });
});

describe("ASTRA-10D-C01: Life gameplay exile and status correction", () => {
  it("gameplay exile still requires a CURRENT Traveler: an ordinary participant (even a former Traveler) is refused; a current Traveler works as before", () => {
    const { tess, ordinary } = exiledTraveler();
    const alive = ordinary[0]!;
    const before = game();
    expect(state().recordExile(alive, "died")).toMatchObject({ ok: false, message: "Only a Traveler can be exiled." });
    expect(game()).toBe(before);
    // A later Traveler is exiled (survives) exactly as before.
    state().addPlayerToSeat("Uma");
    const uma = game().seatOrder.at(-1)!;
    expect(player(uma).isTraveler).toBe(true);
    expect(state().assignRole(uma, "gunslinger")).toMatchObject({ ok: true });
    expect(state().recordExile(uma, "survived")).toMatchObject({ ok: true, changed: true });
    expect(game().lifeEventWindow.events.at(-1)).toMatchObject({ kind: "exile", outcome: "survived" });
    expect(player(uma).alive).toBe(true);
    // Tess, once a Traveler and now ordinary (and resurrected), cannot be exiled by gameplay.
    expect(state().resolveRoles({ intents: toOrdinary(player(tess), "chef") })).toMatchObject({ ok: true });
    expect(state().resurrect(tess)).toMatchObject({ ok: true });
    expect(state().recordExile(tess, "died")).toMatchObject({ ok: false, message: "Only a Traveler can be exiled." });
  });

  it("a currently ORDINARY dead participant may be explicitly corrected to an Exiled state: status-only correction History, no fake exile Life Event", () => {
    const { ordinary } = exiledTraveler();
    const id = ordinary[0]!;
    expect(state().recordDeath(id)).toMatchObject({ ok: true, changed: true });
    const window = game().lifeEventWindow;
    const records = game().history.length;
    expect(player(id).isTraveler).toBe(false);
    expect(state().correctLifeStatus(id, { alive: false, ghostVote: true, exiled: true })).toEqual({ ok: true, changed: true, eventIds: [] });
    expect(player(id)).toMatchObject({ isTraveler: false, alive: false, ghostVote: true, exiled: true });
    expectExileDeath(id, { alive: false, ghostVote: true, exiled: true });
    expect(game().lifeEventWindow).toBe(window); // no Life Event
    expect(game().history).toHaveLength(records + 1);
    expect(game().history.at(-1)).toMatchObject({ category: "life", correction: true,
      change: { kind: "value", from: { exiled: false }, to: { exiled: true } } });
    expect(game().history.at(-1)).not.toHaveProperty("lifeEvent");
    // ...and repaired back to an ordinary death the same way.
    expect(state().correctLifeStatus(id, { alive: false, ghostVote: false })).toMatchObject({ ok: true, changed: true });
    expect(player(id).exiled).toBeUndefined();
    expect(lifeStatusOf(player(id))).toEqual({ state: "deadVoteUsed", anomalies: [] });
  });

  it("a living participant still can never be corrected into an explicit exiled state", () => {
    const { ordinary } = exiledTraveler();
    const before = game();
    for (const target of [{ alive: true, exiled: true }, { alive: true, ghostVote: true, exiled: true }, { alive: true, exiled: false }]) {
      expect(state().correctLifeStatus(ordinary[0]!, target as never).ok).toBe(false);
    }
    expect(game()).toBe(before);
  });
});

describe("ASTRA-10D-C02: correction-recorded exile events never consult the CURRENT Role", () => {
  /** Night 2: the previous phase (Day 1) is late-recordable. */
  function atNightTwo() {
    const ctx = exiledTraveler();
    expect(state().advancePhase().ok).toBe(true);
    expect(game()).toMatchObject({ phase: "night", day: 2 });
    return ctx;
  }

  it("a currently ordinary participant may receive a late-recorded past Day exile, bound to their ParticipantRef, with an explicit repair", () => {
    const { ordinary } = atNightTwo();
    const id = ordinary[1]!;
    expect(player(id).isTraveler).toBe(false);
    const ref = refOf(id);
    const result = state().lateRecordLifeEvent({ kind: "exile", outcome: "died", playerId: id },
      [{ playerId: id, target: { alive: false, ghostVote: true, exiled: true } }]);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(game().lifeEventWindow.events.at(-1)).toMatchObject({ kind: "exile", outcome: "died",
      moment: { phase: "day", day: 1 }, subject: { participantId: ref.participantId, playerId: id } });
    expect(game().history.at(-1)).toMatchObject({ category: "life", correction: true });
    expectExileDeath(id, { alive: false, ghostVote: true, exiled: true });
  });

  it("structural checks remain: Day-only, a valid exile outcome, and a seated participant", () => {
    const { ordinary } = atNightTwo();
    const id = ordinary[1]!;
    const before = game();
    expect(state().lateRecordLifeEvent({ kind: "exile", outcome: "alreadyDead" as never, playerId: id })).toMatchObject({ ok: false, message: "Choose an exile outcome." });
    expect(state().lateRecordLifeEvent({ kind: "exile", outcome: "died", playerId: "nobody" })).toMatchObject({ ok: false });
    expect(game()).toBe(before);
    // At Day 2 the previous phase is Night 2: an exile cannot be recorded into it.
    expect(state().advancePhase().ok).toBe(true);
    const day = game();
    expect(state().lateRecordLifeEvent({ kind: "exile", outcome: "died", playerId: id })).toMatchObject({ ok: false, message: "Exiles happen during the Day." });
    expect(game()).toBe(day);
  });

  it("an event may be AMENDED into an exile of a currently ordinary participant (the original subject, or another one)", () => {
    const { ordinary } = exiledTraveler();
    const [a, b] = ordinary as [PlayerId, PlayerId];
    expect(state().recordExecution(a, "died")).toMatchObject({ ok: true, changed: true });
    const execution = game().lifeEventWindow.events.at(-1)!;
    expect(player(a).isTraveler).toBe(false);
    expect(state().amendLifeEvent(execution.id, { kind: "exile", outcome: "died" },
      [{ playerId: a, target: { alive: false, ghostVote: true, exiled: true } }])).toMatchObject({ ok: true, changed: true });
    const amended = game().lifeEventWindow.events.at(-1)!;
    expect(amended).toMatchObject({ kind: "exile", outcome: "died", subject: execution.subject, moment: execution.moment });
    expectExileDeath(a, { alive: false, ghostVote: true, exiled: true });
    // Amending onto ANOTHER currently ordinary participant binds their ref.
    expect(state().amendLifeEvent(amended.id, { kind: "exile", outcome: "survived", playerId: b })).toMatchObject({ ok: true, changed: true });
    expect(game().lifeEventWindow.events.at(-1)).toMatchObject({ kind: "exile", outcome: "survived",
      subject: { participantId: refOf(b).participantId } });
  });
});
