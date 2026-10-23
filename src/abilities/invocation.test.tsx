// SOL-10F-L3-R1 (PHASE10F Section 23): invocation eligibility = WHEN an
// ability acts (timing) AND HOW it may be invoked (invocation), through ONE
// shared contract (src/abilities/invocation.ts) used by the Day entry, the
// ordinary Night Order AND the coordinator. (Package 4: the rendered Day drawer and Night Order
// rows are retired; the shared helper, entry-point decision and coordinator are still compared.) UI visibility is not authority: a
// crafted guided request is refused (notApplicable) without mutation.
// Rules-neutral fixtures only -- no character mechanics.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup } from "@testing-library/react";
import { INVOCATION_PATHS, invocationEligibility, type InvocationPath } from "./invocation";
import type { AbilityDescriptor, AbilityInvocation, AbilitySemanticsRegistry, AbilityTiming } from "./semantics";
import { pathAbility } from "@/features/abilities/abilityUi";
import { canonicalRoles } from "@/data/canonical";
import { buildRegistry } from "@/data/roleRegistry";
import { captureFingerprint, planAbilityResolution, type AbilityResolutionRequest } from "@/stores/abilityResolution";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { makeSTPlayer } from "@/test/fixtures";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";

const TIMINGS: readonly AbilityTiming[] = ["firstNight", "otherNight", "day", "triggered", "passive", "setup"];
const INVOCATIONS: readonly AbilityInvocation[] = ["wake", "procedure", "publicClaim", "none"];

/** The Game Moments a generic path can be asked about. */
type Moment = { label: string; phase: "setup" | "night" | "day" | "ended"; day: number };
const NIGHT1: Moment = { label: "Night 1", phase: "night", day: 1 };
const NIGHT2: Moment = { label: "Night 2", phase: "night", day: 2 };
const DAY2: Moment = { label: "Day 2", phase: "day", day: 2 };
const MOMENTS: readonly Moment[] = [NIGHT1, NIGHT2, DAY2, { label: "Setup", phase: "setup", day: 0 }, { label: "Ended", phase: "ended", day: 3 }];

/** The acting participant's character at each moment: one with a canonical
 * Night Order row that night (Chef on Night 1, Monk later), and any for Day. */
const subjectFor = (moment: Moment) => moment.phase === "night" ? (moment.day === 1 ? "chef" : "monk") : "slayer";

const script: Script = { id: "invocation", name: "Invocation", characters: canonicalRoles(["chef", "monk", "slayer", "imp", "empath"]) };
const registry = buildRegistry(script);

function gameAt(moment: Moment): StorytellerLobbyRecord {
  const roles = [subjectFor(moment), "imp", "empath"];
  const players = roles.map((actualRole, seat) => makeSTPlayer({ id: `p${seat}`, name: ["Ann", "Ben", "Cat"][seat]!, seat,
    actualRole, shownRole: actualRole, actualAlignment: registry.alignmentOf(actualRole) }));
  return { gameSchemaVersion: 29, preparedInformation: [], playerInfoLog: [], gameRuleFacts: [], code: "", storytellerUid: "local", scriptId: script.id, phase: moment.phase, day: moment.day,
    players: Object.fromEntries(players.map((p) => [p.id, p])), seatOrder: players.map((p) => p.id), plannedPlayerCount: 3, plannedTravelerCount: 0,
    rolePool: [], fabled: [], lorics: [], bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {}, history: [], informationDeliveries: [],
    lifeEventWindow: { coverageFrom: { phase: "night", day: 1 }, events: [] }, setupRolesDealt: true, setupRolesRevealed: true };
}

/** A rules-neutral fixture descriptor: no inputs, a complete notation-only
 * outcome -- so the ONLY thing that can refuse it is invocation eligibility. */
function descriptor(roleId: string, timing: readonly AbilityTiming[], invocation: AbilityInvocation): AbilityDescriptor {
  return { roleId, timing, invocation, usage: { kind: "unlimited" }, inputs: [], hooks: [],
    presentation: { complexity: "complex", action: "FIXTURE ACTION" },
    evaluator: (context) => ({ kind: "outcome", outcome: { operations: [{ domain: "reminder", intents: [
      { kind: "place", target: context.actor.binding, reminder: { label: "fixture" } }] }] } }) };
}
const semanticsOf = (d: AbilityDescriptor): AbilitySemanticsRegistry => new Map([[d.roleId, d]]);

function plan(g: StorytellerLobbyRecord, d: AbilityDescriptor, path: unknown) {
  const request = { mode: "guided", invocationPath: path, fingerprint: captureFingerprint(g, "p0")!, roleId: d.roleId, inputs: {} } as unknown as AbilityResolutionRequest;
  return planAbilityResolution(g, request, { script, registry, semantics: semanticsOf(d), modifiers: [] });
}

const deepFreeze = <T,>(value: T): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
};

/** Section 23's frozen rule, written out independently as the test oracle. */
function expected(timing: readonly AbilityTiming[], invocation: AbilityInvocation, path: InvocationPath, moment: Moment): boolean {
  if (path === "dayEntry") return moment.phase === "day" && timing.includes("day") && (invocation === "publicClaim" || invocation === "procedure");
  // Slice 7: the explicit Night-trigger path needs a VERIFIED trigger
  // declaration; none of these generic descriptors has one -> never eligible.
  if (path === "nightTrigger") return false;
  const tonight: AbilityTiming = moment.day === 1 ? "firstNight" : "otherNight";
  return moment.phase === "night" && timing.includes(tonight) && (invocation === "wake" || invocation === "procedure");
}

beforeEach(() => usePrivacyStore.setState({ enabled: false }));
afterEach(cleanup);

describe("SOL-10F-L3-R1: the required timing x invocation regressions", () => {
  // [#, timing, invocation, path, moment, eligible]
  const REQUIRED: [string, AbilityTiming[], AbilityInvocation, InvocationPath, Moment, boolean][] = [
    ["1 passive/none, Day entry", ["passive"], "none", "dayEntry", DAY2, false],
    ["1 passive/none, Night Order", ["passive"], "none", "nightOrder", NIGHT2, false],
    ["2 triggered/procedure, Day entry", ["triggered"], "procedure", "dayEntry", DAY2, false],
    ["2 triggered/procedure, Night Order (later Night)", ["triggered"], "procedure", "nightOrder", NIGHT2, false],
    ["2 triggered/procedure, Night Order (Night 1)", ["triggered"], "procedure", "nightOrder", NIGHT1, false],
    ["3 day/publicClaim, Day entry", ["day"], "publicClaim", "dayEntry", DAY2, true],
    ["4 day/procedure, Day entry", ["day"], "procedure", "dayEntry", DAY2, true],
    ["5 day/wake, Day entry", ["day"], "wake", "dayEntry", DAY2, false],
    ["6 otherNight/wake, Night Order (later Night)", ["otherNight"], "wake", "nightOrder", NIGHT2, true],
    ["6 otherNight/wake, Night Order (Night 1)", ["otherNight"], "wake", "nightOrder", NIGHT1, false],
    ["7 otherNight/procedure, Night Order (later Night)", ["otherNight"], "procedure", "nightOrder", NIGHT2, true],
    ["8 otherNight/publicClaim, Night Order (later Night)", ["otherNight"], "publicClaim", "nightOrder", NIGHT2, false],
    ["9 firstNight/wake, Night Order (Night 1)", ["firstNight"], "wake", "nightOrder", NIGHT1, true],
    ["9 firstNight/wake, Night Order (later Night)", ["firstNight"], "wake", "nightOrder", NIGHT2, false],
    // Paths never cross phases.
    ["day/publicClaim through the Night Order", ["day"], "publicClaim", "nightOrder", NIGHT2, false],
    ["otherNight/wake through the Day entry at Night", ["otherNight"], "wake", "dayEntry", NIGHT2, false],
    ["day/procedure through the Night Order during the Day", ["day"], "procedure", "nightOrder", DAY2, false],
    // Triggered / passive alongside an explicit timing: only the explicit timing counts.
    ["day+passive/procedure, Day entry", ["day", "passive"], "procedure", "dayEntry", DAY2, true],
    ["otherNight+triggered/wake, Night Order", ["otherNight", "triggered"], "wake", "nightOrder", NIGHT2, true],
    ["setup/procedure, Night Order on Night 1", ["setup"], "procedure", "nightOrder", NIGHT1, false],
  ];

  it.each(REQUIRED)("%s -> eligible %s", (_label, timing, invocation, path, moment, eligible) => {
    const g = deepFreeze(gameAt(moment));
    const d = descriptor(subjectFor(moment), timing, invocation);
    // The shared helper.
    expect(invocationEligibility(d, path, g).eligible).toBe(eligible);
    // The entry-point decision (what the Day drawer / Night row offers).
    expect(pathAbility(d.roleId, registry, semanticsOf(d), path, g).kind).toBe(eligible ? "guided" : "manual");
    // The coordinator, on a frozen game: accepted, or refused notApplicable without mutation.
    const result = plan(g, d, path);
    if (eligible) expect(result).toMatchObject({ ok: true, changed: true });
    else {
      expect(result).toMatchObject({ ok: false, code: "notApplicable" });
      expect((result as { message: string }).message).toBe((invocationEligibility(d, path, g) as { reason: string }).reason);
    }
  });

  it("triggered / passive / invocation none get explicit, non-guessing refusal reasons", () => {
    const g = gameAt(DAY2);
    expect(invocationEligibility(descriptor("slayer", ["passive"], "none"), "dayEntry", g))
      .toEqual({ eligible: false, reason: "This ability is never directly invoked -- resolve its consequences manually." });
    expect(invocationEligibility(descriptor("slayer", ["triggered"], "procedure"), "dayEntry", g))
      .toEqual({ eligible: false, reason: "Triggered and passive abilities have no verified invocation path yet -- resolve manually." });
  });
});

describe("SOL-10F-L3-R1: exhaustive timing x invocation x path x moment agreement (helper = entry point = coordinator)", () => {
  const timingSets: AbilityTiming[][] = [...TIMINGS.map((t) => [t]), ["firstNight", "otherNight"], ["day", "triggered"], ["otherNight", "passive"]];
  const cases = timingSets.flatMap((timing) => INVOCATIONS.flatMap((invocation) =>
    INVOCATION_PATHS.flatMap((path) => MOMENTS.map((moment) => ({ timing, invocation, path, moment })))));

  it(`covers ${cases.length} combinations, all agreeing with Section 23`, () => {
    expect(cases).toHaveLength(9 * 4 * 3 * 5);
    let eligibleCount = 0;
    for (const { timing, invocation, path, moment } of cases) {
      const label = `${timing.join("+")}/${invocation} via ${path} @ ${moment.label}`;
      const g = deepFreeze(gameAt(moment));
      const d = descriptor(subjectFor(moment), timing, invocation);
      const want = expected(timing, invocation, path, moment);
      if (want) eligibleCount++;
      expect(invocationEligibility(d, path, g).eligible, label).toBe(want);
      const offered = pathAbility(d.roleId, registry, semanticsOf(d), path, g).kind === "guided";
      const accepted = plan(g, d, path).ok;
      // 10: whatever an entry point hides, the coordinator refuses for that same path (and vice versa).
      expect(offered, label).toBe(want);
      expect(accepted, label).toBe(want);
    }
    // Night 1 x {firstNight, firstNight+otherNight} x {wake, procedure} = 4;
    // later Night x {otherNight, firstNight+otherNight, otherNight+passive} x 2 = 6;
    // Day x {day, day+triggered} x {publicClaim, procedure} = 4.
    expect(eligibleCount).toBe(14);
  });
});

describe("SOL-10F-L3-R1: coordinator authority over crafted requests", () => {
  it("a crafted guided request for passive/none is refused by resolveAbility with no mutation, no Undo, no History", () => {
    const g = gameAt(DAY2);
    store.setState({ game: g, undoStack: [], localSeq: 0, customScripts: { [script.id]: script } });
    const d = descriptor("slayer", ["passive"], "none");
    for (const path of INVOCATION_PATHS) {
      const result = store.getState().resolveAbility({ mode: "guided", invocationPath: path, fingerprint: captureFingerprint(g, "p0")!, roleId: "slayer", inputs: {} }, semanticsOf(d));
      expect(result).toMatchObject({ ok: false, code: "notApplicable" });
    }
    expect(store.getState().game).toBe(g);
    expect(store.getState().undoStack).toEqual([]);
    expect(store.getState().localSeq).toBe(0);
  });

  it("a crafted triggered/procedure request is refused in every live moment on every path", () => {
    for (const moment of [NIGHT1, NIGHT2, DAY2]) {
      const g = deepFreeze(gameAt(moment));
      const d = descriptor(subjectFor(moment), ["triggered"], "procedure");
      for (const path of INVOCATION_PATHS) expect(plan(g, d, path), `${moment.label} ${path}`).toMatchObject({ ok: false, code: "notApplicable" });
    }
  });

  it.each([
    ["missing", undefined], ["unknown", "drawer"], ["wrong type", 1], ["null", null], ["object", { path: "dayEntry" }], ["case-changed", "DayEntry"],
  ])("a %s invocationPath is a malformed request (invalid), never a default path", (_label, path) => {
    const g = deepFreeze(gameAt(DAY2));
    const d = descriptor("slayer", ["day"], "publicClaim"); // eligible on the Day entry -- the path alone is wrong
    expect(plan(g, d, path)).toMatchObject({ ok: false, code: "invalid" });
  });

  it("the Manual path is unaffected: it carries no invocation path and resolves an ineligible ability's outcome", () => {
    const g = deepFreeze(gameAt(DAY2));
    const d = descriptor("slayer", ["passive"], "none");
    const manual = planAbilityResolution(g, { mode: "manual", fingerprint: captureFingerprint(g, "p0")!, roleId: "slayer", reason: "Passive consequence, resolved by the Storyteller",
      outcome: { operations: [{ domain: "reminder", intents: [{ kind: "place", target: { playerId: "p0", participantId: g.players.p0!.participantId! }, reminder: { label: "noted" } }] }] } },
    { script, registry, semantics: semanticsOf(d), modifiers: [] });
    expect(manual).toMatchObject({ ok: true, changed: true });
  });
});
