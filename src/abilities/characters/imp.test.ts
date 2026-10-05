// Phase 10F Slice 7 -- Imp + the narrow Scarlet Woman dependency
// (matrix Sections 6 and 18.1). Production semantics.
import { beforeEach, describe, expect, it } from "vitest";
import { SUCCESSOR, swFunctionsJudgment } from "./imp";
import { protectionId, homebrewEnv, homebrewScript, impair, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofScript, request, requirementIds, reseat, yes } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { participantStepKey } from "@/stores/nightProgress";
import { buildRegistry } from "@/data/roleRegistry";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";
import { withoutRevealTokens } from "@/test/revealTokens";

// p0 imp, p1 poisoner, p2 scarletwoman, p3 monk, p4 chef, p5 empath, p6 saint  (7 alive non-Travellers)
const ROLES = ["imp", "poisoner", "scarletwoman", "monk", "chef", "empath", "saint"];
const base = () => proofGame(ROLES);
const kill = (g: StorytellerLobbyRecord, target: string, extra = {}) => plan(g, request(g, "p0", "imp", { target: pick(g, target) }, extra));
const domains = (result: ReturnType<typeof plan>) => result.ok && result.changed ? result.plan.outcome.operations.map((o) => o.domain) : [];
const monkSafe = (g: StorytellerLobbyRecord, id: string): StorytellerLobbyRecord => patchPlayer(g, id, { effects: [{
  id: `safe-${id}`, type: "safeFromDemon", sourceCharacter: "monk", lifetime: { kind: "untilDawn" }, state: "active",
  sourceParticipant: { kind: "participant", participantId: g.players.p3!.participantId!, playerId: "p3", nameAtTime: "Player 3" },
  expiry: { kind: "at", moment: { phase: "day", day: 2 } }, appliedAt: { phase: "night", day: 2 } } as EffectRecord] });
const killAll = (g: StorytellerLobbyRecord, ids: string[]) => ids.reduce((acc, id) => patchPlayer(acc, id, { alive: false }), g);

describe("Imp -- killing another player", () => {
  it("an unprotected living target dies (Demon-caused)", () => {
    const result = kill(base(), "p4");
    expect(planned(result).players.p4!.alive).toBe(false);
    expect(domains(result)).toEqual(["life"]);
  });

  it("a Monk-protected target does not die; generic Protected -> judgment", () => {
    expect(kill(monkSafe(base(), "p4"), "p4")).toEqual({ ok: true, changed: false });
    const generic = patchPlayer(base(), "p4", { effects: [{ id: "gp", type: "protected", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as EffectRecord] });
    const id = protectionId(generic, "demon", "p4");
    expect(requirementIds(kill(generic, "p4"))).toEqual([id]);
    expect(planned(kill(generic, "p4", { judgments: { [id]: yes(false) } })).players.p4!.alive).toBe(false);
  });

  it("the Monk's protection stops if the Monk lost the ability first", () => {
    const g = impair(monkSafe(base(), "p4"), "p3");
    expect(planned(kill(g, "p4")).players.p4!.alive).toBe(false);
  });

  it("a dead target: no Life change", () => {
    expect(kill(patchPlayer(base(), "p4", { alive: false }), "p4")).toEqual({ ok: true, changed: false });
  });

  it("an impaired Imp kills nobody", () => {
    expect(kill(impair(base(), "p0"), "p4")).toEqual({ ok: true, changed: false });
    expect(kill(impair(base(), "p0"), "p0")).toEqual({ ok: true, changed: false });
  });

  it("not on Night 1", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(kill(g, "p4")).toMatchObject({ ok: false, code: "notApplicable" });
  });
});

describe("Imp -- star-pass", () => {
  it("Scarlet Woman priority (>= 5 living non-Travellers, her ability functioning): death FIRST, then she becomes the Imp, then her new Imp step is skipped", () => {
    const g = base();
    const result = kill(g, "p0");
    const next = planned(result);
    expect(domains(result)).toEqual(["life", "role", "nightStep"]);
    expect(next.players.p0!.alive).toBe(false);
    expect(next.players.p2).toMatchObject({ actualRole: "imp", shownRole: "imp", alive: true, actualAlignment: "evil" });
    expect(next.players.p1!.actualRole).toBe("poisoner");
    expect(next.nightProgress[`2:${participantStepKey(g.players.p2!.participantId!, "imp")}`]?.status).toBe("skipped");
    expect(result).toMatchObject({ ok: true, plan: { needsConfirmation: true } });
  });

  it("Monk-protected Imp choosing itself: no death and therefore no star-pass", () => {
    expect(kill(monkSafe(base(), "p0"), "p0")).toEqual({ ok: true, changed: false });
  });

  it("below 5 living non-Travellers the Scarlet Woman is an ordinary candidate -> Storyteller choice", () => {
    const g = killAll(base(), ["p4", "p5", "p6"]); // 4 alive: imp, poisoner, sw, monk
    expect(requirementIds(kill(g, "p0"))).toEqual([SUCCESSOR]);
    const toPoisoner = planned(kill(g, "p0", { inputs: { target: pick(g, "p0"), [SUCCESSOR]: pick(g, "p1") } }));
    expect(toPoisoner.players.p1!.actualRole).toBe("imp");
    expect(kill(g, "p0", { inputs: { target: pick(g, "p0"), [SUCCESSOR]: pick(g, "p4") } })).toMatchObject({ ok: false, code: "illegal" }); // dead, not a Minion
  });

  it("the threshold counts only NON-Traveller living players", () => {
    // 4 ordinary alive + 2 alive Travellers = 6 alive, but only 4 count.
    let g = killAll(proofGame([...ROLES, "beggar", "gunslinger"]), ["p4", "p5", "p6"]);
    for (const id of ["p7", "p8"]) g = patchPlayer(g, id, { isTraveler: true, actualAlignment: "good" });
    expect(requirementIds(kill(g, "p0"))).toEqual([SUCCESSOR]);
  });

  it("an impaired Scarlet Woman has no priority: ordinary candidate", () => {
    const g = impair(base(), "p2");
    expect(requirementIds(kill(g, "p0"))).toEqual([SUCCESSOR]);
    expect(planned(kill(g, "p0", { inputs: { target: pick(g, "p0"), [SUCCESSOR]: pick(g, "p2") } })).players.p2!.actualRole).toBe("imp");
  });

  it("unknown Scarlet Woman functioning -> judgment", () => {
    const g = patchPlayer(base(), "p2", { effects: [{ id: "c", type: "customThing", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as EffectRecord,
      { id: "sh", type: "soberHealthy", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as EffectRecord] });
    const id = swFunctionsJudgment(g.players.p2!.participantId!);
    expect(requirementIds(kill(g, "p0"))).toEqual([id]);
    expect(planned(kill(g, "p0", { judgments: { [id]: yes(true) } })).players.p2!.actualRole).toBe("imp");
  });

  it("exactly one living Minion -> deterministic", () => {
    const g = proofGame(["imp", "poisoner", "monk", "chef", "empath", "saint", "washerwoman"]);
    expect(planned(kill(g, "p0")).players.p1!.actualRole).toBe("imp");
  });

  it("dead Minions are not eligible; no living Minion -> the Imp dies with no star-pass", () => {
    const g = killAll(proofGame(["imp", "poisoner", "monk", "chef", "empath", "saint", "washerwoman"]), ["p1"]);
    const result = kill(g, "p0");
    expect(domains(result)).toEqual(["life"]);
    expect(planned(result).players.p1!.actualRole).toBe("poisoner");
  });

  it("several living Minions -> the Storyteller's choice (stale successor refused)", () => {
    const g = proofGame(["imp", "poisoner", "spy", "chef", "empath", "saint", "washerwoman"]);
    expect(requirementIds(kill(g, "p0"))).toEqual([SUCCESSOR]);
    const req = request(g, "p0", "imp", { target: pick(g, "p0"), [SUCCESSOR]: pick(g, "p2") });
    expect(plan(reseat(g, "p2"), req)).toMatchObject({ ok: false, code: "stale" });
  });

  it("the new Imp cannot act again this Night: the re-derived Night Order row is skipped and a guided request is refused", () => {
    const g = base();
    const next = planned(kill(g, "p0", { withStep: true, completeStep: true }));
    const steps = computeNightOrder(next.players, next.seatOrder, proofScript, false, next);
    const heirRow = steps.find((s) => s.kind === "player" && s.playerId === "p2")!;
    expect(heirRow.stepKey).toBe(participantStepKey(g.players.p2!.participantId!, "imp"));
    expect(next.nightProgress[`2:${heirRow.stepKey}`]?.status).toBe("skipped");
    expect(next.players.p2!.abilityUsed).toBe(false); // not faked
    expect(plan(next, request(next, "p2", "imp", { target: pick(next, "p4") }))).toMatchObject({ ok: false, code: "notApplicable" });
    // The old Imp's own step completed in the same snapshot.
    expect(next.nightProgress[`2:${participantStepKey(g.players.p0!.participantId!, "imp")}`]?.status).toBe("done");
  });

  it("the Scarlet Woman priority belongs only to the CANONICAL Scarlet Woman (homebrew collision)", () => {
    const script = homebrewScript("scarletwoman");
    const env = proofEnv({ script, registry: buildRegistry(script) });
    const g = base();
    expect(requirementIds(plan(g, request(g, "p0", "imp", { target: pick(g, "p0") }), env))).toEqual([SUCCESSOR]);
  });

  it("a homebrew Imp reusing the official id inherits no semantics", () => {
    const g = base();
    expect(plan(g, request(g, "p0", "imp", { target: pick(g, "p4") }), homebrewEnv("imp"))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a successor with a concealed identity is not guessed -> Manual", () => {
    const g = patchPlayer(proofGame(["imp", "marionette", "monk", "chef", "empath", "saint", "washerwoman"]), "p1",
      { shownRole: "chef", shownAlignment: null, behaviorMode: "marionette_fake_good_behavior" });
    expect(kill(g, "p0")).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Imp -- one commit and Undo", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  it("death + Role change + step bookkeeping commit ONCE; Undo restores all of it", () => {
    const g = base();
    openInStore(g);
    const seen: unknown[] = [];
    const off = store.subscribe((next, prev) => { if (next.game !== prev.game) seen.push(next.game); });
    expect(store.getState().resolveAbility(request(g, "p0", "imp", { target: pick(g, "p0") }, { withStep: true, completeStep: true }))).toMatchObject({ ok: true, changed: true });
    off();
    expect(seen).toHaveLength(1);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().localSeq).toBe(6);
    store.getState().undo();
    // Phase 10H: every field restored exactly; a reverted visible identity
    // carries a freshly minted reveal token (contract §12.2).
    expect(withoutRevealTokens(store.getState().game)).toEqual(withoutRevealTokens(g));
  });
});
