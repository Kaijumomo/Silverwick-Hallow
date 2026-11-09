import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, impair, openInStore, patchPlayer, pick, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { captureFingerprint } from "@/stores/abilityResolution";
import type { ManualAbilityRequest } from "@/stores/abilityResolution";
import { useStorytellerStore as store, captureCharacterActionContext } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useShellStore } from "@/stores/shellStore";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityInputs } from "../semantics";
import { deriveNightWork } from "@/features/nightOrder/nightWork";
import { nightTriggerStepKey, participantStepKey } from "@/stores/nightProgress";
import { subjectId } from "./shared";
import { undertakerShownId } from "./undertaker";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => store.getState().game!;
const character = (roleId: string) => ({ kind: "character" as const, roleIds: [roleId] });
const shown = () => game().informationDeliveries.at(-1)?.values?.find(v => v.kind === "role");
const invoke = (role: string, inputs: AbilityInputs = {}) => store.getState().resolveAbility(request(game(), "p0", role, inputs,
  { invocationPath: role === "ravenkeeper" ? "nightTrigger" : "nightOrder", withStep: true, completeStep: true }), undefined, captureCharacterActionContext());
function executed(role = "chef") {
  openInStore(proofGame(["undertaker", role, "imp", "monk", "baron"], "day", 1));
  expect(store.getState().recordExecution("p1", "died")).toMatchObject({ ok: true });
  expect(store.getState().setPhase("night")).toMatchObject({ ok: true });
  return game();
}
function killed(role = "ravenkeeper") {
  let g = proofGame([role, "imp", "chef", "monk", "baron"]);
  if (role === "drunk") g = patchPlayer(g, "p0", { shownRole: "ravenkeeper", behaviorMode: "drunk_fake_role_behavior" });
  openInStore(g);
  expect(store.getState().resolveAbility(request(g, "p1", "imp", { target: pick(g, "p0") }))).toMatchObject({ ok: true });
  return game();
}
beforeEach(() => {
  localStorage.clear(); store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  useShellStore.getState().reset();
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("B5b Undertaker authoritative event information", () => {
  it("the recorded execution qualifies independently of explanatory History", () => {
    executed();
    store.setState({ game: { ...game(), history: [] } });
    expect(invoke("undertaker")).toMatchObject({ ok: true }); expect(shown()).toMatchObject({ roleId: "chef" });
  });
  it("does not read the replacement occupant's role or registration", () => {
    const g = executed(); openInStore(patchPlayer(g, "p1", { participantId: "replacement", actualRole: "spy", shownRole: "spy" }));
    expect(invoke("undertaker")).toMatchObject({ ok: true }); expect(shown()).toMatchObject({ roleId: "chef" });
  });
  it.each(["spy", "recluse"])("a currently poisoned dead %s has verified actual registration", role => {
    openInStore(impair(executed(role), "p1"));
    expect(invoke("undertaker")).toMatchObject({ ok: true }); expect(shown()).toMatchObject({ roleId: role });
  });
  it("does not assume historical Spy registration after a role correction", () => {
    openInStore(patchPlayer(executed("spy"), "p1", { actualRole: "chef", shownRole: "chef" })); const before = store.getState();
    expect(invoke("undertaker")).toMatchObject({ ok: false, code: "unsupported" }); expect(store.getState()).toBe(before);
  });
  it("amending an execution to survived removes its qualification without rewriting life status", () => {
    executed(); const eventId = game().lifeEventWindow.events[0]!.id;
    expect(store.getState().resolveLife({ intents: [{ kind: "amendEvent", eventId, replacement: { kind: "execution", outcome: "survived" } }] })).toMatchObject({ ok: true });
    const before = store.getState(); expect(invoke("undertaker")).toMatchObject({ ok: false, code: "notApplicable" }); expect(store.getState()).toBe(before);
  });
  it("a late record without death-time identity stays manual", () => {
    openInStore(proofGame(["undertaker", "chef", "imp", "monk", "baron"]));
    expect(store.getState().resolveLife({ intents: [{ kind: "lateRecord", event: { kind: "execution", playerId: "p1", outcome: "died" } }] })).toMatchObject({ ok: true });
    expect(game().lifeEventWindow.events[0]!.actualRoleAtEvent).toBeUndefined();
    const before = store.getState(); expect(invoke("undertaker")).toMatchObject({ ok: false, code: "unsupported" }); expect(store.getState()).toBe(before);
  });
  it("an amended event cannot consume an impaired answer selected for the old event", () => {
    openInStore(impair(executed(), "p0"));
    const event = game().lifeEventWindow.events[0]!; const selected = { [undertakerShownId(event)]: character("imp") };
    expect(store.getState().resolveLife({ intents: [{ kind: "amendEvent", eventId: event.id, replacement: { kind: "execution", outcome: "survived" } }] })).toMatchObject({ ok: true });
    expect(store.getState().resolveLife({ intents: [{ kind: "amendEvent", eventId: game().lifeEventWindow.events[0]!.id, replacement: { kind: "execution", outcome: "died" } }] })).toMatchObject({ ok: true });
    const before = store.getState(); expect(invoke("undertaker", selected)).toMatchObject({ ok: false, code: "needsInput" }); expect(store.getState()).toBe(before);
  });
  it("multiple qualifying execution deaths stay manual", () => {
    const g = executed(); const event = g.lifeEventWindow.events[0]!;
    openInStore({ ...g, lifeEventWindow: { ...g.lifeEventWindow, events: [event, { ...event, id: "second-execution" }] } });
    const before = store.getState(); expect(invoke("undertaker")).toMatchObject({ ok: false, code: "unsupported" }); expect(store.getState()).toBe(before);
  });
  it("an exile cannot qualify as an execution death", () => {
    const g = executed(); const event = g.lifeEventWindow.events[0]!;
    openInStore({ ...g, lifeEventWindow: { ...g.lifeEventWindow, events: [{ ...event, kind: "exile", moment: { phase: "day", day: 1 }, outcome: "died" }] } });
    const before = store.getState(); expect(invoke("undertaker")).toMatchObject({ ok: false, code: "notApplicable" }); expect(store.getState()).toBe(before);
  });
  it("an impaired information-only choice can show an out-of-script character without adding its mechanics", () => {
    openInStore(impair(executed(), "p0")); const g = game();
    expect(invoke("undertaker", { [undertakerShownId(g.lifeEventWindow.events[0]!)]: character("vortox") })).toMatchObject({ ok: true });
    expect(shown()).toMatchObject({ roleId: "vortox" }); expect(game().players).toEqual(g.players); expect(game().gameRuleFacts).toEqual(g.gameRuleFacts);
  });
  it("ability loss does not offer poisoned/drunk simulated information", () => {
    openInStore(impair(executed(), "p0", "abilityLost")); const before = store.getState();
    expect(invoke("undertaker")).toMatchObject({ ok: false, code: "notApplicable" }); expect(store.getState()).toBe(before);
  });
  it("the delivery and completion save once, reload, and Undo as one outcome", async () => {
    const g = executed(); openInStore(g); const write = vi.spyOn(Storage.prototype, "setItem");
    expect(invoke("undertaker")).toMatchObject({ ok: true }); expect(write).toHaveBeenCalledTimes(1); expect(store.getState().undoStack).toHaveLength(1);
    const next = game(); const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(next); expect(invoke("undertaker")).toMatchObject({ ok: false });
    store.getState().undo(); expect(game()).toEqual(g);
  });
});

function simulatedRequest(g: StorytellerLobbyRecord): ManualAbilityRequest {
  return { mode: "manual", roleId: "ravenkeeper", reason: "Storyteller-initiated simulated Ravenkeeper information",
    fingerprint: captureFingerprint(g, "p0", { day: g.day, stepKey: participantStepKey(g.players.p0!.participantId!, "ravenkeeper") })!, completeStep: true,
    outcome: { operations: [{ domain: "information", recipient: bind(g, "p0"), performedRole: "ravenkeeper", informationActionId: "ravenkeeper-triggered", values: [
      { requirementId: "chosenPlayer", kind: "player", participants: [bind(g, "p2")] }, { requirementId: "role", kind: "role", roleId: "saint" },
    ] }] } };
}
describe("B5b Ravenkeeper simulation and trigger boundaries", () => {
  it.each(["open", "completed", "forged"])("ending recovery validates the event-scoped Ravenkeeper cursor: %s", async state => {
    killed();
    if (state === "completed") expect(invoke("ravenkeeper", { target: pick(game(), "p2") })).toMatchObject({ ok: true });
    const g = game();
    const cursor = { day: g.day, stepKey: nightTriggerStepKey(g.players.p0!.participantId!, "ravenkeeper", g.lifeEventWindow.events[0]!.id) };
    useShellStore.getState().setNightCursor(cursor);
    expect(store.getState().finishGame({ kind: "noResult" })).toMatchObject({ ok: true });
    const saved = JSON.parse(localStorage.getItem("new-blood-st")!);
    if (state === "forged") saved.state.finishedGameUndo.nightCursor.stepKey = nightTriggerStepKey(g.players.p0!.participantId!, "ravenkeeper", "fabricated-event");
    store.setState({ game: null, finishedGameUndo: null, canUndoFinishedGame: false }); useShellStore.getState().resetGameScope();
    localStorage.setItem("new-blood-st", JSON.stringify(saved)); await store.persist.rehydrate();
    expect(store.getState().undoFinishedGame()).toMatchObject({ ok: true });
    expect(game()).toEqual(g); expect(useShellStore.getState().nightCursor).toEqual(state === "forged" ? null : cursor);
  });
  it("a second genuine Night death has a new guide key and cannot inherit the first completion", () => {
    killed(); const env = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS };
    const first = deriveNightWork(game(), env).steps.find(step => step.kind === "player" && step.playerId === "p0")!;
    expect(first.stepKey).toBe(nightTriggerStepKey(game().players.p0!.participantId!, "ravenkeeper", game().lifeEventWindow.events[0]!.id));
    expect(invoke("ravenkeeper", { target: pick(game(), "p2") })).toMatchObject({ ok: true });
    expect(deriveNightWork(game(), env).steps.find(step => step.kind === "player" && step.playerId === "p0")?.stepKey).toBe(first.stepKey);
    expect(store.getState().resolveLife({ intents: [{ kind: "resurrection", playerId: "p0" }, { kind: "death", playerId: "p0" }] })).toMatchObject({ ok: true });
    const second = deriveNightWork(game(), env).steps.find(step => step.kind === "player" && step.playerId === "p0")!;
    expect(second.stepKey).not.toBe(first.stepKey); expect(game().nightProgress[`2:${second.stepKey}`]).toBeUndefined();
    const req = request(game(), "p0", "ravenkeeper", { target: pick(game(), "p3") }, { invocationPath: "nightTrigger", completeStep: true });
    req.fingerprint!.step = { day: 2, stepKey: second.stepKey, status: "absent" };
    expect(store.getState().resolveAbility(req)).toMatchObject({ ok: true });
    expect(game().nightProgress[`2:${second.stepKey}`]?.status).toBe("done"); expect(game().informationDeliveries).toHaveLength(2);
  });
  it("a verified Night 1 death supplies its canonical triggered row despite no ordinary first-night wake", () => {
    openInStore(proofGame(["ravenkeeper", "imp", "chef", "monk", "baron"], "night", 1));
    expect(store.getState().recordDeath("p0")).toMatchObject({ ok: true });
    const work = deriveNightWork(game(), { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS });
    expect(work.steps.some(step => step.kind === "player" && step.playerId === "p0" && step.stepKey === work.triggered[0]!.stepKey)).toBe(true);
  });
  it("positive death evidence in an uncovered Night is still manual", () => {
    const g = killed(); openInStore({ ...g, lifeEventWindow: { ...g.lifeEventWindow, coverageFrom: { phase: "day", day: 2 } } });
    const before = store.getState(); expect(invoke("ravenkeeper", { target: pick(game(), "p2") })).toMatchObject({ ok: false, code: "unsupported" }); expect(store.getState()).toBe(before);
  });
  it("manual Next on an uncertain recorded trigger does not fabricate information or reschedule another unknown wake", () => {
    const g = killed(); openInStore({ ...g, lifeEventWindow: { ...g.lifeEventWindow, coverageFrom: { phase: "day", day: 2 } } });
    const env = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS };
    const row = deriveNightWork(game(), env).steps.find(step => step.kind === "player" && step.playerId === "p0")!;
    expect(store.getState().setNightStepStatus(game().day, row.stepKey, "done", captureCharacterActionContext())).toMatchObject({ ok: true });
    const after = deriveNightWork(game(), env); expect(after.triggered).toEqual([]);
    expect(after.steps.find(step => step.kind === "player" && step.playerId === "p0")?.stepKey).toBe(row.stepKey);
    expect(game().informationDeliveries).toEqual([]);
  });
  it("an ability-lost Ravenkeeper cannot deliver a simulated answer", () => {
    openInStore(impair(killed(), "p0", "abilityLost")); const before = store.getState();
    expect(invoke("ravenkeeper", { target: pick(game(), "p2") })).toMatchObject({ ok: false, code: "notApplicable" }); expect(store.getState()).toBe(before);
  });
  it("an impaired Ravenkeeper may show any registry token without adding its rules", () => {
    openInStore(impair(killed(), "p0")); const g = game();
    expect(invoke("ravenkeeper", { target: pick(g, "p2"), [subjectId("shown", bind(g, "p2"))]: character("vortox") })).toMatchObject({ ok: true });
    expect(shown()).toMatchObject({ roleId: "vortox" }); expect(game().players).toEqual(g.players);
  });
  it("Drunk-as-Ravenkeeper is never derived as an automatically triggered task", () => {
    const g = killed("drunk"); const work = deriveNightWork(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS });
    expect(work.triggered).toEqual([]); expect(work.steps.some(s => s.kind === "player" && s.playerId === "p0")).toBe(true);
  });
  it("deliberately chosen Drunk information is typed, manual, reversible and does not consume a genuine trigger", () => {
    const g = killed("drunk"); openInStore(g); const req = simulatedRequest(g);
    expect(store.getState().resolveAbility(req, undefined, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(game().informationDeliveries.at(-1)).toMatchObject({ actualRole: "drunk", performedRole: "ravenkeeper", provenance: { reason: "manual" } });
    expect(game().lifeEventWindow).toEqual(g.lifeEventWindow); expect(game().players).toEqual(g.players);
    expect(Object.keys(game().nightProgress).some(k => k.includes(":trigger:"))).toBe(false);
    expect(store.getState().resolveAbility(req)).toMatchObject({ ok: false, code: "stale" });
    store.getState().undo(); expect(game()).toEqual(g);
  });
  it.each(["privacy", "storage", "recovery"])("manual simulated %s refusal writes no delivery or step", boundary => {
    const g = killed("drunk"); const req = simulatedRequest(g);
    if (boundary === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (boundary === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    if (boundary === "recovery") store.setState({ terminalClose: { intent: { kind: "declare", winner: "good" }, status: "failed", message: "Retry", recoveryPending: true } });
    const before = store.getState(); expect(store.getState().resolveAbility(req, undefined, captureCharacterActionContext())).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
  });
});
