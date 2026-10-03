// Phase 10F Slice 7 -- Al-Hadikhia (matrix Section 13, with the corrected
// rule: every Al-Hadikhia death is Demon-caused -> protectedFrom(.., "demon")).
import { beforeEach, describe, expect, it } from "vitest";
import { choiceId } from "./alhadikhia";
import { protectionJudgmentId } from "./shared";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, request, requirementIds, reseat, yes } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";

// p0 al-hadikhia, p1 chef, p2 monk, p3 empath, p4 saint, p5 poisoner, p6 washerwoman
const ROLES = ["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];
const base = () => proofGame(ROLES);
const LIVE = true, DIE = false;
function choices(g: StorytellerLobbyRecord, ids: string[], picks: boolean[]): Record<string, AbilityInputValue> {
  return { chosen: pick(g, ...ids), ...Object.fromEntries(picks.map((value, index) => [choiceId(index), yes(value)])) };
}
const run = (g: StorytellerLobbyRecord, ids: string[], picks: boolean[], extra = {}) => plan(g, request(g, "p0", "alhadikhia", choices(g, ids, picks), extra));
const intents = (result: ReturnType<typeof plan>) => result.ok && result.changed
  ? result.plan.outcome.operations.flatMap((o) => (o.domain === "life" ? o.intents.map((i) => `${i.kind}:${i.target.playerId}`) : [])) : [];
/** A Monk-sourced Safe from the Demon on `id` (the Monk is p2). */
const monkSafe = (g: StorytellerLobbyRecord, id: string): StorytellerLobbyRecord => patchPlayer(g, id, { effects: [{
  id: `safe-${id}`, type: "safeFromDemon", sourceCharacter: "monk", lifetime: { kind: "untilDawn" }, state: "active",
  sourceParticipant: { kind: "participant", participantId: g.players.p2!.participantId!, playerId: "p2", nameAtTime: "Player 2" },
  expiry: { kind: "at", moment: { phase: "day", day: 2 } }, appliedAt: { phase: "night", day: 2 } } as EffectRecord] });

describe("Al-Hadikhia -- choosing", () => {
  it("chooses nobody: no Life change, no announcement record; the step may complete", () => {
    const g = base();
    const nobody = { chosen: { kind: "participant" as const, participants: [] } };
    expect(plan(g, request(g, "p0", "alhadikhia", nobody))).toEqual({ ok: true, changed: false });
    const step = planned(plan(g, request(g, "p0", "alhadikhia", nobody, { withStep: true, completeStep: true })));
    expect(step.players).toBe(g.players);
    expect(step.informationDeliveries).toEqual([]);
  });

  it("exactly three distinct participants (or nobody) -- never one or two, never a repeat", () => {
    const g = base();
    expect(plan(g, request(g, "p0", "alhadikhia", { chosen: pick(g, "p1", "p2") }))).toMatchObject({ ok: false, code: "invalid" });
    expect(plan(g, request(g, "p0", "alhadikhia", { chosen: pick(g, "p1", "p1", "p2") }))).toMatchObject({ ok: false, code: "illegal" });
  });

  it("asks each player's live/die choice in order, one at a time", () => {
    const g = base();
    expect(requirementIds(plan(g, request(g, "p0", "alhadikhia", { chosen: pick(g, "p1", "p2", "p3") })))).toEqual([choiceId(0)]);
    expect(requirementIds(plan(g, request(g, "p0", "alhadikhia", { chosen: pick(g, "p1", "p2", "p3"), [choiceId(0)]: yes(DIE) })))).toEqual([choiceId(1)]);
  });
});

describe("Al-Hadikhia -- resolution", () => {
  it("all three choose to die: three Demon-caused deaths, in order", () => {
    const result = run(base(), ["p1", "p2", "p3"], [DIE, DIE, DIE]);
    expect(intents(result)).toEqual(["death:p1", "death:p2", "death:p3"]);
    expect(result).toMatchObject({ plan: { needsConfirmation: true } });
  });

  it("mixed choices: the dying die, the living live (not all alive -> no further deaths)", () => {
    expect(intents(run(base(), ["p1", "p2", "p3"], [LIVE, DIE, LIVE]))).toEqual(["death:p2"]);
  });

  it("a dead player who chooses to live is resurrected", () => {
    const g = patchPlayer(base(), "p1", { alive: false });
    const result = run(g, ["p1", "p2", "p3"], [LIVE, DIE, DIE]);
    expect(intents(result)).toEqual(["resurrection:p1", "death:p2", "death:p3"]);
    expect(planned(result).players.p1!.alive).toBe(true);
  });

  it("a dead player who chooses to die stays dead (no event)", () => {
    const g = patchPlayer(base(), "p1", { alive: false });
    expect(intents(run(g, ["p1", "p2", "p3"], [DIE, LIVE, LIVE]))).toEqual([]);
  });

  it("all choose to live -> all die, 1 -> 2 -> 3, in ONE ordered Life transaction (declared order preserved)", () => {
    expect(intents(run(base(), ["p1", "p2", "p3"], [LIVE, LIVE, LIVE]))).toEqual(["death:p1", "death:p2", "death:p3"]);
    expect(intents(run(base(), ["p3", "p1", "p2"], [LIVE, LIVE, LIVE]))).toEqual(["death:p3", "death:p1", "death:p2"]);
  });

  it("resurrected-then-all-alive: the same participant is resurrected and then dies, in order", () => {
    const g = patchPlayer(base(), "p1", { alive: false });
    const result = run(g, ["p1", "p3", "p4"], [LIVE, LIVE, LIVE]);
    expect(intents(result)).toEqual(["resurrection:p1", "death:p1", "death:p3", "death:p4"]);
    expect(planned(result).players.p1!.alive).toBe(false);
  });

  it("Monk-safe: a 'die' choice does not kill, and the protected player COUNTS AS ALIVE for the all-live test", () => {
    const g = monkSafe(base(), "p1");
    // p1 chose die but is protected (alive); p3, p4 chose live -> all alive -> all die except the protected one.
    expect(intents(run(g, ["p1", "p3", "p4"], [DIE, LIVE, LIVE]))).toEqual(["death:p3", "death:p4"]);
  });

  it("individual protection during the final all-live deaths", () => {
    const g = monkSafe(base(), "p4");
    expect(intents(run(g, ["p1", "p3", "p4"], [LIVE, LIVE, LIVE]))).toEqual(["death:p1", "death:p3"]);
  });

  it("evolving state: a Monk who dies earlier in the sequence no longer protects a later player", () => {
    const g = monkSafe(base(), "p3");
    // p2 (the Monk) chooses to die first -> dies -> p3's Safe from the Demon stops applying.
    expect(intents(run(g, ["p2", "p3", "p4"], [DIE, DIE, LIVE]))).toEqual(["death:p2", "death:p3"]);
    // Order matters: if p3 decides first, the Monk is still alive and protecting.
    expect(intents(run(g, ["p3", "p2", "p4"], [DIE, DIE, LIVE]))).toEqual(["death:p2"]);
  });

  it("Demon-caused: protection is queried for 'demon' -- unknown -> judgment", () => {
    const g = patchPlayer(base(), "p1", { effects: [{ id: "gp", type: "protected", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as EffectRecord] });
    const id = protectionJudgmentId("demon", bind(g, "p1"));
    expect(requirementIds(run(g, ["p1", "p2", "p3"], [DIE, DIE, DIE]))).toEqual([id]);
    expect(intents(run(g, ["p1", "p2", "p3"], [DIE, DIE, DIE], { judgments: { [id]: yes(true) } }))).toEqual(["death:p2", "death:p3"]);
  });

  it("an impaired Al-Hadikhia: choices only, no Life change", () => {
    expect(run(impair(base(), "p0"), ["p1", "p2", "p3"], [DIE, DIE, DIE])).toEqual({ ok: true, changed: false });
  });

  it("Each night*: not on Night 1", () => {
    const g = proofGame(ROLES, "night", 1);
    expect(run(g, ["p1", "p2", "p3"], [DIE, DIE, DIE])).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a participant replaced during the multi-step workflow makes the whole resolution stale", () => {
    const g = base();
    const req = request(g, "p0", "alhadikhia", choices(g, ["p1", "p2", "p3"], [DIE, DIE, DIE]));
    expect(plan(reseat(g, "p2"), req)).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew Al-Hadikhia reusing the official id inherits no semantics", () => {
    const g = base();
    expect(plan(g, request(g, "p0", "alhadikhia", choices(g, ["p1", "p2", "p3"], [DIE, DIE, DIE])), homebrewEnv("alhadikhia"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Al-Hadikhia -- one commit and Undo", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  it("the whole ordered outcome commits once and Undo restores it", () => {
    const g = base();
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "alhadikhia", choices(g, ["p1", "p2", "p3"], [LIVE, LIVE, LIVE])))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().localSeq).toBe(6);
    expect(["p1", "p2", "p3"].map((id) => store.getState().game!.players[id]!.alive)).toEqual([false, false, false]);
    store.getState().undo();
    expect(store.getState().game).toEqual(g);
  });
});
