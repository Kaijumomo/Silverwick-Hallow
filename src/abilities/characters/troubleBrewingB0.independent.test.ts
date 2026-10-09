import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { automationEligibility } from "@/abilities/automationEligibility";
import { incompleteSuccessionReason } from "@/abilities/completeActionSafety";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import type { AbilityOperation, AbilityOutcome } from "@/stores/abilityResolution";
import { composeAbilityOutcome } from "@/stores/abilityResolution";
import { useStorytellerStore as store, captureCharacterActionContext } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofQuery, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { withoutRevealTokens } from "@/test/revealTokens";

// Independent acceptance cases from the official Scarlet Woman, Slayer and Imp
// wiki: count immediately before death; no powers while impaired; self-pass
// must finish its successor change and suppress another attack that night.
const base = () => proofGame(["slayer", "imp", "scarletwoman", "chef", "monk"], "day", 2);
const shot = (g: StorytellerLobbyRecord, target = "p1") => request(g, "p0", "slayer", { target: pick(g, target) });
const eligibility = (g: StorytellerLobbyRecord, target = "p1") => automationEligibility({ query: proofQuery(g),
  descriptor: CANONICAL_ABILITY_SEMANTICS.get("slayer")!, actor: bind(g, "p0"), roleId: "slayer", inputs: { target: pick(g, target) } });
const kill = (g: StorytellerLobbyRecord, id: string): AbilityOutcome => ({ operations: [{ domain: "life", intents: [{ kind: "death", target: bind(g, id) }] }] });

beforeEach(() => { store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" }); });
afterEach(() => vi.restoreAllMocks());

describe("independent B0 complete-action review", () => {
  it("five alive with healthy Scarlet Woman refuses at both UI preflight and command without any publication", () => {
    const g = base(); openInStore(g); const before = store.getState(); const persisted = localStorage.getItem("new-blood-st");
    const write = vi.spyOn(Storage.prototype, "setItem"); let published = 0;
    const unsubscribe = store.subscribe(() => published++);
    try {
      expect(eligibility(g).kind).toBe("manual");
      expect(store.getState().resolveAbility(shot(g), undefined, captureCharacterActionContext())).toMatchObject({ ok: false, code: "unsupported" });
      expect(store.getState()).toBe(before); expect(write).not.toHaveBeenCalled(); expect(published).toBe(0);
      expect(localStorage.getItem("new-blood-st")).toBe(persisted);
      expect(g.history).toEqual([]); expect(g.nightProgress).toEqual({}); expect(g.result).toBeUndefined();
      expect(g.players.p0!.abilityUsed).toBe(false); expect(g.players.p1!.alive).toBe(true);
    } finally { unsubscribe(); }
  });

  it.each(["dead", "impaired", "changed", "four-alive"])("preserves safe Slayer death when SW is %s", variant => {
    let g = variant === "dead" ? proofGame(["slayer", "imp", "scarletwoman", "chef", "monk", "empath"], "day", 2) : base();
    if (variant === "dead") g = patchPlayer(g, "p2", { alive: false });
    if (variant === "impaired") g = impair(g, "p2");
    if (variant === "changed") g = patchPlayer(g, "p2", { actualRole: "baron", shownRole: "baron" });
    if (variant === "four-alive") g = patchPlayer(g, "p4", { alive: false });
    expect(eligibility(g).kind).toBe("automated");
    const next = planned(plan(g, shot(g))); expect(next.players.p1!.alive).toBe(false);
    expect(next.players.p0!.abilityUsed).toBe(true); expect(next.phase).toBe("day"); expect(next.result).toBeUndefined();
  });

  it.each(["impaired-slayer", "dead-target", "protected-target", "unrelated-target"])("preserves a no-death shot with healthy SW: %s", variant => {
    let g = base(); let target = "p1";
    if (variant === "impaired-slayer") g = impair(g, "p0");
    if (variant === "dead-target") g = patchPlayer(g, "p1", { alive: false });
    if (variant === "protected-target") g = impair(g, "p1", "cannotDie");
    if (variant === "unrelated-target") target = "p3";
    expect(eligibility(g, target).kind).toBe("automated");
    const next = planned(plan(g, shot(g, target))); expect(next.players.p0!.abilityUsed).toBe(true);
    expect(next.players.p1!.alive).toBe(g.players.p1!.alive); expect(next.players.p3!.alive).toBe(true);
  });

  it("unknown SW functioning stays wholly manual", () => {
    const g = impair(base(), "p2", "soberHealthy");
    expect(eligibility(g).kind).toBe("manual"); expect(plan(g, shot(g))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("four living residents plus a Traveller do not meet the SW threshold", () => {
    let g = proofGame(["slayer", "imp", "scarletwoman", "chef", "beggar"], "day", 2);
    g = patchPlayer(g, "p4", { isTraveler: true });
    const action = { actor: bind(g, "p0"), roleId: "slayer" };
    expect(incompleteSuccessionReason(proofQuery(g), kill(g, "p1"), action)).toBeUndefined();
    expect(incompleteSuccessionReason(proofQuery(patchPlayer(g, "p4", { isTraveler: false })), kill(g, "p1"), action)).toMatch(/Scarlet Woman/);
    // The wider existing automation envelope still keeps unreviewed Traveller
    // mechanics manual; this assertion isolates the threshold policy only.
    expect(eligibility(g).kind).toBe("manual");
  });

  it("retains complete canonical Imp self-pass, one Undo, persistence and successor skip", async () => {
    const g = proofGame(["imp", "scarletwoman", "slayer", "chef", "monk"]); openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "imp", { target: pick(g, "p0") }, { withStep: true, completeStep: true }))).toMatchObject({ ok: true, changed: true });
    const next = store.getState().game!;
    expect(next.players.p0!.alive).toBe(false); expect(next.players.p1).toMatchObject({ actualRole: "imp", shownRole: "imp", alive: true });
    expect(next.nightProgress[`2:${participantStepKey(g.players.p1!.participantId!, "imp")}`]?.status).toBe("skipped");
    expect(next.nightProgress[`2:${participantStepKey(g.players.p0!.participantId!, "imp")}`]?.status).toBe("done");
    expect(next.result).toBeUndefined(); expect(store.getState().undoStack).toHaveLength(1);
    const saved = localStorage.getItem("new-blood-st")!; store.setState({ game: null, undoStack: [] });
    localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate(); expect(store.getState().game).toEqual(next);
    store.getState().undo(); expect(withoutRevealTokens(store.getState().game!)).toEqual(withoutRevealTokens(g));
    // Identity Undo rotates the private reveal capability rather than reviving
    // a link from the superseded Imp identity.
    expect(store.getState().game!.players.p1!.revealToken).toBeDefined();
    expect(store.getState().game!.players.p1!.revealToken).not.toBe(next.players.p1!.revealToken);
  });

  it("manual Life correction remains available with no invented succession or winner", () => {
    const g = base(); const next = planned(plan(g, { mode: "manual", reason: "Storyteller adjudicated", outcome: kill(g, "p1") }));
    expect(next.players.p1!.alive).toBe(false); expect(next.players.p2!.actualRole).toBe("scarletwoman");
    expect(next.result).toBeUndefined();
  });

  it.each(["absent", "wrong-day", "wrong-participant"])("does not exempt an incomplete self-pass whose successor skip is %s", variant => {
    const g = proofGame(["imp", "scarletwoman", "slayer", "chef", "monk"]);
    const result = plan(g, request(g, "p0", "imp", { target: pick(g, "p0") }));
    if (!result.ok || !result.changed) throw new Error("Canonical self-pass must be available");
    const outcome: AbilityOutcome = { ...result.plan.outcome, operations: result.plan.outcome.operations.flatMap<AbilityOperation>(op => {
      if (op.domain !== "nightStep") return [op];
      if (variant === "absent") return [];
      return [{ ...op, ...(variant === "wrong-day" ? { day: 1 } : { stepKey: participantStepKey(g.players.p2!.participantId!, "imp") }) }];
    }) };
    expect(composeAbilityOutcome(g, outcome, proofEnv(), { resolutionId: `independent-skip-${variant}`,
      automaticAction: { actor: bind(g, "p0"), roleId: "imp" } })).toMatchObject({ ok: false, code: "unsupported" });
    expect(g.players.p0!.alive).toBe(true); expect(g.players.p1!.actualRole).toBe("scarletwoman");
  });

  it("a changed trusted evaluator cannot pass preflight then commit an incomplete death", () => {
    const g = base(); let calls = 0;
    const use: AbilityOperation = { domain: "life", intents: [{ kind: "useAbility", target: bind(g, "p0") }] };
    const descriptor = { ...CANONICAL_ABILITY_SEMANTICS.get("slayer")!, evaluator: () => ({ kind: "outcome" as const,
      outcome: { operations: ++calls === 1 ? [use] : [use, ...kill(g, "p1").operations] } }) };
    const semantics = new Map(CANONICAL_ABILITY_SEMANTICS); semantics.set("slayer", descriptor);
    const before = JSON.stringify(g); expect(plan(g, shot(g), proofEnv({ semantics }))).toMatchObject({ ok: false, code: "unsupported", message: expect.stringMatching(/Scarlet Woman/) });
    expect(calls).toBe(2); expect(JSON.stringify(g)).toBe(before);
  });

  it("uses evolving state when an earlier operation removed SW impairment", () => {
    const g = impair(base(), "p2"); const before = JSON.stringify(g);
    const outcome: AbilityOutcome = { mechanicalOrder: "declared", operations: [
      { domain: "effect", intents: [{ kind: "remove", target: bind(g, "p2"), effectId: "fx-poisoned-p2" }] }, ...kill(g, "p1").operations,
    ] };
    expect(composeAbilityOutcome(g, outcome, proofEnv(), { resolutionId: "independent-evolving", automaticAction: { actor: bind(g, "p0"), roleId: "slayer" } }))
      .toMatchObject({ ok: false, code: "unsupported" }); expect(JSON.stringify(g)).toBe(before);
  });

  it("source loss within a proposed Life batch cannot leave newly healthy SW unresolved", () => {
    let g = proofGame(["slayer", "imp", "scarletwoman", "poisoner", "chef", "monk"], "day", 2);
    g = patchPlayer(g, "p2", { effects: [{ id: "source-poison", type: "poisoned", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" },
      appliedAt: { phase: "day", day: 2 }, sourceCharacter: "poisoner", sourceParticipant: { kind: "participant", ...bind(g, "p3"), nameAtTime: "Poisoner" } }] });
    const before = JSON.stringify(g); expect(proofQuery(g).abilityFunctions(bind(g, "p2"))).toEqual({ known: true, value: false });
    const outcome: AbilityOutcome = { operations: [{ domain: "life", intents: [{ kind: "death", target: bind(g, "p3") }, { kind: "death", target: bind(g, "p1") }] }] };
    expect(composeAbilityOutcome(g, outcome, proofEnv(), { resolutionId: "independent-source-loss", automaticAction: { actor: bind(g, "p0"), roleId: "slayer" } }))
      .toMatchObject({ ok: false, code: "unsupported" }); expect(JSON.stringify(g)).toBe(before);
  });
});
