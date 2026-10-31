// Treacherous 30th slice 2C -- Shabaloth. Production semantics.
import { describe, expect, it } from "vitest";
import { homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";

// Seats: p0 shabaloth, p1 chef, p2 empath, p3 monk, p4 saint, p5 baron, p6 poisoner
const ROLES = ["shabaloth", "chef", "empath", "monk", "saint", "baron", "poisoner"];
const run = (g: ReturnType<typeof proofGame>, a: string, b: string) => plan(g, request(g, "p0", "shabaloth", { targets: pick(g, a, b) }));

describe("Shabaloth", () => {
  it("kills both chosen players", () => {
    const g = proofGame(ROLES);
    const next = planned(run(g, "p1", "p2"));
    expect(next.players.p1!.alive).toBe(false);
    expect(next.players.p2!.alive).toBe(false);
    expect(next.players.p3!.alive).toBe(true);
  });

  it("a dead target is skipped; two dead targets change nothing", () => {
    const one = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    const next = planned(run(one, "p1", "p2"));
    expect(next.players.p2!.alive).toBe(false);
    const both = patchPlayer(one, "p2", { alive: false });
    expect(run(both, "p1", "p2")).toEqual({ ok: true, changed: false });
  });

  it("the same player twice dies once", () => {
    const g = proofGame(ROLES);
    expect(planned(run(g, "p1", "p1")).players.p1!.alive).toBe(false);
  });

  it("a Monk-protected target survives and the other still dies", () => {
    const g = proofGame(ROLES);
    const safe = planned(plan(g, request(g, "p3", "monk", { target: pick(g, "p1") })));
    const next = planned(run(safe, "p1", "p2"));
    expect(next.players.p1!.alive).toBe(true);
    expect(next.players.p2!.alive).toBe(false);
  });

  it("an impaired Shabaloth kills no one; Night 1 and homebrew are refused", () => {
    const g = impair(proofGame(ROLES), "p0");
    expect(run(g, "p1", "p2")).toEqual({ ok: true, changed: false });
    const first = proofGame(ROLES, "night", 1);
    expect(run(first, "p1", "p2")).toMatchObject({ ok: false, code: "notApplicable" });
    const h = proofGame(ROLES);
    expect(plan(h, request(h, "p0", "shabaloth", { targets: pick(h, "p1", "p2") }), homebrewEnv("shabaloth"))).toMatchObject({ ok: false, code: "unsupported" });
  });
});
