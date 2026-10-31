// Treacherous 30th slice 2B -- Vigormortis. Production semantics.
import { describe, expect, it } from "vitest";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request, requirementIds } from "@/test/proofFixtures";
import { subjectId } from "./shared";
import { POISONED_NEIGHBOUR } from "./vigormortis";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Seats: p0 Vigormortis, p1 chef, p2 empath, p3 baron (minion), p4 monk, p5 saint, p6 poisoner (minion)
const ROLES = ["vigormortis", "chef", "empath", "baron", "monk", "saint", "poisoner"];
const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const poisonOn = (g: StorytellerLobbyRecord, id: string) => g.players[id]!.effects.find((e) => e.type === "poisoned" && e.sourceCharacter === "vigormortis");
const choice = (g: StorytellerLobbyRecord, minion: string, who: string) => ({ [subjectId(POISONED_NEIGHBOUR, bind(g, minion))]: pick(g, who) });

describe("Vigormortis -- killing a non-Minion", () => {
  it("kills an unprotected player and poisons no one", () => {
    const g = proofGame(ROLES);
    const next = planned(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p2") })));
    expect(next.players.p2!.alive).toBe(false);
    for (const id of Object.keys(next.players)) expect(poisonOn(next, id)).toBeUndefined();
  });

  it("a dead target changes nothing; an impaired Vigormortis kills no one", () => {
    const dead = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    expect(plan(dead, request(dead, "p0", "vigormortis", { target: pick(dead, "p2") }))).toEqual({ ok: true, changed: false });
    const g = impair(proofGame(ROLES), "p0");
    expect(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p2") }))).toEqual({ ok: true, changed: false });
  });
});

describe("Vigormortis -- killing a Minion", () => {
  it("asks which of the Minion's two nearest Townsfolk neighbours is poisoned", () => {
    const g = proofGame(ROLES);
    const result = plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p3") }));
    expect(result).toMatchObject({ ok: false, code: "needsInput" });
    expect(requirementIds(result)).toEqual([subjectId(POISONED_NEIGHBOUR, bind(g, "p3"))]);
  });

  it("kills the Minion and poisons the chosen Townsfolk (dead neighbours included) until the Vigormortis stops functioning", () => {
    const g = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    const next = planned(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p3"), ...choice(g, "p3", "p2") })));
    expect(next.players.p3!.alive).toBe(false);
    expect(poisonOn(next, "p2")).toMatchObject({ lifetime: { kind: "manual" } });
    expect(poisonOn(next, "p4")).toBeUndefined();
    expect(query(next).impaired(bind(next, "p2"))).toEqual({ known: true, value: true });
    for (const lost of [patchPlayer(next, "p0", { alive: false }), impair(next, "p0"), patchPlayer(next, "p0", { actualRole: "imp" })]) {
      expect(query(lost).impaired(bind(lost, "p2"))).toEqual({ known: true, value: false });
    }
  });

  it("a choice outside the two neighbours is refused", () => {
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p3"), ...choice(g, "p3", "p5") }))).toMatchObject({ ok: false, code: "illegal" });
  });

  it("a single nearest Townsfolk on both sides is poisoned without asking", () => {
    const g = proofGame(["vigormortis", "baron", "saint", "chef", "saint", "saint", "poisoner"]);
    const next = planned(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p1") })));
    expect(next.players.p1!.alive).toBe(false);
    expect(poisonOn(next, "p3")).toBeDefined();
  });

  it("a Spy victim with an ambiguous registration is not decided", () => {
    const g = patchPlayer(proofGame(ROLES), "p3", { actualRole: "spy" });
    expect(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p3") }))).toMatchObject({ ok: false });
  });

  it("a homebrew copy inherits nothing", () => {
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "vigormortis", { target: pick(g, "p2") }), homebrewEnv("vigormortis"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
