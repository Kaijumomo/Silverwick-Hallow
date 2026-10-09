// Phase 10F Slice 7 -- Slayer (matrix Section 10). Production semantics.
import { beforeEach, describe, expect, it } from "vitest";
import { registersAsDemonJudgment } from "./slayer";
import { bind, protectionId, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, request, reseat, yes } from "@/test/proofFixtures";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";

// p0 slayer, p1 imp, p2 chef, p3 recluse, p4 monk, p5 poisoner, p6 empath
const ROLES = ["slayer", "imp", "chef", "recluse", "monk", "poisoner", "empath"];
const day = () => proofGame(ROLES, "day", 2);
const shoot = (g: StorytellerLobbyRecord, target: string, extra = {}) => plan(g, request(g, "p0", "slayer", { target: pick(g, target) }, extra));
const lifeOps = (result: ReturnType<typeof plan>) => result.ok && result.changed ? result.plan.outcome.operations : [];
const effect = (type: string): EffectRecord => ({ id: `fx-${type}`, type, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "day", day: 2 } } as EffectRecord);

describe("Slayer -- functioning", () => {
  it("the actual Demon dies; the use is spent in the SAME atomic Life transaction", () => {
    const g = day();
    const result = shoot(g, "p1");
    const next = planned(result);
    expect(next.players.p1!.alive).toBe(false);
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(lifeOps(result)).toEqual([{ domain: "life", intents: [{ kind: "useAbility", target: bind(g, "p0") }, { kind: "death", target: bind(g, "p1") }] }]);
    expect(result).toMatchObject({ plan: { needsConfirmation: true } });
  });

  it("a non-Demon does not die, but the use is spent (failed shot)", () => {
    const g = day();
    const next = planned(shoot(g, "p2"));
    expect(next.players.p2!.alive).toBe(true);
    expect(next.players.p0!.abilityUsed).toBe(true);
  });

  it("self-target is structurally allowed (spends the use, no death)", () => {
    const next = planned(shoot(day(), "p0"));
    expect(next.players.p0).toMatchObject({ alive: true, abilityUsed: true });
  });

  it("a dead Demon causes no death (use spent)", () => {
    const g = patchPlayer(day(), "p1", { alive: false });
    const result = shoot(g, "p1");
    expect(lifeOps(result)).toEqual([{ domain: "life", intents: [{ kind: "useAbility", target: bind(g, "p0") }] }]);
  });

  it("Recluse registration is the Storyteller's judgment (a Recluse may die to the Slayer)", () => {
    const g = day();
    const id = registersAsDemonJudgment(g.players.p3!.participantId!);
    expect(shoot(g, "p3")).toMatchObject({ ok: false, code: "unsupported" });
    expect(shoot(g, "p3", { judgments: { [id]: yes(true) } })).toMatchObject({ ok: false, code: "unsupported" });
    expect(shoot(g, "p3", { judgments: { [id]: yes(false) } })).toMatchObject({ ok: false, code: "unsupported" });
    expect(g.players.p0!.abilityUsed).toBe(false);
    expect(g.players.p3!.alive).toBe(true);
  });

  it("protection is queried for ANY death: known clear / known block / unknown -> judgment", () => {
    const immune = patchPlayer(day(), "p1", { effects: [effect("cannotDie")] });
    const blocked = planned(shoot(immune, "p1"));
    expect(blocked.players.p1!.alive).toBe(true);
    expect(blocked.players.p0!.abilityUsed).toBe(true);
    // Safe from the DEMON does not stop a Slayer shot.
    const monked = patchPlayer(day(), "p1", { effects: [effect("safeFromDemon")] });
    expect(planned(shoot(monked, "p1")).players.p1!.alive).toBe(false);
    // Generic Protected -> explicit judgment.
    const generic = patchPlayer(day(), "p1", { effects: [effect("protected")] });
    const id = protectionId(generic, "any", "p1");
    expect(shoot(generic, "p1")).toMatchObject({ ok: false, code: "unsupported" });
    expect(shoot(generic, "p1", { judgments: { [id]: yes(true) } })).toMatchObject({ ok: false, code: "unsupported" });
    expect(shoot(generic, "p1", { judgments: { [id]: yes(false) } })).toMatchObject({ ok: false, code: "unsupported" });
    expect(generic.players.p0!.abilityUsed).toBe(false);
  });
});

describe("Slayer -- impairment, usage and timing", () => {
  it("a drunk / poisoned living Slayer spends the use but cannot kill", () => {
    const g = impair(day(), "p0");
    const result = shoot(g, "p1");
    expect(lifeOps(result)).toEqual([{ domain: "life", intents: [{ kind: "useAbility", target: bind(g, "p0") }] }]);
    expect(planned(result).players.p1!.alive).toBe(true);
  });

  it("a dead Slayer cannot perform a real guided use", () => {
    const g = patchPlayer(day(), "p0", { alive: false });
    expect(shoot(g, "p1")).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a second use is rejected", () => {
    const g = patchPlayer(day(), "p0", { abilityUsed: true });
    expect(shoot(g, "p1")).toMatchObject({ ok: false, code: "notApplicable", message: expect.stringMatching(/already been used/) });
  });

  it("only during the Day, through the Day entry", () => {
    const n = proofGame(ROLES, "night", 2);
    expect(plan(n, request(n, "p0", "slayer", { target: pick(n, "p1") }, { invocationPath: "nightOrder" }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("stale target after seat reuse is refused", () => {
    const g = day();
    expect(plan(reseat(g, "p1"), request(g, "p0", "slayer", { target: pick(g, "p1") }))).toMatchObject({ ok: false, code: "stale" });
  });

  it("a homebrew Slayer reusing the official id inherits no semantics", () => {
    const g = day();
    expect(plan(g, request(g, "p0", "slayer", { target: pick(g, "p1") }), homebrewEnv("slayer"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("Slayer -- one commit and Undo", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
  it("use + death commit once; Undo restores both", () => {
    const g = day();
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "slayer", { target: pick(g, "p1") }))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().game!.players.p1!.alive).toBe(false);
    store.getState().undo();
    expect(store.getState().game!.players.p1!.alive).toBe(true);
    expect(store.getState().game!.players.p0!.abilityUsed).toBe(false);
  });
});
