// Phase 10F, Slice 3: the pure ability coordinator (PHASE10F Sections 3-5,
// 7, 12, 14). Rules-neutral fixtures only (src/test/abilityFixtures.ts) --
// no production character semantics are exercised or implied.
// Traceability: 10F-AC-01, 03..08, 10..14, 17, 18, 23..25, 33.
import { describe, expect, it } from "vitest";
import {
  captureFingerprint,
  composeAbilityOutcome,
  planAbilityResolution,
  type AbilityEnvironment,
  type AbilityOutcome,
  type AbilityResolutionRequest,
  type ParticipantBinding,
} from "./abilityResolution";
import { activeModifiers, type ModifierDefinition } from "@/abilities/modifiers";
import { resolveAbilitySemantics, type AbilityDescriptor, type AbilityInputs } from "@/abilities/semantics";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { FIXTURE_SEMANTICS } from "@/test/abilityFixtures";
import type { LifeIdSource } from "./lifeResolution";
import type { Script, StorytellerLobbyRecord } from "./types";

const registry = buildRegistry(setupScript);
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];

function game(phase: "night" | "day" = "night", day = 2, over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase, day, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  g.players.p6 = { ...g.players.p6!, shownRole: "empath", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" };
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  return g;
}
/** The game with seat `id` now holding Actual Role `roleId` (fixture-only). */
const withRole = (g: StorytellerLobbyRecord, id: string, roleId: string): StorytellerLobbyRecord =>
  ({ ...g, players: { ...g.players, [id]: { ...g.players[id]!, actualRole: roleId } } });
const withParticipant = (g: StorytellerLobbyRecord, id: string, participantId: string): StorytellerLobbyRecord =>
  ({ ...g, players: { ...g.players, [id]: { ...g.players[id]!, participantId } } });
const bind = (g: StorytellerLobbyRecord, id: string): ParticipantBinding => ({ playerId: id, participantId: g.players[id]!.participantId! });
const pick = (g: StorytellerLobbyRecord, id: string) => ({ kind: "participant" as const, participants: [bind(g, id)] });
let counter = 0;
const counterIds = (): AbilityEnvironment["ids"] => {
  let e = 0, h = 0, d = 0, x = 0, r = 0, p = 0;
  return {
    life: { eventId: () => `le-${++e}`, historyId: () => `hl-${++h}` },
    effect: { effectId: () => `fx-${++x}`, historyId: () => `he-${++h}` },
    reminder: { reminderId: () => `rm-${++r}`, historyId: () => `hr-${++h}` },
    role: { historyId: () => `hro-${++h}`, packetEpoch: () => `ep-${++p}` },
    alignment: { historyId: () => `ha-${++h}`, packetEpoch: () => `ep-${++p}` },
    deliveryId: () => `d-${++d}`,
    resolutionId: () => `res-${++counter}`,
  };
};
/** Explicitly NO active modifiers unless a test supplies them (the jinx /
 * Fabled tests compute them from the game). */
const env = (over: Partial<AbilityEnvironment> = {}): AbilityEnvironment =>
  ({ script: setupScript, registry, semantics: FIXTURE_SEMANTICS, ids: counterIds(), modifiers: [], ...over });
/** The game's own active modifiers (its Fabled / Lorics and represented jinxes). */
const fabledOf = (g: StorytellerLobbyRecord) => env({ modifiers: activeModifiers(g, registry) });
function guided(g: StorytellerLobbyRecord, actor: string, roleId: string, inputs: AbilityInputs = {}, extra: Partial<AbilityResolutionRequest> = {}): AbilityResolutionRequest {
  // SOL-10F-L3-R1: the generic path for the phase (Night Order / Day entry).
  const invocationPath = g.phase === "day" ? "dayEntry" : "nightOrder";
  return { mode: "guided", invocationPath, fingerprint: captureFingerprint(g, actor)!, roleId, inputs, ...extra } as AbilityResolutionRequest;
}
const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

describe("10F-AC-24 / AC-33: semantics attach only through canonical ownership", () => {
  it("canonical definition + verified semantics -> supported; canonical without semantics -> unsupported", () => {
    expect(resolveAbilitySemantics("monk", registry, FIXTURE_SEMANTICS).kind).toBe("supported");
    expect(resolveAbilitySemantics("washerwoman", registry, FIXTURE_SEMANTICS)).toMatchObject({ kind: "unsupported", reason: "noSemantics" });
    expect(resolveAbilitySemantics("no-such-role", registry, FIXTURE_SEMANTICS)).toMatchObject({ kind: "unsupported", reason: "unknownRole" });
  });

  it("a homebrew character reusing an official RoleId inherits NO semantics (and the coordinator sends it to Manual)", () => {
    const monk = registry.get("monk")!;
    const homebrew: Script = { id: "hb", name: "Homebrew", characters: [
      { ...monk, ability: "Each night*, choose a player: something homebrew happens.", provenance: { status: "homebrew" } },
      ...setupScript.characters.filter((r) => r.id !== "monk"),
    ] };
    const hbRegistry = buildRegistry(homebrew);
    expect(resolveAbilitySemantics("monk", hbRegistry, FIXTURE_SEMANTICS).kind).toBe("homebrew");
    // Same id, modified text but stale "official" provenance: still not canonical.
    const forged: Script = { ...homebrew, characters: [{ ...monk, ability: "Changed." }, ...homebrew.characters.slice(1)] };
    expect(resolveAbilitySemantics("monk", buildRegistry(forged), FIXTURE_SEMANTICS).kind).toBe("homebrew");
    const g = game();
    const result = planAbilityResolution(g, guided(g, "p0", "monk", { target: pick(g, "p2") }), env({ script: homebrew, registry: hbRegistry }));
    expect(result).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("10F-AC-10 / AC-31: a simple target -> Effect ability", () => {
  it("plans one Effect with origin and correlation; pure and deterministic", () => {
    const g = deepFreeze(game());
    const request = guided(g, "p0", "monk", { target: pick(g, "p2") }, { resolutionId: "res-fixed" });
    const a = planAbilityResolution(g, request, env());
    const b = planAbilityResolution(g, request, env());
    expect(a).toEqual(b);
    expect(a).toMatchObject({ ok: true, changed: true });
    if (!a.ok || !a.changed) return;
    expect(a.plan.needsConfirmation).toBe(false); // one participant, no judgment
    expect(a.plan.game.players.p2!.effects).toEqual([expect.objectContaining({ id: "fx-1", type: "marked", sourceCharacter: "monk",
      sourceParticipant: expect.objectContaining({ participantId: g.players.p0!.participantId }) })]);
    expect(a.plan.game.history.at(-1)).toMatchObject({ category: "effect", resolutionId: "res-fixed" });
    expect(g.players.p2!.effects).toEqual([]); // input untouched (deep-frozen)
  });

  it("input structure: missing -> needsInput; stale binding -> stale; violated constraint -> illegal; malformed -> invalid", () => {
    const g = game();
    expect(planAbilityResolution(g, guided(g, "p0", "monk", {}), env())).toMatchObject({ ok: false, code: "needsInput", requirements: [{ id: "target" }] });
    expect(planAbilityResolution(g, guided(g, "p0", "monk", { target: { kind: "participant", participants: [{ playerId: "p2", participantId: "someone-else" }] } }), env()))
      .toMatchObject({ ok: false, code: "stale" });
    expect(planAbilityResolution(g, guided(g, "p0", "monk", { target: pick(g, "p0") }), env())).toMatchObject({ ok: false, code: "illegal" });
    const dead = { ...g, players: { ...g.players, p2: { ...g.players.p2!, alive: false } } };
    expect(planAbilityResolution(dead, guided(dead, "p0", "monk", { target: pick(dead, "p2") }), env())).toMatchObject({ ok: false, code: "illegal" });
    expect(planAbilityResolution(g, guided(g, "p0", "monk", { target: { kind: "number", value: 2 } }), env())).toMatchObject({ ok: false, code: "invalid" });
  });

  it("timing / ownership: wrong phase -> notApplicable; someone else's ability -> invalid; descriptor without evaluator -> unsupported", () => {
    const day = game("day");
    expect(planAbilityResolution(day, guided(day, "p0", "monk", { target: pick(day, "p2") }), env())).toMatchObject({ ok: false, code: "notApplicable" });
    const g = game();
    expect(planAbilityResolution(g, guided(g, "p2", "monk", { target: pick(g, "p3") }), env())).toMatchObject({ ok: false, code: "invalid" });
    const first = game("night", 1);
    expect(planAbilityResolution(first, guided(first, "p5", "chef"), env())).toMatchObject({ ok: false, code: "unsupported" });
  });
});

describe("10F-AC-07 / AC-08: stale workflow and participant bindings", () => {
  it("every fingerprint field is revalidated before planning", () => {
    const g = game();
    const request = guided(g, "p0", "monk", { target: pick(g, "p2") });
    const stale = (changed: StorytellerLobbyRecord) => expect(planAbilityResolution(changed, request, env())).toMatchObject({ ok: false, code: "stale" });
    stale({ ...g, players: { ...g.players, p0: { ...g.players.p0!, participantId: "new-occupant" } } }); // seat reused
    stale({ ...g, players: { ...g.players, p0: { ...g.players.p0!, actualRole: "chef" } } });
    stale({ ...g, players: { ...g.players, p0: { ...g.players.p0!, shownRole: "chef" } } });
    stale({ ...g, players: { ...g.players, p0: { ...g.players.p0!, abilityUsed: true } } });
    stale({ ...g, day: 3 });
    stale({ ...g, phase: "day" });
    const withStep = guided(g, "p0", "monk", { target: pick(g, "p2") }, { fingerprint: captureFingerprint(g, "p0", { day: 2, stepKey: "p:x:monk" })! });
    const done = { ...g, nightProgress: { "2:p:x:monk": { status: "done" as const, notes: "" } } };
    expect(planAbilityResolution(done, withStep, env())).toMatchObject({ ok: false, code: "stale" });
  });

  it("a Life binding whose seat was reused refuses the WHOLE resolution (H-06), nothing planned", () => {
    const g = game("day");
    const reused = { ...g, players: { ...g.players, p2: { ...g.players.p2!, participantId: "replacement" } } };
    const outcome: AbilityOutcome = { operations: [{ domain: "life", intents: [{ kind: "death", target: bind(g, "p2") }] }] };
    expect(composeAbilityOutcome(reused, outcome, env(), { resolutionId: "r" })).toMatchObject({ ok: false, code: "stale", operationIndex: 0, intentIndex: 0 });
  });
});

describe("10F-AC-01 / AC-03 / AC-04 / AC-05 / AC-06: composition", () => {
  it("each operation observes the snapshot produced by the preceding ones (evolving working snapshot)", () => {
    const g = game("day");
    const p2 = bind(g, "p2");
    // death then resurrection of the same participant in separate operations:
    // the resurrection is only legal because it sees the death.
    const outcome: AbilityOutcome = { operations: [
      { domain: "life", intents: [{ kind: "death", target: p2 }] },
      { domain: "life", intents: [{ kind: "resurrection", target: p2 }] },
    ] };
    const result = composeAbilityOutcome(g, outcome, env(), { resolutionId: "r" });
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    expect(result.plan.game.lifeEventWindow.events.map((e) => e.kind)).toEqual(["death", "resurrection"]);
    expect(result.plan.game.players.p2!.alive).toBe(true);
  });

  it("any refusing sub-plan refuses everything (atomic), preserving domain / code / indices", () => {
    const g = game("day");
    const outcome: AbilityOutcome = { mechanicalOrder: "declared", operations: [
      { domain: "effect", intents: [{ kind: "apply", target: bind(g, "p2"), effect: { type: "marked", lifetime: { kind: "manual" } } }] },
      { domain: "life", intents: [{ kind: "death", target: bind(g, "p3") }, { kind: "death", target: bind(g, "p3") }] },
    ] };
    expect(composeAbilityOutcome(g, outcome, env(), { resolutionId: "r" }))
      .toMatchObject({ ok: false, code: "domain", domain: "life", domainCode: "refused", operationIndex: 1 });
  });

  it("there is NO generic mechanical order: multi-domain without a declared order is an incomplete definition", () => {
    const g = game();
    expect(planAbilityResolution(g, guided(g, "p3", "pithag", { target: pick(g, "p5") }), env())).toMatchObject({ ok: false, code: "unsupported" });
    const ordered = planAbilityResolution(g, guided(g, "p4", "imp", { target: pick(g, "p5") }), env());
    expect(ordered).toMatchObject({ ok: true, changed: true });
    if (!ordered.ok || !ordered.changed) return;
    expect(ordered.plan.game.players.p5).toMatchObject({ actualRole: "monk", alive: false });
    expect(ordered.plan.needsConfirmation).toBe(true); // Role + Life
    // Role, then Life, then notation -- in the declared order, correlated by
    // one resolution id (Life correlates through its Life Event, per 10A).
    const added = ordered.plan.game.history.slice(g.history.length);
    expect(added.map((h) => h.category)).toEqual(["role", "life", "reminder"]);
    expect(added.filter((h) => h.category !== "life").every((h) => h.resolutionId === ordered.plan.resolutionId)).toBe(true);
    expect(ordered.plan.game.lifeEventWindow.events.at(-1)!.resolutionId).toBe(ordered.plan.resolutionId);
  });

  it("bookkeeping may only follow the resolved mechanics", () => {
    const g = game();
    const outcome: AbilityOutcome = { operations: [
      { domain: "reminder", intents: [{ kind: "place", target: bind(g, "p2"), reminder: { label: "x" } }] },
      { domain: "effect", intents: [{ kind: "apply", target: bind(g, "p2"), effect: { type: "marked", lifetime: { kind: "manual" } } }] },
    ] };
    expect(composeAbilityOutcome(g, outcome, env(), { resolutionId: "r" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("a same-participant Role chain is refused as unsupported, never collapsed", () => {
    const g = game();
    const p5 = g.players.p5!;
    const change = (to: string, from: string) => ({ kind: "changeActualRole" as const, target: bind(g, "p5"), expectedActualRole: from, expectedIsTraveler: p5.isTraveler, actualRole: to });
    const outcome: AbilityOutcome = { operations: [{ domain: "role", intents: [change("monk", "chef")] }, { domain: "role", intents: [change("empath", "monk")] }] };
    expect(composeAbilityOutcome(g, outcome, env(), { resolutionId: "r" })).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("the composed snapshot must pass the authoritative persisted schema (invalidComposition)", () => {
    const g = game("day");
    // Two Life operations whose id source repeats an event id: each planner
    // accepts its own, the COMPOSED window holds a duplicate id.
    const dup: LifeIdSource = { eventId: () => "le-dup", historyId: (() => { let n = 0; return () => `h-${++n}`; })() };
    const outcome: AbilityOutcome = { operations: [
      { domain: "life", intents: [{ kind: "death", target: bind(g, "p2") }] },
      { domain: "life", intents: [{ kind: "death", target: bind(g, "p3") }] },
    ] };
    expect(composeAbilityOutcome(g, outcome, env({ ids: { ...counterIds(), life: dup } }), { resolutionId: "r" }))
      .toMatchObject({ ok: false, code: "invalidComposition" });
  });

  it("a true no-op changes nothing (same reference, changed: false)", () => {
    const g = game("day");
    const outcome: AbilityOutcome = { operations: [{ domain: "life", intents: [{ kind: "correctAbilityUsed", target: bind(g, "p1"), used: false }] }] };
    expect(composeAbilityOutcome(g, outcome, env(), { resolutionId: "r" })).toEqual({ ok: true, changed: false });
    expect(composeAbilityOutcome(g, { operations: [] }, env(), { resolutionId: "r" })).toEqual({ ok: true, changed: false });
  });

  it("step completion joins the SAME final snapshot", () => {
    const g = game();
    const request = guided(g, "p0", "monk", { target: pick(g, "p2") },
      { fingerprint: captureFingerprint(g, "p0", { day: 2, stepKey: `p:${g.players.p0!.participantId}:monk` })!, completeStep: true });
    const result = planAbilityResolution(g, request, env());
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    expect(result.plan.game.nightProgress[`2:p:${g.players.p0!.participantId}:monk`]).toEqual({ status: "done", notes: "" });
    expect(result.plan.game.players.p2!.effects).toHaveLength(1);
  });
});

describe("10F-AC-15: once-per-game use commits with its outcome", () => {
  it("use + outcome in one Life transaction; an already-used ability is notApplicable", () => {
    const g = game("day");
    const result = planAbilityResolution(g, guided(g, "p1", "slayer", { target: pick(g, "p4") }), env());
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    expect(result.plan.game.players.p1!.abilityUsed).toBe(true);
    expect(result.plan.game.players.p4!.alive).toBe(false);
    const used = result.plan.game;
    expect(planAbilityResolution(used, guided(used, "p1", "slayer", { target: pick(used, "p5") }), env())).toMatchObject({ ok: false, code: "notApplicable" });
  });
});

describe("10F-AC-12 / AC-14: impairment and protection are derived, never guessed", () => {
  it("a manually poisoned actor creates no functioning outcome (only the use is recorded)", () => {
    const g = game("day");
    g.players.p1 = { ...g.players.p1!, effects: [{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }] };
    const result = planAbilityResolution(g, guided(g, "p1", "slayer", { target: pick(g, "p4") }), env());
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    expect(result.plan.game.players.p1!.abilityUsed).toBe(true);
    expect(result.plan.game.players.p4!.alive).toBe(true);
  });

  it("a mechanical outcome from an impaired actor is refused (illegal)", () => {
    const g = game();
    g.players.p4 = { ...g.players.p4!, effects: [{ id: "manual:drunk", type: "drunk", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }] };
    expect(planAbilityResolution(g, guided(g, "p4", "imp", { target: pick(g, "p5") }), env())).toMatchObject({ ok: false, code: "illegal" });
  });

  it("undeclared sourced impairment leaves the whole action manual even with a legacy judgment", () => {
    const g = game("day");
    const source = { kind: "participant" as const, participantId: g.players.p3!.participantId!, playerId: "p3", nameAtTime: "Player 3" };
    g.players.p1 = { ...g.players.p1!, effects: [{ id: "fx-src", type: "poisoned", sourceParticipant: source, sourceCharacter: "pithag", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }] };
    const ask = planAbilityResolution(g, guided(g, "p1", "slayer", { target: pick(g, "p4") }), env());
    expect(ask).toMatchObject({ ok: false, code: "unsupported" });
    const judged = planAbilityResolution(g, guided(g, "p1", "slayer", { target: pick(g, "p4") }, { judgments: { "actor:functioning": { kind: "boolean", value: true } } }), env());
    expect(judged).toMatchObject({ ok: false, code: "unsupported" });
    expect(g.players.p4!.alive).toBe(true);
  });

  it("a suppressed impairment never applies; an active custom Effect leaves automation manual", () => {
    const g = game("day");
    g.players.p1 = { ...g.players.p1!, effects: [
      { id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" }, state: "suppressed", expiry: { kind: "none" } },
      { id: "fx-c", type: "poisonedish", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } },
    ] };
    const result = planAbilityResolution(g, guided(g, "p1", "slayer", { target: pick(g, "p4") }), env());
    expect(result).toMatchObject({ ok: false, code: "unsupported" });
    g.players.p1.effects = g.players.p1.effects.filter(effect => effect.id !== "fx-c");
    expect(planAbilityResolution(g, guided(g, "p1", "slayer", { target: pick(g, "p4") }), env())).toMatchObject({ ok: true, changed: true });
  });
});

describe("10F-AC-18: a simulated wake has no ability", () => {
  it("a Drunk shown the Empath records a delivery with performedRole and Actual Role drunk -- no Current State", () => {
    const g = game();
    const result = planAbilityResolution(g, guided(g, "p6", "empath", { answer: { kind: "number", value: 2 } }), env());
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok || !result.changed) return;
    expect(result.plan.game.informationDeliveries).toEqual([expect.objectContaining({ actualRole: "drunk", performedRole: "empath", resolutionId: result.plan.resolutionId })]);
    expect(result.plan.game.players).toBe(g.players);
    expect(result.plan.game.history).toBe(g.history);
  });

  it("a simulated wake producing a mechanical operation is refused (illegal)", () => {
    const g = game();
    g.players.p6 = { ...g.players.p6!, shownRole: "imp" };
    expect(planAbilityResolution(g, guided(g, "p6", "imp", { target: pick(g, "p2") }), env())).toMatchObject({ ok: false, code: "illegal" });
  });
});

describe("10F-AC-23: modifiers gate only what they could affect", () => {
  it("an unverified Fabled reaching the ability's scope gates it; an unrelated one does not", () => {
    // (Slice 7: Toymaker now has a VERIFIED hook; Angel stays unverified with a death scope.)
    const toymaker = game("day", 2, { fabled: ["angel"] }); // death
    const ask = planAbilityResolution(toymaker, guided(toymaker, "p1", "slayer", { target: pick(toymaker, "p4") }), fabledOf(toymaker));
    expect(ask).toMatchObject({ ok: false, code: "unsupported" });
    const cleared = planAbilityResolution(toymaker, guided(toymaker, "p1", "slayer", { target: pick(toymaker, "p4") },
      { judgments: { "modifier:fabled:angel": { kind: "boolean", value: true } } }), fabledOf(toymaker));
    expect(cleared).toMatchObject({ ok: false, code: "unsupported" });
    const ferryman = game("day", 2, { fabled: ["ferryman"] }); // voting only
    expect(planAbilityResolution(ferryman, guided(ferryman, "p1", "slayer", { target: pick(ferryman, "p4") }), fabledOf(ferryman))).toMatchObject({ ok: true, changed: true });
  });

  it("Bootlegger-style global rules and an unknown custom Fabled gate everything", () => {
    for (const over of [{ lorics: ["bootlegger"] }, { fabled: ["homebrew-fabled"] }]) {
      const g = game("night", 2, over);
      expect(planAbilityResolution(g, guided(g, "p0", "monk", { target: pick(g, "p2") }), fabledOf(g))).toMatchObject({ ok: false, code: "unsupported" });
    }
  });

  it("jinx discovery stays scoped while unreviewed represented characters keep automation manual", () => {
    const g = withRole(game(), "p5", "leviathan");
    const modifiers = activeModifiers(g, registry);
    // Both Leviathan jinxes whose partners are seated (Monk, Pit-Hag) -- and only those.
    expect(modifiers.filter((m) => m.source === "jinx").map((m) => m.id).sort()).toEqual(["jinx:leviathan+monk", "jinx:leviathan+pithag"]);
    expect(planAbilityResolution(g, guided(g, "p0", "monk", { target: pick(g, "p2") }), env({ modifiers })))
      .toMatchObject({ ok: false, code: "unsupported" });
    // The Slayer is not a jinx endpoint, but Leviathan is outside the reviewed envelope.
    const day = withRole(game("day"), "p5", "leviathan");
    expect(planAbilityResolution(day, guided(day, "p1", "slayer", { target: pick(day, "p4") }), fabledOf(day))).toMatchObject({ ok: false, code: "unsupported" });
  });
  it("rules-neutral: a VERIFIED information modifier constrains another evaluator's delivered value", () => {
    const constrain: ModifierDefinition = { id: "fixture:information-constraint", source: "custom", label: "Fixture constraint", scopes: ["information"],
      hook: ({ roleId }) => roleId === "empath"
        ? { kind: "constrainInformation", requirementId: "evilNeighbors", allowed: [{ kind: "number", value: 0 }], reason: "The fixture modifier allows only 0." }
        : { kind: "noEffect" } };
    const g = game();
    const refused = planAbilityResolution(g, guided(g, "p2", "empath", { answer: { kind: "number", value: 1 } }), env({ modifiers: [constrain] }));
    expect(refused).toMatchObject({ ok: false, code: "illegal", message: "The fixture modifier allows only 0." });
    expect(planAbilityResolution(g, guided(g, "p2", "empath", { answer: { kind: "number", value: 0 } }), env({ modifiers: [constrain] })))
      .toMatchObject({ ok: true, changed: true });
    // An unrelated evaluator is untouched by it.
    expect(planAbilityResolution(g, guided(g, "p0", "monk", { target: pick(g, "p2") }), env({ modifiers: [constrain] }))).toMatchObject({ ok: true, changed: true });
  });
});

describe("10F-AC-11: the Manual / unmodeled-interaction path", () => {
  it("requires a stated reason, labels every record, always previews, and commits nothing on refusal", () => {
    const g = game("day");
    const outcome: AbilityOutcome = { operations: [{ domain: "life", intents: [{ kind: "death", target: bind(g, "p2") }] }] };
    expect(planAbilityResolution(g, { mode: "manual", outcome, reason: "  " }, env())).toMatchObject({ ok: false, code: "invalid" });
    const result = planAbilityResolution(g, { mode: "manual", outcome, reason: "Homebrew Fabled interaction", context: { provenance: { sourcePlayer: "p1", sourceCharacter: "slayer" } } }, env());
    expect(result).toMatchObject({ ok: true, changed: true, plan: { needsConfirmation: true } });
    if (!result.ok || !result.changed) return;
    expect(result.plan.game.history.at(-1)!.provenance).toMatchObject({ reason: "manual", note: "Homebrew Fabled interaction", sourceCharacter: "slayer" });
    expect(result.plan.game.lifeEventWindow.events.at(-1)!.provenance).toMatchObject({ reason: "manual" });
  });

  it("an unsupported / homebrew ability is never a dead end: the same primitives resolve it manually", () => {
    const g = game("night", 1);
    expect(planAbilityResolution(g, guided(g, "p5", "chef"), env())).toMatchObject({ ok: false, code: "unsupported" });
    const manual = planAbilityResolution(g, { mode: "manual", fingerprint: captureFingerprint(g, "p5")!, reason: "No modeled rule",
      outcome: { operations: [{ domain: "information", recipient: bind(g, "p5"), informationActionId: "chef-first-night", values: [{ requirementId: "pairs", kind: "number", value: 1 }] }] } }, env());
    expect(manual).toMatchObject({ ok: true, changed: true });
  });
});

describe("10F-AC-25: structured, non-throwing refusals for hostile input", () => {
  it.each([
    null, undefined, 7, "x", {}, { mode: "other" },
    { mode: "guided" }, { mode: "guided", fingerprint: null, roleId: "monk", inputs: {} },
    { mode: "manual", reason: "r" }, { mode: "manual", reason: "r", outcome: { operations: "x" } },
    { mode: "manual", reason: "r", outcome: { operations: [null] } },
    { mode: "manual", reason: "r", outcome: { operations: [{ domain: "life", intents: "x" }] } },
    { mode: "manual", reason: "r", outcome: { operations: [{ domain: "life", intents: [{ kind: "retractEvent", target: { playerId: "p1", participantId: "fixture-participant-p1" } }] }] } },
    { mode: "manual", reason: "r", outcome: { operations: [{ domain: "nope" }] } },
    { mode: "manual", reason: "r", resolutionId: "", outcome: { operations: [] } },
  ])("%j", (request) => {
    const g = game("day");
    let result: unknown;
    expect(() => { result = planAbilityResolution(g, request as never, env()); }).not.toThrow();
    expect(result).toMatchObject({ ok: false });
    expect(["invalid", "stale", "unsupported", "domain"]).toContain((result as { code: string }).code);
  });

  it("a guided request without its workflow fingerprint is malformed (invalid), not stale", () => {
    const g = game();
    expect(planAbilityResolution(g, { mode: "guided", roleId: "monk", inputs: {} } as never, env())).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("SOL-10F-L1: jinx activation uses authoritative REPRESENTED canonical characters", () => {
  const jinxIds = (g: StorytellerLobbyRecord, reg = registry) => activeModifiers(g, reg).filter((m) => m.source === "jinx").map((m) => m.id);

  it("1. both endpoints on the script but neither represented -> no jinx", () => {
    const g = withRole(game(), "p0", "chef"); // no Monk, no Leviathan seated; both are on the full canonical script
    expect(setupScript.characters.some((r) => r.id === "leviathan") && setupScript.characters.some((r) => r.id === "monk")).toBe(true);
    expect(jinxIds(g)).not.toContain("jinx:leviathan+monk");
  });

  it("2. the evaluated character represented, the other endpoint absent -> no gate", () => {
    const g = game();
    expect(jinxIds(g)).toEqual([]);
    expect(planAbilityResolution(g, guided(g, "p0", "monk", { target: pick(g, "p2") }), fabledOf(g))).toMatchObject({ ok: true, changed: true });
  });

  it("3. both canonical endpoints represented -> gate", () => {
    const g = withRole(game(), "p5", "leviathan");
    expect(jinxIds(g)).toContain("jinx:leviathan+monk");
    expect(planAbilityResolution(g, guided(g, "p0", "monk", { target: pick(g, "p2") }), fabledOf(g))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("4. a dead participant still represents their current character", () => {
    const g = withRole(game(), "p5", "leviathan");
    g.players.p5 = { ...g.players.p5!, alive: false, ghostVote: false };
    expect(jinxIds(g)).toContain("jinx:leviathan+monk");
  });

  it("5. a Role change away immediately removes the gate (derived on every evaluation)", () => {
    const g = withRole(game(), "p5", "leviathan");
    expect(jinxIds(g)).toContain("jinx:leviathan+monk");
    const changed = withRole(g, "p5", "chef");
    expect(jinxIds(changed)).toEqual([]);
    expect(planAbilityResolution(changed, guided(changed, "p0", "monk", { target: pick(changed, "p2") }), fabledOf(changed))).toMatchObject({ ok: true, changed: true });
  });

  it("6. a homebrew definition reusing an endpoint id never activates the canonical jinx", () => {
    const leviathan = registry.get("leviathan")!;
    const homebrew: Script = { ...setupScript, characters: [{ ...leviathan, ability: "Homebrew text.", provenance: { status: "homebrew" } },
      ...setupScript.characters.filter((r) => r.id !== "leviathan")] };
    const g = withRole(game(), "p5", "leviathan");
    expect(jinxIds(g, buildRegistry(homebrew))).toEqual([]);
  });

  it("7. several participants with the same Roles never duplicate the modifier", () => {
    let g = withRole(withRole(game(), "p5", "leviathan"), "p2", "leviathan");
    g = withRole(g, "p6", "monk");
    const ids = jinxIds(g);
    expect(ids.filter((id) => id === "jinx:leviathan+monk")).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an empty seat, an unassigned Role or a Shown Role never represents a character", () => {
    const g = game();
    g.players.p5 = { ...g.players.p5!, actualRole: "", shownRole: "leviathan" };
    expect(jinxIds(g)).toEqual([]);
    const empty = withRole(game(), "p5", "leviathan");
    empty.players.p5 = { ...empty.players.p5!, isEmpty: true };
    delete empty.players.p5!.participantId;
    expect(jinxIds(empty)).toEqual([]);
  });

  it("Fabled / Lorics still come from authoritative game.fabled / game.lorics", () => {
    const g = game("night", 2, { fabled: ["toymaker"], lorics: ["bootlegger"] });
    expect(activeModifiers(g, registry).map((m) => m.id)).toEqual(["fabled:toymaker", "loric:bootlegger"]);
  });
});

describe("SOL-10F-L4: malformed fingerprint = invalid; well-formed but changed = stale", () => {
  const base = () => { const g = game(); return { g, fp: captureFingerprint(g, "p0")! }; };
  const request = (fingerprint: unknown) => ({ mode: "guided", invocationPath: "nightOrder", fingerprint, roleId: "monk", inputs: {} }) as never;

  it.each([
    ["missing", undefined],
    ["null", null],
    ["a string", "fp"],
    ["no actor", (fp: Record<string, unknown>) => { delete fp.actor; }],
    ["a malformed binding", (fp: Record<string, unknown>) => { fp.actor = { playerId: "p0" }; }],
    ["an empty ParticipantId", (fp: Record<string, unknown>) => { fp.actor = { playerId: "p0", participantId: "" }; }],
    ["no Actual Role", (fp: Record<string, unknown>) => { delete fp.actualRole; }],
    ["a numeric Shown Role", (fp: Record<string, unknown>) => { fp.shownRole = 3; }],
    ["no Traveler status", (fp: Record<string, unknown>) => { delete fp.isTraveler; }],
    ["an unknown phase", (fp: Record<string, unknown>) => { fp.phase = "dusk"; }],
    ["a fractional day", (fp: Record<string, unknown>) => { fp.day = 1.5; }],
    ["no ability-use state", (fp: Record<string, unknown>) => { fp.abilityUsed = "no"; }],
    ["a malformed step", (fp: Record<string, unknown>) => { fp.step = { day: 2, stepKey: "", status: "done" }; }],
    ["a step with an unknown status", (fp: Record<string, unknown>) => { fp.step = { day: 2, stepKey: "p:x:monk", status: "maybe" }; }],
  ])("%s -> invalid (guided and manual)", (_label, change) => {
    const { g, fp } = base();
    let fingerprint: unknown = change;
    if (typeof change === "function") { fingerprint = structuredClone(fp); (change as (f: Record<string, unknown>) => void)(fingerprint as Record<string, unknown>); }
    expect(planAbilityResolution(g, request(fingerprint), env())).toMatchObject({ ok: false, code: "invalid" });
    if (fingerprint !== undefined) {
      expect(planAbilityResolution(g, { mode: "manual", fingerprint, reason: "r", outcome: { operations: [] } } as never, env())).toMatchObject({ ok: false, code: "invalid" });
    }
  });

  it.each([
    ["a replacement participant", (g: StorytellerLobbyRecord) => withParticipant(g, "p0", "someone-new")],
    ["an Actual Role change", (g: StorytellerLobbyRecord) => withRole(g, "p0", "chef")],
    ["a Shown Role change", (g: StorytellerLobbyRecord) => ({ ...g, players: { ...g.players, p0: { ...g.players.p0!, shownRole: "chef" } } })],
    ["a phase change", (g: StorytellerLobbyRecord) => ({ ...g, phase: "day" as const })],
    ["a day change", (g: StorytellerLobbyRecord) => ({ ...g, day: 3 })],
    ["an ability-use change", (g: StorytellerLobbyRecord) => ({ ...g, players: { ...g.players, p0: { ...g.players.p0!, abilityUsed: true } } })],
  ])("a well-formed fingerprint after %s -> stale", (_label, change) => {
    const { g, fp } = base();
    expect(planAbilityResolution(change(g), request(fp), env())).toMatchObject({ ok: false, code: "stale" });
  });

  it("a well-formed step fingerprint whose step status changed -> stale", () => {
    const { g } = base();
    const fp = captureFingerprint(g, "p0", { day: 2, stepKey: "p:x:monk" })!;
    const changed = { ...g, nightProgress: { "2:p:x:monk": { status: "skipped" as const, notes: "" } } };
    expect(planAbilityResolution(changed, request(fp), env())).toMatchObject({ ok: false, code: "stale" });
  });
});

describe("SOL-10F-L5: a verified information constraint never silently skips Player-valued information", () => {
  // Rules-neutral fixture: a two-player + character delivery (the Washerwoman
  // Information Action's SHAPE only -- not its rules).
  const PAIR_INFO: AbilityDescriptor = {
    roleId: "washerwoman", timing: ["firstNight"], invocation: "wake", usage: { kind: "unlimited" }, hooks: ["information"],
    inputs: [{ id: "pair", kind: "participant", count: 2, source: "storyteller", label: "the pair" }],
    presentation: { complexity: "complex", action: "fixture" },
    evaluator: ({ actor, inputs }) => ({ kind: "outcome", outcome: { operations: [{ domain: "information", recipient: actor.binding, informationActionId: "washerwoman-first-night",
      values: [{ requirementId: "players", kind: "player", participants: (inputs.pair as { participants: ParticipantBinding[] }).participants },
        { requirementId: "role", kind: "role", roleId: "chef" }] }] } }),
  };
  const semantics = new Map([[PAIR_INFO.roleId, PAIR_INFO]]);
  const firstNight = () => {
    const g = withRole(game("night", 1), "p0", "washerwoman");
    g.players.p0 = { ...g.players.p0!, shownRole: "washerwoman" };
    return g;
  };
  const constrainTo = (allowed: unknown[]): ModifierDefinition => ({ id: "fixture:pair", source: "custom", label: "Fixture pair constraint", scopes: ["information"],
    hook: () => ({ kind: "constrainInformation", requirementId: "players", allowed: allowed as never, reason: "The fixture allows only that pair." }) });
  const plan = (g: StorytellerLobbyRecord, pair: [string, string], allowed: unknown[]) => planAbilityResolution(g,
    guided(g, "p0", "washerwoman", { pair: { kind: "participant", participants: pair.map((id) => bind(g, id)) } }),
    env({ semantics, modifiers: [constrainTo(allowed)] }));

  it("an allowed pair passes; any other pair is illegal (enforced, not skipped)", () => {
    const g = firstNight();
    const allowed = [{ kind: "player", participantIds: [g.players.p2!.participantId, g.players.p3!.participantId], order: "unordered" }];
    expect(plan(g, ["p2", "p3"], allowed)).toMatchObject({ ok: true, changed: true });
    expect(plan(g, ["p3", "p2"], allowed)).toMatchObject({ ok: true, changed: true }); // unordered
    expect(plan(g, ["p2", "p4"], allowed)).toMatchObject({ ok: false, code: "illegal", message: "The fixture allows only that pair." });
  });

  it("order and cardinality are honored exactly as the constraint states", () => {
    const g = firstNight();
    const ordered = [{ kind: "player", participantIds: [g.players.p2!.participantId, g.players.p3!.participantId], order: "ordered" }];
    expect(plan(g, ["p2", "p3"], ordered)).toMatchObject({ ok: true, changed: true });
    expect(plan(g, ["p3", "p2"], ordered)).toMatchObject({ ok: false, code: "illegal" });
    const single = [{ kind: "player", participantIds: [g.players.p2!.participantId], order: "unordered" }];
    expect(plan(g, ["p2", "p3"], single)).toMatchObject({ ok: false, code: "illegal" });
  });

  it("comparison is by stable ParticipantId, never the reusable PlayerId", () => {
    const g = firstNight();
    // The constraint names the PREVIOUS occupant of seat p3; the seat now holds someone else.
    const allowed = [{ kind: "player", participantIds: [g.players.p2!.participantId, "previous-occupant-of-p3"], order: "unordered" }];
    expect(plan(g, ["p2", "p3"], allowed)).toMatchObject({ ok: false, code: "illegal" });
  });

  it("a constraint of the wrong kind or a malformed constraint fails safe (never passes unenforced)", () => {
    const g = firstNight();
    expect(plan(g, ["p2", "p3"], [{ kind: "number", value: 2 }])).toMatchObject({ ok: false, code: "illegal" });
    for (const malformed of [[2], [{ kind: "player", participantIds: ["a"] }], [{ kind: "player", participantIds: "a", order: "unordered" }], [{ kind: "mystery" }]]) {
      expect(plan(g, ["p2", "p3"], malformed)).toMatchObject({ ok: false, code: "unsupported" });
    }
  });
});
