import { describe, expect, it } from "vitest";
import type { EffectRecord } from "@/stores/types";
import { officialEffectPresentation, officialNotationRole } from "./officialReminderPresentation";
import { bind, impair, proofGame, proofRegistry, proofScript, reseat } from "@/test/proofFixtures";
import { createRulesQuery } from "@/stores/rulesQuery";

const effect = (id: string, type: string, sourceCharacter?: string, state: EffectRecord["state"] = "active"): EffectRecord =>
  ({ id, type, sourceCharacter, state, lifetime: { kind: "manual" }, expiry: { kind: "none" } });

describe("official reminder presentation", () => {
  it("derives applicability from the bound source, including impairment, suppression, death and seat replacement", () => {
    const original = proofGame(["poisoner", "chef"]);
    original.players.p1!.effects = [{ ...effect("poison", "poisoned", "poisoner"), sourceParticipant: {
      kind: "participant", ...bind(original, "p0"), nameAtTime: "Player 0" } }];
    const details = (game: typeof original) => officialEffectPresentation(game.players.p1!, {
      query: createRulesQuery(game, { registry: proofRegistry, script: proofScript }), target: bind(game, "p1"),
    }).tokens[0]!.detail;
    expect(details(original)).toContain("Currently affecting");
    expect(details(impair(original, "p0"))).toContain("Not currently affecting");
    expect(details(original)).toContain("Currently affecting");
    const dead = { ...original, players: { ...original.players, p0: { ...original.players.p0!, alive: false } } };
    expect(details(dead)).toContain("Not currently affecting");
    expect(details(reseat(original, "p0"))).not.toContain(": Currently affecting");
    const suppressed = { ...original, players: { ...original.players, p1: { ...original.players.p1!,
      effects: [{ ...original.players.p1!.effects[0]!, state: "suppressed" as const }] } } };
    expect(details(suppressed)).toContain("Not currently affecting");
    expect(original.players.p1!.effects[0]!.state).toBe("active");
  });
  it("uses the canonical Poisoner and Monk token labels for their exact effect types", () => {
    const view = officialEffectPresentation({ effects: [effect("p", "poisoned", "poisoner"), effect("m", "safeFromDemon", "monk")] });
    expect(view.tokens.map(token => [token.role.id, token.label])).toEqual([["poisoner", "Poisoned"], ["monk", "Safe"]]);
    expect(view.fallback).toEqual([]);
  });

  it("keeps manual and other-source effects distinct without claiming official artwork", () => {
    const view = officialEffectPresentation({ effects: [effect("p", "poisoned", "poisoner"), effect("manual", "poisoned"),
      effect("other", "poisoned", "pukka"), effect("bookkeeping", "protected", "monk")] });
    expect(view.tokens[0]!.instances.map(item => item.id)).toEqual(["p"]);
    expect(view.fallback.map(group => [group.indicator.label, group.activeCount])).toEqual([["Poisoned", 2], ["Protected", 1]]);
  });

  it("retains multiple sources and ignores suppressed instances without mutating records", () => {
    const first = Object.freeze(effect("first", "poisoned", "poisoner"));
    const second = Object.freeze(effect("second", "poisoned", "poisoner"));
    const effects = [first, second, effect("suppressed", "safeFromDemon", "monk", "suppressed")];
    const view = officialEffectPresentation({ effects });
    expect(view.tokens).toHaveLength(1);
    expect(view.tokens[0]!.instances).toEqual([first, second]);
    expect(effects).toHaveLength(3);
  });

  it("moves derived display with authoritative effects without retaining an old-target token", () => {
    const poison = effect("resolution:poison", "poisoned", "poisoner");
    expect(officialEffectPresentation({ effects: [poison] }).tokens).toHaveLength(1);
    expect(officialEffectPresentation({ effects: [] }).tokens).toHaveLength(0);
    expect(officialEffectPresentation({ effects: [poison] }).tokens[0]!.instances).toEqual([poison]);
  });

  it("only recognizes exact publisher notation label/source pairs", () => {
    expect(officialNotationRole("fortuneteller", "Red Herring")?.id).toBe("fortuneteller");
    expect(officialNotationRole("poisoner", "Poisoned")?.id).toBe("poisoner");
    expect(officialNotationRole(undefined, "Poisoned")).toBeUndefined();
    expect(officialNotationRole("monk", "Poisoned")).toBeUndefined();
    expect(officialNotationRole("invented", "Safe")).toBeUndefined();
    expect(officialNotationRole("poisoner", "poisoned")).toBeUndefined();
  });
});
