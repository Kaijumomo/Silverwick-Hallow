import { describe, expect, it } from "vitest";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { createRulesQuery } from "@/stores/rulesQuery";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Official Monk examples: https://wiki.bloodontheclocktower.com/Monk
// Source loss: https://wiki.bloodontheclocktower.com/Abilities
// These chains use production evaluators to create the effects under test.
const roles = ["monk", "poisoner", "imp", "mayor", "soldier", "chef", "slayer"];
const protect = (game: StorytellerLobbyRecord, target: string) =>
  planned(plan(game, request(game, "p0", "monk", { target: pick(game, target) })));
const poison = (game: StorytellerLobbyRecord, target: string) =>
  planned(plan(game, request(game, "p1", "poisoner", { target: pick(game, target) })));
const attack = (game: StorytellerLobbyRecord, target: string) =>
  plan(game, request(game, "p2", "imp", { target: pick(game, target) }));

describe("B2c: Monk and Trouble Brewing interaction chains", () => {
  it("Monk-protected Mayor survives the Imp without invoking a bounce or changing history", () => {
    const game = protect(proofGame(roles), "p3");
    const before = JSON.stringify(game);
    expect(proofQuery(game).protectedFrom(bind(game, "p3"), "demon")).toEqual({ known: true, value: true });
    expect(attack(game, "p3")).toEqual({ ok: true, changed: false });
    expect(JSON.stringify(game)).toBe(before);
  });

  it.each(["dead", "poisoned", "changed", "unknown"])("%s Monk does not settle the Mayor's unresolved death interaction", kind => {
    let game = protect(proofGame(roles), "p3");
    if (kind === "dead") game = patchPlayer(game, "p0", { alive: false });
    if (kind === "poisoned") game = poison(game, "p0");
    if (kind === "changed") game = patchPlayer(game, "p0", { actualRole: "chef" });
    if (kind === "unknown") game = impair(game, "p0", "soberHealthy");
    const before = JSON.stringify(game);
    expect(proofQuery(game).protectedFrom(bind(game, "p3"), "demon")).toMatchObject({ known: false });
    expect(attack(game, "p3")).toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(game)).toBe(before);
  });

  it("Monk protection is independent of the protected Soldier's own poisoning", () => {
    const poisoned = poison(proofGame(roles), "p4");
    expect(planned(attack(poisoned, "p4")).players.p4!.alive).toBe(false);
    const protectedGame = protect(poisoned, "p4");
    expect(proofQuery(protectedGame).abilityFunctions(bind(protectedGame, "p4"))).toEqual({ known: true, value: false });
    expect(attack(protectedGame, "p4")).toEqual({ ok: true, changed: false });
  });

  it("a Poisoner-disabled Monk produces no protection when choosing a target", () => {
    const game = poison(proofGame(roles), "p0");
    expect(plan(game, request(game, "p0", "monk", { target: pick(game, "p5") }))).toEqual({ ok: true, changed: false });
    expect(game.players.p5!.effects).toEqual([]);
    expect(planned(attack(game, "p5")).players.p5!.alive).toBe(false);
  });

  it("killing the Poisoner restores an already placed Monk protection without rewriting its effect", () => {
    const protectedGame = protect(proofGame(roles), "p5");
    const suppressed = poison(protectedGame, "p0");
    const effect = suppressed.players.p5!.effects[0]!;
    expect(proofQuery(suppressed).protectedFrom(bind(suppressed, "p5"), "demon")).toEqual({ known: true, value: false });
    const recovered = planned(attack(suppressed, "p1"));
    expect(recovered.players.p5!.effects[0]).toBe(effect);
    expect(proofQuery(recovered).protectedFrom(bind(recovered, "p5"), "demon")).toEqual({ known: true, value: true });
    expect(attack(recovered, "p5")).toEqual({ ok: true, changed: false });
  });

  it("killing the Monk stops protection before a subsequent death attempt", () => {
    const protectedGame = protect(proofGame(roles), "p5");
    const lost = planned(attack(protectedGame, "p0"));
    expect(proofQuery(lost).protectedFrom(bind(lost, "p5"), "demon")).toEqual({ known: true, value: false });
    expect(planned(attack(lost, "p5")).players.p5!.alive).toBe(false);
  });

  it("Monk-protected Imp self-target causes neither death nor succession", () => {
    const game = protect(proofGame(roles), "p2");
    expect(attack(game, "p2")).toEqual({ ok: true, changed: false });
    expect(game.players.p1!.actualRole).toBe("poisoner");
    expect(game.players.p2!.alive).toBe(true);
  });

  it("Demon-specific protection does not prevent a Slayer killing the Imp", () => {
    const protectedGame = protect(proofGame(roles), "p2");
    // Even a Safe effect deliberately retained by manual correction past dawn
    // cannot become protection from a non-Demon ability.
    const game = patchPlayer({ ...protectedGame, phase: "day" }, "p2", { effects: [{
      ...protectedGame.players.p2!.effects[0]!, lifetime: { kind: "manual" }, expiry: { kind: "none" },
    }] });
    const result = plan(game, request(game, "p6", "slayer", { target: pick(game, "p2") }));
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, changed: true });
    const next = planned(result);
    expect(next.players.p2!.alive).toBe(false);
    expect(proofQuery(game).protectedFrom(bind(game, "p2"), "any")).toEqual({ known: true, value: false });
  });
});

describe("B2c: supported protection does not broaden unverified interactions", () => {
  it("a homebrew Mayor still has unknown protection at both query and coordinator boundaries", () => {
    const game = protect(proofGame(roles), "p3");
    const environment = homebrewEnv("mayor");
    expect(createRulesQuery(game, environment).protectedFrom(bind(game, "p3"), "demon")).toMatchObject({ known: false });
    expect(plan(game, request(game, "p2", "imp", { target: pick(game, "p3") }), environment)).toMatchObject({ ok: false, code: "unsupported" });
  });

  it.each(["fool", "sailor", "lleech", "zombuul"])("does not infer protection precedence for %s", role => {
    const game = patchPlayer(protect(proofGame(roles), "p3"), "p3", { actualRole: role });
    expect(proofQuery(game).protectedFrom(bind(game, "p3"), "demon")).toMatchObject({ known: false });
    expect(attack(game, "p3")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("Safe does not settle non-Demon attacks on the Mayor", () => {
    const game = protect(proofGame(roles), "p3");
    expect(proofQuery(game).protectedFrom(bind(game, "p3"), "any")).toMatchObject({ known: false });
  });

  it.each(["tealady", "innkeeper"])("preserves the existing external %s protection boundary", role => {
    const game = patchPlayer(protect(proofGame(roles), "p3"), "p5", { actualRole: role });
    expect(proofQuery(game).protectedFrom(bind(game, "p3"), "demon")).toMatchObject({ known: false });
    expect(attack(game, "p3")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("generic Protected notation is not effective Monk protection", () => {
    const protectedGame = protect(proofGame(roles), "p3");
    const game = patchPlayer(protectedGame, "p3", { effects: [{ ...protectedGame.players.p3!.effects[0]!, type: "protected" }] });
    expect(proofQuery(game).protectedFrom(bind(game, "p3"), "demon")).toMatchObject({ known: false });
    expect(attack(game, "p3")).toMatchObject({ ok: false, code: "unsupported" });
  });

  it.each(["pukka", "nodashii", "fanggu"])("%s harmful effects outside supported coverage keep the whole action manual", role => {
    const game = patchPlayer(protect(proofGame(roles), "p5"), "p2", { actualRole: role });
    const before = JSON.stringify(game);
    expect(plan(game, request(game, "p0", "monk", { target: pick(game, "p4") }))).toMatchObject({ ok: false, code: "unsupported" });
    expect(plan(game, request(game, "p2", role, { target: pick(game, "p5") }))).toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(game)).toBe(before);
  });

  it("Monk protection never makes Vortox-affected information resolve incorrectly", () => {
    let game = proofGame(["monk", "poisoner", "vortox", "empath", "soldier", "chef", "slayer"]);
    game = protect(game, "p3");
    const before = JSON.stringify(game);
    expect(plan(game, request(game, "p3", "empath"))).toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(game)).toBe(before);
  });
});
