import { describe, expect, it } from "vitest";
import { bind, impair, patchPlayer, proofEnv, proofGame, proofScript, reseat } from "@/test/proofFixtures";
import { butlerSelectionContext, planButlerSelection, reconcileButlerReminders, type ButlerSelectionRequest } from "./butlerSelection";
import { currentVotingState, freshVotingDay, planVoting } from "./voting";
import { planLifeTransaction, applyLifePlan } from "./lifeResolution";
import { StorytellerGamePersistedSchema } from "./schemas";
import { participantStepKey } from "./nightProgress";
import type { StorytellerLobbyRecord } from "./types";

// Independent oracle: /Butler explicitly permits dead Masters and says illegal
// observed votes still count. Master notation must not become vote authority.
const base = (): StorytellerLobbyRecord => {
  const g = proofGame(["butler", "chef", "soldier", "poisoner", "imp"], "night", 1);
  return { ...g, players: Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, { ...p, packetEpoch: "identity-" + id }])) };
};
const req = (g: StorytellerLobbyRecord, target = "p1"): ButlerSelectionRequest => ({ source: bind(g, "p0"), target: bind(g, target), expected: butlerSelectionContext(g, proofScript, bind(g, "p0")) });
const select = (g: StorytellerLobbyRecord, target = "p1") => {
  const result = planButlerSelection(g, req(g, target), proofEnv());
  expect(result).toMatchObject({ ok: true, changed: true });
  if (!result.ok || !result.changed) throw new Error("Expected accepted selection");
  return result.game;
};
const masters = (g: StorytellerLobbyRecord) => Object.values(g.players).flatMap(p => p.reminders.filter(r => r.label === "Master").map(r => ({ playerId: p.id, ...r })));

describe("B7 independent Butler selection and non-enforcement", () => {
  it.each([false, true])("chooses another player with dead=%s, completes only the Butler step and preserves v28", dead => {
    const before = patchPlayer(base(), "p1", { alive: !dead }); const next = select(before);
    expect(masters(next)).toHaveLength(1); expect(masters(next)[0]).toMatchObject({ playerId: "p1", sourceCharacter: "butler", sourceParticipant: { participantId: before.players.p0!.participantId } });
    expect(next.nightProgress["1:" + participantStepKey(before.players.p0!.participantId!, "butler")]?.status).toBe("done");
    expect(next.phase).toBe("night"); expect(next.day).toBe(1); expect(next.players.p0!.abilityUsed).toBe(false);
    expect(next.gameSchemaVersion).toBe(29); expect(StorytellerGamePersistedSchema.safeParse(next).success).toBe(true);
    expect(before.players.p1!.reminders).toEqual([]);
  });

  it("self-selection is refused without completing the turn", () => {
    const g = base(); expect(planButlerSelection(g, req(g, "p0"), proofEnv())).toMatchObject({ ok: false }); expect(g.nightProgress).toEqual({}); expect(masters(g)).toEqual([]);
  });

  it("same choice is idempotent and replacement removes only exact generated notation", () => {
    const original = base(); original.players.p1!.reminders.push({ id: "manual-master", label: "Master", sourceCharacter: "butler" });
    const first = select(original); const again = planButlerSelection(first, req(first), proofEnv());
    expect(again).toMatchObject({ ok: true, changed: false });
    const changed = select(first, "p2"); expect(changed.players.p1!.reminders).toEqual(original.players.p1!.reminders);
    expect(masters(changed).filter(r => r.playerId === "p2")).toHaveLength(1);
  });

  it.each(["poisoned", "drunk", "abilityLost"])("%s source remains fully manual with no automated Master or completed step", effect => {
    const g = impair(base(), "p0", effect); expect(planButlerSelection(g, req(g), proofEnv())).toMatchObject({ ok: false }); expect(masters(g)).toEqual([]); expect(g.nightProgress).toEqual({});
  });

  it.each(["source-seat", "target-seat", "source-role", "source-dead", "source-epoch", "day", "phase", "game", "script"])("stale %s cannot redirect selection", change => {
    const original = base(); const request = req(original); let g = original;
    if (change === "source-seat") g = reseat(g, "p0");
    if (change === "target-seat") g = reseat(g, "p1");
    if (change === "source-role") g = patchPlayer(g, "p0", { actualRole: "chef" });
    if (change === "source-dead") g = patchPlayer(g, "p0", { alive: false });
    if (change === "source-epoch") g = patchPlayer(g, "p0", { packetEpoch: "new-identity" });
    if (change === "day") g = { ...g, day: 2 };
    if (change === "phase") g = { ...g, phase: "day" };
    if (change === "game") g = { ...g, code: "OTHER" };
    if (change === "script") g = { ...g, scriptId: "other" };
    expect(planButlerSelection(g, request, proofEnv())).toMatchObject({ ok: false }); expect(masters(g)).toEqual([]);
  });

  it("Master death retains the choice while source death and resurrection retire it", () => {
    const selected = select(base());
    const death = planLifeTransaction(selected, { intents: [{ kind: "death", playerId: "p1" }] }, undefined, proofEnv());
    expect(death).toMatchObject({ ok: true, changed: true });
    if (!death.ok || !death.changed) throw new Error("death refused");
    const deadMaster = applyLifePlan(selected, death.plan); expect(masters(deadMaster)).toHaveLength(1);
    const cycle = planLifeTransaction(deadMaster, { intents: [{ kind: "death", playerId: "p0" }, { kind: "resurrection", playerId: "p0" }] }, undefined, proofEnv());
    expect(cycle).toMatchObject({ ok: true, changed: true });
    if (!cycle.ok || !cycle.changed) throw new Error("cycle refused");
    expect(masters(applyLifePlan(deadMaster, cycle.plan))).toEqual([]);
  });

  it("source replacement removes generated notation and retains unrelated manual tokens", () => {
    const selected = select(base()); selected.players.p1!.reminders.push({ id: "manual", label: "Master", sourceCharacter: "butler" });
    const next = reconcileButlerReminders(reseat(selected, "p0")); expect(masters(next)).toHaveLength(1); expect(masters(next)[0]!.id).toBe("manual");
  });

  it("temporary impairment retains a healthy selection as notation without creating any vote modifier", () => {
    const selected = select(base()); const impaired = reconcileButlerReminders(impair(selected, "p0"));
    expect(masters(impaired)).toEqual(masters(selected)); expect(impaired.voting?.modifiers ?? []).toEqual([]);
  });

  it("the next Night expires only the previous generated Master", () => {
    const selected = select(base()); selected.players.p1!.reminders.push({ id: "manual", label: "Master", sourceCharacter: "butler" });
    expect(masters(reconcileButlerReminders({ ...selected, phase: "day" }))).toHaveLength(2);
    const next = reconcileButlerReminders({ ...selected, day: 2 }); expect(masters(next)).toHaveLength(1); expect(masters(next)[0]!.id).toBe("manual");
    const changed = select(next, "p2"); expect(masters(changed)).toHaveLength(2);
  });

  it.each([false, true])("observed Butler vote counts even when Master did not vote, dead Butler=%s", dead => {
    let g: StorytellerLobbyRecord = { ...select(base(), "p2"), phase: "day", voting: freshVotingDay(1) };
    if (dead) g = patchPlayer(g, "p0", { alive: false, ghostVote: true });
    const start = planVoting(g, { kind: "begin", code: g.code, day: g.day, expectedRevision: 0, roundId: "ballot", mode: "nomination", nominator: bind(g, "p2"), nominee: bind(g, "p4") }, proofEnv());
    expect(start).toMatchObject({ ok: true }); if (!start.ok) throw new Error("begin refused"); g = start.game;
    const vote = planVoting(g, { kind: "respond", code: g.code, day: g.day, expectedRevision: currentVotingState(g).revision, roundId: "ballot", voter: bind(g, "p0"), choice: "yes" }, proofEnv());
    expect(vote).toMatchObject({ ok: true }); if (!vote.ok) throw new Error("vote refused");
    expect(vote.game.voting!.rounds[0]!.tally).toBe(1); expect(vote.game.voting!.rounds[0]!.responses[0]!.weight).toBe(1);
    expect(vote.game.players.p0!.ghostVote).toBe(!dead);
  });
});
