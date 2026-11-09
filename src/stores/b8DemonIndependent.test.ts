import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, impair, openInStore, patchPlayer, pick, proofEnv, proofGame, request } from "@/test/proofFixtures";
import { captureCharacterActionContext, captureVotingContext, useStorytellerStore as store } from "./storytellerStore";
import { currentVotingState } from "./voting";
import { usePrivacyStore } from "./privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { endGameEligibility } from "./endGameEligibility";
import { validVictoryEvidence } from "./victoryEvidence";
import { StorytellerGamePersistedSchema } from "./schemas";
import { planGameRuleFactTransaction } from "./gameRuleFacts";
import { correctAlignmentIntent } from "./alignmentResolution";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import type { StorytellerLobbyRecord } from "./types";

// Independent rule oracle: official Scarlet Woman/Imp/Slayer almanacs.
// Five ordinary players are counted immediately BEFORE Demon death;
// impairment is evaluated at that time; actual succession resolves first.
const env = proofEnv();
const state = () => store.getState();
const game = () => state().game!;
const eligibility = () => endGameEligibility(game(), env);
const demonFacts = () => validVictoryEvidence(game()).filter(fact => fact.provenance?.sourceCharacter === "imp");
const base = () => proofGame(["imp", "scarletwoman", "chef", "poisoner", "soldier"], "day", 2);
const four = () => patchPlayer(base(), "p4", { alive: false });
function poisonThroughDay(before: StorytellerLobbyRecord, id = "p1") {
  const next = impair(before, id);
  next.players[id]!.effects[0] = { ...next.players[id]!.effects[0]!, lifetime: { kind: "throughFollowingDay" }, expiry: { kind: "at", moment: { phase: "night", day: before.day + 1 } } };
  return next;
}
const shoot = (actor: string, target: string) => state().resolveAbility(request(game(), actor, "slayer", { target: pick(game(), target) }));
const impKill = (target: string, successor?: string) => state().resolveAbility(request(game(), "p0", "imp", { target: pick(game(), target), ...(successor ? { successor: pick(game(), successor) } : {}) }));
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
  openInStore(base());
});
afterEach(() => vi.restoreAllMocks());

describe("B8 independent resolved Demon death amendment", () => {
  it.each(["execution", "slayer"])("%s below five captures exact resolved death and verifies Good", action => {
    openInStore(action === "execution" ? four() : patchPlayer(four(), "p2", { actualRole: "slayer", shownRole: "slayer" }));
    expect(action === "execution" ? state().recordExecution("p0", "died") : shoot("p2", "p0")).toMatchObject({ ok: true });
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
    expect(eligibility()).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
    expect(demonFacts()).toHaveLength(1);
    expect(demonFacts()[0]).toMatchObject({ resolutionId: game().lifeEventWindow.events.find(event => event.actualRoleAtEvent === "imp")!.id,
      provenance: { sourceCharacter: "imp", sourceParticipant: { participantId: game().players.p0!.participantId } } });
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });
  it.each(["execution", "slayer"])("%s at five completes Scarlet Woman succession before publishing any assistance", action => {
    if (action === "slayer") openInStore(patchPlayer(base(), "p2", { actualRole: "slayer", shownRole: "slayer" }));
    let publications = 0;
    const stop = store.subscribe(next => {
      publications++;
      expect(next.game!.players.p1!.actualRole).toBe("imp");
      expect(endGameEligibility(next.game!, env)).toEqual({ kind: "none" });
    });
    try { expect(action === "execution" ? state().recordExecution("p0", "died") : shoot("p2", "p0")).toMatchObject({ ok: true }); }
    finally { stop(); }
    expect(publications).toBe(1); expect(game().players.p0!.alive).toBe(false); expect(demonFacts()).toEqual([]);
  });
  it.each(["poisoned", "drunk", "abilityLost"])("%s Scarlet Woman at five does not succeed and verified death persists", impairment => {
    openInStore(impair(base(), "p1", impairment));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
    expect(eligibility()).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
    expect(demonFacts()).toHaveLength(1);
  });
  it("poison expiry and reload cannot reinterpret Scarlet Woman eligibility at the resolved death", () => {
    openInStore(poisonThroughDay(base())); expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    const captured = demonFacts(); expect(captured).toHaveLength(1);
    expect(state().advancePhase()).toMatchObject({ ok: true }); expect(game().players.p1!.effects).toEqual([]);
    expect(demonFacts()).toEqual(captured); expect(eligibility()).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
    const expected = game(); const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); store.persist.rehydrate();
    expect(game()).toEqual(expected); expect(demonFacts()).toEqual(captured);
    expect(eligibility()).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
  });
  it("Travellers cannot supply Scarlet Woman's fifth ordinary survivor", () => {
    const withTraveller = patchPlayer(proofGame(["imp", "scarletwoman", "chef", "soldier", "beggar"], "day", 2), "p4", { isTraveler: true });
    openInStore(withTraveller); expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
    expect(eligibility()).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
  });
  it.each(["soberHealthy", "multiple"])("%s Scarlet Woman ambiguity produces no resolved outcome evidence", mode => {
    openInStore(mode === "multiple" ? patchPlayer(base(), "p3", { actualRole: "scarletwoman", shownRole: "scarletwoman" }) : impair(base(), "p1", "soberHealthy"));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(demonFacts()).toEqual([]); expect(eligibility()).toMatchObject({ kind: "unknown" });
  });
  it("raw Life death never claims the unresolved Scarlet Woman chain is complete", () => {
    expect(state().resolveLife({ intents: [{ kind: "death", playerId: "p0" }] })).toMatchObject({ ok: true });
    expect(demonFacts()).toEqual([]); expect(eligibility()).toMatchObject({ kind: "unknown" });
    expect(state().recordDeath("p2")).toMatchObject({ ok: true });
    expect(demonFacts()).toEqual([]); expect(eligibility()).toMatchObject({ kind: "unknown" });
  });
  it("manual ability composition cannot fabricate a resolved Demon consequence", () => {
    expect(state().resolveAbility({ mode: "manual", reason: "Actual outcome recorded", outcome: { operations: [{ domain: "life", intents: [{ kind: "death", target: bind(game(), "p0") }] }] } })).toMatchObject({ ok: true });
    expect(demonFacts()).toEqual([]); expect(eligibility()).toMatchObject({ kind: "unknown" });
  });
  it("Imp self-pass prioritizes healthy Scarlet Woman at five and emits no Good proof", () => {
    openInStore({ ...base(), phase: "night" }); expect(impKill("p0")).toMatchObject({ ok: true });
    expect(game().players.p1!.actualRole).toBe("imp"); expect(game().players.p3!.actualRole).toBe("poisoner");
    expect(demonFacts()).toEqual([]); expect(eligibility()).toEqual({ kind: "none" });
  });
  it("self-pass to the sole poisoned Scarlet Woman remains a Minion transfer below five", () => {
    openInStore(impair(proofGame(["imp", "scarletwoman", "chef", "soldier"], "night", 2), "p1"));
    expect(impKill("p0")).toMatchObject({ ok: true });
    expect(game().players.p1!.actualRole).toBe("imp"); expect(demonFacts()).toEqual([]);
    expect(eligibility()).toEqual({ kind: "none" });
  });
  it("Imp self-kill with no possible Minion produces resolved Good evidence", () => {
    openInStore(proofGame(["imp", "chef", "soldier", "mayor", "monk"], "night", 2));
    expect(impKill("p0")).toMatchObject({ ok: true }); expect(demonFacts()).toHaveLength(1);
    expect(eligibility()).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
  });
  it("multiple eligible Imp successors require the existing choice and no partial death or fact", () => {
    openInStore(proofGame(["imp", "poisoner", "baron", "chef"], "night", 2)); const before = game();
    expect(impKill("p0")).toMatchObject({ ok: false }); expect(game()).toBe(before); expect(demonFacts()).toEqual([]);
    expect(impKill("p0", "p2")).toMatchObject({ ok: true }); expect(game().players.p2!.actualRole).toBe("imp");
    expect(demonFacts()).toEqual([]); expect(eligibility()).toEqual({ kind: "none" });
  });
  it("ambiguous Recluse as possible self-pass recipient leaves the whole action manual", () => {
    openInStore(proofGame(["imp", "recluse", "chef"], "night", 2)); const before = game();
    expect(impKill("p0")).toMatchObject({ ok: false }); expect(game()).toBe(before); expect(demonFacts()).toEqual([]);
  });
  it("actual Demon death leaving two survivors takes precedence over ordinary Evil", () => {
    openInStore(proofGame(["imp", "scarletwoman", "chef"], "day", 2));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(demonFacts()).toHaveLength(1); expect(eligibility()).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
  });
  it("a negative Saint execution followed by a Slayer Demon kill preserves both facts without losing Good", () => {
    openInStore(impair(proofGame(["saint", "slayer", "imp", "chef", "soldier"], "day", 2), "p0"));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(eligibility()).toEqual({ kind: "none" });
    expect(shoot("p1", "p2")).toMatchObject({ ok: true });
    expect(eligibility()).toEqual({ kind: "verified", team: "good", reason: "demonDeath" });
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    expect(validVictoryEvidence(game()).some(fact => fact.provenance?.sourceCharacter === "saint")).toBe(true);
    expect(demonFacts()).toHaveLength(1);
  });
  it("an earlier positive Saint ending cannot be replaced by a later Slayer Demon death", () => {
    openInStore(proofGame(["saint", "slayer", "imp", "chef", "soldier"], "day", 2));
    expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(eligibility()).toEqual({ kind: "verified", team: "evil", reason: "saint" });
    expect(shoot("p1", "p2")).toMatchObject({ ok: true });
    expect(eligibility()).toEqual({ kind: "verified", team: "evil", reason: "saint" }); expect(demonFacts()).toEqual([]);
  });
  it("retained resolved evidence is private and command-managed", () => {
    openInStore(four()); expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    const fact = demonFacts()[0]!; expect(fact).toBeDefined();
    expect(planGameRuleFactTransaction({ ...game(), gameRuleFacts: [] }, { intents: [{ kind: "apply", type: fact.type }], context: { provenance: { sourcePlayer: "p0", sourceCharacter: "imp" } }, resolutionId: fact.resolutionId }).ok).toBe(false);
    const without = { ...game(), gameRuleFacts: [] };
    expect(projectLobbyToPublic(game(), {})).toEqual(projectLobbyToPublic(without, {}));
    expect(projectLobbyToSelfMap(game(), env.registry)).toEqual(projectLobbyToSelfMap(without, env.registry));
  });
  it.each(["event", "source", "effect"])("%s correction invalidates prior resolved evidence and Undo restores it", mode => {
    openInStore(poisonThroughDay(base())); expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    const qualified = game(); expect(demonFacts()).toHaveLength(1);
    if (mode === "event") expect(state().retractLifeEvent(qualified.lifeEventWindow.events[0]!.id)).toMatchObject({ ok: true });
    if (mode === "source") expect(state().resolveAlignments({ intents: [correctAlignmentIntent(game().players.p0!, "good")] })).toMatchObject({ ok: true });
    if (mode === "effect") expect(state().resolveEffects({ intents: [{ kind: "correctRemove", target: bind(game(), "p1"), effectId: game().players.p1!.effects[0]!.id }] })).toMatchObject({ ok: true });
    expect(demonFacts()).toEqual([]);
    state().undo(); expect(game()).toEqual(qualified); expect(demonFacts()).toHaveLength(1);
  });
  it("departed source invalidates evidence and membership Undo cannot resurrect that participant", () => {
    openInStore(four()); expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true });
    expect(demonFacts()).toHaveLength(1); expect(state().unseatPlayer("p0")).toBe(true);
    expect(demonFacts()).toEqual([]); expect(state().undoStack).toEqual([]);
    const departed = game(); state().undo(); expect(game()).toEqual(departed);
    expect(game().players.p0!.participantId).toBeUndefined(); expect(demonFacts()).toEqual([]);
  });
  it.each([4, 5])("Voting execution at %i ordinary survivors resolves the whole chain atomically", count => {
    openInStore(count === 4 ? four() : base()); const before = game(); let publications = 0;
    const stop = store.subscribe(next => {
      publications++;
      expect(next.game!.players.p0!.alive).toBe(false);
      expect(next.game!.players.p1!.actualRole).toBe(count === 4 ? "scarletwoman" : "imp");
      expect(demonFacts()).toHaveLength(count === 4 ? 1 : 0);
      expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(next.game);
    });
    try {
      expect(state().resolveVoting({ kind: "execution", target: bind(game(), "p0"), outcome: "died", code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision }, captureVotingContext())).toMatchObject({ ok: true });
    } finally { stop(); }
    expect(publications).toBe(1);
    expect(eligibility()).toEqual(count === 4 ? { kind: "verified", team: "good", reason: "demonDeath" } : { kind: "none" });
    if (count === 4) expect(demonFacts()[0]!.resolutionId).toBe(game().lifeEventWindow.events.find(event => event.actualRoleAtEvent === "imp")!.id);
    state().undo();
    if (count === 5) {
      // Existing identity Undo rotates the reveal credential rather than
      // restoring a previously disclosed character token.
      const { revealToken, ...restoredHeir } = game().players.p1!;
      expect(revealToken).toEqual(expect.any(String));
      expect({ ...game(), players: { ...game().players, p1: restoredHeir } }).toEqual(before);
    } else expect(game()).toEqual(before);
    expect(demonFacts()).toEqual([]);
  });
  it.each(["storage", "privacy", "stale", "writer", "recovery"])("%s refusal leaves death, evidence and Undo unchanged", mode => {
    openInStore(four()); const context = captureCharacterActionContext();
    if (mode === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Cannot persist"); });
    if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (mode === "stale") state().setNotes("p2", "Changed");
    if (mode === "writer") store.setState({ lobby: { code: "B8DEMONX", uid: "host", sessionId: "session", status: "live" }, game: { ...game(), code: "B8DEMONX", storytellerUid: "host" } });
    if (mode === "recovery") store.setState({ terminalClose: { status: "failed", message: "Retry", recoveryPending: true, intent: { kind: "declare", winner: "good" } } });
    const before = state(); expect(state().recordExecution("p0", "died", undefined, undefined, context)).toMatchObject({ ok: false });
    expect(state()).toBe(before); expect(demonFacts()).toEqual([]);
  });
  it("new death and resolved outcome save in one publication and Undo restores the entire prior game", () => {
    openInStore(four()); const before = game(); const seq = state().localSeq; let publications = 0;
    const stop = store.subscribe(next => { publications++; expect(demonFacts()).toHaveLength(1); expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(next.game); });
    try { expect(state().recordExecution("p0", "died")).toMatchObject({ ok: true }); } finally { stop(); }
    expect(publications).toBe(1); expect(state().localSeq).toBe(seq + 1); expect(state().undoStack).toEqual([before]);
    state().undo(); expect(game()).toEqual(before); expect(demonFacts()).toEqual([]);
  });
});
