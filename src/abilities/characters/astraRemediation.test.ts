// Phase 10F -- SOL-10F-A1..A10 (PHASE10F Section 31): permanent regressions
// for Astra's Slice 7 counterexamples and the A9 / A10 contract cases.
// Each `describe` names its finding; Astra's original reproduction is the
// first case where one exists.
import { describe, expect, it } from "vitest";
import { activeModifiers, type ModifierDefinition } from "@/abilities/modifiers";
import { abilityInputValueError } from "@/stores/abilityResolution";
import { impair, num, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofRegistry, request, requirementIds, yes } from "@/test/proofFixtures";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

const IMP_ROLES = ["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];
const withFabled = (fabled: string[]) => ({ ...proofGame(IMP_ROLES), fabled });
const envOf = (g: StorytellerLobbyRecord, extra: ModifierDefinition[] = []) => proofEnv({ modifiers: [...activeModifiers(g, proofRegistry), ...extra] });
const attack = (g: StorytellerLobbyRecord, judgments: Record<string, AbilityInputValue> = {}, extra: ModifierDefinition[] = []) =>
  plan(g, request(g, "p0", "imp", { target: pick(g, "p1") }, { judgments }), envOf(g, extra));

describe("SOL-10F-A3 -- verified and unverified modifiers compose", () => {
  it("Astra's reproduction: Toymaker + Angel -- answering Angel no longer bypasses Toymaker", () => {
    const g = withFabled(["toymaker", "angel"]);
    expect(requirementIds(attack(g)).sort()).toEqual(["modifier:fabled:angel", "modifier:fabled:toymaker"]);
    expect(requirementIds(attack(g, { "modifier:fabled:angel": yes() }))).toEqual(["modifier:fabled:toymaker"]);
    expect(requirementIds(attack(g, { "modifier:fabled:toymaker": yes() }))).toEqual(["modifier:fabled:angel"]);
    expect(planned(attack(g, { "modifier:fabled:angel": yes(), "modifier:fabled:toymaker": yes() })).players.p1!.alive).toBe(false);
  });

  it("Toymaker only / Angel only", () => {
    expect(requirementIds(attack(withFabled(["toymaker"])))).toEqual(["modifier:fabled:toymaker"]);
    expect(requirementIds(attack(withFabled(["angel"])))).toEqual(["modifier:fabled:angel"]);
  });

  it("a verified 'unsupported' hook wins even when unverified modifiers also reach", () => {
    const g = withFabled(["angel"]);
    const stop: ModifierDefinition = { id: "custom:stop", source: "custom", label: "stop", scopes: ["death"], hook: () => ({ kind: "unsupported", message: "Stopped by a verified hook." }) };
    expect(attack(g, { "modifier:fabled:angel": yes() }, [stop])).toMatchObject({ ok: false, code: "unsupported", message: "Stopped by a verified hook." });
    expect(attack(g, {}, [stop])).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("a verified information constraint stays enforced after an unverified modifier is confirmed", () => {
    const g = { ...proofGame(["empath", "imp", "chef", "monk", "saint", "drunk", "poisoner"]), fabled: ["fibbin"] }; // fibbin: unverified, information
    const onlyZero: ModifierDefinition = { id: "custom:zero", source: "custom", label: "zero", scopes: ["information"],
      hook: () => ({ kind: "constrainInformation", requirementId: "evilNeighbors", allowed: [{ kind: "number", value: 0 }], reason: "Only 0 may be shown." }) };
    const env = envOf(g, [onlyZero]);
    expect(requirementIds(plan(g, request(g, "p0", "empath"), env))).toEqual(["modifier:fabled:fibbin"]);
    // Computed 2 (imp + poisoner neighbours) violates the verified constraint.
    expect(plan(g, request(g, "p0", "empath", {}, { judgments: { "modifier:fabled:fibbin": yes() } }), env)).toMatchObject({ ok: false, code: "illegal", message: "Only 0 may be shown." });
  });

  it("several unverified + several verified judgments are all asked, and all must be answered", () => {
    const g = withFabled(["toymaker", "angel", "doomsayer"]);
    const ask: ModifierDefinition = { id: "custom:ask", source: "custom", label: "ask", scopes: ["death"], hook: () => ({ kind: "judgment", message: "Custom verified judgment." }) };
    expect(requirementIds(attack(g, {}, [ask])).sort()).toEqual(["modifier:custom:ask", "modifier:fabled:angel", "modifier:fabled:doomsayer", "modifier:fabled:toymaker"]);
    const all = Object.fromEntries(["custom:ask", "fabled:angel", "fabled:doomsayer", "fabled:toymaker"].map((id) => [`modifier:${id}`, yes()]));
    expect(attack(g, all, [ask])).toMatchObject({ ok: true, changed: true });
    const { ["modifier:custom:ask"]: _dropped, ...missingOne } = all;
    expect(requirementIds(attack(g, missingOne, [ask]))).toEqual(["modifier:custom:ask"]);
  });

  it("unrelated modifiers stay ignored (no blanket gate)", () => {
    expect(requirementIds(attack(withFabled(["toymaker", "ferryman"])))).toEqual(["modifier:fabled:toymaker"]);
    const g = withFabled(["toymaker", "angel"]);
    expect(planned(plan(g, request(g, "p5", "poisoner", { target: pick(g, "p1") }), envOf(g))).players.p1!.effects).toHaveLength(1);
  });
});

describe("SOL-10F-A8 -- every AbilityInputValue is validated at runtime", () => {
  const harlot = () => patchPlayer(proofGame(["harlot", "chef", "monk", "imp", "empath", "saint", "spy"]), "p0",
    { isTraveler: true, actualAlignment: "good", travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 } });
  const empath = () => proofGame(["empath", "imp", "chef", "monk", "saint", "drunk", "poisoner"]);
  const malformed: [string, unknown][] = [
    ["Boolean \"no\"", { kind: "boolean", value: "no" }],
    ["Boolean 1", { kind: "boolean", value: 1 }],
    ["NaN number", { kind: "number", value: Number.NaN }],
    ["Infinity number", { kind: "number", value: Number.POSITIVE_INFINITY }],
    ["participant binding without participantId", { kind: "participant", participants: [{ playerId: "p1" }] }],
    ["participants not an array", { kind: "participant", participants: "p1" }],
    ["role array with an empty id", { kind: "character", roleIds: [""] }],
    ["role array with a number", { kind: "character", roleIds: [3] }],
    ["alignment 'neutral'", { kind: "alignment", alignment: "neutral" }],
    ["text that is not a string", { kind: "text", value: 5 }],
    ["unknown kind", { kind: "player", playerIds: ["p1"] }],
    ["extra field", { kind: "boolean", value: true, extra: 1 }],
  ];

  it.each(malformed)("an undeclared follow-up with %s is refused 'invalid' (never consumed by truthiness)", (_label, value) => {
    const g = empath();
    expect(abilityInputValueError(value)).not.toBeNull();
    expect(plan(g, request(g, "p0", "empath", { anything: value as AbilityInputValue }))).toMatchObject({ ok: false, code: "invalid" });
    expect(plan(g, request(g, "p0", "empath", {}, { judgments: { anything: value as AbilityInputValue } }))).toMatchObject({ ok: false, code: "invalid" });
  });

  it("Astra's reproduction: a Harlot consent of \"no\" (string) is refused, never read as Yes", () => {
    const g = harlot();
    const consentId = requirementIds(plan(g, request(g, "p0", "harlot", { target: pick(g, "p1") })))[0]!;
    expect(plan(g, request(g, "p0", "harlot", { target: pick(g, "p1"), [consentId]: { kind: "boolean", value: "no" } as unknown as AbilityInputValue })))
      .toMatchObject({ ok: false, code: "invalid" });
  });

  it("valid false stays false and valid 0 stays 0", () => {
    const g = harlot();
    const consentId = requirementIds(plan(g, request(g, "p0", "harlot", { target: pick(g, "p1") })))[0]!;
    expect(plan(g, request(g, "p0", "harlot", { target: pick(g, "p1"), [consentId]: yes(false) }))).toEqual({ ok: true, changed: false });
    const impaired = impair(empath(), "p0");
    expect(planned(plan(impaired, request(impaired, "p0", "empath", { communicated: num(0) }))).informationDeliveries[0]!.values).toEqual(
      [{ requirementId: "evilNeighbors", kind: "number", value: 0 }]);
  });
});
