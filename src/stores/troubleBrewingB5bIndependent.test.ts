import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, impair, openInStore, patchPlayer, pick, proofGame, proofRegistry, request, reseat } from "@/test/proofFixtures";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { subjectId } from "@/abilities/characters/shared";
import { captureFingerprint, type ManualAbilityRequest } from "./abilityResolution";
import { participantStepKey } from "./nightProgress";
import { currentVotingState, freshVotingDay } from "./voting";
import { useShellStore } from "./shellStore";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { proofScript } from "@/test/proofFixtures";
import type { AbilityInputs } from "@/abilities/semantics";
import type { ExecutionOutcome, StorytellerLobbyRecord } from "./types";

// Rules-derived independent command tests: official Undertaker learns the
// character that DIED by execution, while Ravenkeeper fires from THIS Night's
// death and may choose alive/dead participants. No explanatory History oracle.
// https://wiki.bloodontheclocktower.com/Undertaker
// https://wiki.bloodontheclocktower.com/Ravenkeeper
const game = () => store.getState().game!;
const character = (roleId: string) => ({ kind: "character" as const, roleIds: [roleId] });
const shown = () => game().informationDeliveries.at(-1)?.values?.find(v => v.kind === "role");
const invoke = (g: StorytellerLobbyRecord, role: string, inputs: AbilityInputs = {}) => store.getState().resolveAbility(
  request(g, "p0", role, inputs, { invocationPath: role === "ravenkeeper" ? "nightTrigger" : "nightOrder", withStep: true, completeStep: true }),
  undefined, captureCharacterActionContext());
function execute(role = "chef", outcome: ExecutionOutcome = "died") {
  let g = proofGame(["undertaker", role, "imp", "monk", "baron"], "day", 1);
  if (outcome === "alreadyDead") g = patchPlayer(g, "p1", { alive: false, ghostVote: true });
  openInStore(g);
  expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p1", outcome }] })).toMatchObject({ ok: true });
  expect(store.getState().setPhase("night")).toMatchObject({ ok: true });
  return game();
}
function ravenkeeper(role = "ravenkeeper") {
  let g = proofGame([role, "imp", "chef", "monk", "baron"]);
  if (role === "drunk") g = patchPlayer(g, "p0", { shownRole: "ravenkeeper", behaviorMode: "drunk_fake_role_behavior" });
  openInStore(g);
  expect(store.getState().resolveAbility(request(g, "p1", "imp", { target: pick(g, "p0") }))).toMatchObject({ ok: true });
  return game();
}
beforeEach(() => {
  localStorage.clear(); store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false, sync: null });
  useShellStore.getState().reset();
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("B5b independent authoritative event information", () => {
  it("Undertaker reads a real previous-Day execution despite later character change", () => {
    const executed = execute();
    const g = patchPlayer(executed, "p1", { actualRole: "soldier", shownRole: "soldier" }); openInStore(g);
    expect(invoke(g, "undertaker")).toMatchObject({ ok: true });
    expect(shown()).toMatchObject({ roleId: "chef" }); expect(game().players.p1!.actualRole).toBe("soldier");
  });

  it("Undertaker reveals the Drunk actual identity, not the Townsfolk believed", () => {
    let g = proofGame(["undertaker", "drunk", "imp", "monk", "baron"], "day", 1);
    g = patchPlayer(g, "p1", { shownRole: "virgin", behaviorMode: "drunk_fake_role_behavior" }); openInStore(g);
    expect(store.getState().resolveLife({ intents: [{ kind: "execution", playerId: "p1", outcome: "died" }] })).toMatchObject({ ok: true });
    store.getState().setPhase("night");
    expect(invoke(game(), "undertaker")).toMatchObject({ ok: true }); expect(shown()).toMatchObject({ roleId: "drunk" });
  });

  it("Imp execution plus Scarlet Woman succession still reveals the executed Imp", () => {
    const g = proofGame(["undertaker", "imp", "scarletwoman", "monk", "baron"], "day", 1); openInStore(g);
    expect(store.getState().recordExecution("p1", "died", undefined, undefined, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(game().players.p2!.actualRole).toBe("imp"); store.getState().setPhase("night");
    expect(invoke(game(), "undertaker")).toMatchObject({ ok: true }); expect(shown()).toMatchObject({ roleId: "imp" });
  });

  it("a genuine Virgin nomination execution supplies Undertaker's previous-Day information", () => {
    const g = proofGame(["undertaker", "chef", "virgin", "imp", "baron"], "day", 1, { voting: freshVotingDay(1) }); openInStore(g);
    expect(store.getState().resolveVoting({ kind: "begin", code: g.code, day: 1, expectedRevision: currentVotingState(g).revision,
      roundId: "virgin-independent", mode: "nomination", nominator: bind(g, "p1"), nominee: bind(g, "p2") }, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(store.getState().resolveVoting({ kind: "virgin", code: g.code, day: 1, expectedRevision: currentVotingState(game()).revision,
      roundId: "virgin-independent", execute: true, outcome: "died" }, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(game().players.p1!.alive).toBe(false);
    expect(store.getState().resolveVoting({ kind: "acknowledge", code: g.code, day: 1, expectedRevision: currentVotingState(game()).revision,
      roundId: "virgin-independent" }, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(store.getState().setPhase("night")).toMatchObject({ ok: true });
    expect(invoke(game(), "undertaker")).toMatchObject({ ok: true }); expect(shown()).toMatchObject({ roleId: "chef" });
  });

  it.each(["survived", "alreadyDead"] as const)("Undertaker cannot turn an execution outcome of %s into information", outcome => {
    const g = execute("chef", outcome); const before = store.getState();
    expect(invoke(g, "undertaker")).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
    expect(game().informationDeliveries).toEqual([]);
  });

  it("Slayer death during the previous Day is not an Undertaker execution", () => {
    const g = proofGame(["undertaker", "slayer", "imp", "scarletwoman", "monk"], "day", 1); openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p1", "slayer", { target: pick(g, "p2") }))).toMatchObject({ ok: true });
    store.getState().setPhase("night"); const before = store.getState();
    expect(invoke(game(), "undertaker")).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it("current Night death does not substitute for yesterday's execution", () => {
    const g = proofGame(["undertaker", "chef", "imp", "monk", "baron"]); openInStore(g);
    expect(store.getState().resolveLife({ intents: [{ kind: "death", playerId: "p1" }] })).toMatchObject({ ok: true });
    const before = store.getState(); expect(invoke(game(), "undertaker")).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it.each(["missing-role", "unknown-coverage", "retracted"])("Undertaker leaves %s execution evidence manual and unchanged", scenario => {
    let g = execute();
    if (scenario === "missing-role") g = { ...g, lifeEventWindow: { ...g.lifeEventWindow, events: g.lifeEventWindow.events.map(e => ({ ...e, actualRoleAtEvent: undefined })) } };
    if (scenario === "unknown-coverage") g = { ...g, lifeEventWindow: { ...g.lifeEventWindow, coverageFrom: { phase: "night", day: 2 } } };
    openInStore(g);
    if (scenario === "retracted") expect(store.getState().resolveLife({ intents: [{ kind: "retractEvent", eventId: g.lifeEventWindow.events[0]!.id }] })).toMatchObject({ ok: true });
    const before = store.getState(); expect(invoke(game(), "undertaker")).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it.each(["spy", "recluse"])("Undertaker cannot silently pick the executed %s optional registration", role => {
    const g = execute(role); const before = store.getState();
    expect(invoke(g, "undertaker")).toMatchObject({ ok: false, code: "unsupported" }); expect(store.getState()).toBe(before);
  });

  it("an ordinary executed character with an explicit false-registration effect remains manual", () => {
    const g = impair(execute(), "p1", "registersFalsely"); openInStore(g); const before = store.getState();
    expect(invoke(g, "undertaker")).toMatchObject({ ok: false, code: "unsupported" }); expect(store.getState()).toBe(before);
  });

  it.each(["poisoned", "drunk"])("%s Undertaker may deliberately show the true character", effect => {
    const g = impair(execute(), "p0", effect); openInStore(g);
    const result = invoke(g, "undertaker"); expect(result).toMatchObject({ ok: false, code: "needsInput" });
    const id = !result.ok && "requirements" in result ? result.requirements?.[0]?.id : undefined; expect(id).toBeTruthy();
    expect(invoke(g, "undertaker", { [id!]: character("chef") })).toMatchObject({ ok: true });
    expect(shown()).toMatchObject({ roleId: "chef" }); expect(game().players).toEqual(g.players);
  });

  it("Ravenkeeper accepts a dead target's actual character in one private reversible delivery", async () => {
    let g = ravenkeeper(); g = patchPlayer(g, "p2", { alive: false, ghostVote: true }); openInStore(g);
    const write = vi.spyOn(Storage.prototype, "setItem");
    expect(invoke(g, "ravenkeeper", { target: pick(g, "p2") })).toMatchObject({ ok: true });
    const next = game(); expect(shown()).toMatchObject({ roleId: "chef" }); expect(write).toHaveBeenCalledTimes(1); expect(store.getState().undoStack).toHaveLength(1);
    expect(next.lifeEventWindow).toEqual(g.lifeEventWindow); expect(next.players).toEqual(g.players);
    expect(JSON.stringify([projectLobbyToPublic(next, {}), projectLobbyToSelfMap(next, proofRegistry)])).not.toMatch(/informationDeliveries|chosenPlayer|actualRole|participantId/);
    const saved = localStorage.getItem("new-blood-st")!; store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(next); store.getState().undo(); expect(game()).toEqual(g);
  });

  it("one Ravenkeeper death cannot be consumed twice, even with a fresh request", () => {
    const g = ravenkeeper(); expect(invoke(g, "ravenkeeper", { target: pick(g, "p2") })).toMatchObject({ ok: true });
    const before = store.getState(); expect(invoke(game(), "ravenkeeper", { target: pick(game(), "p3") })).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it("a poisoned Ravenkeeper may reveal a script token whose mechanics are not implemented", () => {
    const g = impair(ravenkeeper(), "p0"); openInStore(g);
    expect(invoke(g, "ravenkeeper", { target: pick(g, "p2"), [subjectId("shown", bind(g, "p2"))]: character("mathematician") })).toMatchObject({ ok: true });
    expect(shown()).toMatchObject({ roleId: "mathematician" }); expect(game().players).toEqual(g.players);
  });

  it("a corrected-away Ravenkeeper event invalidates the captured command", () => {
    const g = ravenkeeper(); const pending = request(g, "p0", "ravenkeeper", { target: pick(g, "p2") }, { invocationPath: "nightTrigger", withStep: true, completeStep: true });
    expect(store.getState().resolveLife({ intents: [{ kind: "retractEvent", eventId: g.lifeEventWindow.events[0]!.id }] })).toMatchObject({ ok: true });
    const before = store.getState(); expect(store.getState().resolveAbility(pending, undefined, captureCharacterActionContext())).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it("positive Ravenkeeper death in an uncovered window cannot manufacture an automatic trigger", () => {
    const original = ravenkeeper(); const g = { ...original, lifeEventWindow: { ...original.lifeEventWindow, coverageFrom: { phase: "day" as const, day: original.day } } };
    openInStore(g); const before = store.getState();
    expect(invoke(g, "ravenkeeper", { target: pick(g, "p2") })).toMatchObject({ ok: false, code: "unsupported" });
    expect(store.getState()).toBe(before); expect(game().informationDeliveries).toEqual([]);
  });

  it("validated finished-game recovery restores the exact event-specific Ravenkeeper cursor without delivery", async () => {
    const g = ravenkeeper();
    const work = deriveNightWork(g, { script: proofScript, registry: proofRegistry, semantics: CANONICAL_ABILITY_SEMANTICS });
    const row = work.steps.find(step => step.kind === "player" && step.playerId === "p0")!;
    const cursor = { day: g.day, stepKey: row.stepKey }; useShellStore.getState().setNightCursor(cursor);
    expect(store.getState().finishGame({ kind: "noResult" })).toMatchObject({ ok: true });
    const saved = localStorage.getItem("new-blood-st")!; store.setState({ game: null, finishedGameUndo: null, canUndoFinishedGame: false }); useShellStore.getState().resetGameScope();
    localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate(); expect(store.getState().undoFinishedGame()).toMatchObject({ ok: true });
    expect(useShellStore.getState().nightCursor).toEqual(cursor); expect(game().lifeEventWindow).toEqual(g.lifeEventWindow); expect(game().informationDeliveries).toEqual([]);
    expect(invoke(game(), "ravenkeeper", { target: pick(game(), "p2") })).toMatchObject({ ok: true }); expect(shown()).toMatchObject({ roleId: "chef" });
  });

  it("a replaced Ravenkeeper occupant never inherits the former death trigger", () => {
    const g = reseat(ravenkeeper(), "p0"); openInStore(g); const before = store.getState();
    expect(invoke(g, "ravenkeeper", { target: pick(g, "p2") })).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });

  it("Drunk shown Ravenkeeper has no automatic death-trigger authority", () => {
    const g = ravenkeeper("drunk"); const before = store.getState();
    expect(invoke(g, "ravenkeeper", { target: pick(g, "p2"), [subjectId("shown", bind(g, "p2"))]: character("imp") })).toMatchObject({ ok: false });
    expect(store.getState()).toBe(before); expect(game().informationDeliveries).toEqual([]);
  });

  it("manually simulated Drunk Ravenkeeper records chosen information without trigger or life mechanics", async () => {
    const g = ravenkeeper("drunk"); openInStore(g);
    const req: ManualAbilityRequest = { mode: "manual", reason: "Storyteller initiated simulated Ravenkeeper wake", roleId: "ravenkeeper",
      fingerprint: captureFingerprint(g, "p0", { day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, "ravenkeeper") })!, completeStep: true,
      outcome: { mechanicalOrder: "declared", operations: [{ domain: "information", recipient: bind(g, "p0"), performedRole: "ravenkeeper", informationActionId: "ravenkeeper-triggered", values: [
        { requirementId: "chosenPlayer", kind: "player", participants: [bind(g, "p2")] }, { requirementId: "role", kind: "role", roleId: "imp" },
      ] }] } };
    expect(store.getState().resolveAbility(req, undefined, captureCharacterActionContext())).toMatchObject({ ok: true });
    const next = game(); expect(next.informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "ravenkeeper", provenance: { reason: "manual" } });
    expect(shown()).toMatchObject({ roleId: "imp" }); expect(next.players).toEqual(g.players); expect(next.lifeEventWindow).toEqual(g.lifeEventWindow);
    const newKeys = Object.keys(next.nightProgress).filter(key => !(key in g.nightProgress));
    expect(newKeys).toEqual([`${g.day}:${participantStepKey(g.players.p0!.participantId!, "ravenkeeper")}`]);
    expect(store.getState().undoStack).toHaveLength(1);
    const accepted = store.getState(); expect(store.getState().resolveAbility(req, undefined, captureCharacterActionContext())).toMatchObject({ ok: false }); expect(store.getState()).toBe(accepted);
    const saved = localStorage.getItem("new-blood-st")!; store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(next); store.getState().undo(); expect(game()).toEqual(g);
  });

  it.each(["privacy", "recovery", "storage", "writer"])("Ravenkeeper %s refusal leaves trigger unconsumed and information private", mode => {
    const g = ravenkeeper();
    if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (mode === "recovery") store.setState({ terminalClose: { intent: { kind: "declare", winner: "good" }, status: "failed", message: "Retry", recoveryPending: true } });
    if (mode === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    if (mode === "writer") store.setState({ lobby: { code: "B5BTEST1", uid: "host", sessionId: "s", status: "live" }, game: { ...g, code: "B5BTEST1", storytellerUid: "host" } });
    const before = store.getState(); let publications = 0; const stop = store.subscribe(() => publications++);
    try { expect(invoke(game(), "ravenkeeper", { target: pick(game(), "p2") })).toMatchObject({ ok: false }); expect(store.getState().game).toBe(before.game); expect(store.getState().undoStack).toBe(before.undoStack); expect(publications).toBe(0); }
    finally { stop(); }
  });
});
