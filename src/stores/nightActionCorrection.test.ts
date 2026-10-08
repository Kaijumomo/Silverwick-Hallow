import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { captureFingerprint } from "./abilityResolution";
import { clearNightActionCorrections, getNightActionCorrection } from "./nightActionCorrection";
import { participantStepKey } from "./nightProgress";
import { proofGame, proofScript, bind, pick } from "@/test/proofFixtures";

const state = () => store.getState();
const game = () => state().game!;
const stepKey = () => participantStepKey(game().players.p0!.participantId!, game().players.p0!.actualRole);
const correction = (target = "p2") => ({ day: 2, stepKey: stepKey(), target: bind(game(), target) });
function start(role = "poisoner") {
  store.setState({ game: proofGame([role, "chef", "empath", "imp", "saint"]), lobby: null,
    customScripts: { [proofScript.id]: proofScript }, undoStack: [], localSeq: 0 });
}
function act(target = "p1") {
  return state().resolveAbility({ mode: "guided", invocationPath: "nightOrder", roleId: game().players.p0!.actualRole,
    fingerprint: captureFingerprint(game(), "p0", { day: 2, stepKey: stepKey() })!,
    inputs: { target: pick(game(), target) }, completeStep: true });
}
beforeEach(() => { clearNightActionCorrections(); start(); });

describe("bounded Night target correction", () => {
  it.each([["poisoner", "poisoned"], ["monk", "safeFromDemon"]])("moves the real %s effect atomically and preserves Undo", (role, effectType) => {
    start(role);
    expect(act()).toMatchObject({ ok: true, changed: true });
    const before = game();
    const undoLength = state().undoStack.length;
    const seq = state().localSeq;
    let replacements = 0;
    const unsubscribe = store.subscribe((next, prev) => { if (next.game !== prev.game) replacements++; });
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: true, changed: true });
    unsubscribe();
    expect(replacements).toBe(1);
    expect(state().localSeq).toBe(seq + 1);
    expect(state().undoStack).toHaveLength(undoLength + 1);
    expect(game().players.p1!.effects).toHaveLength(0);
    expect(game().players.p2!.effects).toEqual([expect.objectContaining({ type: effectType, sourceCharacter: role })]);
    expect(game().nightProgress[`2:${stepKey()}`]?.status).toBe("done");
    expect(game().history.slice(before.history.length)).toHaveLength(2);
    expect(game().history.slice(before.history.length).every((entry) => entry.correction)).toBe(true);
    state().undo();
    expect(game()).toEqual(before);
    expect(getNightActionCorrection(game(), 2, stepKey())).toBeNull();
  });

  it("can repeatedly correct without accumulating an old effect", () => {
    expect(act()).toMatchObject({ ok: true });
    expect(state().correctNightActionTarget(correction("p2"))).toMatchObject({ ok: true, changed: true });
    expect(state().correctNightActionTarget(correction("p3"))).toMatchObject({ ok: true, changed: true });
    expect(game().players.p1!.effects).toHaveLength(0);
    expect(game().players.p2!.effects).toHaveLength(0);
    expect(game().players.p3!.effects).toHaveLength(1);
    expect(getNightActionCorrection(game(), 2, stepKey())?.target.playerId).toBe("p3");
  });

  it("removes the old self-poison before determining whether the actor functions", () => {
    expect(act("p0")).toMatchObject({ ok: true });
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: true, changed: true });
    expect(game().players.p0!.effects).toHaveLength(0);
    expect(game().players.p2!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
  });

  it("keeps unrelated notes and reminder notation", () => {
    expect(act()).toMatchObject({ ok: true });
    state().setNightStepNotes(2, stepKey(), "Remember this");
    state().addReminder("p3", { label: "Chosen" });
    const reminders = game().players.p3!.reminders;
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: true, changed: true });
    expect(game().players.p3!.reminders).toEqual(reminders);
    expect(game().nightProgress[`2:${stepKey()}`]?.notes).toBe("Remember this");
  });

  it.each(["mechanics", "progress", "information", "replacement", "phase"])("refuses changed %s without partial removal", (change) => {
    expect(act()).toMatchObject({ ok: true });
    const g = game();
    if (change === "mechanics") store.setState({ game: { ...g, players: { ...g.players, p3: { ...g.players.p3!, alive: false } } } });
    if (change === "progress") state().setNightStepStatus(2, "later", "done");
    if (change === "information") store.setState({ game: { ...g, informationDeliveries: [...g.informationDeliveries, { id: "later" } as never] } });
    if (change === "replacement") store.setState({ game: { ...g, players: { ...g.players, p1: { ...g.players.p1!, participantId: "replacement" } } } });
    if (change === "phase") store.setState({ game: { ...g, phase: "day" } });
    const before = game();
    const undo = state().undoStack;
    const seq = state().localSeq;
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: false, code: "stale" });
    expect(game()).toBe(before);
    expect(state().undoStack).toBe(undo);
    expect(state().localSeq).toBe(seq);
  });

  it("rejects a stale target binding and an illegal Monk self-target atomically", () => {
    start("monk"); expect(act()).toMatchObject({ ok: true });
    const before = game();
    expect(state().correctNightActionTarget({ ...correction(), target: { playerId: "p2", participantId: "stale" } })).toMatchObject({ ok: false, code: "stale" });
    expect(state().correctNightActionTarget(correction("p0"))).toMatchObject({ ok: false, code: "illegal" });
    expect(game()).toBe(before);
  });

  it("same-target selection is a true no-op", () => {
    expect(act()).toMatchObject({ ok: true });
    const before = game(); const undo = state().undoStack;
    expect(state().correctNightActionTarget(correction("p1"))).toEqual({ ok: true, changed: false });
    expect(game()).toBe(before); expect(state().undoStack).toBe(undo);
  });

  it("does not infer correction authority from persisted History after receipt loss", () => {
    expect(act()).toMatchObject({ ok: true });
    clearNightActionCorrections();
    const before = game();
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: false, code: "stale" });
    expect(game()).toBe(before);
  });

  it("preserves a separate same-type effect when correcting the action's own effect", () => {
    state().addEffect("p1", { type: "poisoned", lifetime: { kind: "manual" } });
    const unrelated = game().players.p1!.effects[0];
    expect(act()).toMatchObject({ ok: true });
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: true });
    expect(game().players.p1!.effects).toEqual([unrelated]);
    expect(game().players.p2!.effects).toHaveLength(1);
  });

  it("clears receipts on remote restore and writer-scope changes", () => {
    expect(act()).toMatchObject({ ok: true });
    state().restoreRemoteCheckpoint(game(), null);
    expect(getNightActionCorrection(game(), 2, stepKey())).toBeNull();
    start(); expect(act()).toMatchObject({ ok: true });
    state().ensureSyncScope("OTHER", "new-session");
    expect(getNightActionCorrection(game(), 2, stepKey())).toBeNull();
  });

  it("supports correcting an earlier action after undoing the later action", () => {
    expect(act()).toMatchObject({ ok: true });
    state().setNightStepStatus(2, "later", "done");
    expect(getNightActionCorrection(game(), 2, stepKey())?.canCorrect).toBe(false);
    state().undo();
    expect(getNightActionCorrection(game(), 2, stepKey())?.canCorrect).toBe(true);
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: true });
  });

  it.each(["poisoner", "monk"])("keeps %s correction blocked until all later actions are undone", (role) => {
    start(role);
    expect(act()).toMatchObject({ ok: true, changed: true });
    const resolved = game();
    state().setNightStepStatus(2, "later-1", "done");
    state().setNightStepStatus(2, "later-2", "done");
    state().undo();
    const intermediate = game();
    const intermediateUndo = state().undoStack;
    const intermediateSeq = state().localSeq;
    expect(getNightActionCorrection(game(), 2, stepKey())?.canCorrect).toBe(false);
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: false, code: "stale" });
    expect(game()).toBe(intermediate);
    expect(state().undoStack).toBe(intermediateUndo);
    expect(state().localSeq).toBe(intermediateSeq);

    state().undo();
    expect(game()).toEqual(resolved);
    expect(getNightActionCorrection(game(), 2, stepKey())?.canCorrect).toBe(true);
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: true, changed: true });
    expect(game().players.p1!.effects).toHaveLength(0);
    expect(game().players.p2!.effects).toHaveLength(1);
    state().undo();
    expect(game()).toEqual(resolved);
    expect(getNightActionCorrection(game(), 2, stepKey())).toBeNull();
  });

  it("discards the receipt when Undo passes the original action", () => {
    const before = game();
    expect(act()).toMatchObject({ ok: true, changed: true });
    state().setNightStepStatus(2, "later-1", "done");
    state().setNightStepStatus(2, "later-2", "done");
    state().undo();
    state().undo();
    expect(getNightActionCorrection(game(), 2, stepKey())?.canCorrect).toBe(true);
    state().undo();
    expect(game()).toEqual(before);
    expect(getNightActionCorrection(game(), 2, stepKey())).toBeNull();
    expect(state().correctNightActionTarget(correction())).toMatchObject({ ok: false, code: "stale" });
    expect(game()).toEqual(before);
  });

  it("retains the earlier Poisoner receipt while discarding an undone Monk action", () => {
    store.setState({ game: proofGame(["poisoner", "monk", "empath", "imp", "saint"]) });
    expect(act("p4")).toMatchObject({ ok: true, changed: true });
    const poisonResolved = game();
    const monkStep = participantStepKey(game().players.p1!.participantId!, "monk");
    expect(state().resolveAbility({ mode: "guided", invocationPath: "nightOrder", roleId: "monk",
      fingerprint: captureFingerprint(game(), "p1", { day: 2, stepKey: monkStep })!,
      inputs: { target: pick(game(), "p2") }, completeStep: true,
    })).toMatchObject({ ok: true, changed: true });
    state().setNightStepStatus(2, "later", "done");
    state().undo();
    expect(getNightActionCorrection(game(), 2, monkStep)?.canCorrect).toBe(true);
    expect(getNightActionCorrection(game(), 2, stepKey())?.canCorrect).toBe(false);
    state().undo();
    expect(game()).toEqual(poisonResolved);
    expect(getNightActionCorrection(game(), 2, monkStep)).toBeNull();
    expect(getNightActionCorrection(game(), 2, stepKey())?.canCorrect).toBe(true);
  });
});
