import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proofGame, proofEnv, proofQuery, bind, impair, patchPlayer, reseat, homebrewEnv, openInStore, request, pick } from "@/test/proofFixtures";
import { applyLifePlan, planLifeTransaction, type LifeTransaction } from "./lifeResolution";
import { captureSaintQualification, captureMayorQualification, reconcileVictoryEvidence, validVictoryEvidence, victoryCoverageEligibility, type VictoryEvidenceResult } from "./victoryEvidence";
import { applyGameRuleFactPlan, planGameRuleFactExpiry, planGameRuleFactTransaction } from "./gameRuleFacts";
import { applyEffectPlan, planEffectExpiry, planEffectTransaction } from "./effectResolution";
import { pruneLifeEventWindow } from "./lifeEvents";
import { StorytellerGamePersistedSchema } from "./schemas";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import type { StorytellerLobbyRecord } from "./types";
import { useStorytellerStore as store, captureCharacterActionContext } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { correctAlignmentIntent } from "./alignmentResolution";
import { endGameEligibility } from "./endGameEligibility";
import { scarletWomanSuccession } from "@/abilities/characters/scarletWoman";
import { isSaintNonqualifyingEvidenceType } from "./gameRuleFactRegistry";

// Independent official expectations: wiki.bloodontheclocktower.com/Saint,
// /Mayor, /Glossary. Neither current sobriety nor a reminder proves past
// functioning. Tests use real Life/expiry planners and event identities.
const env = proofEnv();
const saint = () => proofGame(["saint", "chef", "soldier", "poisoner", "imp"], "day", 2);
const mayor = () => proofGame(["mayor", "chef", "imp"], "day", 2);
function accepted(result: VictoryEvidenceResult) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.game;
}
function life(game: StorytellerLobbyRecord, intents: LifeTransaction["intents"]) {
  const plan = planLifeTransaction(game, { intents }, undefined, env);
  expect(plan).toMatchObject({ ok: true, changed: true });
  if (!plan.ok || !plan.changed) throw new Error("Expected accepted Life action");
  return applyLifePlan(game, plan.plan);
}
function execute(before: StorytellerLobbyRecord, outcome: "died" | "survived" | "alreadyDead" = "died") {
  const after = life(before, [{ kind: "execution", playerId: "p0", outcome }]);
  const event = after.lifeEventWindow.events.at(-1)!;
  return accepted(captureSaintQualification(before, after, event.id, env));
}
function advance(before: StorytellerLobbyRecord) {
  const destination = before.phase === "day" ? { phase: "night" as const, day: before.day + 1 } : { phase: "day" as const, day: before.day };
  let next: StorytellerLobbyRecord = { ...before, ...destination, lifeEventWindow: pruneLifeEventWindow(before.lifeEventWindow, destination.phase, destination.day) };
  const effectPlan = planEffectExpiry(before, destination);
  if (effectPlan) next = applyEffectPlan(next, effectPlan);
  const facts = planGameRuleFactExpiry(before, destination);
  if (facts) next = applyGameRuleFactPlan(next, facts);
  return next;
}
function ending(before: StorytellerLobbyRecord) { return accepted(captureMayorQualification(before, advance(before), env)); }
function throughDay(game: StorytellerLobbyRecord) {
  const next = impair(game, "p0");
  next.players.p0!.effects[0] = { ...next.players.p0!.effects[0]!, lifetime: { kind: "throughFollowingDay" }, expiry: { kind: "at", moment: { phase: "night", day: game.day + 1 } } };
  return next;
}

describe("B8 independent temporal qualification", () => {
  it.each(["good", "evil"] as const)("Saint captures actual %s team against exact execution event, not action correlation", alignment => {
    const before = patchPlayer(saint(), "p0", { actualAlignment: alignment });
    const after = execute(before); const evidence = validVictoryEvidence(after);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({ recordedAt: { phase: "day", day: 2 }, expiresAt: { phase: "day", day: 3 }, resolutionId: after.lifeEventWindow.events[0]!.id,
      provenance: { sourceCharacter: "saint", sourceParticipant: { participantId: before.players.p0!.participantId } } });
    expect(evidence[0]!.type.toLowerCase()).toContain(alignment);
    expect(after.gameSchemaVersion).toBe(28); expect(after.result).toBeUndefined();
    expect(StorytellerGamePersistedSchema.safeParse(after).success).toBe(true);
    expect(validVictoryEvidence(JSON.parse(JSON.stringify(after)))).toEqual(evidence);
  });
  it.each(["poisoned", "drunk", "abilityLost"])("%s Saint records verified nonqualification without indicating a game ending", effect => {
    const after = execute(impair(saint(), "p0", effect));
    const evidence = validVictoryEvidence(after);
    expect(evidence).toHaveLength(1); expect(isSaintNonqualifyingEvidenceType(evidence[0]!.type)).toBe(true);
    expect(endGameEligibility(after, env)).toEqual({ kind: "none" });
  });
  it("uncertain Saint functioning records neither positive nor negative evidence", () => {
    expect(validVictoryEvidence(execute(impair(saint(), "p0", "soberHealthy")))).toEqual([]);
  });
  it.each(["survived", "alreadyDead"] as const)("%s execution is not Saint death", outcome => {
    const before = outcome === "alreadyDead" ? patchPlayer(saint(), "p0", { alive: false }) : saint();
    expect(validVictoryEvidence(execute(before, outcome))).toEqual([]);
  });
  it("ordinary death never substitutes for execution", () => {
    const before = saint(); const after = life(before, [{ kind: "death", playerId: "p0" }]);
    expect(validVictoryEvidence(accepted(captureSaintQualification(before, after, after.lifeEventWindow.events[0]!.id, env)))).toEqual([]);
  });
  it("current healthy state after poison expiry does not invent Saint eligibility", () => {
    const healthy = advance(execute(saint())); const poisoned = advance(execute(throughDay(saint())));
    expect(healthy.players.p0!.effects).toEqual([]); expect(poisoned.players.p0!.effects).toEqual([]);
    expect(validVictoryEvidence(healthy)).toHaveLength(1); expect(validVictoryEvidence(poisoned)).toHaveLength(1);
    expect(isSaintNonqualifyingEvidenceType(validVictoryEvidence(healthy)[0]!.type)).toBe(false);
    expect(isSaintNonqualifyingEvidenceType(validVictoryEvidence(poisoned)[0]!.type)).toBe(true);
    expect(validVictoryEvidence(JSON.parse(JSON.stringify(healthy)))).toHaveLength(1);
  });
  it("Saint evidence survives following Night and expires with its supporting event at next Day", () => {
    const night = advance(execute(saint())); expect(validVictoryEvidence(night)).toHaveLength(1);
    const day = advance(night); expect(validVictoryEvidence(day)).toEqual([]); expect(day.lifeEventWindow.events).toEqual([]);
    expect(StorytellerGamePersistedSchema.safeParse(day).success).toBe(true);
  });
  it("retraction removes exact Saint evidence and amendment cannot inherit it by resolution id", () => {
    const qualified = execute(saint()); const event = qualified.lifeEventWindow.events[0]!;
    const retracted = life(qualified, [{ kind: "retractEvent", eventId: event.id }]);
    expect(validVictoryEvidence(accepted(reconcileVictoryEvidence(qualified, retracted, { correction: true })))).toEqual([]);
    const amended = life(qualified, [{ kind: "amendEvent", eventId: event.id, replacement: { kind: "execution", outcome: "survived" } }]);
    expect(validVictoryEvidence(accepted(reconcileVictoryEvidence(qualified, amended, { correction: true })))).toEqual([]);
  });
  it("unknown actual alignment never becomes an assumed Good Saint", () => {
    expect(validVictoryEvidence(execute(patchPlayer(saint(), "p0", { actualAlignment: undefined })))).toEqual([]);
  });
  it("unrelated notation, names and notes do not erase temporal evidence", () => {
    const before = execute(saint()); const next = patchPlayer(before, "p2", { name: "Renamed", stNotes: "Private note" });
    expect(validVictoryEvidence(accepted(reconcileVictoryEvidence(before, next, { correction: true })))).toHaveLength(1);
  });
  it("same seat with a different participation never inherits Saint qualification", () => {
    const before = execute(saint()); const after = reseat(before, "p0");
    expect(validVictoryEvidence(after)).toEqual([]);
    expect(validVictoryEvidence(accepted(reconcileVictoryEvidence(before, after)))).toEqual([]);
    expect(StorytellerGamePersistedSchema.safeParse(after).success).toBe(false);
  });
  it.each(["good", "evil"] as const)("Mayor captures actual %s team only after the precise Day end", alignment => {
    const before = patchPlayer(mayor(), "p0", { actualAlignment: alignment });
    expect(validVictoryEvidence(before)).toEqual([]);
    const after = ending(before); const fact = validVictoryEvidence(after)[0]!;
    expect(fact).toMatchObject({ recordedAt: { phase: "day", day: 2 }, expiresAt: { phase: "day", day: 3 }, provenance: { sourceCharacter: "mayor" } });
    expect(fact.type.toLowerCase()).toContain(alignment); expect(fact.resolutionId).toBeUndefined();
    expect(StorytellerGamePersistedSchema.safeParse(after).success).toBe(true);
    expect(validVictoryEvidence(JSON.parse(JSON.stringify(after)))).toHaveLength(1);
  });
  it.each(["poisoned", "drunk", "abilityLost", "soberHealthy"])("%s Mayor does not qualify", effect => {
    expect(validVictoryEvidence(ending(impair(mayor(), "p0", effect)))).toEqual([]);
  });
  it("Mayor is judged before poison expiry, not healthy destination state", () => {
    const before = throughDay(mayor()); const after = ending(before);
    expect(after.players.p0!.effects).toEqual([]); expect(validVictoryEvidence(after)).toEqual([]);
  });
  it("Traveller counts toward Mayor three but cannot override already reached two ordinary survivors", () => {
    expect(validVictoryEvidence(ending(proofGame(["mayor", "imp", "beggar"], "day", 2)))).toEqual([]);
    expect(validVictoryEvidence(ending(proofGame(["mayor", "chef", "imp", "beggar"], "day", 2)))).toEqual([]);
  });
  it("exile permits Mayor while any survived execution prevents it", () => {
    const four = patchPlayer(proofGame(["mayor", "chef", "imp", "beggar"], "day", 2), "p3", { isTraveler: true });
    const exiled = life(four, [{ kind: "exile", playerId: "p3", outcome: "died" }]);
    expect(validVictoryEvidence(ending(exiled))).toHaveLength(1);
    const executed = life(mayor(), [{ kind: "execution", playerId: "p1", outcome: "survived" }]);
    expect(validVictoryEvidence(ending(executed))).toEqual([]);
  });
  it("unknown execution coverage never means no execution", () => {
    const before = mayor(); before.lifeEventWindow.coverageFrom = { phase: "night", day: 3 };
    expect(validVictoryEvidence(ending(before))).toEqual([]);
  });
  it("Mayor cannot trigger from a fabricated phase jump or already-dead Demon table", () => {
    const before = mayor();
    expect(validVictoryEvidence(accepted(captureMayorQualification(before, { ...advance(before), day: 4 }, env)))).toEqual([]);
    const noDemon = proofGame(["mayor", "chef", "soldier", "imp"], "day", 2);
    expect(validVictoryEvidence(ending(patchPlayer(noDemon, "p3", { alive: false })))).toEqual([]);
  });
  it("a prior-Day execution recorded late invalidates Mayor without inventing replacement evidence", () => {
    const before = ending(mayor());
    const after = life(before, [{ kind: "lateRecord", event: { kind: "execution", playerId: "p1", outcome: "survived" } }]);
    expect(validVictoryEvidence(accepted(reconcileVictoryEvidence(before, after, { correction: true })))).toEqual([]);
  });
  it("life correction invalidates Mayor; expired poison does not manufacture it", () => {
    const before = ending(mayor()); const after = life(before, [{ kind: "correctStatus", playerId: "p1", target: { alive: false, ghostVote: true } }]);
    expect(validVictoryEvidence(accepted(reconcileVictoryEvidence(before, after, { correction: true })))).toEqual([]);
  });
  it("registered qualification types cannot be created through generic fact commands", () => {
    for (const qualified of [execute(saint()), ending(mayor())]) {
      const fact = validVictoryEvidence(qualified)[0]!;
      const result = planGameRuleFactTransaction({ ...qualified, gameRuleFacts: [] }, { intents: [{ kind: "apply", type: fact.type }], context: { provenance: { sourcePlayer: "p0", sourceCharacter: fact.provenance!.sourceCharacter } }, resolutionId: fact.resolutionId });
      expect(result.ok).toBe(false);
    }
  });
  it.each(["missingSource", "wrongSource", "wrongRole", "wrongEvent", "wrongLifetime", "textPayload"])("%s malformed captured Saint fails recovered validation", kind => {
    const candidate = structuredClone(execute(saint())); const fact = candidate.gameRuleFacts[0]!;
    if (kind === "missingSource") delete fact.provenance;
    if (kind === "wrongSource" && fact.provenance?.sourceParticipant?.kind === "participant") fact.provenance.sourceParticipant.participantId = "different-person";
    if (kind === "wrongRole") fact.provenance!.sourceCharacter = "chef";
    if (kind === "wrongEvent") fact.resolutionId = "not-the-execution";
    if (kind === "wrongLifetime") fact.expiresAt = { phase: "night", day: 3 };
    if (kind === "textPayload") fact.provenance!.note = "functioning=true";
    expect(StorytellerGamePersistedSchema.safeParse(candidate).success).toBe(false);
  });
  it("qualification stays absent from both player and public projections", () => {
    const qualified = execute(saint()); const bare = { ...qualified, gameRuleFacts: [] };
    expect(projectLobbyToPublic(qualified, {})).toEqual(projectLobbyToPublic(bare, {}));
    expect(projectLobbyToSelfMap(qualified, env.registry)).toEqual(projectLobbyToSelfMap(bare, env.registry));
  });
  it("actual supported abilities work on custom scripts without requiring a Trouble Brewing script id", () => {
    expect(victoryCoverageEligibility(saint(), env)).toEqual({ kind: "automated" });
    expect(validVictoryEvidence(execute(saint()))).toHaveLength(1); // proof script contains the broader catalog.
    expect(victoryCoverageEligibility(saint(), homebrewEnv("saint"))).toMatchObject({ kind: "manual" });
  });
  it.each(["fabled", "lorics", "customEffect"])("%s uncertain competing rules do not qualify", kind => {
    let before = saint();
    if (kind === "fabled") before = { ...before, fabled: ["fiddler"] };
    if (kind === "lorics") before = { ...before, lorics: ["boffin"] };
    if (kind === "customEffect") before = impair(before, "p2", "customWinEffect");
    expect(validVictoryEvidence(execute(before))).toEqual([]);
  });
});

describe("B8 independent authoritative store integration", () => {
  const state = () => store.getState();
  const game = () => state().game!;
  beforeEach(() => {
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
    usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
    openInStore(saint());
  });
  afterEach(() => vi.restoreAllMocks());
  it.each(["saint", "mayor"])("%s captures in one saved publication, survives rehydration and Undoes together", character => {
    if (character === "mayor") openInStore(mayor());
    const before = game(); const seq = state().localSeq;
    let publications = 0;
    const stop = store.subscribe(next => {
      publications++;
      expect(validVictoryEvidence(next.game!)).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(next.game);
    });
    try {
      expect(character === "saint" ? state().recordExecution("p0", "died") : state().advancePhase()).toMatchObject({ ok: true });
    } finally { stop(); }
    expect(publications).toBe(1); expect(state().undoStack).toEqual([before]); expect(state().localSeq).toBe(seq + 1);
    const expected = game(); const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); store.persist.rehydrate();
    expect(game()).toEqual(expected); expect(validVictoryEvidence(game())).toHaveLength(1);
    state().undo(); expect(game()).toEqual(before); expect(validVictoryEvidence(game())).toEqual([]);
  });
  it.each(["saint", "mayor"])("%s failed persistence does not publish a partial qualification", character => {
    if (character === "mayor") openInStore(mayor());
    const before = state(); const saved = localStorage.getItem("new-blood-st");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
    expect(character === "saint" ? state().recordExecution("p0", "died") : state().advancePhase()).toMatchObject({ ok: false });
    expect(state()).toBe(before); expect(localStorage.getItem("new-blood-st")).toBe(saved);
  });
  it.each(["privacy", "stale", "recovery", "writer"])("%s prevents Saint capture before any game publication", mode => {
    const context = captureCharacterActionContext();
    if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (mode === "stale") state().setNotes("p2", "Changed");
    if (mode === "recovery") store.setState({ terminalClose: { status: "failed", message: "Retry", recoveryPending: true, intent: { kind: "declare", winner: "good" } } });
    if (mode === "writer") store.setState({ lobby: { code: "B8VERIFY", uid: "host", sessionId: "session", status: "live" }, game: { ...game(), code: "B8VERIFY", storytellerUid: "host" } });
    const before = state();
    expect(state().recordExecution("p0", "died", undefined, undefined, context)).toMatchObject({ ok: false });
    expect(state()).toBe(before);
  });
  it("Life retraction clears the captured fact atomically and Undo restores it", () => {
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    const qualified = game(); const event = qualified.lifeEventWindow.events[0]!;
    expect(state().retractLifeEvent(event.id)).toMatchObject({ ok: true });
    expect(validVictoryEvidence(game())).toEqual([]);
    state().undo(); expect(game()).toEqual(qualified); expect(validVictoryEvidence(game())).toHaveLength(1);
  });
  it("actual alignment correction invalidates captured team rather than flipping historical winner", () => {
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(state().resolveAlignments({ intents: [correctAlignmentIntent(game().players.p0!, "evil")] })).toMatchObject({ ok: true });
    expect(validVictoryEvidence(game())).toEqual([]);
  });
  it("Day-ending poison expiry keeps impaired Mayor unqualified through store and reload", () => {
    openInStore(throughDay(mayor()));
    expect(state().advancePhase()).toMatchObject({ ok: true });
    expect(game().players.p0!.effects).toEqual([]); expect(validVictoryEvidence(game())).toEqual([]);
    const expected = game(); const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null }); localStorage.setItem("new-blood-st", saved); store.persist.rehydrate();
    expect(game()).toEqual(expected); expect(validVictoryEvidence(game())).toEqual([]);
  });
  it("manual death and status correction cannot create Saint historical qualification", () => {
    expect(state().correctLifeStatus("p0", { alive: false, ghostVote: true })).toMatchObject({ ok: true });
    expect(validVictoryEvidence(game())).toEqual([]);
    openInStore({ ...saint(), phase: "night", day: 3 });
    expect(state().lateRecordLifeEvent({ kind: "execution", playerId: "p0", outcome: "died" })).toMatchObject({ ok: true });
    expect(validVictoryEvidence(game())).toEqual([]);
  });
  it.each(["good", "evil"] as const)("Saint actual %s team drives the opposite indicated winner", alignment => {
    openInStore(patchPlayer(saint(), "p0", { actualAlignment: alignment }));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: alignment === "good" ? "evil" : "good", reason: "saint" });
  });
  it.each(["good", "evil"] as const)("Mayor actual %s team drives the indicated winner only after Day-end", alignment => {
    openInStore(patchPlayer(mayor(), "p0", { actualAlignment: alignment }));
    expect(endGameEligibility(game(), env)).toEqual({ kind: "none" });
    expect(state().advancePhase()).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: alignment, reason: "mayor" });
  });
  it("Demon execution leaving two alive verifies Good over ordinary Evil", () => {
    openInStore(proofGame(["imp", "chef", "soldier"], "day", 2));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
    state().undo(); expect(endGameEligibility(game(), env)).toEqual({ kind: "none" });
  });
  it("two ordinary survivors excludes a living Traveller and cannot become a Mayor win", () => {
    openInStore(patchPlayer(proofGame(["mayor", "imp", "beggar"], "day", 2), "p2", { isTraveler: true }));
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
    expect(state().advancePhase()).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
    expect(validVictoryEvidence(game())).toEqual([]);
  });
  it("automatic Slayer death completes mandatory Scarlet Woman succession before eligibility", () => {
    openInStore(proofGame(["slayer", "imp", "scarletwoman", "chef", "soldier"], "day", 2));
    expect(state().resolveAbility(request(game(), "p0", "slayer", { target: pick(game(), "p1") }))).toMatchObject({ ok: true });
    expect(game().players.p2!.actualRole).toBe("imp");
    expect(endGameEligibility(game(), env)).toEqual({ kind: "none" });
  });
  it("automatic Imp self-pass resolves before final-two eligibility", () => {
    openInStore(proofGame(["imp", "poisoner", "chef"], "night", 2));
    expect(state().resolveAbility(request(game(), "p0", "imp", { target: pick(game(), "p0") }))).toMatchObject({ ok: true });
    expect(game().players.p1!.actualRole).toBe("imp");
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
  });
  it.each(["poisoner", "recluse"])("manual Night Imp death with possible %s successor remains unknown", role => {
    openInStore(proofGame(["imp", role, "chef"], "night", 2));
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toMatchObject({ kind: "unknown" });
  });
  it("manual Night Imp death with no possible successor verifies Good", () => {
    openInStore(proofGame(["imp", "chef", "soldier"], "night", 2));
    expect(state().recordDeath("p0")).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
  });
  it("resolved Imp execution below five verifies official Good despite living Scarlet Woman", () => {
    openInStore(proofGame(["imp", "scarletwoman", "chef", "soldier"], "day", 2));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
    expect(validVictoryEvidence(game()).some(fact => fact.provenance?.sourceCharacter === "imp")).toBe(true);
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
  });
  it("resolved Imp execution records poisoned Scarlet Woman nonqualification at five", () => {
    openInStore(impair(proofGame(["imp", "scarletwoman", "chef", "soldier", "mayor"], "day", 2), "p1"));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(validVictoryEvidence(game()).some(fact => fact.provenance?.sourceCharacter === "imp")).toBe(true);
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
  });
  it("later death cannot erase unresolved Scarlet Woman succession from a raw Life action", () => {
    openInStore(proofGame(["imp", "scarletwoman", "chef", "soldier", "mayor"], "day", 2));
    expect(state().resolveLife({ intents: [{ kind: "death", playerId: "p0" }] })).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toMatchObject({ kind: "unknown" });
    expect(state().recordDeath("p2")).toMatchObject({ ok: true });
    expect(endGameEligibility(game(), env)).toMatchObject({ kind: "unknown" });
  });
  it("legacy Saint missing event-time functioning does not invent competing outcome", () => {
    const legacy = execute(saint()); legacy.gameRuleFacts = [];
    expect(endGameEligibility(legacy, env)).toMatchObject({ kind: "unknown" });
  });
  it.each(["good", "evil"] as const)("known poisoned %s Saint leaving two survivors verifies ordinary Evil", alignment => {
    openInStore(impair(patchPlayer(proofGame(["saint", "chef", "imp"], "day", 2), "p0", { actualAlignment: alignment }), "p0"));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    const evidence = validVictoryEvidence(game()); expect(evidence).toHaveLength(1);
    expect(isSaintNonqualifyingEvidenceType(evidence[0]!.type)).toBe(true);
    expect(evidence[0]!.type.toLowerCase()).toContain(alignment);
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
  });
  it("negative Saint functioning survives poison expiry and reload, then expires at next Day", () => {
    openInStore(throughDay(proofGame(["saint", "chef", "imp"], "day", 2)));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    const originalEvent = game().lifeEventWindow.events[0]!.id;
    expect(state().advancePhase()).toMatchObject({ ok: true });
    expect(game().players.p0!.effects).toEqual([]);
    expect(validVictoryEvidence(game())[0]!.resolutionId).toBe(originalEvent);
    const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null }); localStorage.setItem("new-blood-st", saved); store.persist.rehydrate();
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
    expect(state().advancePhase()).toMatchObject({ ok: true });
    expect(validVictoryEvidence(game())).toEqual([]);
    expect(game().lifeEventWindow.events).toEqual([]);
  });
  it.each(["source", "event", "effect"])("%s correction invalidates negative Saint proof without inventing a positive outcome", correction => {
    openInStore(impair(proofGame(["saint", "chef", "imp"], "day", 2), "p0"));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    if (correction === "source") expect(state().resolveAlignments({ intents: [correctAlignmentIntent(game().players.p0!, "evil")] })).toMatchObject({ ok: true });
    if (correction === "event") expect(state().amendLifeEvent(game().lifeEventWindow.events[0]!.id, { kind: "execution", outcome: "survived" })).toMatchObject({ ok: true });
    if (correction === "effect") expect(state().resolveEffects({ intents: [{ kind: "correctRemove", target: bind(game(), "p0"), effectId: game().players.p0!.effects[0]!.id }] })).toMatchObject({ ok: true });
    expect(validVictoryEvidence(game())).toEqual([]);
    expect(endGameEligibility(game(), env)).not.toMatchObject({ kind: "verified", reason: "saint" });
  });
  it("negative Saint facts cannot be created by generic commands or inherited by another participant", () => {
    const qualified = execute(impair(saint(), "p0")); const fact = validVictoryEvidence(qualified)[0]!;
    expect(planGameRuleFactTransaction({ ...qualified, gameRuleFacts: [] }, { intents: [{ kind: "apply", type: fact.type }], context: { provenance: { sourcePlayer: "p0", sourceCharacter: "saint" } }, resolutionId: fact.resolutionId }).ok).toBe(false);
    const changed = reseat(qualified, "p0");
    expect(validVictoryEvidence(changed)).toEqual([]);
    expect(StorytellerGamePersistedSchema.safeParse(changed).success).toBe(false);
  });
  it("a later Saint execution cannot replace a previously reached ordinary ending", () => {
    openInStore(patchPlayer(proofGame(["saint", "imp"], "day", 2), "p0", { actualAlignment: "evil" }));
    expect(endGameEligibility(game(), env)).toEqual({ kind: "verified", team: "evil", reason: "twoAlive" });
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    // The Evil game-ending condition preceded this action; new Saint capture
    // must not invent a later competing Good outcome.
    expect(validVictoryEvidence(game())).toEqual([]);
  });
  it("DIAGNOSTIC: resolved nonqualification and unresolved Scarlet Woman succession can leave identical mechanical records", () => {
    const healthy = proofGame(["imp", "scarletwoman", "chef", "soldier", "mayor"], "day", 2);
    const poisoned = impair(healthy, "p1");
    expect(scarletWomanSuccession(proofQuery(healthy), bind(healthy, "p0"))).toMatchObject({ kind: "successor" });
    expect(scarletWomanSuccession(proofQuery(poisoned), bind(poisoned, "p0"))).toEqual({ kind: "none" });
    const execution = (before: StorytellerLobbyRecord) => {
      const result = planLifeTransaction(before, { intents: [{ kind: "execution", playerId: "p0", outcome: "died" }] }, { eventId: () => "same-execution-id", historyId: () => "same-life-history-id" }, env);
      if (!result.ok || !result.changed) throw new Error("Diagnostic execution refused");
      return applyLifePlan(before, result.plan);
    };
    const pending = execution(healthy); const completed = execution(poisoned);
    const remove = planEffectTransaction(completed, { intents: [{ kind: "remove", target: bind(completed, "p1"), effectId: completed.players.p1!.effects[0]!.id }] });
    if (!remove.ok || !remove.changed) throw new Error("Diagnostic effect removal refused");
    const recovered = applyEffectPlan(completed, remove.plan);
    // History differs but is explanatory. No authoritative current field
    // retains the earlier SW functioning result. This prevents a truthful
    // recovered claim of resolved Demon death in the second branch alone.
    const mechanical = ({ history: _history, ...game }: StorytellerLobbyRecord) => game;
    expect(mechanical(pending)).toEqual(mechanical(recovered));
    expect(StorytellerGamePersistedSchema.safeParse(pending).success).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(recovered).success).toBe(true);
    expect(endGameEligibility(pending, env)).toMatchObject({ kind: "unknown" });
    expect(endGameEligibility(recovered, env)).toMatchObject({ kind: "unknown" });
  });
});
