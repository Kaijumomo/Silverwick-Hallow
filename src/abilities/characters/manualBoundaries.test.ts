// Phase 10F Slice 7 -- the verified-Manual / Setup-owned boundaries:
// Tinker (matrix 14), Toymaker (matrix 16), Baron (matrix 17), and the other
// deliberately Manual branches (Cult Leader vote, Pit-Hag Demon / Traveller).
import { describe, expect, it } from "vitest";
import { CANONICAL_ABILITY_SEMANTICS, resolveAbilitySemantics } from "@/abilities/semantics";
import { activeModifiers } from "@/abilities/modifiers";
import { buildCoverageManifest } from "@/abilities/coverage";
import { pathAbility } from "@/features/abilities/abilityUi";
import { computeNightOrder } from "@/features/nightOrder/nightOrder";
import { evilInformationPolicy } from "@/features/nightOrder/nightRules";
import { INVOCATION_PATHS } from "@/abilities/invocation";
import { TOYMAKER_ATTACK_MESSAGE } from "./modifierHooks";
import { choiceId } from "./alhadikhia";
import { bind, homebrewScript, patchPlayer, pick, plan, planned, proofEnv, proofGame, proofRegistry, proofScript, request, yes } from "@/test/proofFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "@/stores/types";

const at = (phase: "night" | "day", day: number) => ({ phase, day });

describe("Tinker -- verified Manual, never a guided action", () => {
  const g = proofGame(["tinker", "imp", "chef", "monk", "empath", "saint", "poisoner"], "night", 2);

  it("has no descriptor; resolves as verifiedManual through the canonical ownership gate", () => {
    expect(CANONICAL_ABILITY_SEMANTICS.has("tinker")).toBe(false);
    expect(resolveAbilitySemantics("tinker", proofRegistry)).toMatchObject({ kind: "verifiedManual", note: expect.stringMatching(/protected Tinker cannot die/) });
    // A homebrew reuse of the id inherits not even the reference text.
    expect(resolveAbilitySemantics("tinker", buildRegistry(homebrewScript("tinker")))).toMatchObject({ kind: "homebrew" });
  });

  it("no path (Night Order, Day entry, Night trigger) offers it as a guided action, in any phase", () => {
    for (const path of INVOCATION_PATHS) for (const moment of [at("night", 1), at("night", 2), at("day", 2)]) {
      expect(pathAbility("tinker", proofRegistry, CANONICAL_ABILITY_SEMANTICS, path, moment), `${path} ${moment.phase}${moment.day}`).toMatchObject({ kind: "manual" });
    }
  });

  it("a crafted guided request is refused; no automatic or random death", () => {
    for (const [phase, path] of [["night", "nightOrder"], ["day", "dayEntry"], ["night", "nightTrigger"]] as const) {
      const live = proofGame(["tinker", "imp", "chef"], phase, 2);
      expect(plan(live, request(live, "p0", "tinker", {}, { invocationPath: path, withStep: path === "nightTrigger" }))).toMatchObject({ ok: false, code: "unsupported" });
    }
  });

  it("its Night row (death check) shows the verified reference text with the Manual path", () => {
    const row = computeNightOrder(g.players, g.seatOrder, proofScript, false, g).find((s) => s.kind === "player" && s.playerId === "p0");
    expect(row).toBeDefined();
    expect(pathAbility("tinker", proofRegistry, CANONICAL_ABILITY_SEMANTICS, "nightOrder", g)).toMatchObject({ kind: "manual", reason: expect.stringMatching(/Storyteller discretion/) });
  });
});

describe("Toymaker -- verified hook; skip history is never claimed", () => {
  const withToymaker = (g: StorytellerLobbyRecord) => ({ ...g, fabled: ["toymaker"] });
  const g = withToymaker(proofGame(["imp", "poisoner", "monk", "chef", "empath", "fortuneteller", "saint"], "night", 2));
  const env = () => proofEnv({ modifiers: activeModifiers(g, proofRegistry) });

  it("the Demon's whole attack stays Manual while the required skip is unknown", () => {
    const result = plan(g, request(g, "p0", "imp", { target: pick(g, "p3") }), env());
    expect(result).toMatchObject({ ok: false, code: "unsupported", message: TOYMAKER_ATTACK_MESSAGE });
    const allowed = plan(g, request(g, "p0", "imp", { target: pick(g, "p3") }, { judgments: { "modifier:fabled:toymaker": yes(true) } }), env());
    expect(allowed).toMatchObject({ ok: false, code: "unsupported" });
    expect(g.players.p3!.alive).toBe(true);
  });

  it("every Demon attack evaluation is gated (Al-Hadikhia too)", () => {
    const al = withToymaker(proofGame(["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"], "night", 2));
    const req = request(al, "p0", "alhadikhia", { chosen: pick(al, "p1", "p2", "p3"),
      ...Object.fromEntries(["p1", "p2", "p3"].map((id, index) => [choiceId(index, bind(al, id)), yes(false)])) });
    expect(plan(al, req, proofEnv({ modifiers: activeModifiers(al, proofRegistry) }))).toMatchObject({ ok: false, code: "unsupported" });
  });

  it("unrelated ability scopes are unaffected (no blanket gate)", () => {
    expect(planned(plan(g, request(g, "p1", "poisoner", { target: pick(g, "p3") }), env())).players.p3!.effects).toHaveLength(1);
    expect(planned(plan(g, request(g, "p4", "empath"), env())).informationDeliveries).toHaveLength(1);
    expect(planned(plan(g, request(g, "p2", "monk", { target: pick(g, "p3") }), env())).players.p3!.effects).toHaveLength(1);
  });

  it("no Reminder is read as skip-history truth", () => {
    const noted = patchPlayer(g, "p0", { reminders: [{ id: "rm", label: "Demon has skipped an attack", sourceCharacter: "toymaker" }] });
    expect(plan(noted, request(noted, "p0", "imp", { target: pick(noted, "p3") }), proofEnv({ modifiers: activeModifiers(noted, proofRegistry) })))
      .toMatchObject({ ok: false, code: "unsupported" });
  });

  it("below-7 normal evil starting information is not regressed", () => {
    const five = proofGame(["imp", "poisoner", "chef", "monk", "empath"], "night", 1);
    expect(evilInformationPolicy(Object.values(five.players), proofRegistry, { fabled: ["toymaker"] }).normalStartingInfo).toBe(true);
    expect(evilInformationPolicy(Object.values(five.players), proofRegistry, {}).normalStartingInfo).toBe(false);
  });

  it("coverage: verified Manual, not 'evidence pending'", () => {
    expect(buildCoverageManifest().find((e) => e.id === "toymaker")).toMatchObject({ status: "verifiedManual" });
  });
});

describe("Baron -- Setup-owned negative proof", () => {
  it("no live guided Day or Night ability; coverage stays setupOwned", () => {
    expect(CANONICAL_ABILITY_SEMANTICS.has("baron")).toBe(false);
    for (const path of INVOCATION_PATHS) for (const moment of [at("night", 1), at("night", 2), at("day", 2)]) {
      expect(pathAbility("baron", proofRegistry, CANONICAL_ABILITY_SEMANTICS, path, moment)).toMatchObject({ kind: "manual" });
    }
    const g = proofGame(["baron", "imp", "chef"], "night", 2);
    expect(plan(g, request(g, "p0", "baron"))).toMatchObject({ ok: false, code: "unsupported" });
    expect(buildCoverageManifest().find((e) => e.id === "baron")).toMatchObject({ status: "setupOwned" });
  });

  it("a Baron created mid-game alters no composition; a Baron's death undoes no Setup", () => {
    const g = proofGame(["pithag", "chef", "imp", "monk", "empath", "saint", "washerwoman"], "night", 2);
    const made = planned(plan(g, request(g, "p0", "pithag", { target: pick(g, "p1"), character: { kind: "character", roleIds: ["baron"] } })));
    expect([made.rolePool, made.plannedPlayerCount, made.plannedTravelerCount]).toEqual([g.rolePool, g.plannedPlayerCount, g.plannedTravelerCount]);
    expect(Object.values(made.players).filter((p) => proofRegistry.get(p.actualRole)?.type === "outsider")).toHaveLength(1); // still just the Saint
    // The Baron dies (Slayer-independent: an ordinary Life death through the manual path).
    const died = planned(plan(made, { mode: "manual", outcome: { operations: [{ domain: "life", intents: [{ kind: "death", target: { playerId: "p1", participantId: made.players.p1!.participantId! } }] }] }, reason: "test" }, proofEnv()));
    for (const id of Object.keys(made.players).filter((id) => id !== "p1")) expect(died.players[id]!.actualRole).toBe(made.players[id]!.actualRole);
    expect(died.rolePool).toEqual(made.rolePool);
  });
});
