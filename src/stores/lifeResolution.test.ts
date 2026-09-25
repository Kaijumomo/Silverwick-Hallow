import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "./identity";
import { participantRefOf } from "./participants";
import { planLifeTransaction } from "./lifeResolution";
import {
  deathsAt,
  executionDeathsAt,
  executionsAt,
  exilesAt,
  lifeEventCoverageAt,
  lifeEventsForParticipantAt,
  resurrectionsAt,
} from "./lifeEvents";
import { StorytellerGamePersistedSchema } from "./schemas";
import type { LifeEvent, PlayerId, StorytellerLobbyRecord } from "./types";

// Phase 10A: the authoritative life-resolution boundary -- Current State,
// the Life Event Window and History always change together (one commit, one
// Undo entry, one localSeq step) or not at all.

const game = () => store.getState().game!;
const state = () => store.getState();
const player = (id: PlayerId) => game().players[id]!;
const events = () => game().lifeEventWindow.events;
const NIGHT1 = { phase: "night", day: 1 } as const;
const DAY1 = { phase: "day", day: 1 } as const;
const NIGHT2 = { phase: "night", day: 2 } as const;
const DAY2 = { phase: "day", day: 2 } as const;

beforeEach(() => store.setState({
  game: null, lobby: null, undoStack: [], localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
}));

/** A dealt, revealed 7-player game at Night 1, plus one late Traveler. */
function liveGame(): { ids: PlayerId[]; traveler: PlayerId } {
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
  const ids = [...game().seatOrder];
  state().addPlayerToSeat("Tess");
  const traveler = game().seatOrder.at(-1)!;
  expect(player(traveler).isTraveler).toBe(true);
  state().assignRole(traveler, "thief");
  return { ids, traveler };
}

function toDay() { expect(state().advancePhase().ok).toBe(true); }

type Snapshot = { game: StorytellerLobbyRecord; undo: number; seq: number };
const snap = (): Snapshot => ({ game: game(), undo: state().undoStack.length, seq: state().localSeq });
/** Nothing at all changed: same game reference, Undo, localSeq. */
function expectUnchanged(before: Snapshot) {
  expect(state().game).toBe(before.game);
  expect(state().undoStack.length).toBe(before.undo);
  expect(state().localSeq).toBe(before.seq);
}
/** Exactly one commit: one Undo entry holding the prior game, one localSeq step. */
function expectOneCommit(before: Snapshot) {
  expect(state().game).not.toBe(before.game);
  expect(state().localSeq).toBe(before.seq + 1);
  expect(state().undoStack.at(-1)).toEqual(before.game);
}

describe("Phase 10A: basic death", () => {
  it("alive -> death: dead, vote granted, one death event and one History mirror, one commit", () => {
    const { ids } = liveGame();
    const id = ids[0]!;
    const before = snap();
    const result = state().recordDeath(id, { provenance: { reason: "demon" } });
    expect(result).toMatchObject({ ok: true, changed: true });
    expectOneCommit(before);
    expect(player(id)).toMatchObject({ alive: false, ghostVote: true });
    expect("exiled" in player(id)).toBe(false);
    const ref = participantRefOf(game(), id)!;
    expect(events()).toEqual([{ id: expect.any(String), kind: "death", subject: ref, moment: NIGHT1, provenance: { reason: "demon" } }]);
    if (result.ok) expect(result.eventIds).toEqual([events()[0]!.id]);
    const record = game().history.at(-1)!;
    expect(record).toMatchObject({
      category: "life", participant: ref, moment: NIGHT1, provenance: { reason: "demon" },
      change: { kind: "value", from: { alive: true }, to: { alive: false } },
      lifeEvent: { added: events()[0] },
    });
    expect(record.correction).toBeUndefined();
    expect(StorytellerGamePersistedSchema.safeParse(JSON.parse(JSON.stringify(game()))).success).toBe(true);
  });

  it("death grants the vote token regardless of a stale prior vote value", () => {
    const { ids } = liveGame();
    const id = ids[0]!;
    store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), ghostVote: false } } } });
    expect(state().recordDeath(id).ok).toBe(true);
    expect(player(id)).toMatchObject({ alive: false, ghostVote: true });
    expect(game().history.at(-1)!.change).toEqual({ kind: "value", from: { alive: true, ghostVote: false }, to: { alive: false, ghostVote: true } });
  });

  it("a duplicate death is refused and changes nothing (state, window, History, Undo, localSeq)", () => {
    const { ids } = liveGame();
    state().recordDeath(ids[0]!);
    const before = snap();
    const result = state().recordDeath(ids[0]!);
    expect(result).toMatchObject({ ok: false, code: "refused" });
    expectUnchanged(before);
  });

  it("Undo restores Current State, the window and History together", () => {
    const { ids } = liveGame();
    const before = structuredClone(game());
    state().recordDeath(ids[0]!);
    state().undo();
    expect(game()).toEqual(before);
  });
});

describe("Phase 10A: ghost vote", () => {
  it("dead + vote -> spend; duplicate spend refused; restore; living spend/restore refused", () => {
    const { ids } = liveGame();
    const [dead, living] = [ids[0]!, ids[1]!];
    state().recordDeath(dead);
    const eventsBefore = events();
    expect(state().spendGhostVote(dead)).toMatchObject({ ok: true, changed: true, eventIds: [] });
    expect(player(dead).ghostVote).toBe(false);
    // A vote token is not a Life Event -- the window is untouched, History mirrors the diff.
    expect(events()).toBe(eventsBefore);
    expect(game().history.at(-1)).toMatchObject({ category: "life", change: { from: { ghostVote: true }, to: { ghostVote: false } } });
    expect(game().history.at(-1)!.lifeEvent).toBeUndefined();

    let before = snap();
    expect(state().spendGhostVote(dead).ok).toBe(false);
    expectUnchanged(before);

    expect(state().restoreGhostVote(dead).ok).toBe(true);
    expect(player(dead).ghostVote).toBe(true);
    before = snap();
    expect(state().restoreGhostVote(dead).ok).toBe(false);
    expectUnchanged(before);

    for (const run of [() => state().spendGhostVote(living), () => state().restoreGhostVote(living)]) {
      before = snap();
      expect(run()).toMatchObject({ ok: false, code: "refused" });
      expectUnchanged(before);
    }
  });
});

describe("Phase 10A: resurrection", () => {
  it("dead -> alive: vote normalized, exile cleared, ability restored, resurrection event", () => {
    const { traveler } = liveGame();
    toDay();
    state().recordExile(traveler, "died");
    state().spendGhostVote(traveler);
    state().setAbilityUsed(traveler, true);
    expect(player(traveler)).toMatchObject({ alive: false, ghostVote: false, exiled: true, abilityUsed: true });
    expect(state().resurrect(traveler).ok).toBe(true);
    expect(player(traveler)).toMatchObject({ alive: true, ghostVote: true, abilityUsed: false });
    expect("exiled" in player(traveler)).toBe(false);
    expect(events().at(-1)).toMatchObject({ kind: "resurrection", moment: DAY1 });
    expect(game().history.at(-1)!.change).toEqual({ kind: "value",
      from: { alive: false, ghostVote: false, exiled: true, abilityUsed: true },
      to: { alive: true, ghostVote: true, exiled: false, abilityUsed: false } });
  });

  it("a duplicate resurrection is refused", () => {
    const { ids } = liveGame();
    const before = snap();
    expect(state().resurrect(ids[0]!).ok).toBe(false);
    expectUnchanged(before);
  });

  it("a status correction to alive is NOT a resurrection: no event, ability stays used, flagged correction", () => {
    const { ids } = liveGame();
    const id = ids[0]!;
    state().recordDeath(id);
    state().setAbilityUsed(id, true);
    const eventsBefore = events();
    expect(state().correctLifeStatus(id, { alive: true }).ok).toBe(true);
    expect(player(id)).toMatchObject({ alive: true, ghostVote: true, abilityUsed: true });
    expect(events()).toEqual(eventsBefore);
    expect(game().history.at(-1)).toMatchObject({ category: "life", correction: true,
      change: { from: { alive: false }, to: { alive: true } } });
    expect(game().history.at(-1)!.lifeEvent).toBeUndefined();
  });
});

describe("Phase 10A: exile", () => {
  it("a living Traveler exiled -> died: dead, exiled, vote granted", () => {
    const { traveler } = liveGame();
    toDay();
    expect(state().recordExile(traveler, "died").ok).toBe(true);
    expect(player(traveler)).toMatchObject({ alive: false, ghostVote: true, exiled: true });
    expect(events().at(-1)).toMatchObject({ kind: "exile", outcome: "died", moment: DAY1 });
  });

  it("a living Traveler exiled -> survived: stays alive, not exiled, no vote change -- the event still records it", () => {
    const { traveler } = liveGame();
    toDay();
    const before = player(traveler);
    expect(state().recordExile(traveler, "survived").ok).toBe(true);
    expect(player(traveler)).toEqual(before);
    expect(events().at(-1)).toMatchObject({ kind: "exile", outcome: "survived" });
    const record = game().history.at(-1)!;
    expect(record.change).toBeUndefined();
    expect(record.lifeEvent?.added).toMatchObject({ kind: "exile", outcome: "survived" });
    // Several exiles on one Day are allowed.
    expect(state().recordExile(traveler, "survived").ok).toBe(true);
    expect(exilesAt(game(), DAY1)).toMatchObject({ status: "known", events: [{ outcome: "survived" }, { outcome: "survived" }] });
  });

  it("refused: at Night, for a dead Traveler, and for a non-Traveler", () => {
    const { ids, traveler } = liveGame();
    let before = snap();
    expect(state().recordExile(traveler, "died").ok).toBe(false); // Night 1
    expectUnchanged(before);
    toDay();
    before = snap();
    expect(state().recordExile(ids[0]!, "died").ok).toBe(false);
    expectUnchanged(before);
    state().recordExile(traveler, "died");
    before = snap();
    expect(state().recordExile(traveler, "died").ok).toBe(false);
    expectUnchanged(before);
  });

  it("exile never touches supporters' or other players' vote tokens", () => {
    const { ids, traveler } = liveGame();
    state().recordDeath(ids[0]!);
    toDay();
    const others = ids.map((id) => ({ ...player(id) }));
    state().recordExile(traveler, "died");
    ids.forEach((id, i) => expect(player(id)).toEqual(others[i]));
  });
});

describe("Phase 10A: execution", () => {
  it("alive executee -> died: one execution event (never execution + death), dead with vote", () => {
    const { ids } = liveGame();
    toDay();
    expect(state().recordExecution(ids[0]!, "died").ok).toBe(true);
    expect(player(ids[0]!)).toMatchObject({ alive: false, ghostVote: true });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({ kind: "execution", outcome: "died", moment: DAY1 });
    expect(executionDeathsAt(game(), DAY1)).toMatchObject({ status: "known", events: [{ kind: "execution" }] });
    expect(deathsAt(game(), DAY1)).toMatchObject({ status: "known", events: [{ kind: "execution" }] });
  });

  it("alive executee -> survived: no life-field diff, but the event and its History persist", () => {
    const { ids } = liveGame();
    toDay();
    const before = snap();
    expect(state().recordExecution(ids[0]!, "survived").ok).toBe(true);
    expectOneCommit(before);
    expect(player(ids[0]!)).toEqual(before.game.players[ids[0]!]);
    const record = game().history.at(-1)!;
    expect(record.change).toBeUndefined();
    expect(record.lifeEvent?.added).toMatchObject({ kind: "execution", outcome: "survived" });
    expect(deathsAt(game(), DAY1)).toEqual({ status: "known", events: [] });
  });

  it("dead executee -> alreadyDead; mismatched outcomes are refused", () => {
    const { ids } = liveGame();
    state().recordDeath(ids[0]!);
    toDay();
    let before = snap();
    expect(state().recordExecution(ids[0]!, "died").ok).toBe(false);
    expectUnchanged(before);
    expect(state().recordExecution(ids[0]!, "alreadyDead").ok).toBe(true);
    expect(events().at(-1)).toMatchObject({ kind: "execution", outcome: "alreadyDead" });
    before = snap();
    expect(state().recordExecution(ids[1]!, "alreadyDead", { confirmAdditionalExecution: true }).ok).toBe(false);
    expectUnchanged(before);
  });

  it("execution is Day-only", () => {
    const { ids } = liveGame();
    const before = snap();
    expect(state().recordExecution(ids[0]!, "died").ok).toBe(false);
    expectUnchanged(before);
  });

  it("an exceptional Traveler executee requires explicit confirmation", () => {
    const { traveler } = liveGame();
    toDay();
    const before = snap();
    expect(state().recordExecution(traveler, "died")).toMatchObject({ ok: false, code: "needsConfirmation", confirmation: "travelerExecutee" });
    expectUnchanged(before);
    expect(state().recordExecution(traveler, "died", { confirmTravelerExecutee: true }).ok).toBe(true);
    expect(player(traveler)).toMatchObject({ alive: false, ghostVote: true });
    expect("exiled" in player(traveler)).toBe(false); // executed, not exiled
  });

  it("an additional execution on the same Day needs confirmation, but is never impossible", () => {
    const { ids } = liveGame();
    toDay();
    state().recordExecution(ids[0]!, "survived");
    const before = snap();
    expect(state().recordExecution(ids[1]!, "died")).toMatchObject({ ok: false, code: "needsConfirmation", confirmation: "additionalExecution" });
    expectUnchanged(before);
    expect(state().recordExecution(ids[1]!, "died", { confirmAdditionalExecution: true }).ok).toBe(true);
    expect(executionsAt(game(), DAY1)).toMatchObject({ status: "known", events: [{ outcome: "survived" }, { outcome: "died" }] });
  });
});

describe("Phase 10A: guards and true no-ops", () => {
  it("Setup-time life changes are refused -- nothing becomes hidden state", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 5 });
    state().addPlayerToSeat("Alice");
    const id = game().seatOrder[0]!;
    const before = snap();
    for (const run of [() => state().recordDeath(id), () => state().correctLifeStatus(id, { alive: false, ghostVote: true })]) {
      expect(run().ok).toBe(false);
      expectUnchanged(before);
    }
  });

  it("an empty planned seat is never mutated", () => {
    liveGame();
    state().addEmptySeat();
    const empty = game().seatOrder.at(-1)!;
    expect(player(empty).isEmpty).toBe(true);
    const before = snap();
    expect(state().recordDeath(empty).ok).toBe(false);
    expect(state().recordDeath("toString").ok).toBe(false);
    expect(state().recordDeath("__proto__").ok).toBe(false);
    expectUnchanged(before);
  });

  it("an ended game accepts no life change", () => {
    const { ids } = liveGame();
    expect(state().setPhase("ended").ok).toBe(true);
    const before = snap();
    expect(state().recordDeath(ids[0]!).ok).toBe(false);
    expectUnchanged(before);
  });

  it("a status correction to the current status is a true no-op", () => {
    const { ids } = liveGame();
    const before = snap();
    expect(state().correctLifeStatus(ids[0]!, { alive: true })).toEqual({ ok: true, changed: false, eventIds: [] });
    expectUnchanged(before);
  });

  it("new commands never create an invalid combination: exile-dead only for a Traveler, a living player keeps their vote", () => {
    const { ids } = liveGame();
    const before = snap();
    expect(state().correctLifeStatus(ids[0]!, { alive: false, ghostVote: true, exiled: true }).ok).toBe(false);
    expect(state().correctLifeStatus(ids[0]!, { alive: true, ghostVote: false } as never).ok).toBe(false);
    expectUnchanged(before);
  });

  it("a Provenance source that is not seated refuses the whole command", () => {
    const { ids } = liveGame();
    const before = snap();
    expect(state().recordDeath(ids[0]!, { provenance: { sourcePlayer: "nobody" } }).ok).toBe(false);
    expectUnchanged(before);
  });
});

describe("Phase 10A: the Life Event Window", () => {
  it("current and previous phases are queryable; older phases expire on rollover", () => {
    const { ids } = liveGame();
    state().recordDeath(ids[0]!);                 // Night 1
    toDay();
    state().recordExecution(ids[1]!, "died");      // Day 1
    expect(deathsAt(game(), NIGHT1)).toMatchObject({ status: "known", events: [{ kind: "death" }] });
    expect(deathsAt(game(), DAY1)).toMatchObject({ status: "known", events: [{ kind: "execution" }] });
    toDay(); // -> Night 2: Night 1 expires, Day 1 stays queryable during the following Night
    expect(game().phase).toBe("night");
    expect(events().map((e) => e.kind)).toEqual(["execution"]);
    expect(deathsAt(game(), DAY1)).toMatchObject({ status: "known", events: [{ kind: "execution" }] });
    expect(deathsAt(game(), NIGHT1)).toMatchObject({ status: "unknown", reason: "expired" });
    state().recordDeath(ids[2]!);                  // Night 2
    toDay(); // -> Day 2: Night 2 deaths queryable during the following Day
    expect(deathsAt(game(), NIGHT2)).toMatchObject({ status: "known", events: [{ kind: "death" }] });
    expect(events().map((e) => e.moment)).toEqual([NIGHT2]);
    expect(deathsAt(game(), DAY2)).toEqual({ status: "known", events: [] }); // covered + none
  });

  it("phase advance prunes as ONE Undo action, writes no History for expiry, and Undo restores the pruned events", () => {
    const { ids } = liveGame();
    state().recordDeath(ids[0]!);
    toDay();
    state().recordExecution(ids[1]!, "survived");
    const beforeAdvance = structuredClone(game());
    const before = snap();
    toDay(); // Day 1 -> Night 2 prunes Night 1's death
    expectOneCommit(before);
    expect(events()).toHaveLength(1);
    expect(game().history).toEqual(beforeAdvance.history);
    state().undo();
    expect(game()).toEqual(beforeAdvance);
    expect(events().map((e) => e.kind)).toEqual(["death", "execution"]);
  });

  it("multiple events keep acceptance order and a shared resolutionId", () => {
    const { ids } = liveGame();
    const result = state().resolveLife({
      resolutionId: "res-1",
      intents: [{ kind: "death", playerId: ids[2]! }, { kind: "death", playerId: ids[0]! }],
      context: { provenance: { sourceCharacter: "shabaloth" } },
    });
    expect(result.ok).toBe(true);
    expect(events().map((e) => e.subject.playerId)).toEqual([ids[2], ids[0]]);
    expect(events().every((e) => e.resolutionId === "res-1")).toBe(true);
  });

  it("a query before coverageFrom is unknown, never an empty 'none'", () => {
    liveGame();
    store.setState({ game: { ...game(), lifeEventWindow: { coverageFrom: DAY1, events: [] } } });
    expect(executionsAt(game(), NIGHT1)).toEqual({ status: "unknown", reason: "notCovered", recorded: [] });
    toDay();
    expect(executionsAt(game(), DAY1)).toEqual({ status: "known", events: [] });
    expect(lifeEventCoverageAt(game(), DAY2)).toEqual({ status: "unknown", reason: "future" });
  });
});

describe("Phase 10A: future ability-engine seam (multi-intent transactions)", () => {
  it("several subjects resolve in ONE commit: one Undo entry, one localSeq step, one History record per participant", () => {
    const { ids } = liveGame();
    const before = snap();
    const historyBefore = game().history.length;
    const result = state().resolveLife({
      resolutionId: "night-2-demon",
      intents: [{ kind: "death", playerId: ids[0]! }, { kind: "death", playerId: ids[1]! }],
    });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (result.ok) expect(result.eventIds).toHaveLength(2);
    expectOneCommit(before);
    const records = game().history.slice(historyBefore);
    expect(records.map((h) => h.participant.playerId)).toEqual([ids[0], ids[1]]);
    expect(records.every((h) => h.lifeEvent?.added?.resolutionId === "night-2-demon")).toBe(true);
    state().undo();
    expect(game()).toEqual(before.game);
  });

  it("any refused intent refuses the whole transaction -- nothing is applied partially", () => {
    const { ids } = liveGame();
    state().recordDeath(ids[1]!);
    const before = snap();
    const result = state().resolveLife({ intents: [{ kind: "death", playerId: ids[0]! }, { kind: "death", playerId: ids[1]! }] });
    expect(result.ok).toBe(false);
    expectUnchanged(before);
    expect(player(ids[0]!).alive).toBe(true);
  });

  it("one semantic action = one event per subject: a second event for the same subject is refused", () => {
    const { ids } = liveGame();
    toDay();
    const before = snap();
    const result = state().resolveLife({ intents: [
      { kind: "execution", playerId: ids[0]!, outcome: "survived" },
      { kind: "death", playerId: ids[0]! },
    ] });
    expect(result.ok).toBe(false);
    expectUnchanged(before);
  });

  it("gameplay and correction intents never mix", () => {
    const { ids } = liveGame();
    const before = snap();
    expect(state().resolveLife({ intents: [
      { kind: "death", playerId: ids[0]! }, { kind: "correctStatus", playerId: ids[1]!, target: { alive: true } },
    ] }).ok).toBe(false);
    expectUnchanged(before);
  });

  it("planLifeTransaction is pure: planning never mutates the game it reads", () => {
    const { ids } = liveGame();
    const frozen = structuredClone(game());
    const plan = planLifeTransaction(game(), { intents: [{ kind: "death", playerId: ids[0]! }] });
    expect(plan.ok).toBe(true);
    expect(game()).toEqual(frozen);
  });

  it("the caller's own intent/provenance objects are never shared with stored state", () => {
    const { ids } = liveGame();
    const provenance = { reason: "original" };
    state().recordDeath(ids[0]!, { provenance });
    provenance.reason = "mutated later";
    expect(events()[0]!.provenance).toEqual({ reason: "original" });
    expect(game().history.at(-1)!.provenance).toEqual({ reason: "original" });
  });
});

describe("Phase 10A: corrections", () => {
  function executed() {
    const ctx = liveGame();
    toDay();
    expect(state().recordExecution(ctx.ids[0]!, "died").ok).toBe(true);
    return { ...ctx, event: events()[0]! as LifeEvent };
  }

  it("retract removes the event; Current State is repaired only when asked, atomically, as one Undo step", () => {
    const { ids, event } = executed();
    const before = snap();
    const result = state().retractLifeEvent(event.id, [{ playerId: ids[0]!, target: { alive: true } }]);
    expect(result.ok).toBe(true);
    expectOneCommit(before);
    expect(events()).toEqual([]);
    expect(player(ids[0]!)).toMatchObject({ alive: true, ghostVote: true });
    const record = game().history.at(-1)!;
    expect(record).toMatchObject({ category: "life", correction: true, lifeEvent: { removed: event },
      change: { from: { alive: false }, to: { alive: true } } });
    expect(record.lifeEvent?.added).toBeUndefined();
    state().undo();
    expect(game()).toEqual(before.game);
  });

  it("retract without a repair leaves Current State alone (never a fake resurrection)", () => {
    const { ids, event } = executed();
    expect(state().retractLifeEvent(event.id).ok).toBe(true);
    expect(player(ids[0]!).alive).toBe(false);
    expect(events().some((e) => e.kind === "resurrection")).toBe(false);
  });

  it("amend retracts and appends a replacement with a NEW id, the original moment and resolutionId", () => {
    const { ids, event } = executed();
    const result = state().amendLifeEvent(event.id, { kind: "execution", outcome: "survived" },
      [{ playerId: ids[0]!, target: { alive: true } }]);
    expect(result.ok).toBe(true);
    expect(events()).toHaveLength(1);
    const replacement = events()[0]!;
    expect(replacement.id).not.toBe(event.id);
    expect(replacement).toMatchObject({ kind: "execution", outcome: "survived", moment: DAY1, subject: event.subject });
    expect(player(ids[0]!).alive).toBe(true);
    expect(game().history.at(-1)).toMatchObject({ correction: true, lifeEvent: { removed: event, added: replacement } });
    // Accepted events are never edited in place: the original object is untouched.
    expect(event).toMatchObject({ outcome: "died" });
  });

  it("amend can move an event to a different executee: one History record per affected participant", () => {
    const { ids, event } = executed();
    const historyBefore = game().history.length;
    expect(state().amendLifeEvent(event.id, { kind: "execution", outcome: "died", playerId: ids[1]! }, [
      { playerId: ids[1]!, target: { alive: false, ghostVote: true } },
      { playerId: ids[0]!, target: { alive: true } },
    ]).ok).toBe(true);
    const records = game().history.slice(historyBefore);
    expect(records.map((r) => r.participant.playerId).sort()).toEqual([ids[0], ids[1]].sort());
    expect(player(ids[0]!).alive).toBe(true);
    expect(player(ids[1]!).alive).toBe(false);
    expect(lifeEventsForParticipantAt(game(), player(ids[1]!).participantId!, DAY1)).toMatchObject({ status: "known", events: [{ kind: "execution" }] });
  });

  it("late record appends a valid event at the immediately previous phase", () => {
    const { ids } = liveGame();
    toDay();
    toDay(); // Night 2: the previous phase is Day 1
    expect(state().lateRecordLifeEvent({ kind: "execution", outcome: "died", playerId: ids[0]! },
      [{ playerId: ids[0]!, target: { alive: false, ghostVote: true } }]).ok).toBe(true);
    expect(events().at(-1)).toMatchObject({ kind: "execution", moment: DAY1 });
    expect(player(ids[0]!).alive).toBe(false);
    expect(game().history.at(-1)).toMatchObject({ correction: true, moment: NIGHT2 });
    // Structural rules still apply to corrections: an exile needs a Day
    // moment and a Traveler; a Night previous phase has no execution.
    toDay(); // Day 2: previous is Night 2
    const before = snap();
    expect(state().lateRecordLifeEvent({ kind: "execution", outcome: "died", playerId: ids[1]! }).ok).toBe(false);
    expectUnchanged(before);
  });

  it("corrections are unavailable once the original event has left the window", () => {
    const { event } = executed();
    toDay(); toDay(); // Day 1 -> Night 2 -> Day 2: Day 1 expired
    const before = snap();
    expect(state().retractLifeEvent(event.id).ok).toBe(false);
    expect(state().amendLifeEvent(event.id, { kind: "death" }).ok).toBe(false);
    expectUnchanged(before);
  });

  it("a correction fires no ability semantics: no resurrection event and no ability restoration", () => {
    const { ids, event } = executed();
    state().setAbilityUsed(ids[0]!, true);
    state().retractLifeEvent(event.id, [{ playerId: ids[0]!, target: { alive: true } }]);
    expect(player(ids[0]!).abilityUsed).toBe(true);
    expect(resurrectionsAt(game(), DAY1)).toEqual({ status: "known", events: [] });
  });

  it("an identical amendment is refused", () => {
    const { event } = executed();
    const before = snap();
    expect(state().amendLifeEvent(event.id, { kind: "execution", outcome: "died" }).ok).toBe(false);
    expectUnchanged(before);
  });
});

describe("Phase 10A: legacy compatibility adapters", () => {
  it("setAlive(false) is a death, setAlive(true) a status correction, setGhostVote(false) a spend, exileTraveler an exile(died)", () => {
    const { ids, traveler } = liveGame();
    state().setAlive(ids[0]!, false);
    expect(events().at(-1)).toMatchObject({ kind: "death" });
    state().setGhostVote(ids[0]!, false);
    expect(player(ids[0]!).ghostVote).toBe(false);
    state().setAlive(ids[0]!, true);
    expect(player(ids[0]!)).toMatchObject({ alive: true, ghostVote: true });
    expect(game().history.at(-1)!.correction).toBe(true);
    toDay();
    state().exileTraveler(traveler);
    expect(events().at(-1)).toMatchObject({ kind: "exile", outcome: "died" });
  });
});
