import { describe, expect, it } from "vitest";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, proofEnv, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { createRulesQuery } from "@/stores/rulesQuery";
import { automationEligibility } from "@/abilities/automationEligibility";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { buildCoverageManifest, coverageSummary } from "@/abilities/coverage";
import type { AbilityInputs } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

const eligible = (game: StorytellerLobbyRecord, roleId: string, inputs: AbilityInputs = {}) => automationEligibility({
  query: proofQuery(game), descriptor: CANONICAL_ABILITY_SEMANTICS.get(roleId)!, actor: bind(game, "p0"), roleId, inputs,
});

describe("Character Intelligence safety reproductions", () => {
  it("a healthy Soldier is protected from the Imp without a stored token", () => {
    const game = proofGame(["imp", "soldier", "chef"]);
    expect(proofQuery(game).protectedFrom(bind(game, "p1"), "demon")).toEqual({ known: true, value: true });
    expect(plan(game, request(game, "p0", "imp", { target: pick(game, "p1") }))).toEqual({ ok: true, changed: false });
  });

  it("an impaired Soldier is not protected from the Imp", () => {
    const game = impair(proofGame(["imp", "soldier", "chef"]), "p1");
    expect(proofQuery(game).protectedFrom(bind(game, "p1"), "demon")).toEqual({ known: true, value: false });
  });

  it("Vortox prevents ordinary automatic Empath information", () => {
    const game = proofGame(["empath", "vortox", "chef"]);
    expect(proofQuery(game).modifierGate("empath", ["information", "registration"]).kind).toBe("gated");
    expect(plan(game, request(game, "p0", "empath")).ok).toBe(false);
  });

  it("dead Vortox does not affect otherwise ordinary Empath information", () => {
    const game = patchPlayer(proofGame(["empath", "vortox", "chef"]), "p1", { alive: false });
    expect(proofQuery(game).modifierGate("empath", ["information", "registration"]).kind).toBe("clear");
    expect(plan(game, request(game, "p0", "empath")).ok).toBe(true);
  });

  it("unmodeled Fool death prevention is unknown rather than absent", () => {
    const game = proofGame(["imp", "fool", "chef"]);
    expect(proofQuery(game).protectedFrom(bind(game, "p1"), "demon").known).toBe(false);
  });
});

describe("Character Intelligence bounded automation", () => {
  it("keeps the 181-character denominator distinct from jinx entries and inventory owners", () => {
    const manifest = buildCoverageManifest();
    expect(coverageSummary(manifest)).toMatchObject({ characterTotal: 181, jinxTotal: 131 });
    expect(new Set(manifest.filter(entry => entry.kind !== "jinx").map(entry => entry.id)).size).toBe(181);
    for (const id of ["baron", "fanggu", "vigormortis", "godfather", "balloonist", "sentinel"]) {
      expect(manifest.find(entry => entry.id === id)?.capabilities).toContainEqual(expect.objectContaining({ owner: "setup", boundary: expect.stringContaining("count policy") }));
    }
    for (const id of ["bureaucrat", "virgin"]) expect(manifest.find(entry => entry.id === id)?.capabilities).toContainEqual(expect.objectContaining({ owner: "voting" }));
    expect(CANONICAL_ABILITY_SEMANTICS.size).toBe(11);
    expect(CANONICAL_ABILITY_SEMANTICS.has("soldier")).toBe(false);
    expect(CANONICAL_ABILITY_SEMANTICS.has("vortox")).toBe(false);
  });

  it("Soldier protection is Demon-specific, actual-role-bound, and life-dependent", () => {
    const game = proofGame(["imp", "soldier", "chef"]);
    expect(proofQuery(game).protectedFrom(bind(game, "p1"), "any")).toEqual({ known: true, value: false });
    for (const next of [patchPlayer(game, "p1", { alive: false }), patchPlayer(game, "p1", { actualRole: "chef" }), patchPlayer(game, "p1", { actualRole: "drunk", shownRole: "soldier" })]) {
      expect(proofQuery(next).protectedFrom(bind(next, "p1"), "demon")).toEqual({ known: true, value: false });
    }
    const revived = patchPlayer(patchPlayer(game, "p1", { alive: false }), "p1", { alive: true });
    expect(proofQuery(revived).protectedFrom(bind(revived, "p1"), "demon")).toEqual({ known: true, value: true });
    const env = homebrewEnv("soldier");
    expect(createRulesQuery(game, env).protectedFrom(bind(game, "p1"), "demon").known).toBe(false);
  });

  it("unknown Soldier functioning makes the entire Imp action Manual", () => {
    const game = impair(proofGame(["imp", "soldier", "chef"]), "p1", "soberHealthy");
    expect(eligible(game, "imp", { target: pick(game, "p1") }).kind).toBe("manual");
  });

  it("healthy Soldier and ordinary targets remain automated within the reviewed envelope", () => {
    const game = proofGame(["imp", "soldier", "chef"]);
    expect(eligible(game, "imp").kind).toBe("automated");
    expect(eligible(game, "imp", { target: pick(game, "p1") }).kind).toBe("automated");
    expect(eligible(game, "imp", { target: pick(game, "p2") }).kind).toBe("automated");
  });

  it.each(["fool", "sailor", "tealady", "innkeeper", "lleech", "nodashii", "amnesiac"])("unreviewed %s interaction requires the whole action Manual", role => {
    const game = proofGame(["imp", role, "chef"]);
    expect(eligible(game, "imp", { target: pick(game, "p2") }).kind).toBe("manual");
  });

  it("Mayor targeting is Manual without disabling an unrelated target", () => {
    const game = proofGame(["imp", "mayor", "chef"]);
    expect(eligible(game, "imp", { target: pick(game, "p1") }).kind).toBe("manual");
    expect(eligible(game, "imp", { target: pick(game, "p2") }).kind).toBe("automated");
  });

  it("ambiguous successor registration keeps a star-pass wholly Manual", () => {
    const game = proofGame(["imp", "recluse", "poisoner"]);
    expect(eligible(game, "imp", { target: pick(game, "p0") }).kind).toBe("manual");
    expect(eligible(game, "imp", { target: pick(game, "p2") }).kind).toBe("automated");
  });

  it("Vortox gates healthy and impaired Empath, but not unrelated choices", () => {
    const game = proofGame(["empath", "vortox", "chef"]);
    expect(eligible(game, "empath").kind).toBe("manual");
    expect(eligible(impair(game, "p0"), "empath").kind).toBe("manual");
    const poisoner = proofGame(["poisoner", "vortox", "chef"]);
    expect(eligible(poisoner, "poisoner", { target: pick(poisoner, "p2") }).kind).toBe("automated");
  });

  it("Vortox impairment, death and role changes are evaluated from current state", () => {
    const game = proofGame(["empath", "vortox", "chef"]);
    for (const next of [impair(game, "p1"), patchPlayer(game, "p1", { alive: false }), patchPlayer(game, "p1", { actualRole: "imp" })]) expect(eligible(next, "empath").kind).toBe("automated");
    expect(eligible(impair(game, "p1", "soberHealthy"), "empath").kind).toBe("manual");
    const revived = patchPlayer(patchPlayer(game, "p1", { alive: false }), "p1", { alive: true });
    expect(eligible(revived, "empath").kind).toBe("manual");
  });

  it("custom Vortox receives no official mechanic and makes the interaction Manual", () => {
    const game = proofGame(["empath", "vortox", "chef"]);
    const query = createRulesQuery(game, homebrewEnv("vortox"));
    expect(query.modifierGate("empath", ["information"]).kind).toBe("clear");
    expect(automationEligibility({ query, descriptor: CANONICAL_ABILITY_SEMANTICS.get("empath")!, actor: bind(game, "p0"), roleId: "empath" }).kind).toBe("manual");
  });

  it("ordinary Empath stays automatic while ambiguous registration and modifiers are wholly Manual", () => {
    const game = proofGame(["empath", "imp", "chef"]);
    expect(eligible(game, "empath").kind).toBe("automated");
    expect(eligible(patchPlayer(game, "p2", { actualRole: "spy" }), "empath").kind).toBe("manual");
    expect(eligible({ ...game, fabled: ["fibbin"] }, "empath").kind).toBe("manual");
  });

  it("preflight is pure and does not turn missing ordinary player choice into Manual", () => {
    const game = proofGame(["poisoner", "imp", "chef"]);
    const before = JSON.stringify(game);
    expect(eligible(game, "poisoner").kind).toBe("automated");
    expect(eligible(game, "poisoner", { target: pick(game, "p2") }).kind).toBe("automated");
    expect(JSON.stringify(game)).toBe(before);
    expect(proofEnv().registry.get("vortox")).toBeDefined(); // script presence alone never gates
  });
});
