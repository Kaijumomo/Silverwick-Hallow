// Treacherous 30th slice 2B -- No Dashii. Production semantics.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Seats: p0 No Dashii, p1 chef, p2 empath, p3 saint (outsider), p4 baron (minion), p5 monk, p6 poisoner (minion)
const ROLES = ["nodashii", "chef", "empath", "saint", "baron", "monk", "poisoner"];
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const poisoned = (g: StorytellerLobbyRecord, id: string) => query(g).impaired(bind(g, id));

describe("No Dashii -- passive poison", () => {
  it("poisons the two nearest Townsfolk, skipping Outsiders and Minions", () => {
    const g = proofGame(ROLES);
    expect(poisoned(g, "p1")).toEqual({ known: true, value: true });
    expect(poisoned(g, "p5")).toEqual({ known: true, value: true }); // p6 is a Minion, skipped
    for (const id of ["p2", "p3", "p4", "p6"]) expect(poisoned(g, id)).toEqual({ known: true, value: false });
    expect(query(g).abilityFunctions(bind(g, "p1"))).toEqual({ known: true, value: false });
  });

  it("counts dead neighbours", () => {
    const g = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    expect(poisoned(g, "p1")).toEqual({ known: true, value: true });
    expect(poisoned(g, "p2")).toEqual({ known: true, value: false });
  });

  it("follows the seating when a neighbour stops being a Townsfolk", () => {
    const g = patchPlayer(proofGame(ROLES), "p1", { actualRole: "saint" });
    expect(poisoned(g, "p1")).toEqual({ known: true, value: false });
    expect(poisoned(g, "p2")).toEqual({ known: true, value: true });
  });

  it("ends when the No Dashii dies, is impaired or changes character", () => {
    const g = proofGame(ROLES);
    for (const ended of [patchPlayer(g, "p0", { alive: false }), impair(g, "p0"), patchPlayer(g, "p0", { actualRole: "imp" })]) {
      expect(poisoned(ended, "p1")).toEqual({ known: true, value: false });
      expect(poisoned(ended, "p5")).toEqual({ known: true, value: false });
    }
  });

  it("a Spy that may register as a Townsfolk makes the poison a Storyteller judgment", () => {
    const g = patchPlayer(proofGame(ROLES), "p6", { actualRole: "spy" });
    expect(poisoned(g, "p5").known).toBe(false);
  });

  it("a homebrew No Dashii inherits no passive poison", () => {
    const g = proofGame(ROLES);
    const q = createRulesQuery(g, { registry: homebrewEnv("nodashii").registry, script: homebrewEnv("nodashii").script, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
    expect(q.impaired(bind(g, "p1"))).toEqual({ known: true, value: false });
  });
});

describe("No Dashii -- nightly kill", () => {
  it("kills an unprotected living player", () => {
    const g = proofGame(ROLES);
    const next = planned(plan(g, request(g, "p0", "nodashii", { target: pick(g, "p2") })));
    expect(next.players.p2!.alive).toBe(false);
  });

  it("a dead target changes nothing; a Monk-protected target survives", () => {
    const dead = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    expect(plan(dead, request(dead, "p0", "nodashii", { target: pick(dead, "p2") }))).toEqual({ ok: true, changed: false });
    // The Monk (p2) is not a neighbour, so it functions and its protection settles the attack.
    const roles = ["nodashii", "chef", "monk", "saint", "baron", "empath", "poisoner"];
    const g = proofGame(roles);
    const withSafe = planned(plan(g, request(g, "p2", "monk", { target: pick(g, "p3") })));
    expect(plan(withSafe, request(withSafe, "p0", "nodashii", { target: pick(withSafe, "p3") }))).toEqual({ ok: true, changed: false });
  });

  it("an impaired No Dashii chooses but kills no one", () => {
    const g = impair(proofGame(ROLES), "p0");
    expect(plan(g, request(g, "p0", "nodashii", { target: pick(g, "p2") }))).toEqual({ ok: true, changed: false });
  });

  it("does not act on Night 1, and a homebrew copy inherits nothing", () => {
    const first = proofGame(ROLES, "night", 1);
    expect(plan(first, request(first, "p0", "nodashii", { target: pick(first, "p2") }))).toMatchObject({ ok: false, code: "notApplicable" });
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "nodashii", { target: pick(g, "p2") }), homebrewEnv("nodashii"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
