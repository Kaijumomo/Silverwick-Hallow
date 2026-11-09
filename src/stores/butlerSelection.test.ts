import { describe, expect, it } from "vitest";
import { bind, impair, patchPlayer, proofGame, proofRegistry, proofScript, reseat } from "@/test/proofFixtures";
import { butlerReminderId, butlerReminderOrigin, butlerSelectionAvailability, butlerSelectionContext, planButlerSelection, reconcileButlerReminders } from "./butlerSelection";
import { applyLifePlan, planLifeTransaction } from "./lifeResolution";
import { applyRolePlan, changeRoleIntent, defaultRoleIds, planRoleTransaction } from "./roleResolution";
import { StorytellerGamePersistedSchema } from "./schemas";
import { participantStepKey } from "./nightProgress";
import { participantRefOf } from "./participants";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import type { StorytellerLobbyRecord } from "./types";

const env = { script: proofScript, registry: proofRegistry };
const game = () => patchPlayer(proofGame(["butler", "chef", "saint", "imp"], "night", 1), "p0", { packetEpoch: "butler-epoch" });
const request = (g: StorytellerLobbyRecord, target = "p1") => ({ source: bind(g, "p0"), target: bind(g, target), expected: butlerSelectionContext(g, proofScript, bind(g, "p0")) });
function select(g = game(), target = "p1") {
  const result = planButlerSelection(g, request(g, target), env);
  expect(result).toMatchObject({ ok: true, changed: true });
  if (!result.ok || !result.changed) throw new Error("Expected selection");
  return result.game;
}
function life(g: StorytellerLobbyRecord, ids: string[]) {
  const result = planLifeTransaction(g, { intents: ids.map(playerId => ({ kind: "death" as const, playerId })) }, undefined, env);
  if (!result.ok || !result.changed) throw new Error("Expected Life change");
  return applyLifePlan(g, result.plan);
}

describe("Butler command-managed selection notation", () => {
  it("records exact source, generated Master and Night completion without mechanical state", () => {
    const before = game(); const after = select(before);
    expect(after.players.p1!.reminders).toEqual([expect.objectContaining({ id: butlerReminderId(before.players.p0!.participantId!, "butler-epoch"), label: "Master", sourceCharacter: "butler", sourceParticipant: participantRefOf(before, "p0") })]);
    expect(after.nightProgress[`1:${participantStepKey(before.players.p0!.participantId!, "butler")}`]?.status).toBe("done");
    expect(Object.values(after.players).map(p => p.effects)).toEqual(Object.values(before.players).map(p => p.effects));
    expect(after.voting).toEqual(before.voting);
    expect(after.preparedInformation).toBe(before.preparedInformation);
  });
  it("allows a dead Master", () => expect(select(patchPlayer(game(), "p1", { alive: false })).players.p1!.reminders).toHaveLength(1));
  it("rejects self-selection without mutating", () => { const g = game(); const before = JSON.stringify(g); expect(planButlerSelection(g, request(g, "p0"), env).ok).toBe(false); expect(JSON.stringify(g)).toBe(before); });
  it("same choice is idempotent; a different choice replaces only its generated token", () => {
    const first = select();
    expect(planButlerSelection(first, request(first), env)).toEqual({ ok: true, changed: false });
    const manual = { id: "manual", label: "Master", sourceCharacter: "butler", sourceParticipant: participantRefOf(first, "p0")! };
    const next = select(patchPlayer(first, "p1", { reminders: [...first.players.p1!.reminders, manual] }), "p2");
    expect(next.players.p1!.reminders).toEqual([manual]);
    expect(next.players.p2!.reminders).toHaveLength(1);
  });
  it("later Night choice replaces the previous generated token", () => {
    const first = select(); const next = select({ ...first, day: 2 }, "p2");
    expect(next.players.p1!.reminders).toEqual([]);
    expect(next.players.p2!.reminders[0]?.createdAt).toEqual({ phase: "night", day: 2 });
  });
  it("same Master chosen on a later Night renews only the exact generated token", () => {
    const first = select(); const next = select({ ...first, day: 2 });
    expect(next.players.p1!.reminders).toHaveLength(1);
    expect(next.players.p1!.reminders[0]?.createdAt).toEqual({ phase: "night", day: 2 });
    expect(reconcileButlerReminders(next).players.p1!.reminders).toEqual(next.players.p1!.reminders);
  });
  it("generated choice lasts through the following Day, then clears at next Night without touching manual tokens", () => {
    const selected = select(); const manual = { id: "manual", label: "Master", sourceCharacter: "butler" };
    const first = patchPlayer(selected, "p1", { reminders: [...selected.players.p1!.reminders, manual] });
    expect(reconcileButlerReminders({ ...first, phase: "day" }).players.p1!.reminders).toEqual(first.players.p1!.reminders);
    expect(reconcileButlerReminders({ ...first, day: 2 }).players.p1!.reminders).toEqual([manual]);
    expect(reconcileButlerReminders({ ...first, phase: "setup", day: 0 }).players.p1!.reminders).toEqual([manual]);
  });
  for (const mutate of [
    (g: StorytellerLobbyRecord) => ({ ...g, phase: "day" as const }),
    (g: StorytellerLobbyRecord) => ({ ...g, day: 2 }),
    (g: StorytellerLobbyRecord) => ({ ...g, code: "DIFFERENT" }),
    (g: StorytellerLobbyRecord) => ({ ...g, storytellerUid: "new-owner" }),
    (g: StorytellerLobbyRecord) => patchPlayer(g, "p0", { packetEpoch: "new-epoch" }),
    (g: StorytellerLobbyRecord) => patchPlayer(g, "p0", { actualRole: "chef" }),
    (g: StorytellerLobbyRecord) => reseat(g, "p0"),
    (g: StorytellerLobbyRecord) => reseat(g, "p1"),
  ]) it("rejects changed game, Night or participant context", () => { const g = game(); expect(planButlerSelection(mutate(g), request(g), env).ok).toBe(false); });
  it("rejects stale script contents", () => { const g = game(); expect(planButlerSelection(g, request(g), { ...env, script: { ...proofScript, name: "Changed" } }).ok).toBe(false); });
  it.each(["poisoned", "drunk", "abilityLost"])("%s source stays wholly manual", type => {
    const g = impair(game(), "p0", type);
    expect(butlerSelectionAvailability(g, bind(g, "p0"), env).ok).toBe(false);
    expect(planButlerSelection(g, request(g), env).ok).toBe(false);
  });
  it("target death and temporary source impairment preserve recorded notation", () => {
    const selected = select();
    expect(life(selected, ["p1"]).players.p1!.reminders).toEqual(selected.players.p1!.reminders);
    expect(reconcileButlerReminders(impair(selected, "p0")).players.p1!.reminders).toEqual(selected.players.p1!.reminders);
  });
  it("source death removes only exact generated notation, even with resurrection in the same transaction", () => {
    const selected = select(); const manual = { id: "manual", label: "Master", sourceCharacter: "butler" };
    const g = patchPlayer(selected, "p1", { reminders: [...selected.players.p1!.reminders, manual] });
    const result = planLifeTransaction(g, { intents: [{ kind: "death", playerId: "p0" }, { kind: "resurrection", playerId: "p0" }] }, undefined, env);
    if (!result.ok || !result.changed) throw new Error("Expected lifecycle");
    expect(applyLifePlan(g, result.plan).players.p1!.reminders).toEqual([manual]);
  });
  it("source role change ends generated notation", () => {
    const g = select(); const result = planRoleTransaction(g, { intents: [changeRoleIntent(g.players.p0!, "chef")] }, { script: proofScript, ids: defaultRoleIds });
    if (!result.ok || !result.changed) throw new Error("Expected role change");
    expect(applyRolePlan(g, result.plan).players.p1!.reminders).toEqual([]);
  });
  it("source replacement and identity reset remove generated notation", () => {
    const g = select();
    expect(reconcileButlerReminders(reseat(g, "p0")).players.p1!.reminders).toEqual([]);
    expect(reconcileButlerReminders(patchPlayer(g, "p0", { packetEpoch: "next" })).players.p1!.reminders).toEqual([]);
  });
  it("schema v28 reload preserves exact selection and public/player projections omit it", () => {
    const g = select(); const restored = StorytellerGamePersistedSchema.parse(JSON.parse(JSON.stringify(g)));
    expect(restored.gameSchemaVersion).toBe(29);
    expect(restored.players.p1!.reminders).toEqual(g.players.p1!.reminders);
    expect(JSON.stringify(projectLobbyToPublic(g, {}))).not.toContain("butler-master");
    expect(JSON.stringify(projectLobbyToSelfMap(g, proofRegistry))).not.toContain("butler-master");
  });
  it("ownership uses collision-free exact ID/origin, never the label", () => {
    const g = select(); const token = g.players.p1!.reminders[0]!;
    expect(butlerReminderOrigin({ ...token, label: "Corrected text" })).toEqual({ participantId: g.players.p0!.participantId, epoch: "butler-epoch" });
    expect(butlerReminderOrigin({ ...token, id: "manual" })).toBeNull();
    expect(butlerReminderOrigin({ ...token, sourceParticipant: participantRefOf(g, "p2")! })).toBeNull();
    expect(butlerReminderId("a,b", "c")).not.toBe(butlerReminderId("a", "b,c"));
  });
});
