// Phase 10F: the Rules Query layer -- pure DERIVED answers, never persisted,
// with explicit unknown/judgment answers for custom, cyclic or unmodeled
// interactions. Traceability: 10F-AC-12, 10F-AC-13, 10F-AC-14.
import { describe, expect, it } from "vitest";
import { bindingOf, createRulesQuery, effectSemanticsOf } from "./rulesQuery";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import type { AbilityDescriptor, AbilitySemanticsRegistry } from "@/abilities/semantics";
import type { EffectRecord, ParticipantRef, StorytellerLobbyRecord } from "./types";

const registry = buildRegistry(setupScript);
const ROLES = ["washerwoman", "chef", "empath", "monk", "spy", "poisoner", "imp"];
function game(): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 2 });
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  return g;
}
const effect = (over: Partial<EffectRecord> & Pick<EffectRecord, "id" | "type">): EffectRecord =>
  ({ lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, ...over });
const ref = (g: StorytellerLobbyRecord, id: string): ParticipantRef =>
  ({ kind: "participant", participantId: g.players[id]!.participantId!, playerId: id, nameAtTime: g.players[id]!.name });
const q = (g: StorytellerLobbyRecord, semantics?: AbilitySemanticsRegistry) =>
  createRulesQuery(g, { registry, script: setupScript, modifiers: [], ...(semantics ? { semantics } : {}) });
const b = (g: StorytellerLobbyRecord, id: string) => bindingOf(g.players[id]!);

describe("10F-AC-14: protection types stay distinct", () => {
  it("safeFromDemon protects against the Demon only; cannotDie against any death; generic Protected decides nothing", () => {
    const g = game();
    g.players.p0 = { ...g.players.p0!, effects: [effect({ id: "a", type: "safeFromDemon" })] };
    g.players.p1 = { ...g.players.p1!, effects: [effect({ id: "b", type: "cannotDie" })] };
    g.players.p2 = { ...g.players.p2!, effects: [effect({ id: "c", type: "protected" })] };
    const query = q(g);
    expect(query.protectedFrom(b(g, "p0"), "demon")).toEqual({ known: true, value: true });
    expect(query.protectedFrom(b(g, "p0"), "any")).toEqual({ known: true, value: false });
    expect(query.protectedFrom(b(g, "p1"), "any")).toEqual({ known: true, value: true });
    expect(query.protectedFrom(b(g, "p2"), "demon")).toMatchObject({ known: false });
    expect(query.protectedFrom(b(g, "p2"), "any")).toMatchObject({ known: false });
    expect(query.protectedFrom(b(g, "p3"), "demon")).toEqual({ known: true, value: false });
  });
});

describe("10F-AC-12 / AC-13: impairment and applicability are derived, never cached", () => {
  it("manual Drunk/Poisoned impair; suppressed never applies; a custom type has no rule by name", () => {
    const g = game();
    g.players.p0 = { ...g.players.p0!, effects: [effect({ id: "manual:poisoned", type: "poisoned" })] };
    g.players.p1 = { ...g.players.p1!, effects: [effect({ id: "manual:drunk", type: "drunk", state: "suppressed" })] };
    g.players.p2 = { ...g.players.p2!, effects: [effect({ id: "x", type: "poisonish" })] };
    g.players.p3 = { ...g.players.p3!, effects: [effect({ id: "y", type: "abilityLost" })] };
    const before = structuredClone(g);
    const query = q(g);
    expect(query.impaired(b(g, "p0"))).toEqual({ known: true, value: true });
    expect(query.abilityFunctions(b(g, "p0"))).toEqual({ known: true, value: false });
    expect(query.impaired(b(g, "p1"))).toEqual({ known: true, value: false });
    expect(query.effectApplies(b(g, "p2"), g.players.p2!.effects[0]!)).toMatchObject({ known: false });
    expect(query.abilityFunctions(b(g, "p2"))).toEqual({ known: true, value: true }); // custom types never impair by name
    expect(query.abilityFunctions(b(g, "p3"))).toEqual({ known: true, value: false });
    expect(effectSemanticsOf("poisonish")).toBeUndefined();
    expect(effectSemanticsOf("toString")).toBeUndefined();
    expect(g).toEqual(before); // nothing derived was written anywhere
  });

  it("a sourced Effect follows its source only as DECLARED; undeclared is unknown; dependency cycles fail safe to unknown", () => {
    const g = game();
    // Chef poisoned by the Poisoner (p5); the Poisoner poisoned by the Chef.
    g.players.p1 = { ...g.players.p1!, effects: [effect({ id: "e1", type: "poisoned", sourceParticipant: ref(g, "p5"), sourceCharacter: "poisoner" })] };
    g.players.p5 = { ...g.players.p5!, effects: [effect({ id: "e2", type: "poisoned", sourceParticipant: ref(g, "p1"), sourceCharacter: "poisoner" })] };
    expect(q(g).impaired(b(g, "p1"))).toMatchObject({ known: false }); // undeclared persistence
    const fixture = (persistence: "independent" | "whileSourceFunctions"): AbilitySemanticsRegistry => new Map([["poisoner", {
      roleId: "poisoner", timing: ["otherNight"], invocation: "wake", usage: { kind: "unlimited" }, inputs: [], hooks: [],
      sourcedEffects: [{ type: "poisoned", persistence }], presentation: { complexity: "simple", action: "fixture" },
    } satisfies AbilityDescriptor]]);
    expect(q(g, fixture("independent")).impaired(b(g, "p1"))).toEqual({ known: true, value: true });
    // whileSourceFunctions: p1's poison depends on p5 functioning, which
    // depends on p5's poison, which depends on p1 -- a cycle -> unknown.
    expect(q(g, fixture("whileSourceFunctions")).impaired(b(g, "p1"))).toMatchObject({ known: false, reason: expect.stringMatching(/depend on each other/) });
    // Break the cycle: the source is healthy -> the poison applies.
    const healthy = { ...g, players: { ...g.players, p5: { ...g.players.p5!, effects: [] } } };
    expect(q(healthy, fixture("whileSourceFunctions")).impaired(b(healthy, "p1"))).toEqual({ known: true, value: true });
    // The source died -> it no longer functions -> the poison stops applying.
    const dead = { ...healthy, players: { ...healthy.players, p5: { ...healthy.players.p5!, alive: false } } };
    expect(q(dead, fixture("whileSourceFunctions")).impaired(b(dead, "p1"))).toEqual({ known: true, value: false });
  });

  it("a stale binding answers unknown, never another occupant's state", () => {
    const g = game();
    expect(q(g).isAlive({ playerId: "p0", participantId: "someone-else" })).toMatchObject({ known: false });
    expect(q(g).participant({ playerId: "toString", participantId: "x" })).toBeNull();
  });
});

describe("registration, neighbours and in-play queries", () => {
  it("registration is known only when nothing could alter it; a self-misregistering character is a judgment", () => {
    const g = game();
    const query = q(g);
    expect(query.registration(b(g, "p1"))).toEqual({ character: { known: true, value: "chef" }, alignment: { known: true, value: "good" } });
    expect(query.registration(b(g, "p4")).character).toMatchObject({ known: false }); // Spy
    g.players.p2 = { ...g.players.p2!, effects: [effect({ id: "r", type: "registersFalsely" })] };
    expect(q(g).registration(b(g, "p2")).alignment).toMatchObject({ known: false });
    // A homebrew character's registration is the Storyteller's decision.
    const hb = { ...g, players: { ...g.players, p0: { ...g.players.p0!, actualRole: "no-such-role" } } };
    expect(q(hb).registration(b(hb, "p0")).character).toMatchObject({ known: false });
  });

  it("alive neighbours skip the dead and empty seats around the ring", () => {
    const g = game();
    g.players.p1 = { ...g.players.p1!, alive: false };
    g.players.p6 = { ...g.players.p6!, isEmpty: true };
    delete g.players.p6!.participantId;
    const answer = q(g).aliveNeighbours(b(g, "p0"));
    expect(answer).toEqual({ known: true, value: { left: b(g, "p5"), right: b(g, "p2") } });
    expect(q(g).inPlay("imp")).toEqual([]); // the Imp's seat is empty now
    expect(q(g).inPlay("chef")).toEqual([b(g, "p1")]);
  });
});
