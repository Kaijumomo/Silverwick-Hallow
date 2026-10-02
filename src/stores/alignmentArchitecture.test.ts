// Phase 10E architecture guard: NO LIVE/GENERAL WRITER BYPASSES THE ALIGNMENT
// SEAM, and perception stays owned by the Phase 10D seam.
//
// Every live/general change to `actualAlignment` goes through
// planAlignmentTransaction / applyAlignmentPlan / resolveAlignments. The only
// other writers are narrow, non-live and reviewed here:
//
//  - constructors / occupancy: occupySeat DROPS a stale seat alignment (a new
//    participation starts unresolved); blank/arrival constructors carry none;
//  - Setup: dealtIdentity (the Deal's initial derivation, via freshAssignment)
//    and setIsTraveler (the pre-Reveal Traveler designation reset);
//  - migration: gameMigration.ts (v13 -> v14 derivation);
//  - validated whole-snapshot restoration (undo / restoreRemoteCheckpoint)
//    replaces `game` wholesale and writes no field.
//
// The scan uses the SAME write-shape detector as the Role guard
// (src/test/writerGuard.ts, SOL-10F-L7: comment-stripped, write-like shapes
// only, however the literal or statement is closed); a false positive merely
// asks for review.
// Traceability: 10E-AC-39, 10E-AC-42 (imports), 10E-AC-38 (adapter shape).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { enclosingUnitFor, stripCommentsForGuard as stripComments, writePatterns } from "@/test/writerGuard";

const SRC = resolve(__dirname, "..");
const FIELD = "actualAlignment";
const WRITE_PATTERNS = [
  ...writePatterns([FIELD]),
  // Destructuring that renames the field away (how occupySeat drops it).
  new RegExp(`\\{\\s*(${FIELD})\\s*:\\s*_\\w+\\s*,`, "g"),
];

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
const lineOf = (code: string, index: number) => code.slice(0, index).split("\n").length;
function writeLines(source: string): number[] {
  const code = stripComments(source);
  const lines = new Set<number>();
  for (const pattern of WRITE_PATTERNS) {
    pattern.lastIndex = 0;
    for (let match = pattern.exec(code); match; match = pattern.exec(code)) lines.add(lineOf(code, match.index));
  }
  return [...lines].sort((a, b) => a - b);
}
const enclosingUnit = enclosingUnitFor;
const source = (module: string) => readFileSync(join(SRC, module), "utf8");
function storeBody(name: string): string {
  const code = stripComments(source("stores/storytellerStore.ts"));
  const start = code.search(new RegExp(`^ {6}${name}: \\(`, "m"));
  expect(start, `${name} exists`).toBeGreaterThan(-1);
  const rest = code.slice(start + 1);
  const next = rest.search(/\n {6}\w+: (?:\(|async \()/);
  return rest.slice(0, next < 0 ? undefined : next);
}

/** The reviewed modules that may contain write-like shapes for Actual
 * Alignment, each for a stated, non-live reason. */
const ALLOWED_MODULES: Record<string, string> = {
  "stores/alignmentResolution.ts": "THE seam: the planner's final record and intent builders",
  "stores/storytellerStore.ts": "occupancy and Setup only (units audited below)",
  "stores/identity.ts": "dealtIdentity: the Setup Deal's initial derivation",
  "stores/schemas.ts": "the persisted-shape schemas",
  "stores/gameMigration.ts": "legacy migration (v13 -> v14 derivation)",
};
/** Store units that may write Actual Alignment. */
const ALLOWED_STORE_UNITS = new Set(["occupySeat", "setIsTraveler"]);

describe("Phase 10E architecture guard: no writer bypasses the Alignment seam", () => {
  it("only the reviewed modules contain write-like shapes for actualAlignment", () => {
    const offenders = productionSources().filter((module) => writeLines(source(module)).length > 0 && !(module in ALLOWED_MODULES));
    expect(offenders).toEqual([]);
  });

  it("inside the store, only occupancy (drop) and the Setup Traveler designation (reset) touch it; the Deal goes through dealtIdentity", () => {
    const code = source("stores/storytellerStore.ts");
    const units = new Set(writeLines(code).map((line) => enclosingUnit(code, line)));
    expect([...units].filter((unit) => !ALLOWED_STORE_UNITS.has(unit))).toEqual([]);
    expect(units.has("occupySeat")).toBe(true); // the occupancy boundary drops a stale seat alignment
    expect(units.has("freshAssignment")).toBe(false);
    // No History is hand-built for alignment anywhere in the store any more.
    expect(stripComments(code)).not.toMatch(/category:\s*"alignment"/);
    expect(stripComments(code)).not.toMatch(/alignmentHistoryValue/);
  });

  it("both legacy setters are thin adapters over resolveAlignments -- no parallel mutation path", () => {
    for (const name of ["setActualAlignment", "setTravelerAlignment"]) {
      const text = storeBody(name);
      expect(text, name).toMatch(/resolveAlignments\(/);
      expect(text, name).toMatch(/changeAlignmentIntent\(/);
      for (const forbidden of [/\bset\(/, /patchPlayer/, /players:/, /pushUndo/, /recordIfLive/, /invalidatePrivatePacket/, /actualAlignment:/, /history/]) {
        expect(text, `${name} must not match ${forbidden}`).not.toMatch(forbidden);
      }
    }
    const seam = storeBody("resolveAlignments");
    expect(seam).toMatch(/planAlignmentTransaction/);
    expect(seam).toMatch(/applyAlignmentPlan/);
    expect(seam.match(/\bset\(/g)).toHaveLength(1);
    expect(seam.match(/pushUndo\(/g)).toHaveLength(1);
  });

  it("render-bound UI and other production code never use the PlayerId-only adapters", () => {
    const callers = productionSources().filter((module) => module !== "stores/storytellerStore.ts" &&
      /\b(setActualAlignment|setTravelerAlignment)\b/.test(stripComments(source(module))));
    expect(callers).toEqual([]);
    const ui = stripComments(source("features/players/AlignmentControls.tsx"));
    expect(ui).toMatch(/resolveAlignments\(\{ intents: \[intent\] \}\)/);
    expect(ui).toMatch(/changeAlignmentIntent\(player, /);
    expect(ui).toMatch(/correctAlignmentIntent\(player, /);
    // Player-facing alignment goes through the Phase 10D perception seam.
    expect(ui).toMatch(/resolveRoles\(\{ intents: \[shownAlignmentIntent\(player, /);
  });

  it("the planner and applyAlignmentPlan are pure: no randomness, clock or store access", () => {
    const code = stripComments(source("stores/alignmentResolution.ts"));
    const start = code.indexOf("export function applyAlignmentPlan");
    const end = code.indexOf("export function changeAlignmentIntent");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pure = code.slice(start, end);
    for (const forbidden of [/Math\.random/, /Date\.now/, /new Date\b/, /crypto/, /randomUUID/, /useStorytellerStore/, /localStorage/, /\bfetch\(/, /defaultAlignmentIds/]) {
      expect(pure).not.toMatch(forbidden);
    }
    expect(pure).toMatch(/ids\.packetEpoch\(\)/);
    expect(pure).toMatch(/ids\.historyId\(\)/);
  });

  it("the Alignment plan patches only Actual Alignment and the Traveler packet cleanup -- never perception, Role, Life, Effects, Reminders or arrival", () => {
    const code = stripComments(source("stores/alignmentResolution.ts"));
    const list = /export const ALIGNMENT_PLAN_FIELDS = \[([\s\S]*?)\] as const;/.exec(code)![1]!;
    const fields = [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(fields.sort()).toEqual(["actualAlignment", "packetEpoch", "privateInfo", "publishedPacket"]);
    for (const forbidden of ["shownAlignment", "shownRole", "behaviorMode", "actualRole", "isTraveler", "publicDisplayRole",
      "travelerArrival", "alive", "ghostVote", "exiled", "abilityUsed", "effects", "reminders", "participantId"]) {
      expect(fields).not.toContain(forbidden);
    }
    // Perception remains owned by the 10D seam: the Alignment module writes
    // no perception field at all.
    expect(code).not.toMatch(/\b(shownAlignment|shownRole|behaviorMode)\s*:/);
    expect(code).not.toMatch(/\.(shownAlignment|shownRole|behaviorMode|travelerArrival)\s*=[^=]/);
  });

  it("10E-AC-42: the Alignment planner imports no character ability evaluation and no other domain planner", () => {
    const code = source("stores/alignmentResolution.ts");
    const imports = [...code.matchAll(/^import[^"]*"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["./history", "./identity", "./lifeEvents", "./participants", "./schemas", "./types", "@/data/setupCounts"].sort());
    for (const forbidden of [/roleResolution/, /effectResolution/, /lifeResolution/, /reminderResolution/, /informationActions/, /nightRules/,
      /roleRegistry/, /canonical/, /\.reminders\b/, /\.effects\b/, /\.lifeEventWindow/]) {
      expect(stripComments(code)).not.toMatch(forbidden);
    }
  });

  it("SOL-10F-L7: planted direct actualAlignment writers are caught regardless of formatting (self-check)", () => {
    for (const planted of [
      'const next = { ...player, actualAlignment: "evil" };',
      'const next = { ...player, actualAlignment: "evil" }',
      "set({ game: patch(game, { actualAlignment: value }) });",
      "const next = {\n  ...player,\n  actualAlignment: value,\n};",
      "const next = {\n  ...player,\n  actualAlignment: value\n};",
      "Object.assign(player, { actualAlignment: value });",
      "player.actualAlignment = 'good';",
      "player.actualAlignment='good';",
      'player["actualAlignment"] = value;',
      "delete next.actualAlignment;",
      'delete next["actualAlignment"];',
    ]) expect(writeLines(planted), planted).not.toEqual([]);
    // Reads, comparisons and type annotations are not writes.
    expect(writeLines([
      "const view = (p) => p.actualAlignment;",
      'if (p.actualAlignment === "evil" || p.actualAlignment == null) x();',
      "type T = { actualAlignment: Alignment };",
      "  actualAlignment: Alignment | null;",
      "  actualAlignment?: Alignment;",
      '// player.actualAlignment = "commented out";',
    ].join("\n"))).toEqual([]);
  });
});
