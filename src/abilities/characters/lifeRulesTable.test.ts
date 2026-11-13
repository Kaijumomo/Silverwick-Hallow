// @vitest-environment node
// LS-1b: the life-rules TABLE must answer exactly what the hard-coded LS-1 branches (2df35fb) answered, for every role, cause
// and state. LEGACY below is a frozen copy of that code; if it and the table ever disagree, the table is wrong (or the change is deliberate).
import { describe, expect, it } from "vitest";
import { isCanonicalRole } from "@/data/canonical";
import type { QueryAnswer, RulesQuery } from "@/stores/rulesQuery";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import { LIFE_RULES, lifeRuleNeedsRosterReview, lifeRuleOf, passiveProtection, survivesFirstDeath } from "./passiveRules";
import { executionAdvice } from "@/stores/executionAdvice";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { proofRegistry, proofScript } from "@/test/proofFixtures";
import { bind, impair, patchPlayer, pick, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const TARGET_DEATH_GAPS = new Set(["mayor", "lleech", "zombuul"]);
const EXTERNAL_PROTECTION_GAPS = new Set(["tealady"]);

function legacySurvives(query: RulesQuery, target: ParticipantBinding): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  if (!player || !role || !isCanonicalRole(role) || player.actualRole !== "fool") return { known: true, value: false };
  if (player.abilityUsed) return { known: true, value: false };
  return query.abilityFunctions(target);
}
function legacyProtection(query: RulesQuery, target: ParticipantBinding, cause: "demon" | "any", foolHandled = false): QueryAnswer<boolean> {
  const player = query.participant(target);
  const role = player && query.roleOf(player.actualRole);
  if (!player || !role || !isCanonicalRole(role)) return { known: false, reason: "x" };
  for (const other of Object.values(query.game.players)) {
    if (other.isEmpty || !other.participantId || !other.alive || !EXTERNAL_PROTECTION_GAPS.has(other.actualRole)) continue;
    const definition = query.roleOf(other.actualRole);
    if (!definition || !isCanonicalRole(definition)) continue;
    const functioning = query.abilityFunctions({ playerId: other.id, participantId: other.participantId });
    if (!functioning.known || functioning.value) return { known: false, reason: "x" };
  }
  if (!player.alive) return { known: true, value: false };
  const functioning = query.abilityFunctions(target);
  if (player.actualRole === "mayor" && cause === "demon") {
    for (const effect of player.effects) {
      if (effect.type !== "safeFromDemon") continue;
      const applies = query.effectApplies(target, effect);
      if (applies.known && applies.value) return { known: true, value: true };
    }
  }
  if (TARGET_DEATH_GAPS.has(player.actualRole) && (!functioning.known || functioning.value)) return { known: false, reason: "x" };
  if (player.actualRole === "fool" && !foolHandled) {
    const survives = legacySurvives(query, target);
    if (!survives.known || survives.value) return { known: false, reason: "x" };
  }
  if (player.actualRole === "sailor") return functioning;
  if (player.actualRole !== "soldier" || cause !== "demon") return { known: true, value: false };
  return functioning;
}
const shape = (a: QueryAnswer<boolean>) => (a.known ? `known:${a.value}` : "unknown");

// Seats: p0 monk, p1 poisoner, p2 imp, p3 TARGET, p4 chef or tealady, p5 empath, p6 baron
const BASE = ["monk", "poisoner", "imp", "chef", "chef", "empath", "baron"];
const ROLES = ["fool", "sailor", "soldier", "mayor", "lleech", "zombuul", "tealady", "chef", "imp", "monk", "innkeeper", "saint", "virgin", "pacifist", "drunk"];
const PROTECTED = (() => {
  const g = proofGame(BASE, "night", 2);
  return planned(plan(g, request(g, "p0", "monk", { target: pick(g, "p3") })));
})();
const make = (role: string, state: { dead: boolean; used: boolean; safe: boolean; poisoned: boolean; tea: boolean }): StorytellerLobbyRecord => {
  // The Monk's real safeFromDemon Effect is carried over from a plan on an ordinary Townsfolk, then the target's character is changed.
  let g = state.safe ? PROTECTED : proofGame(BASE, "night", 2);
  g = patchPlayer(g, "p3", { actualRole: role, abilityUsed: state.used });
  if (state.tea) g = patchPlayer(g, "p4", { actualRole: "tealady" });
  if (state.poisoned) g = impair(g, "p3");
  if (state.dead) g = patchPlayer(g, "p3", { alive: false });
  return g;
};

describe("LS-1b: the life-rules table equals the LS-1 branches", () => {
  const bools = [false, true];
  it("passiveProtection and survivesFirstDeath agree for every role x cause x spendHandled x state", () => {
    let checked = 0;
    for (const role of ROLES) for (const dead of bools) for (const used of bools) for (const safe of bools) for (const poisoned of bools) for (const tea of bools) {
      // LS-2b models the Tea Lady on purpose: games with a Tea Lady seated are compared in teaLady.test.ts instead.
      if (tea || role === "tealady") { checked += 4; continue; }
      const g = make(role, { dead, used, safe, poisoned, tea });
      const query = proofQuery(g);
      const target = bind(g, "p3");
      const label = JSON.stringify({ role, dead, used, safe, poisoned, tea });
      expect(shape(survivesFirstDeath(query, target)), label).toBe(shape(legacySurvives(query, target)));
      for (const cause of ["demon", "any"] as const) for (const handled of bools) {
        expect(shape(passiveProtection(query, target, cause, handled)), `${label} ${cause} ${handled}`).toBe(shape(legacyProtection(query, target, cause, handled)));
        checked++;
      }
    }
    expect(checked).toBe(ROLES.length * 32 * 4);
  });

  it("an impaired holder: the tea case also covers a drunk Tea Lady (external gap) in play", () => {
    const g = impair(make("chef", { dead: false, used: false, safe: false, poisoned: false, tea: true }), "p4");
    const target = bind(g, "p3");
    expect(shape(passiveProtection(proofQuery(g), target, "any"))).toBe(shape(legacyProtection(proofQuery(g), target, "any")));
  });
});

describe("LS-1b: the rows themselves", () => {
  it("the table holds exactly the characters the old branches and gap lists named", () => {
    expect(Object.keys(LIFE_RULES).sort()).toEqual(["fool", "lleech", "mayor", "pacifist", "sailor", "soldier", "tealady", "zombuul"]);
  });
  it("rows read as the proposal's examples", () => {
    expect(lifeRuleOf("soldier")).toMatchObject({ holder: "self", duration: "permanent", needsFunctioning: true, causes: "demon", decision: "auto", onSurvive: "nothing" });
    expect(lifeRuleOf("sailor")).toMatchObject({ causes: "any", decision: "auto", onSurvive: "nothing" });
    expect(lifeRuleOf("fool")).toMatchObject({ duration: "once", causes: "any", decision: "auto", onSurvive: "spend", alsoCreditedTo: ["pacifist"] });
    expect(lifeRuleOf("chef")).toBeUndefined();
    expect(lifeRuleOf("constructor")).toBeUndefined();
  });
  it("only an automatic row whose holder is unreviewed asks for roster review (the Sailor)", () => {
    expect(["sailor", "fool", "soldier", "mayor", "tealady", "chef"].filter(lifeRuleNeedsRosterReview)).toEqual(["sailor"]);
  });
});

describe("LS-1b: no change to the advice and the reasons users read", () => {
  const environment = { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS };
  const guarded = (roles: string[]) => {
    const g = proofGame(roles, "day", 2);
    return patchPlayer(g, "p1", { effects: [{ id: "inn", type: "cannotDie", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "day", day: 2 } } as never] });
  };
  it("a protected non-Fool still gets the protection note while a Pacifist is seated, alive or dead", () => {
    for (const alive of [true, false]) {
      const g = patchPlayer(guarded(["imp", "chef", "pacifist", "empath"]), "p2", { alive });
      expect(executionAdvice(g, "p1", environment)).toEqual({ kind: "survives", spends: false, note: "Player 1 is protected from this death: they survive the execution." });
    }
  });
  it("the Fool's manual-fallback reason keeps its wording", () => {
    const g = proofGame(["imp", "fool", "chef", "empath"]);
    const answer = passiveProtection(proofQuery(g), bind(g, "p1"), "any");
    expect(answer).toMatchObject({ known: false });
    expect((answer as { reason: string }).reason).toMatch(/^The Fool survives its first death and then loses its ability/);
  });
});
