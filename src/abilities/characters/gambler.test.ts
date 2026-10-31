// Treacherous 30th slice 2C -- Gambler. Production semantics.
import { describe, expect, it } from "vitest";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";
import type { AbilityInputValue } from "@/abilities/semantics";

// Seats: p0 gambler, p1 chef, p2 empath, p3 monk, p4 imp, p5 saint, p6 poisoner
const ROLES = ["gambler", "chef", "empath", "monk", "imp", "saint", "poisoner"];
const guess = (...roleIds: string[]): AbilityInputValue => ({ kind: "character", roleIds });
const run = (g: ReturnType<typeof proofGame>, target: string, role: string, extra: Record<string, AbilityInputValue> = {}) =>
  plan(g, request(g, "p0", "gambler", { target: pick(g, target), guess: guess(role), ...extra }));

describe("Gambler", () => {
  it("a right guess changes nothing", () => {
    const g = proofGame(ROLES);
    expect(run(g, "p1", "chef")).toEqual({ ok: true, changed: false });
  });

  it("a wrong guess kills the Gambler", () => {
    const g = proofGame(ROLES);
    const next = planned(run(g, "p1", "empath"));
    expect(next.players.p0!.alive).toBe(false);
    expect(next.players.p1!.alive).toBe(true);
  });

  it("may choose themself and the dead", () => {
    const g = patchPlayer(proofGame(ROLES), "p2", { alive: false });
    expect(run(g, "p2", "empath")).toEqual({ ok: true, changed: false });
    expect(run(g, "p0", "gambler")).toEqual({ ok: true, changed: false });
    expect(planned(run(g, "p0", "chef")).players.p0!.alive).toBe(false);
  });

  it("an impaired Gambler guesses but cannot die", () => {
    const g = impair(proofGame(ROLES), "p0");
    expect(run(g, "p1", "empath")).toEqual({ ok: true, changed: false });
  });

  it("an Innkeeper-style cannotDie Effect protects a wrong Gambler", () => {
    const g = proofGame(["gambler", "innkeeper", "empath", "monk", "imp", "saint", "chef"]);
    const guardedGame = planned(plan(g, request(g, "p1", "innkeeper", { targets: pick(g, "p0", "p2"),
      [`innkeeper:drunk:${JSON.stringify([bind(g, "p0").participantId, bind(g, "p2").participantId])}`]: pick(g, "p2") })));
    expect(run(guardedGame, "p3", "chef")).toEqual({ ok: true, changed: false });
  });

  it("a Spy's ambiguous registration stays Manual (never guessed)", () => {
    const g = patchPlayer(proofGame(ROLES), "p6", { actualRole: "spy" });
    const result = run(g, "p6", "chef");
    expect(result).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("does not act on Night 1, needs exactly one guessed character, and homebrew inherits nothing", () => {
    const first = proofGame(ROLES, "night", 1);
    expect(run(first, "p1", "chef")).toMatchObject({ ok: false, code: "notApplicable" });
    const g = proofGame(ROLES);
    expect(plan(g, request(g, "p0", "gambler", { target: pick(g, "p1"), guess: guess() }))).toMatchObject({ ok: false });
    expect(plan(g, request(g, "p0", "gambler", { target: pick(g, "p1"), guess: guess("chef") }), homebrewEnv("gambler"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
