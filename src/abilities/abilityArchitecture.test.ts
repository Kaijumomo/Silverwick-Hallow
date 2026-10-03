// Phase 10F architecture guards + coverage manifest.
//
// Guards that future code cannot silently violate the frozen contract:
//  - ability modules / Rules Query never read Reminders (see also the 10C
//    guard) or History as mechanical truth;
//  - the coordinator never calls production resolve* commands (see
//    resolveAbility.test.ts) and never touches the store;
//  - no RoleId branching leaks into the generic coordinator / workflow UI;
//  - semantics are resolved ONLY through the canonical ownership gate;
//  - derived Effect applicability is never written back;
//  - evaluators / Rules Query are pure;
//  - public / self projections gain no 10F field;
//  - SOL-10F-L3-R1: ability timing / invocation is interpreted ONLY by the
//    shared invocation-eligibility contract (abilities/invocation.ts).
// Traceability: 10F-AC-13, AC-20, AC-24, AC-28, AC-33, AC-34.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import rawRoles from "@/data/canonical/roles.json";
import jinxData from "@/data/canonical/jinxes.json";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import { buildCoverageManifest, coverageSummary, PROOF_SET } from "./coverage";
import { CANONICAL_ABILITY_SEMANTICS } from "./semantics";
import { CANONICAL_MODIFIER_SCOPES } from "./modifiers";
import { FIXTURE_SEMANTICS } from "@/test/abilityFixtures";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";

const SRC = resolve(__dirname, "..");
const read = (module: string) => stripComments(readFileSync(join(SRC, module), "utf8"));
function productionSources(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "test" || name === "node_modules") continue;
      out.push(...productionSources(path));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(relative(SRC, path).split("\\").join("/"));
    }
  }
  return out;
}

/** The generic 10F rules / workflow modules. */
const GENERIC = [
  "abilities/invocation.ts",
  "stores/abilityResolution.ts",
  "abilities/semantics.ts",
  "features/abilities/abilityUi.ts",
  "features/abilities/AbilityWorkspace.tsx",
];
const RULES = ["stores/rulesQuery.ts", "abilities/modifiers.ts", "abilities/semantics.ts", "stores/abilityResolution.ts"];
const CANONICAL_IDS = new Set((rawRoles as { id: string }[]).map((r) => r.id));
const stringLiterals = (code: string) => [...code.matchAll(/["'`]([a-z][a-z0-9]*)["'`]/g)].map((m) => m[1]!);
/** Removes the reviewed structural data tables (classification only). */
const withoutTables = (code: string) => code
  .replace(/export const CANONICAL_MODIFIER_SCOPES[\s\S]*?\n};/, "")
  .replace(/export const REGISTRATION_ALTERING[\s\S]*?\n};/, "")
  .replace(/export const APPROVED_EFFECT_SEMANTICS[\s\S]*?\n};/, "");

describe("10F architecture guards", () => {
  it("no RoleId branching in the generic coordinator / workflow modules (only reviewed structural tables name characters)", () => {
    for (const module of [...GENERIC, "stores/rulesQuery.ts", "abilities/modifiers.ts"]) {
      const offenders = stringLiterals(withoutTables(read(module))).filter((literal) => CANONICAL_IDS.has(literal));
      expect(offenders, module).toEqual([]);
    }
  });

  it("the RoleId detector catches a planted branch (self-check)", () => {
    const planted = 'if (player.actualRole === "imp") return;\nswitch (roleId) { case "monk": break; }';
    expect(stringLiterals(planted).filter((literal) => CANONICAL_IDS.has(literal)).sort()).toEqual(["imp", "monk"]);
  });

  it("rules modules never read Reminders or History as mechanical truth", () => {
    for (const module of RULES) {
      const code = read(module);
      for (const forbidden of [/\.reminders\b/, /\bReminderRecord\b/, /\.history\b/, /HistoryRecord\b/]) {
        expect(code, `${module} ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });

  it("Rules Query and ability modules are pure: no store, clock, randomness or I/O", () => {
    for (const module of ["stores/rulesQuery.ts", "abilities/modifiers.ts", "abilities/semantics.ts", "abilities/coverage.ts", "abilities/invocation.ts"]) {
      const code = read(module);
      for (const forbidden of [/useStorytellerStore/, /Math\.random/, /Date\.now/, /new Date\b/, /localStorage/, /\bfetch\(/, /firebase/i]) {
        expect(code, `${module} ${forbidden}`).not.toMatch(forbidden);
      }
    }
  });

  it("derived Effect applicability is never written back (10F-AC-13)", () => {
    const code = read("stores/rulesQuery.ts");
    for (const forbidden of [/\.state\s*=[^=]/, /\bstate\s*:\s*["']/, /planEffectTransaction/, /applyEffectPlan/, /resolveEffects/, /"suppress"/]) {
      expect(code).not.toMatch(forbidden);
    }
    // The coordinator never synthesizes an Effect lifecycle change itself:
    // every Effect intent comes from the evaluator / manual outcome.
    expect(read("stores/abilityResolution.ts")).not.toMatch(/kind:\s*"(suppress|resume|update)"/);
  });

  it("semantics are only ever resolved through the canonical ownership gate (10F-AC-24)", () => {
    const users = productionSources().filter((module) => /\bsemantics\.get\(|CANONICAL_ABILITY_SEMANTICS\.get\(/.test(read(module)));
    expect(users).toEqual(["abilities/semantics.ts"]);
    expect(read("abilities/semantics.ts")).toMatch(/isCanonicalRole\(role\)/);
  });

  it("evaluators are pure functions of their context (fixtures included): no store / clock / randomness", () => {
    const fixtures = readFileSync(join(SRC, "test/abilityFixtures.ts"), "utf8");
    for (const forbidden of [/useStorytellerStore/, /Math\.random/, /Date\.now/, /\.reminders\b/]) expect(fixtures).not.toMatch(forbidden);
  });

  it("SOL-10F-L3-R1: only the shared invocation contract interprets descriptor timing / invocation; UI and coordinator call it", () => {
    const readers = productionSources().filter((module) => /\.(timing|invocation)\b/.test(read(module)));
    expect(readers.sort()).toEqual(["abilities/invocation.ts", "stores/informationDelivery.ts"]);
    // informationDelivery.ts reads an Information ACTION's timing (a different type), never an ability descriptor's.
    expect(read("stores/informationDelivery.ts").match(/[\w.]+\.(timing|invocation)\b/g)).toEqual(["action.timing"]);
    for (const module of ["stores/abilityResolution.ts", "features/abilities/abilityUi.ts"]) expect(read(module), module).toMatch(/\binvocationEligibility\(/);
    for (const module of ["features/abilities/AbilityEntry.tsx", "features/nightOrder/NightOrderPanel.tsx"]) expect(read(module), module).toMatch(/\bpathAbility\(/);
    expect(read("stores/abilityResolution.ts")).not.toMatch(/timingAllows/);
  });

  it("production semantics are EXACTLY the matrix-authorized guided proof / support characters (Slice 7)", () => {
    expect([...CANONICAL_ABILITY_SEMANTICS.keys()].sort()).toEqual(
      ["alhadikhia", "cultleader", "empath", "fortuneteller", "harlot", "imp", "monk", "pithag", "poisoner", "ravenkeeper", "slayer"]);
    // Negative proofs: Setup-owned, verified-Manual and dependency-only ids are never live semantics.
    for (const id of ["baron", "tinker", "toymaker", "drunk", "scarletwoman"]) expect(CANONICAL_ABILITY_SEMANTICS.has(id), id).toBe(false);
  });
});

describe("10F-AC-28: projections gain no 10F field", () => {
  it("public and self projections never carry resolution ids, performed Roles, participant ids or Night progress", () => {
    const registry = buildRegistry(setupScript);
    const g = setupGame(undefined, { phase: "day", day: 2, setupRolesDealt: true, setupRolesRevealed: true });
    g.informationDeliveries = [{ id: "d", recipient: { kind: "participant", participantId: g.players.p0!.participantId!, playerId: "p0", nameAtTime: "Player 0" },
      actualRole: g.players.p0!.actualRole, performedRole: "empath", informationActionId: "x", values: [], resolutionId: "res-secret" }];
    g.nightProgress = { [`2:p:${g.players.p0!.participantId}:x`]: { status: "done", notes: "secret note" } };
    const wire = JSON.stringify([projectLobbyToPublic(g, {}), projectLobbyToSelfMap(g, registry)]);
    for (const leak of ["res-secret", "performedRole", "resolutionId", "secret note", g.players.p0!.participantId!, "nightProgress", "informationDeliveries"]) {
      expect(wire).not.toContain(leak);
    }
    const publicKeys = new Set(Object.values(projectLobbyToPublic(g, {}).players).flatMap((p) => Object.keys(p)));
    expect([...publicKeys].sort()).toEqual(["alive", "ghostVote", "id", "isTraveler", "joinedAt", "name", "online", "seat"].sort());
  });
});

describe("10F-AC-34: canonical coverage manifest", () => {
  const manifest = buildCoverageManifest();

  it("classifies every canonical character and every jinx exactly once, generated from the pinned data", () => {
    const roleIds = (rawRoles as { id: string }[]).map((r) => r.id);
    const jinxIds = (jinxData as { id: string; jinx: { id: string }[] }[]).flatMap((e) => e.jinx.map((j) => `${e.id}+${j.id}`));
    expect(manifest.map((e) => e.id).sort()).toEqual([...roleIds, ...jinxIds].sort());
    expect(new Set(manifest.map((e) => e.id)).size).toBe(manifest.length);
  });

  it("tracks the proof set, the Baron negative proof and Fabled/Loric scopes", () => {
    const verifiedManual = ["tinker", "toymaker", "drunk"];
    for (const id of PROOF_SET.filter((p) => p !== "baron")) {
      expect(manifest.find((e) => e.id === id), id).toMatchObject({ status: verifiedManual.includes(id) ? "verifiedManual" : "supported" });
    }
    expect(manifest.find((e) => e.id === "baron")).toMatchObject({ status: "setupOwned" });
    // Slice 7: no completed proof rule still claims rules evidence is pending.
    expect(JSON.stringify(manifest)).not.toMatch(/proofPending|Manual until its rules matrix/);
    expect(manifest.find((e) => e.id === "empath")).toMatchObject({ status: "supported", note: expect.stringMatching(/Support semantic/) });
    for (const id of ["cultleader", "pithag"]) expect(manifest.find((e) => e.id === id)!.note, id).toMatch(/GUIDED-PARTIAL/);
    expect(manifest.find((e) => e.id === "scarletwoman")).toMatchObject({ status: "unclassified", note: expect.stringMatching(/star-pass/) });
    for (const entry of manifest.filter((e) => e.kind === "fabled" || e.kind === "loric")) {
      expect(entry.status).toBe(entry.id === "toymaker" ? "verifiedManual" : "modifierScoped");
      expect(entry.scopes).toEqual(CANONICAL_MODIFIER_SCOPES[entry.id]);
    }
    expect(manifest.filter((e) => e.kind === "jinx").every((e) => e.status === "gatedJudgment")).toBe(true);
    expect(manifest.filter((e) => e.status === "supported").map((e) => e.id).sort()).toEqual([...CANONICAL_ABILITY_SEMANTICS.keys()].sort());
  });

  it("a registered semantics module flips exactly its entry to supported (extension needs no coordinator change)", () => {
    const withFixtures = buildCoverageManifest(FIXTURE_SEMANTICS);
    expect(withFixtures.filter((e) => e.status === "supported").map((e) => e.id).sort()).toEqual([...FIXTURE_SEMANTICS.keys()].sort());
    const summary = coverageSummary(manifest);
    expect(summary.total).toBe(manifest.length);
    expect(summary.byStatus.unclassified).toBeGreaterThan(0); // Phase 11 work remains
    expect(Object.values(summary.byStatus).reduce((a, b) => a + b, 0)).toBe(summary.total);
  });

  it("every Fabled and Loric in the canonical data has a reviewed scope classification", () => {
    const modifiers = (rawRoles as { id: string; team: string }[]).filter((r) => r.team === "fabled" || r.team === "loric").map((r) => r.id);
    expect(modifiers.filter((id) => !(id in CANONICAL_MODIFIER_SCOPES))).toEqual([]);
  });
});
