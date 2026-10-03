// Phase 10F Slice 7: the small GENERIC seams added for the proof characters,
// tested independently of any character (rules-neutral where possible).
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "./rulesQuery";
import { composeAbilityOutcome, planAbilityResolution } from "./abilityResolution";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { changeRoleIntent, setPerceptionIntent } from "./roleResolution";
import { bind, patchPlayer, pick, proofEnv, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import type { EffectRecord, StorytellerLobbyRecord } from "./types";

const q = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });

describe("allowNone participant requirements", () => {
  const fixture = (allowNone: boolean): AbilitySemanticsRegistry => new Map([["chef", {
    roleId: "chef", timing: ["otherNight"], invocation: "wake", usage: { kind: "unlimited" }, hooks: [],
    inputs: [{ id: "who", kind: "participant", source: "player", count: 2, ...(allowNone ? { allowNone } : {}), label: "who" }],
    presentation: { complexity: "complex", action: "x" },
    evaluator: () => ({ kind: "outcome", outcome: { operations: [] } }),
  } satisfies AbilityDescriptor]]);
  const g = proofGame(["chef", "monk", "imp"]);
  const none = { who: { kind: "participant" as const, participants: [] } };

  it("an empty answer is accepted only when the requirement allows NOBODY; otherwise exactly `count`", () => {
    expect(planAbilityResolution(g, request(g, "p0", "chef", none), proofEnv({ semantics: fixture(true) }))).toEqual({ ok: true, changed: false });
    expect(planAbilityResolution(g, request(g, "p0", "chef", none), proofEnv({ semantics: fixture(false) }))).toMatchObject({ ok: false, code: "invalid" });
    expect(planAbilityResolution(g, request(g, "p0", "chef", { who: pick(g, "p1") }), proofEnv({ semantics: fixture(true) }))).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("RulesQuery.assumingAlive -- hypothetical evolving Life state", () => {
  it("answers over the hypothetical state; the original query and game are untouched", () => {
    const g = proofGame(["monk", "chef", "imp"]);
    const query = q(g);
    const hypo = query.assumingAlive(bind(g, "p0"), false);
    expect(hypo.isAlive(bind(g, "p0"))).toEqual({ known: true, value: false });
    expect(query.isAlive(bind(g, "p0"))).toEqual({ known: true, value: true });
    expect(g.players.p0!.alive).toBe(true);
  });

  it("a sourced protection follows its source in the hypothetical state", () => {
    const g0 = proofGame(["monk", "chef", "imp"]);
    const g = patchPlayer(g0, "p1", { effects: [{ id: "s", type: "safeFromDemon", sourceCharacter: "monk", lifetime: { kind: "untilDawn" }, state: "active",
      sourceParticipant: { kind: "participant", participantId: g0.players.p0!.participantId!, playerId: "p0", nameAtTime: "Player 0" },
      expiry: { kind: "at", moment: { phase: "day", day: 2 } }, appliedAt: { phase: "night", day: 2 } } as EffectRecord] });
    expect(q(g).protectedFrom(bind(g, "p1"), "demon")).toEqual({ known: true, value: true });
    expect(q(g).assumingAlive(bind(g, "p0"), false).protectedFrom(bind(g, "p1"), "demon")).toEqual({ known: true, value: false });
  });

  it("a stale binding leaves the query unchanged", () => {
    const g = proofGame(["monk", "chef"]);
    const query = q(g);
    expect(query.assumingAlive({ playerId: "p0", participantId: "someone-else" }, false)).toBe(query);
  });
});

describe("Role chains: a perception update with its Role change is not a chain", () => {
  it("change + setPerception for one participant composes; two Actual Role changes are still refused", () => {
    const g = proofGame(["poisoner", "chef", "imp"]);
    const p = g.players.p0!;
    const env = proofEnv();
    const ok = composeAbilityOutcome(g, { operations: [{ domain: "role", intents: [changeRoleIntent(p, "imp"),
      setPerceptionIntent(p, { shownRole: "imp", shownAlignment: p.shownAlignment })] }] }, env, { resolutionId: "r" });
    expect(ok).toMatchObject({ ok: true, changed: true });
    if (ok.ok && ok.changed) expect(ok.plan.game.players.p0).toMatchObject({ actualRole: "imp", shownRole: "imp" });
    const chain = composeAbilityOutcome(g, { operations: [{ domain: "role", intents: [changeRoleIntent(p, "imp")] },
      { domain: "role", intents: [changeRoleIntent({ ...p, actualRole: "imp" }, "spy")] }] }, env, { resolutionId: "r" });
    expect(chain).toMatchObject({ ok: false, code: "unsupported" });
  });
});
