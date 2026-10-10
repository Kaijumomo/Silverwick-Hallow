import { describe, expect, it } from "vitest";
import { officialEffectPresentation } from "./officialReminderPresentation";
import { bind, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { createRulesQuery } from "@/stores/rulesQuery";
import type { EffectRecord } from "@/stores/types";

const fact = (id = "herring"): EffectRecord => ({ id, type: "fortuneTellerRedHerring", state: "active",
  lifetime: { kind: "manual" }, expiry: { kind: "none" } });

describe("B3 Red Herring official reminder", () => {
  it("draws the existing source-free fact as the Fortune Teller's official token", () => {
    const record = Object.freeze(fact());
    const view = officialEffectPresentation({ effects: [record] });
    expect(view.tokens).toHaveLength(1);
    expect(view.tokens[0]).toMatchObject({ role: { id: "fortuneteller" }, label: "Red Herring", instances: [record] });
    expect(view.fallback).toEqual([]);
    expect(record).not.toHaveProperty("sourceCharacter");
    expect(record).not.toHaveProperty("sourceParticipant");
  });

  it("retains each authoritative record behind a single token without selecting or deleting one", () => {
    const records = [fact("first"), fact("second")];
    const view = officialEffectPresentation({ effects: records });
    expect(view.tokens).toHaveLength(1);
    expect(view.tokens[0]!.instances).toEqual(records);
    expect(records).toHaveLength(2);
  });

  it("continues to display the fact after death, character changes, impairment and later Nights", () => {
    const game = proofGame(["fortuneteller", "chef", "imp"], "night", 1);
    game.players.p1!.effects = [fact()];
    game.players.p0!.alive = false;
    game.players.p0!.actualRole = "monk";
    game.players.p0!.effects = [{ ...fact("poison"), type: "poisoned" }];
    game.players.p1!.alive = false;
    game.players.p1!.actualRole = "imp";
    game.players.p1!.actualAlignment = "evil";
    game.day = 4;
    const view = officialEffectPresentation(game.players.p1!, {
      query: createRulesQuery(game, { registry: proofRegistry, script: proofScript }), target: bind(game, "p1"),
    });
    expect(view.tokens[0]).toMatchObject({ label: "Red Herring", detail: "Red Herring: Currently affecting this player" });
    expect(game.players.p1!.effects).toEqual([fact()]);
  });
});
