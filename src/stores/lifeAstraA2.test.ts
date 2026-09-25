import { beforeEach, describe, expect, it } from "vitest";
import { migrateStoreState, takeMigrationResetFlag, useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "./identity";
import { deathsAt, resurrectionsAt } from "./lifeEvents";
import { StorytellerGamePersistedSchema } from "./schemas";
import { detectLegacyGameVersion } from "./gameMigration";
import type { HistoryRecord, PlayerId, StorytellerLobbyRecord } from "./types";

// Phase 10A Astra remediation, Package A2 (10A-ASTRA-004): one atomic
// resolution may give ONE participant several ordered Life Events (e.g. a
// resurrection and then a death), each legal against the evolving working
// state, all committed together and mirrored in order in that
// participant's single History record. Generic transactions only -- no Role
// logic is implemented here.

const STORAGE_KEY = "new-blood-st";
const game = () => store.getState().game!;
const state = () => store.getState();
const player = (id: PlayerId) => game().players[id]!;
const events = () => game().lifeEventWindow.events;
const NIGHT2 = { phase: "night", day: 2 } as const;

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
  takeMigrationResetFlag();
});

/** Night 2 of a revealed 7-player game; seat 2 ("C") died on Night 1. */
function nightTwoWithDeadC(): { a: PlayerId; b: PlayerId; c: PlayerId; ids: PlayerId[] } {
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  for (let i = 0; i < 7; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  const ids = [...game().seatOrder];
  const [a, b, c] = ids as [PlayerId, PlayerId, PlayerId];
  expect(state().recordDeath(c).ok).toBe(true);
  expect(state().advancePhase().ok).toBe(true); // Day 1
  expect(state().advancePhase().ok).toBe(true); // Night 2
  return { a, b, c, ids };
}

const recordFor = (records: HistoryRecord[], id: PlayerId) =>
  records.find((h) => h.participant.playerId === id)!;
const opsOf = (h: HistoryRecord) => h.lifeEvent?.operations.map((o) => `${o.kind}:${o.event.kind}`);

describe("10A-ASTRA-004: the Al-Hadikhia-shaped generic resolution", () => {
  it("resurrection(C), death(A), death(B), death(C) commit atomically, in order, with one History record per participant", () => {
    const { a, b, c } = nightTwoWithDeadC();
    expect(player(c)).toMatchObject({ alive: false });
    const before = { game: structuredClone(game()), undo: state().undoStack.length, seq: state().localSeq };
    const historyBefore = game().history.length;

    const result = state().resolveLife({
      resolutionId: "al-hadikhia-n2",
      intents: [
        { kind: "resurrection", playerId: c },
        { kind: "death", playerId: a },
        { kind: "death", playerId: b },
        { kind: "death", playerId: c },
      ],
      context: { provenance: { sourceCharacter: "alhadikhia" } },
    });
    expect(result).toMatchObject({ ok: true, changed: true });

    // Final Current State: all three dead, each holding their vote.
    for (const id of [a, b, c]) expect(player(id)).toMatchObject({ alive: false, ghostVote: true });
    // The Life Event Window: C's resurrection AND death, in transaction order.
    const added = events().slice(-4);
    expect(added.map((e) => `${e.kind}:${e.subject.playerId}`)).toEqual([
      `resurrection:${c}`, `death:${a}`, `death:${b}`, `death:${c}`,
    ]);
    expect(added.every((e) => e.resolutionId === "al-hadikhia-n2")).toBe(true);
    if (result.ok) expect(result.eventIds).toEqual(added.map((e) => e.id));
    expect(resurrectionsAt(game(), NIGHT2)).toMatchObject({ status: "known", events: [{ subject: { playerId: c } }] });
    expect(deathsAt(game(), NIGHT2)).toMatchObject({ status: "known", events: [{}, {}, {}] });

    // History: one record per affected participant; C's keeps BOTH events in
    // order even though C is dead before and after.
    const records = game().history.slice(historyBefore);
    expect(records).toHaveLength(3);
    expect(opsOf(recordFor(records, c))).toEqual(["added:resurrection", "added:death"]);
    expect(opsOf(recordFor(records, a))).toEqual(["added:death"]);
    expect(opsOf(recordFor(records, b))).toEqual(["added:death"]);
    // C is dead before and after: no alive diff, the operations carry the meaning.
    const cChange = recordFor(records, c).change;
    expect(cChange && "to" in cChange ? cChange.to : {}).not.toHaveProperty("alive");
    expect(recordFor(records, a).change).toEqual({ kind: "value", from: { alive: true }, to: { alive: false } });

    // One authoritative replacement: one Undo entry, one localSeq step.
    expect(state().undoStack.length).toBe(Math.min(before.undo + 1, 20));
    expect(state().localSeq).toBe(before.seq + 1);
    expect(state().undoStack.at(-1)).toEqual(before.game);
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(game()))).success).toBe(true);

    // Undo restores C dead, A/B alive, the prior window and prior History.
    state().undo();
    expect(game()).toEqual(before.game);
    expect(player(c).alive).toBe(false);
    expect(player(a).alive).toBe(true);
    expect(player(b).alive).toBe(true);
  });

  it("C's resurrection restores the generic ability marker even though C ends dead again", () => {
    const { a, b, c } = nightTwoWithDeadC();
    state().setAbilityUsed(c, true);
    const historyBefore = game().history.length;
    expect(state().resolveLife({ intents: [
      { kind: "resurrection", playerId: c }, { kind: "death", playerId: a },
      { kind: "death", playerId: b }, { kind: "death", playerId: c },
    ] }).ok).toBe(true);
    const cRecord = recordFor(game().history.slice(historyBefore), c);
    expect(cRecord.change).toEqual({ kind: "value", from: { abilityUsed: true }, to: { abilityUsed: false } });
    expect(opsOf(cRecord)).toEqual(["added:resurrection", "added:death"]);
  });
});

describe("10A-ASTRA-004: same-participant sequences are judged against the evolving working state", () => {
  it("death(A) then resurrection(A) is valid: A ends alive, both events kept in order", () => {
    const { a } = nightTwoWithDeadC();
    const historyBefore = game().history.length;
    expect(state().resolveLife({ intents: [{ kind: "death", playerId: a }, { kind: "resurrection", playerId: a }] }).ok).toBe(true);
    expect(player(a)).toMatchObject({ alive: true, ghostVote: true });
    expect(events().slice(-2).map((e) => e.kind)).toEqual(["death", "resurrection"]);
    const record = recordFor(game().history.slice(historyBefore), a);
    expect(opsOf(record)).toEqual(["added:death", "added:resurrection"]);
    expect(record.change).toBeUndefined(); // alive before and after -- the operations carry the meaning
  });

  it.each([
    ["death(A), death(A)", (a: PlayerId) => [{ kind: "death" as const, playerId: a }, { kind: "death" as const, playerId: a }]],
    ["resurrection(C), resurrection(C)", (_a: PlayerId, c: PlayerId) => [{ kind: "resurrection" as const, playerId: c }, { kind: "resurrection" as const, playerId: c }]],
    ["death(B), resurrection(C), death(C), death(C)", (_a: PlayerId, c: PlayerId, b: PlayerId) => [
      { kind: "death" as const, playerId: b }, { kind: "resurrection" as const, playerId: c },
      { kind: "death" as const, playerId: c }, { kind: "death" as const, playerId: c }]],
  ])("%s: the later illegal intent refuses the whole transaction -- nothing is applied", (_label, build) => {
    const { a, b, c } = nightTwoWithDeadC();
    const before = { game: game(), undo: state().undoStack, seq: state().localSeq };
    expect(state().resolveLife({ intents: build(a, c, b) }).ok).toBe(false);
    expect(state().game).toBe(before.game);
    expect(state().undoStack).toBe(before.undo);
    expect(state().localSeq).toBe(before.seq);
    expect(player(a).alive).toBe(true);
    expect(player(b).alive).toBe(true);
    expect(player(c).alive).toBe(false);
  });
});

describe("10A-ASTRA-004: corrections with several operations for one participant", () => {
  it("retracting two events of the same participant in one correction is allowed and ordered", () => {
    const { a } = nightTwoWithDeadC();
    expect(state().resolveLife({ intents: [{ kind: "death", playerId: a }, { kind: "resurrection", playerId: a }] }).ok).toBe(true);
    const [death, resurrection] = events().slice(-2);
    const historyBefore = game().history.length;
    const before = { game: structuredClone(game()), seq: state().localSeq };
    expect(state().resolveLife({ intents: [
      { kind: "retractEvent", eventId: resurrection!.id }, { kind: "retractEvent", eventId: death!.id },
    ] }).ok).toBe(true);
    expect(events().some((e) => e.id === death!.id || e.id === resurrection!.id)).toBe(false);
    const record = recordFor(game().history.slice(historyBefore), a);
    expect(record.correction).toBe(true);
    expect(record.lifeEvent?.operations).toEqual([
      { kind: "removed", event: resurrection }, { kind: "removed", event: death },
    ]);
    expect(state().localSeq).toBe(before.seq + 1);
    state().undo();
    expect(game()).toEqual(before.game);
  });

  it("amend and late record for a participant who already has an operation in the same correction", () => {
    const { a } = nightTwoWithDeadC();
    state().advancePhase(); // Day 2; previous phase is Night 2
    const nightDeath = state().lateRecordLifeEvent({ kind: "death", playerId: a },
      [{ playerId: a, target: { alive: false, ghostVote: true } }]);
    expect(nightDeath.ok).toBe(true);
    const recorded = events().at(-1)!;
    const historyBefore = game().history.length;
    // One correction for the same participant: amend that Night 2 death
    // into a resurrection, then late-record a subsequent Night 2 death.
    expect(state().resolveLife({ intents: [
      { kind: "amendEvent", eventId: recorded.id, replacement: { kind: "resurrection" } },
      { kind: "lateRecord", event: { kind: "death", playerId: a } },
      { kind: "correctStatus", playerId: a, target: { alive: false, ghostVote: true } },
    ] }).ok).toBe(true);
    const record = recordFor(game().history.slice(historyBefore), a);
    expect(opsOf(record)).toEqual(["removed:death", "added:resurrection", "added:death"]);
    expect(events().slice(-2).map((e) => e.kind)).toEqual(["resurrection", "death"]);
  });
});

describe("10A-ASTRA-004: the revised v19 History mirror persists, recovers and is version evidence", () => {
  function afterResolution() {
    const { a, b, c } = nightTwoWithDeadC();
    expect(state().resolveLife({ resolutionId: "r1", intents: [
      { kind: "resurrection", playerId: c }, { kind: "death", playerId: a },
      { kind: "death", playerId: b }, { kind: "death", playerId: c },
    ] }).ok).toBe(true);
    return { a, b, c };
  }

  it("round-trips local persistence exactly", async () => {
    afterResolution();
    const before = structuredClone(game());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = localStorage.getItem(STORAGE_KEY)!;
    expect(JSON.parse(raw).version).toBe(19);
    store.setState({ game: null, undoStack: [], localSeq: 0 });
    localStorage.setItem(STORAGE_KEY, raw);
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(game()).toEqual(before);
  });

  it("a current-version store holding it passes unchanged; remote detection reports v19", () => {
    afterResolution();
    const current = JSON.parse(JSON.stringify({ game: game(), undoStack: state().undoStack }));
    expect(migrateStoreState(current, 19)).toBe(current);
    expect(takeMigrationResetFlag()).toBe(false);
    expect(detectLegacyGameVersion(current.game)).toBe(19);
  });

  it("the mirror alone (without a window) is v19 evidence and is rejected, never repaired as v18", () => {
    afterResolution();
    const g = JSON.parse(JSON.stringify(game())) as Partial<StorytellerLobbyRecord> & Record<string, unknown>;
    delete g.lifeEventWindow;
    expect(detectLegacyGameVersion(g)).toBe(19);
    migrateStoreState({ game: g, undoStack: [] }, 18);
    expect(takeMigrationResetFlag()).toBe(true);
  });
});
