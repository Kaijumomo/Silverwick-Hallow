import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { impair, openInStore, patchPlayer, proofGame } from "@/test/proofFixtures";
import { captureVotingContext, useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { currentVotingState, freshVotingDay } from "./voting";
import type { VotingIntent } from "./votingTypes";

// Independent rules oracle: official /Virgin, /Spy and /States.
// Triggering execution and whether execution kills are distinct decisions.
const state = () => store.getState();
const game = () => state().game!;
const binding = (id: string) => ({ playerId: id, participantId: game().players[id]!.participantId! });
type Action = VotingIntent extends infer T ? T extends VotingIntent ? Omit<T, "code" | "day" | "expectedRevision"> : never : never;
const intent = (action: Action): VotingIntent => ({ ...action, code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision } as VotingIntent);
const act = (action: Action) => state().resolveVoting(intent(action), captureVotingContext());
const begin = (from = "p0", to = "p1", id = "virgin-first") => act({ kind: "begin", roundId: id, mode: "nomination", nominator: binding(from), nominee: binding(to) });
const round = () => game().voting!.rounds.at(-1)!;
const noAbility = () => game().players.p1!.reminders.filter(r => r.sourceCharacter === "virgin" && r.label === "No Ability");
const base = (nominator = "chef") => proofGame([nominator, "virgin", "slayer", "poisoner", "imp"], "day", 2, { voting: freshVotingDay(2) });
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" }); openInStore(base());
});
afterEach(() => vi.restoreAllMocks());

describe("B7 independent first Virgin nomination", () => {
  it.each(["healthy", "poisoned-nominator", "self"])("%s Townsfolk nomination consumes, then leaves execution death with Storyteller", variant => {
    if (variant === "poisoned-nominator") openInStore(impair(game(), "p0"));
    const before = game(); const seq = state().localSeq;
    expect(begin(variant === "self" ? "p1" : "p0")).toMatchObject({ ok: true });
    expect(game().players.p1!.abilityUsed).toBe(true); expect(noAbility()).toHaveLength(1);
    expect(round().virginPending).toBe(true); expect(round().responses).toEqual([]);
    expect(game().lifeEventWindow.events).toEqual([]);
    expect(state().undoStack).toEqual([before]); expect(state().localSeq).toBe(seq + 1);
    expect(act({ kind: "virgin", roundId: round().id, execute: true, outcome: "survived" })).toMatchObject({ ok: true });
    expect(game().lifeEventWindow.events).toHaveLength(1);
    expect(game().lifeEventWindow.events[0]).toMatchObject({ kind: "execution", outcome: "survived", subject: { participantId: before.players[variant === "self" ? "p1" : "p0"]!.participantId } });
    expect(game().players[variant === "self" ? "p1" : "p0"]!.alive).toBe(true);
  });

  it.each(["butler", "drunk", "poisoner", "imp"])("actual %s does not trigger even when shown as Townsfolk", role => {
    openInStore(patchPlayer(base(role), "p0", { shownRole: "chef" }));
    expect(begin()).toMatchObject({ ok: true });
    expect(game().players.p1!.abilityUsed).toBe(true); expect(noAbility()).toHaveLength(1);
    expect(round().virginPending).toBe(false); expect(round().status).toBe("voting");
    expect(game().lifeEventWindow.events).toEqual([]);
  });

  it.each(["poisoned", "drunk"])("%s Virgin consumes on legal nomination without triggering", effect => {
    openInStore(impair(game(), "p1", effect)); expect(begin()).toMatchObject({ ok: true });
    expect(game().players.p1!.abilityUsed).toBe(true); expect(noAbility()).toHaveLength(1);
    expect(round().virginPending).toBe(false); expect(game().lifeEventWindow.events).toEqual([]);
  });

  it.each([true, false])("Spy registration remains entirely manual until explicit recorded outcome %s", execute => {
    openInStore(base("spy")); expect(begin()).toMatchObject({ ok: true });
    expect(round().virginPending).toBe(true); expect(game().players.p1!.abilityUsed).toBe(false); expect(noAbility()).toEqual([]);
    expect(act({ kind: "virgin", roundId: round().id, execute, ...(execute ? { outcome: "died" as const } : {}) })).toMatchObject({ ok: true });
    expect(game().players.p1!.abilityUsed).toBe(true); expect(noAbility()).toHaveLength(1);
    expect(game().lifeEventWindow.events).toHaveLength(execute ? 1 : 0);
    expect(game().players.p0!.alive).toBe(!execute);
  });

  it("a poisoned Spy has no optional registration and continues voting", () => {
    openInStore(impair(base("spy"), "p0")); expect(begin()).toMatchObject({ ok: true });
    expect(game().players.p1!.abilityUsed).toBe(true); expect(round().virginPending).toBe(false);
  });

  it("dead nominator is invalid and cannot consume or place notation", () => {
    openInStore(patchPlayer(game(), "p0", { alive: false })); const before = state();
    expect(begin()).toMatchObject({ ok: false }); expect(state()).toBe(before); expect(noAbility()).toEqual([]);
  });

  it("later nomination after removing the token cannot rearm the ability", () => {
    openInStore(base("butler")); expect(begin()).toMatchObject({ ok: true });
    expect(state().removeReminder("p1", noAbility()[0]!.id)).toMatchObject({ ok: true });
    store.setState({ game: { ...game(), day: 3, voting: freshVotingDay(3) } });
    expect(begin("p2", "p1", "later")).toMatchObject({ ok: true });
    expect(game().players.p1!.abilityUsed).toBe(true); expect(round().virginPending).toBe(false); expect(noAbility()).toEqual([]);
  });

  it("survived Virgin execution forbids another ordinary nomination and is not repeated at Day completion", () => {
    expect(begin()).toMatchObject({ ok: true });
    expect(act({ kind: "virgin", roundId: round().id, execute: true, outcome: "survived" })).toMatchObject({ ok: true });
    expect(act({ kind: "acknowledge", roundId: round().id })).toMatchObject({ ok: true });
    expect(begin("p2", "p3", "second")).toMatchObject({ ok: false });
    expect(state().advancePhase(captureVotingContext())).toMatchObject({ ok: true });
    expect(game().phase).toBe("night"); expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
  });

  it("the complete first-nomination snapshot survives reload and Undo", async () => {
    const before = game(); expect(begin()).toMatchObject({ ok: true }); const expected = game();
    const saved = localStorage.getItem("new-blood-st")!; store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(expected); state().undo(); expect(game()).toEqual(before);
  });

  it.each(["privacy", "storage", "stale-participant", "stale-context"])("%s refuses nomination and consumption atomically", variant => {
    const command = intent({ kind: "begin", roundId: "stale", mode: "nomination", nominator: binding("p0"), nominee: binding("p1") });
    const context = captureVotingContext();
    if (variant === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (variant === "stale-participant") store.setState({ game: patchPlayer(game(), "p1", { participantId: "replacement" }) });
    if (variant === "stale-context") state().setNotes("p0", "Changed");
    if (variant === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full disk"); });
    const before = state(); expect(state().resolveVoting(command, context)).toMatchObject({ ok: false }); expect(state()).toBe(before);
    expect(game().players.p1!.abilityUsed).toBe(false); expect(noAbility()).toEqual([]);
  });
});
