// @vitest-environment node
// LS-2a: the widened death gate (causes "execution" and "assassin", bypassedBy, decision auto | choice | unmodelled).
// LEGACY below is a frozen copy of the gate at main 13855e9 (LS-1). For the causes "demon" and "any" the new gate must answer
// exactly what it answered, for every role and state below, with the same judgment ids and the same dependency stamps.
// https://wiki.bloodontheclocktower.com/Assassin -- "they die, even if for some reason they could not".
import { describe, expect, it } from "vitest";
import { isCanonicalRole } from "@/data/canonical";
import { resolveAbilitySemantics } from "@/abilities/semantics";
import type { AbilityEvaluationContext } from "@/abilities/semantics";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import type { QueryAnswer, RulesQuery } from "@/stores/rulesQuery";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { EffectRecord, StorytellerLobbyRecord } from "@/stores/types";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofQuery, proofRegistry, request } from "@/test/proofFixtures";
import { LIFE_RULES, lifeRuleOf, lifeRuleStops, passiveProtection, survivesFirstDeath } from "./passiveRules";
import { deathAttempt, protectionJudgmentId } from "./shared";

// ---- Frozen copy of the LS-1 gate (13855e9) -------------------------------------------------------------------------------
type LegacyRule = { holder: "self" | "neighbours"; duration: "permanent" | "once"; needsFunctioning: boolean; causes: "demon" | "any";
  decision: "auto" | "storyteller"; onSurvive: "nothing" | "spend"; mayorMonk?: true };
const LEGACY_GAP: LegacyRule = { holder: "self", duration: "permanent", needsFunctioning: true, causes: "any", decision: "storyteller", onSurvive: "nothing" };
const LEGACY_RULES: Record<string, LegacyRule> = {
  soldier: { holder: "self", duration: "permanent", needsFunctioning: true, causes: "demon", decision: "auto", onSurvive: "nothing" },
  sailor: { holder: "self", duration: "permanent", needsFunctioning: true, causes: "any", decision: "auto", onSurvive: "nothing" },
  fool: { holder: "self", duration: "once", needsFunctioning: true, causes: "any", decision: "auto", onSurvive: "spend" },
  mayor: { ...LEGACY_GAP, mayorMonk: true }, lleech: LEGACY_GAP, zombuul: LEGACY_GAP, tealady: { ...LEGACY_GAP, holder: "neighbours" },
};
const legacyRule = (id: string) => (Object.prototype.hasOwnProperty.call(LEGACY_RULES, id) ? LEGACY_RULES[id] : undefined);
const LEGACY_PROTECTION_SEMANTICS: Record<string, "demonProtection" | "deathImmunity" | "genericProtection"> = { safeFromDemon: "demonProtection", cannotDie: "deathImmunity", protected: "genericProtection" };

function legacySurvives(query: RulesQuery, target: ParticipantBinding): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  const rule = player && legacyRule(player.actualRole);
  if (!player || !role || !isCanonicalRole(role) || !rule || rule.onSurvive !== "spend") return { known: true, value: false };
  if (rule.duration === "once" && player.abilityUsed) return { known: true, value: false };
  return rule.needsFunctioning ? query.abilityFunctions(target) : { known: true, value: true };
}
function legacyPassive(query: RulesQuery, target: ParticipantBinding, cause: "demon" | "any", spendHandled = false): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  if (!player || !role || !isCanonicalRole(role)) return { known: false, reason: "x" };
  for (const other of Object.values(query.game.players)) {
    const rule = !other.isEmpty && other.participantId && other.alive ? legacyRule(other.actualRole) : undefined;
    if (!rule || rule.holder === "self") continue;
    const definition = query.roleOf(other.actualRole);
    if (!definition || !isCanonicalRole(definition)) continue;
    const functioning = query.abilityFunctions({ playerId: other.id, participantId: other.participantId! });
    if (!functioning.known || functioning.value) return { known: false, reason: "x" };
  }
  if (!player.alive) return { known: true, value: false };
  const functioning = query.abilityFunctions(target);
  const rule = legacyRule(player.actualRole);
  if (!rule || rule.holder !== "self") return { known: true, value: false };
  if (rule.mayorMonk && cause === "demon" && player.effects.some(e => e.type === "safeFromDemon" && (a => a.known && a.value)(query.effectApplies(target, e)))) return { known: true, value: true };
  if (rule.decision === "storyteller") {
    if (!functioning.known || functioning.value) return { known: false, reason: "x" };
    return { known: true, value: false };
  }
  if (rule.onSurvive === "spend") {
    if (spendHandled) return { known: true, value: false };
    const survives = legacySurvives(query, target);
    if (!survives.known || survives.value) return { known: false, reason: "x" };
    return { known: true, value: false };
  }
  if (rule.causes !== "any" && rule.causes !== cause) return { known: true, value: false };
  return rule.needsFunctioning ? functioning : { known: true, value: true };
}
function legacyProtection(query: RulesQuery, target: ParticipantBinding, cause: "demon" | "any", spendHandled: boolean): QueryAnswer<boolean> {
  const player = query.participant(target);
  if (!player) return { known: false, reason: "x" };
  const passive = legacyPassive(query, target, cause, spendHandled);
  if (!passive.known || passive.value) return passive;
  let undetermined = false;
  for (const effect of player.effects) {
    const semantics = LEGACY_PROTECTION_SEMANTICS[effect.type];
    if (!semantics) continue;
    if (semantics === "demonProtection" && cause !== "demon") continue;
    const answer = query.effectApplies(target, effect);
    if (!answer.known) { undetermined = true; continue; }
    if (!answer.value) continue;
    if (semantics === "genericProtection") { undetermined = true; continue; }
    return { known: true, value: true };
  }
  return undetermined ? { known: false, reason: "x" } : { known: true, value: false };
}
function legacyOutcome(query: RulesQuery, target: ParticipantBinding, cause: "demon" | "any"): string {
  const survives = legacySurvives(query, target);
  if (!survives.known) return "unknown";
  const other = legacyProtection(query, target, cause, true);
  if (!other.known) return "unknown";
  return other.value ? "survives:false" : survives.value ? "survives:true" : "dies";
}
/** The protection-dependency stamp exactly as 13855e9 built it. */
function legacyStamp(game: StorytellerLobbyRecord): string {
  const sortedKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortedKeys);
    if (!value || typeof value !== "object") return value ?? null;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]));
  };
  const sourceIdentity = (ref: EffectRecord["sourceParticipant"]): unknown => !ref ? null
    : ref.kind === "participant" ? [ref.kind, ref.playerId, ref.participantId] : ref.kind === "legacy" ? [ref.kind, ref.playerId] : sortedKeys(ref);
  const declarationOf = (effect: EffectRecord): unknown => {
    if (!effect.sourceCharacter) return null;
    const resolved = resolveAbilitySemantics(effect.sourceCharacter, proofRegistry, CANONICAL_ABILITY_SEMANTICS);
    return [resolved.kind, resolved.kind === "supported" ? resolved.descriptor.sourcedEffects?.find((entry) => entry.type === effect.type)?.persistence ?? null : null];
  };
  return JSON.stringify(["protection-dependency-v1",
    Object.values(game.players).some((p) => !p.isEmpty && p.actualRole === "nodashii") ? game.seatOrder : null,
    Object.keys(game.players).sort().flatMap((playerId) => {
      const player = game.players[playerId];
      if (!player || player.isEmpty || !player.participantId) return [];
      return [[playerId, player.participantId, player.alive, player.abilityUsed, player.actualRole, (player.effects ?? []).map((effect) => [
        effect.id, effect.type, effect.state, effect.sourceCharacter ?? null, sourceIdentity(effect.sourceParticipant),
        sortedKeys(effect.expiry), sortedKeys(effect.parameters), declarationOf(effect)])]];
    })]);
}
// ----------------------------------------------------------------------------------------------------------------------------

const shape = (a: QueryAnswer<boolean>) => (a.known ? `known:${a.value}` : "unknown");
const outcomeShape = (a: ReturnType<RulesQuery["deathOutcome"]>) => (a.known ? (a.value.kind === "dies" ? "dies" : `survives:${a.value.spends}`) : "unknown");

// Seats: p0 monk, p1 poisoner, p2 imp, p3 TARGET, p4 chef or tealady, p5 empath, p6 baron
const BASE = ["monk", "poisoner", "imp", "chef", "chef", "empath", "baron"];
const ROLES = ["fool", "sailor", "soldier", "mayor", "lleech", "zombuul", "tealady", "chef", "imp", "monk", "innkeeper", "saint", "virgin",
  "pacifist", "drunk", "devilsadvocate", "assassin", "spy", "recluse", "goon"];
type State = { dead: boolean; used: boolean; safe: boolean; inn: boolean; poisoned: boolean; tea: boolean };
const PROTECTED = (() => {
  const g = proofGame(BASE, "night", 2);
  return planned(plan(g, request(g, "p0", "monk", { target: pick(g, "p3") })));
})();
const cannotDie = (g: StorytellerLobbyRecord, id: string) => patchPlayer(g, id, { effects: [...g.players[id]!.effects,
  { id: `inn-${id}`, type: "cannotDie", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as EffectRecord] });
const make = (role: string, state: State): StorytellerLobbyRecord => {
  // The Monk's real safeFromDemon Effect is carried over from a plan on an ordinary Townsfolk, then the target's character is changed.
  let g = state.safe ? PROTECTED : proofGame(BASE, "night", 2);
  g = patchPlayer(g, "p3", { actualRole: role, abilityUsed: state.used });
  if (state.tea) g = patchPlayer(g, "p4", { actualRole: "tealady" });
  if (state.inn) g = cannotDie(g, "p3");
  if (state.poisoned) g = impair(g, "p3");
  if (state.dead) g = patchPlayer(g, "p3", { alive: false });
  return g;
};
const STATES: State[] = (() => {
  const out: State[] = [];
  const b = [false, true];
  for (const dead of b) for (const used of b) for (const safe of b) for (const inn of b) for (const poisoned of b) for (const tea of b) out.push({ dead, used, safe, inn, poisoned, tea });
  return out;
})();
/** States whose answer an LS-2 package changes on purpose: LS-2b models the Tea Lady (any seated Tea Lady; her stamp also gains
 * the seating and the alignments). Those states are tested in teaLady.test.ts. */
const changedOnPurpose = (role: string, state: State) => state.tea || role === "tealady";

describe("LS-2a: the gate is unchanged for the causes demon and any", () => {
  it("passiveProtection, survivesFirstDeath, protectedFrom, deathOutcome, judgment ids and stamps match 13855e9 for every role x state", () => {
    let checked = 0;
    for (const role of ROLES) for (const state of STATES) {
      if (changedOnPurpose(role, state)) continue;
      const g = make(role, state);
      const query = proofQuery(g);
      const target = bind(g, "p3");
      const label = JSON.stringify({ role, ...state });
      expect(shape(survivesFirstDeath(query, target)), label).toBe(shape(legacySurvives(query, target)));
      for (const cause of ["demon", "any"] as const) {
        for (const handled of [false, true]) {
          expect(shape(passiveProtection(query, target, cause, handled)), `${label} ${cause} ${handled}`).toBe(shape(legacyPassive(query, target, cause, handled)));
        }
        expect(shape(query.protectedFrom(target, cause)), `${label} ${cause} protectedFrom`).toBe(shape(legacyProtection(query, target, cause, false)));
        expect(outcomeShape(query.deathOutcome(target, cause)), `${label} ${cause} deathOutcome`).toBe(legacyOutcome(query, target, cause));
        const stamp = query.protectionDependencyStamp(target, cause);
        expect(stamp, `${label} stamp`).toBe(legacyStamp(g));
        expect(protectionJudgmentId(cause, target, stamp)).toBe(`protection:${cause}:${JSON.stringify([target.participantId, legacyStamp(g)])}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(ROLES.length * STATES.length / 2);
  });

  it("an execution is answered exactly as the old 'any' question for every role x state (the execution advice asked 'any' before LS-2a)", () => {
    for (const role of ROLES) for (const state of STATES) {
      if (changedOnPurpose(role, state)) continue;
      const g = make(role, state);
      const query = proofQuery(g);
      const target = bind(g, "p3");
      expect(outcomeShape(query.deathOutcome(target, "execution")), JSON.stringify({ role, ...state })).toBe(legacyOutcome(query, target, "any"));
    }
  });
});

describe("LS-2a: rows", () => {
  it("every automatic or spending row is bypassed by the Assassin; gap rows are unmodelled; no row is a choice yet", () => {
    for (const id of ["soldier", "sailor", "fool", "tealady"]) expect(lifeRuleOf(id)?.bypassedBy, id).toEqual(["assassin"]);
    for (const id of ["mayor", "lleech", "zombuul"]) expect(lifeRuleOf(id)?.decision, id).toBe("unmodelled");
    for (const rule of Object.values(LIFE_RULES)) expect(["auto", "unmodelled"]).toContain(rule!.decision);
  });
  it("a row stops only its own causes", () => {
    const soldier = lifeRuleOf("soldier")!, sailor = lifeRuleOf("sailor")!;
    expect((["demon", "execution", "assassin", "any"] as const).map(c => lifeRuleStops(soldier, c))).toEqual([true, false, false, false]);
    expect((["demon", "execution", "assassin", "any"] as const).map(c => lifeRuleStops(sailor, c))).toEqual([true, true, false, true]);
  });
});

/** A test-only Assassin caller: the Assassin's own evaluator is not built (Plan v3 5B-5); this asks the shared gate directly. */
const assassinate = (g: StorytellerLobbyRecord, id: string) =>
  deathAttempt({ query: proofQuery(g), judgments: {} } as unknown as AbilityEvaluationContext, bind(g, id), "assassin");

describe("LS-2a: the assassin cause goes around every prevention", () => {
  // p0 chef, p1 target, p2 monk, p3 innkeeper, p4 imp (no Assassin is seated: the caller is test-only, so the Monk still automates)
  const base = (role: string) => proofGame(["chef", role, "monk", "innkeeper", "imp"], "night", 2);

  it("a Soldier, a sober Sailor and an unspent Fool die, and the Fool spends nothing", () => {
    for (const role of ["soldier", "sailor", "fool"]) {
      const g = base(role);
      expect(assassinate(g, "p1"), role).toEqual({ kind: "dies" });
      expect(proofQuery(g).deathOutcome(bind(g, "p1"), "assassin"), role).toEqual({ known: true, value: { kind: "dies" } });
      expect(proofQuery(g).protectedFrom(bind(g, "p1"), "assassin"), role).toEqual({ known: true, value: false });
    }
    // The same characters are still protected from the Demon (the bypass is the Assassin's alone).
    expect(proofQuery(base("fool")).deathOutcome(bind(base("fool"), "p1"), "demon")).toEqual({ known: true, value: { kind: "survives", spends: true } });
    expect(proofQuery(base("sailor")).deathOutcome(bind(base("sailor"), "p1"), "demon")).toEqual({ known: true, value: { kind: "survives", spends: false } });
  });

  it("an unknown sobriety does not stop the Assassin (nothing to ask)", () => {
    for (const role of ["soldier", "sailor", "fool"]) {
      const g = impair(base(role), "p1", "soberHealthy");
      expect(assassinate(g, "p1"), role).toEqual({ kind: "dies" });
    }
  });

  it("Monk-protected and Innkeeper-protected targets die", () => {
    const g = base("chef");
    const monk = planned(plan(g, request(g, "p2", "monk", { target: pick(g, "p1") })));
    expect(proofQuery(monk).deathOutcome(bind(monk, "p1"), "demon")).toEqual({ known: true, value: { kind: "survives", spends: false } });
    expect(assassinate(monk, "p1")).toEqual({ kind: "dies" });
    const inn = cannotDie(g, "p1");
    expect(proofQuery(inn).protectedFrom(bind(inn, "p1"), "any")).toEqual({ known: true, value: true });
    expect(assassinate(inn, "p1")).toEqual({ kind: "dies" });
    // Even a generic Protected marker, which otherwise always asks, does not stop it.
    const marker = patchPlayer(g, "p1", { effects: [{ ...inn.players.p1!.effects[0]!, type: "protected" }] });
    expect(proofQuery(marker).protectedFrom(bind(marker, "p1"), "any")).toMatchObject({ known: false });
    expect(assassinate(marker, "p1")).toEqual({ kind: "dies" });
  });

  it("a Monk-protected Fool also dies and spends nothing", () => {
    const g = base("fool");
    const monk = planned(plan(g, request(g, "p2", "monk", { target: pick(g, "p1") })));
    expect(assassinate(monk, "p1")).toEqual({ kind: "dies" });
  });

  it("unmodelled rows still send the question to the Storyteller (their own rules are not modelled)", () => {
    expect(assassinate(base("zombuul"), "p1")).toMatchObject({ kind: "ask" });
  });
});
