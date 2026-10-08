import { describe, expect, it } from "vitest";
import type { EffectRecord } from "@/stores/types";
import { officialEffectPresentation, officialNotationRole } from "./officialReminderPresentation";

const effect = (id: string, type: string, sourceCharacter?: string, state: EffectRecord["state"] = "active"): EffectRecord =>
  ({ id, type, sourceCharacter, state, lifetime: { kind: "manual" }, expiry: { kind: "none" } });

describe("official reminder presentation", () => {
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
