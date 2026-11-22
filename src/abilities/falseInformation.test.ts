// @vitest-environment node
// SV-5h: the shared false-information rule on its own (https://wiki.bloodontheclocktower.com/Vortox): "Townsfolk abilities yield false
// info." "Even if they are drunk or poisoned, it must be false." It "does not affect information gained by other means". The rule is
// exercised through a TEST descriptor that declares its truth, so nothing here depends on which real characters are taught.
import { describe, expect, it } from "vitest";
import { bind, homebrewEnv, impair, num, patchPlayer, plan, proofEnv, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { automationEligibility } from "@/abilities/automationEligibility";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { createRulesQuery } from "@/stores/rulesQuery";
import { passiveInformationModifiers, townsfolkInformationFalse } from "./characters/passiveRules";
import { answerOf, ask, outcome } from "./characters/shared";
import { FALSE_INFORMATION_REFUSED, booleanTruth, falseNumbers, numberTruth, unknownTruth } from "./falseInformation";
import type { StorytellerLobbyRecord } from "@/stores/types";

/** An Oracle-shaped test ability: the truth is a fixed 2; the Storyteller gives the number while the rule applies. */
const TRUE_VALUE = 2;
const seen: { mustBeFalse?: boolean }[] = [];
const testOracle = (truth: AbilityDescriptor["truth"]): AbilityDescriptor => ({
  ...CANONICAL_ABILITY_SEMANTICS.get("oracle")!,
  evaluator: (context) => {
    seen.push({ mustBeFalse: context.mustBeFalse });
    const told = answerOf(context.inputs, "communicated", "number");
    if (context.mustBeFalse || context.simulated || !context.functioning) {
      if (!told) return ask("Choose", { id: "communicated", kind: "number", source: "storyteller", label: "Shown" });
      return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "oracle-other-night", values: [{ requirementId: "deadEvil", kind: "number", value: told.value }] }]);
    }
    return outcome([{ domain: "information", recipient: context.actor.binding, informationActionId: "oracle-other-night", values: [{ requirementId: "deadEvil", kind: "number", value: TRUE_VALUE }] }]);
  },
  truth,
});
const semanticsWith = (descriptor: AbilityDescriptor): AbilitySemanticsRegistry => new Map([...CANONICAL_ABILITY_SEMANTICS, [descriptor.roleId, descriptor]]);
const taught = semanticsWith(testOracle(() => numberTruth("deadEvil", [TRUE_VALUE])));
const env = (semantics = taught) => proofEnv({ semantics });
const give = (g: StorytellerLobbyRecord, value?: number, semantics = taught) =>
  plan(g, request(g, "p0", "oracle", value === undefined ? {} : { communicated: num(value) }), env(semantics));
const base = () => proofGame(["oracle", "vortox", "chef", "empath", "saint"]);

describe("SV-5h: when information must be false", () => {
  it("a living, sober and healthy Vortox: every canonical Townsfolk ability, never an Outsider, Minion or Demon", () => {
    const q = proofQuery(base());
    expect(townsfolkInformationFalse(q, "oracle")).toEqual({ known: true, value: true });
    expect(townsfolkInformationFalse(q, "chef")).toEqual({ known: true, value: true });
    for (const role of ["saint", "poisoner", "imp", "harlot"]) expect(townsfolkInformationFalse(q, role)).toEqual({ known: true, value: false });
  });

  it("ends at once when the Vortox dies, is poisoned or drunk, or stops being the Vortox; unknown functioning stays unknown", () => {
    const g = base();
    for (const next of [patchPlayer(g, "p1", { alive: false }), impair(g, "p1"), impair(g, "p1", "drunk"), patchPlayer(g, "p1", { actualRole: "imp" })])
      expect(townsfolkInformationFalse(proofQuery(next), "oracle")).toEqual({ known: true, value: false });
    expect(townsfolkInformationFalse(proofQuery(impair(g, "p1", "soberHealthy")), "oracle").known).toBe(false);
  });

  it("two Vortoxes: any one working is enough", () => {
    const g = impair(proofGame(["oracle", "vortox", "chef", "vortox", "saint"]), "p1");
    expect(townsfolkInformationFalse(proofQuery(g), "oracle")).toEqual({ known: true, value: true });
  });

  it("a homebrew character reusing the Vortox id brings no rule", () => {
    const query = createRulesQuery(base(), homebrewEnv("vortox"));
    expect(townsfolkInformationFalse(query, "oracle")).toEqual({ known: true, value: false });
  });
});

describe("SV-5h: the Vortox's information modifier", () => {
  it("gates a Townsfolk ability that has not declared its truth (by hand, as before)", () => {
    const g = base();
    expect(passiveInformationModifiers(proofQuery(g), "oracle")).toHaveLength(1);
    expect(give(g, undefined, CANONICAL_ABILITY_SEMANTICS)).toMatchObject({ ok: false });
    expect(proofQuery(g).modifierGate("empath", ["information"]).kind).toBe("gated");
  });

  it("does not gate one that declares it: the coordinator applies the shared rule", () => {
    const g = base();
    expect(passiveInformationModifiers(proofQuery(g), "oracle", true)).toEqual([]);
    expect(createRulesQuery(g, env()).modifierGate("oracle", ["information", "registration"]).kind).toBe("clear");
  });

  it("still gates while a Vortox's functioning is unknown", () => {
    const g = impair(base(), "p1", "soberHealthy");
    expect(passiveInformationModifiers(proofQuery(g), "oracle", true)).toHaveLength(1);
  });
});

describe("SV-5h: the coordinator's one generic enforcement", () => {
  it("the evaluator is told the answer must be false, and the true answer is refused", () => {
    seen.length = 0;
    const g = base();
    expect(give(g)).toMatchObject({ ok: false, code: "needsInput" });
    expect(seen.at(-1)).toEqual({ mustBeFalse: true });
    expect(give(g, TRUE_VALUE)).toMatchObject({ ok: false, code: "illegal", message: FALSE_INFORMATION_REFUSED });
    expect(give(g, 0)).toMatchObject({ ok: true, changed: true });
    expect(give(g, 3)).toMatchObject({ ok: true, changed: true });
  });

  it("a drunk or poisoned Townsfolk still gets false information", () => {
    const g = impair(base(), "p0");
    expect(give(g, TRUE_VALUE)).toMatchObject({ ok: false, code: "illegal" });
    expect(give(g, 1)).toMatchObject({ ok: true, changed: true });
  });

  it("a Drunk only shown the Townsfolk has no Townsfolk ability: the Storyteller's free choice, true answers included", () => {
    seen.length = 0;
    const g = patchPlayer(base(), "p0", { actualRole: "drunk", shownRole: "oracle", behaviorMode: "drunk_fake_role_behavior" });
    expect(give(g, TRUE_VALUE)).toMatchObject({ ok: true, changed: true });
    expect(seen.at(-1)).toEqual({ mustBeFalse: undefined });
  });

  it("no living, working Vortox: true information as before", () => {
    const g = patchPlayer(base(), "p1", { alive: false });
    expect(give(g)).toMatchObject({ ok: true, changed: true });
    expect(give(impair(base(), "p1"))).toMatchObject({ ok: true, changed: true });
  });

  it("a truth that cannot be worked out sends the step to the Storyteller, by hand", () => {
    const semantics = semanticsWith(testOracle(() => unknownTruth("Nobody can tell.")));
    expect(give(base(), 0, semantics)).toMatchObject({ ok: false, code: "unsupported", message: "Nobody can tell." });
  });

  it("the preflight agrees: automated while the truth is known", () => {
    const g = base();
    const query = createRulesQuery(g, env());
    const descriptor = taught.get("oracle")!;
    expect(automationEligibility({ query, descriptor, actor: bind(g, "p0"), roleId: "oracle" }).kind).toBe("automated");
  });
});

describe("SV-5h: the truth helpers", () => {
  it("a Yes / No: only the ruled or certain answer is true", () => {
    const truth = booleanTruth("x", true);
    expect(truth.known && truth.isTrue({ requirementId: "x", kind: "boolean", value: true })).toBe(true);
    expect(truth.known && truth.isTrue({ requirementId: "x", kind: "boolean", value: false })).toBe(false);
    expect(truth.known && truth.isTrue({ requirementId: "y", kind: "boolean", value: true })).toBe(false);
    const open = booleanTruth("x", undefined);
    expect(open.known && open.isTrue({ requirementId: "x", kind: "boolean", value: true })).toBe(false);
  });

  it("a number is certainly true only when it is the one possible answer", () => {
    expect(falseNumbers([1, 2, 3, 4], [2])).toEqual([1, 3, 4]);
    // A Spy or Recluse could make 1 or 3 true: each is false under one of the registrations the Storyteller may rule.
    expect(falseNumbers([1, 2, 3, 4], [1, 3])).toEqual([1, 2, 3, 4]);
    const truth = numberTruth("n", [1, 3]);
    expect(truth.known && truth.isTrue({ requirementId: "n", kind: "number", value: 1 })).toBe(false);
  });
});
