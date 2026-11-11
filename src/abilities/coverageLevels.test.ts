import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import rawRoles from "@/data/canonical/roles.json";
import { buildCoverageManifest, coverageSummary, type CoverageEntry } from "@/abilities/coverage";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { REVIEWED_INTERACTION_ROLES } from "./characters/passiveRules";
import { ENDING_EVIDENCE_ROLES, PARTIAL_SUPPORT, TEST_EVIDENCE } from "./coverageEvidence";

/**
 * Stage 5A-1: the coverage list tells the truth. These tests pin the per-character
 * `level` and `evidence` fields to the facts the gates actually read, so a level
 * cannot drift from the code. No behaviour is tested here because none changed.
 */
const ROOT = resolve(__dirname, "../..");
const SRC = join(ROOT, "src");
const manifest = buildCoverageManifest();
const characters: CoverageEntry[] = manifest.filter(e => e.kind !== "jinx");
const byId = new Map(characters.map(e => [e.id, e]));
const quoted = (id: string) => new RegExp(`["'\`]${id}["'\`]|\\b${id}\\s*:`);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("coverage level and evidence (Stage 5A-1)", () => {
  it("every character has a level, jinxes have none", () => {
    expect(characters).toHaveLength(181);
    for (const e of characters) expect(e.level, e.id).toBeDefined();
    for (const e of manifest.filter(x => x.kind === "jinx")) expect(e.level, e.id).toBeUndefined();
  });

  it("pins today's counts (update deliberately when a work package lands)", () => {
    // 24 guided + 26 reviewed + 65 partial + 66 generic = 181.
    // Against the v3 plan table (state at c4e884e): the ten Stage 4 characters moved from generic to reviewed (PR #26);
    // Goon (Moonchild interaction) and Thief, Gunslinger, Scapegoat, Beggar (game-ending allow-list) were found to have a support piece.
    expect(coverageSummary(manifest).byLevel).toEqual({ guided: 24, reviewed: 26, partial: 65, generic: 66 });
  });

  it("level follows the facts the gates read", () => {
    for (const e of characters) {
      const guided = CANONICAL_ABILITY_SEMANTICS.has(e.id);
      const reviewed = REVIEWED_INTERACTION_ROLES.has(e.id);
      expect(e.reviewedInteraction, e.id).toBe(reviewed);
      if (guided) expect(e.level, e.id).toBe("guided");
      else if (reviewed) expect(e.level, e.id).toBe("reviewed");
      else expect(["partial", "generic"], e.id).toContain(e.level);
    }
    // Nothing on the reviewed list is left below "reviewed", and no Fabled or Loric is on it.
    for (const id of REVIEWED_INTERACTION_ROLES) expect(["guided", "reviewed"], id).toContain(byId.get(id)?.level);
    expect(characters.filter(e => e.level === "guided").map(e => e.id).sort()).toEqual(characters.filter(e => e.status === "supported").map(e => e.id).sort());
  });

  it("a level that claims support cites code; every cited path exists", () => {
    for (const e of characters) {
      const code = (e.evidence ?? []).filter(x => x.kind === "code");
      if (e.level !== "generic") expect(code.length, `${e.id} has no code evidence`).toBeGreaterThan(0);
      if (e.level === "generic") expect(code.every(x => x.path === "src/abilities/modifiers.ts"), `${e.id}: generic cites only the Fabled/Loric scope table`).toBe(true);
      for (const ev of e.evidence ?? []) expect(() => statSync(join(ROOT, ev.path)), `${e.id}: ${ev.path}`).not.toThrow();
    }
  });

  it("guided and reviewed characters carry test evidence", () => {
    const missing = characters.filter(e => (e.level === "guided" || e.level === "reviewed") && !(e.evidence ?? []).some(x => x.kind === "test")).map(e => e.id);
    expect(missing).toEqual([]);
  });

  it("every hand-written support piece and test names its character in the cited file", () => {
    const ids = new Set(characters.map(e => e.id));
    for (const [id, pieces] of Object.entries(PARTIAL_SUPPORT)) {
      expect(ids.has(id), `unknown id ${id}`).toBe(true);
      for (const piece of pieces) expect(readFileSync(join(ROOT, piece.path), "utf8"), `${id} in ${piece.path}`).toMatch(quoted(id));
    }
    for (const [id, paths] of Object.entries(TEST_EVIDENCE)) {
      expect(ids.has(id), `unknown id ${id}`).toBe(true);
      for (const path of paths) expect(readFileSync(join(ROOT, path), "utf8"), `${id} in ${path}`).toMatch(quoted(id));
    }
  });

  it("the game-ending allow-list mirrored for evidence equals the source list", () => {
    const source = readFileSync(join(SRC, "stores/victoryEvidence.ts"), "utf8");
    const listed = /const supportedRoles = new Set\(\[(.*?)\]\)/s.exec(source)![1]!.match(/"([a-z]+)"/g)!.map(s => s.replaceAll('"', ""));
    expect([...ENDING_EVIDENCE_ROLES].sort()).toEqual([...listed].sort());
  });

  it("a generic character is not named in any behavioural source file (guards against a stale 'generic')", () => {
    // Art lists, the launch splash and the trial seed only decorate or seed; they carry no rule.
    const decorative = ["features/splash/LaunchSplash.tsx", "features/home/art.ts", "trial/seed.ts"];
    const sources = walk(SRC)
      .filter(f => /\.tsx?$/.test(f) && !/\.(test|spec)\./.test(f) && !f.includes(`${join(SRC, "data")}/`))
      .map(f => relative(SRC, f))
      .filter(f => !decorative.includes(f) && !f.startsWith("test/") && !f.startsWith("abilities/coverage") && f !== "abilities/coverageEvidence.ts" && !f.startsWith("firebase/"));
    const texts = new Map(sources.map(f => [f, readFileSync(join(SRC, f), "utf8")]));
    const stale: string[] = [];
    for (const e of characters.filter(x => x.level === "generic")) {
      const re = new RegExp(`["'\`]${e.id}["'\`]`);
      for (const [f, t] of texts) if (re.test(t)) stale.push(`${e.id} in ${f}`);
    }
    expect(stale).toEqual([]);
  });

  it("known gaps are carried as caveats, never as support", () => {
    expect(byId.get("mutant")!.caveats?.join(" ")).toMatch(/only in Day/);
    expect(byId.get("juggler")!.caveats?.join(" ")).toMatch(/wakes once/);
    for (const e of characters.filter(x => x.kind === "fabled" || x.kind === "loric")) expect(e.caveats?.join(" "), e.id).toMatch(/manual game ending/);
    expect((rawRoles as { id: string }[]).length).toBe(181);
  });
});
