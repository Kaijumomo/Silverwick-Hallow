// @vitest-environment node
// Treacherous 30th slice 2C -- Shabaloth. Production semantics.
import { describe, expect, it } from "vitest";
import { bind, homebrewEnv, impair, patchPlayer, pick, plan, planned, proofGame, proofRegistry, proofScript, request } from "@/test/proofFixtures";
import { createRulesQuery } from "@/stores/rulesQuery";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { regurgitable, shabalothTokens } from "./shabaloth";
import type { StorytellerLobbyRecord } from "@/stores/types";

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

  it("a dead target is skipped, but the chosen players still carry the DEAD token", () => {
    const one = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    const next = planned(run(one, "p1", "p2"));
    expect(next.players.p2!.alive).toBe(false);
    const both = patchPlayer(one, "p2", { alive: false });
    const marked = planned(run(both, "p1", "p2"));
    expect(chosen(marked).sort()).toEqual(["p1", "p2"]);
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

  it("both chosen players protected, none already dead: the wake completes with no death and no token (no empty effect step)", () => {
    const g = proofGame(ROLES);
    const monk = planned(plan(g, request(g, "p3", "monk", { target: pick(g, "p1") })));
    const guarded = patchPlayer(monk, "p2", { effects: [...monk.players.p2!.effects, { id: "inn", type: "cannotDie", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 } } as never] });
    const result = run(guarded, "p1", "p2");
    // Completed, nothing changed: nobody died and no token was placed.
    expect(result).toEqual({ ok: true, changed: false });
  });

  it("a Monk-protected player chosen twice survives and the wake completes", () => {
    const g = proofGame(ROLES);
    const monk = planned(plan(g, request(g, "p3", "monk", { target: pick(g, "p1") })));
    const result = run(monk, "p1", "p1");
    expect(result).toEqual({ ok: true, changed: false });
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

const query = (g: StorytellerLobbyRecord) => createRulesQuery(g, { registry: proofRegistry, script: proofScript, semantics: CANONICAL_ABILITY_SEMANTICS, modifiers: [] });
const chosen = (g: StorytellerLobbyRecord) => Object.keys(g.players).filter((id) => g.players[id]!.effects.some((e) => e.type === "shabalothChosen" && e.state === "active"));
const night = (g: StorytellerLobbyRecord, day: number) => ({ ...g, day }) as StorytellerLobbyRecord;

describe("Shabaloth -- the DEAD tokens (WP-6)", () => {
  it("a chosen player who dies carries the DEAD token; a protected survivor carries none", () => {
    const g = proofGame(ROLES);
    const safe = planned(plan(g, request(g, "p3", "monk", { target: pick(g, "p1") })));
    const next = planned(run(safe, "p1", "p2"));
    expect(next.players.p1!.alive).toBe(true);
    expect(chosen(next)).toEqual(["p2"]);
    expect(next.players.p2!.effects.find((e) => e.type === "shabalothChosen")).toMatchObject({ sourceCharacter: "shabaloth", lifetime: { kind: "manual" } });
  });

  it("a chosen player who was already dead still carries the DEAD token (they can be regurgitated)", () => {
    const g = patchPlayer(proofGame(ROLES), "p1", { alive: false });
    const next = planned(run(g, "p1", "p2"));
    expect(chosen(next).sort()).toEqual(["p1", "p2"]);
  });

  it("the same player twice carries one token", () => {
    const next = planned(run(proofGame(ROLES), "p1", "p1"));
    expect(next.players.p1!.effects.filter((e) => e.type === "shabalothChosen")).toHaveLength(1);
  });

  it("the tokens move to the new targets each night, and nothing else is touched", () => {
    const first = planned(run(night(proofGame(ROLES), 2), "p1", "p2"));
    const second = planned(run(night(first, 3), "p4", "p5"));
    expect(chosen(second).sort()).toEqual(["p4", "p5"]);
    expect(shabalothTokens(query(second), bind(second, "p0"))).toHaveLength(2);
    expect(second.players.p1!.alive).toBe(false);
  });

  it("an impaired Shabaloth neither kills nor moves anything", () => {
    const first = planned(run(night(proofGame(ROLES), 2), "p1", "p2"));
    const drunk = impair(night(first, 3), "p0");
    expect(run(drunk, "p4", "p5")).toEqual({ ok: true, changed: false });
  });
});

describe("Shabaloth -- who may be regurgitated at Dusk (WP-6)", () => {
  const afterNight2 = () => planned(run(night(proofGame(ROLES), 2), "p1", "p2"));
  const offered = (g: StorytellerLobbyRecord) => regurgitable(query(g), bind(g, "p0")).map((c) => c.target.playerId).sort();

  it("offers last night's chosen players who are dead, and nobody before the Shabaloth has chosen", () => {
    const g = night(afterNight2(), 3);
    expect(offered(g)).toEqual(["p1", "p2"]);
    expect(offered(night(proofGame(ROLES), 3))).toEqual([]);
  });

  it("includes a player who was already dead when attacked, and leaves out a protected survivor", () => {
    const dead = patchPlayer(night(proofGame(ROLES), 2), "p1", { alive: false });
    const safe = planned(plan(dead, request(dead, "p3", "monk", { target: pick(dead, "p2") })));
    const g = night(planned(run(safe, "p1", "p2")), 3);
    expect(offered(g)).toEqual(["p1"]);
  });

  it("offers nothing on the night the Shabaloth acts (its old tokens have moved), nor when it is dead or impaired", () => {
    const done = planned(run(night(afterNight2(), 3), "p4", "p5"));
    expect(offered(done)).toEqual([]);
    const g = night(afterNight2(), 3);
    expect(offered(patchPlayer(g, "p0", { alive: false }))).toEqual([]);
    expect(offered(impair(g, "p0"))).toEqual([]);
  });

  it("a choice from two nights ago is no longer offered", () => {
    expect(offered(night(afterNight2(), 4))).toEqual([]);
  });
});
