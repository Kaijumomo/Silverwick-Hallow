// Phase 10D architecture guard: NO LIVE/GENERAL WRITER BYPASSES THE ROLE SEAM.
//
// Every live/general change to actualRole, shownRole, shownAlignment,
// behaviorMode, isTraveler and publicDisplayRole goes through
// planRoleTransaction / applyRolePlan / resolveRoles. The only other writers
// are narrow, reviewed and documented here:
//
//  - constructors / occupancy: blankPlayer, arrivalPlayer (a new arrival is a
//    Traveler), occupySeat (via arrivalPlayer), unseat rebuilds a blank seat;
//  - Setup: dealtIdentity/freshAssignment (Deal, Shuffle, Swap, Manual
//    Override, Edit Bag) and setIsTraveler (the pre-Reveal Traveler
//    designation) -- Setup-specific workflows that are never live Role
//    transitions and record no History;
//  - migration: gameMigration.ts and migrateStoreState's legacy steps;
//  - validated whole-snapshot restoration (undo / restoreRemoteCheckpoint)
//    replaces `game` wholesale and writes no field.
//
// The scan strips comments and looks for WRITE-LIKE shapes only (an object
// literal / patch property however it is closed -- `,`, `}`, `};`, `})`, end
// of line -- a property or bracket assignment, a delete); a false positive
// merely asks for review.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { enclosingUnitFor, snapshotViolations, stripCommentsForGuard, writeLinesFor } from "@/test/writerGuard";

const SRC = resolve(__dirname, "..");
// SOL-10F-L7: one shared write-shape detector (src/test/writerGuard.ts) for
// the Role and Alignment guards -- catches `{ ...p, actualRole: x };`
// (semicolon-terminated), property / bracket assignment and delete.
const FIELDS = ["actualRole", "shownRole", "shownAlignment", "behaviorMode", "isTraveler", "publicDisplayRole"];

const stripComments = stripCommentsForGuard;

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

const writeLines = (source: string): number[] => writeLinesFor(FIELDS, source);

/** The reviewed modules that may contain write-like shapes for these fields,
 * each for a stated, non-live reason. */
const ALLOWED_MODULES: Record<string, string> = {
  "stores/roleResolution.ts": "THE seam: the planner's working state and intent builders",
  "stores/storytellerStore.ts": "constructors, Setup and legacy migration (units audited below)",
  "stores/identity.ts": "dealtIdentity: the Setup Deal's fresh assignment",
  "stores/schemas.ts": "the persisted-shape schemas",
  "stores/gameMigration.ts": "legacy migration",
  "stores/projections.ts": "builds projection RECORDS (public/self), never Current State",
  "stores/informationDelivery.ts": "an Information Delivery RECORD snapshots the recipient's Actual Role (Phase 10F pure planner), never Current State",
  "stores/abilityResolution.ts": "captureFingerprint snapshots the OBSERVED Role/perception into a read-only workflow fingerprint (Phase 10F), never Current State",
  // SOL-10F-L7: admitted ONLY at its AlignmentChange log entry (the observed
  // Traveler status), asserted below; ALIGNMENT_PLAN_FIELDS forbids isTraveler.
  "stores/alignmentResolution.ts": "the Alignment seam's AlignmentChange record carries the OBSERVED Traveler status, never a player patch",
  "firebase/snapshots.ts": "wire decoders for projection records",
  "firebase/membershipCommands.ts": "builds a Role-seam INTENT for a Traveler choice",
  "features/players/PlayerDrawer.tsx": "builds Role-seam INTENTS from the rendered record",
  "features/players/TravelerArrival.tsx": "builds Role-seam INTENTS from the rendered Traveler record (ASTRA-10D-003)",
};

/** Store units (top-level helpers / commands) that may write these fields. */
const ALLOWED_STORE_UNITS = new Set([
  "blankPlayer", "arrivalPlayer", "migrateStoreState", "setIsTraveler",
  // Not a player write: the compatibility adapter builds a perception SPEC it
  // hands to setPerception (checked below). (Phase 10F: the Information
  // Delivery record's Actual Role snapshot moved into the pure planner,
  // informationDelivery.ts, so recordInformationDelivery writes none.)
  "setShownRole",
  // SOL-10F-L7: the strengthened detector now also sees these two adapters'
  // perception SPECs (`setPerception(id, { ...: x })`). Same reason as
  // setShownRole; each flagged line is asserted below to be ONLY that call.
  "setShownAlignment", "setBehaviorMode",
]);

/** SOL-10F-L7: the Phase 10F read-only snapshot modules above are admitted
 * ONLY at their reviewed unit and only as verbatim observed copies. */
const SNAPSHOT_SITES: Record<string, string> = {
  "stores/abilityResolution.ts": "captureFingerprint",
  "stores/informationDelivery.ts": "planInformationDelivery",
};

/** Units whose only write shape is a perception spec handed to setPerception. */
const PERCEPTION_SPEC_UNITS = new Set(["setShownRole", "setShownAlignment", "setBehaviorMode"]);

const enclosingUnit = enclosingUnitFor;

describe("Phase 10D architecture guard: no writer bypasses the Role seam", () => {
  it("only the reviewed modules contain write-like shapes for Role/perception fields", () => {
    const offenders = productionSources().filter((module) =>
      writeLines(readFileSync(join(SRC, module), "utf8")).length > 0 && !(module in ALLOWED_MODULES));
    expect(offenders).toEqual([]);
  });

  it("inside the store, only constructors, Setup Traveler designation and legacy migration write them", () => {
    const source = readFileSync(join(SRC, "stores/storytellerStore.ts"), "utf8");
    const units = new Set(writeLines(source).map((line) => enclosingUnit(source, line)));
    expect([...units].filter((unit) => !ALLOWED_STORE_UNITS.has(unit))).toEqual([]);
    // The Setup Deal / refinement commands write through the one reviewed
    // builder (freshAssignment -> dealtIdentity), never field by field.
    expect(units.has("freshAssignment")).toBe(false);
  });

  it("SOL-10F-L7: the 10F snapshot modules write Role fields only as observed copies inside their reviewed unit", () => {
    for (const [module, unit] of Object.entries(SNAPSHOT_SITES)) {
      const text = readFileSync(join(SRC, module), "utf8");
      expect(writeLines(text).length, module).toBeGreaterThan(0);
      expect(snapshotViolations(FIELDS, text, unit), module).toEqual([]);
    }
    // Self-check: a planted writer inside the reviewed unit, or a copy outside it, is caught.
    const planted = 'function captureFingerprint(player) {\n  return { actualRole: player.actualRole,\n    shownRole: "imp" };\n}\nfunction other(player) {\n  return { actualRole: player.actualRole };\n}';
    expect(snapshotViolations(FIELDS, planted, "captureFingerprint")).toEqual([
      '3 (captureFingerprint): shownRole: "imp" };',
      "6 (other): return { actualRole: player.actualRole };",
    ]);
  });

  it("SOL-10F-L7: the perception adapters' only write shape is the spec they hand to setPerception", () => {
    const source = readFileSync(join(SRC, "stores/storytellerStore.ts"), "utf8");
    const code = stripComments(source).split("\n");
    const hits = writeLines(source).filter((line) => PERCEPTION_SPEC_UNITS.has(enclosingUnit(source, line)));
    expect(new Set(hits.map((line) => enclosingUnit(source, line)))).toEqual(PERCEPTION_SPEC_UNITS);
    for (const line of hits) {
      // Walk back to the opening `return get().setPerception(id, {` with no
      // statement boundary in between: the hit is inside that spec literal.
      let open = line - 1;
      while (open >= 0 && !/^\s*return get\(\)\.setPerception\(id, \{/.test(code[open]!)) {
        expect(code[open], `line ${line} is not inside a setPerception spec`).not.toMatch(/;/);
        open--;
      }
      expect(open, `line ${line}`).toBeGreaterThanOrEqual(0);
      expect(code.slice(open, line + 2).join("\n"), `line ${line}`).toMatch(/\}\);/);
    }
  });

  it("every compatibility wrapper is a thin adapter over resolveRoles / setPerception -- no parallel mutation path", () => {
    const source = stripComments(readFileSync(join(SRC, "stores/storytellerStore.ts"), "utf8"));
    const body = (name: string) => {
      const start = source.search(new RegExp(`^ {6}${name}: \\(`, "m"));
      expect(start, `${name} exists`).toBeGreaterThan(-1);
      const rest = source.slice(start + 1);
      const next = rest.search(/\n {6}\w+: (?:\(|async \()/);
      return rest.slice(0, next < 0 ? undefined : next);
    };
    for (const name of ["assignRole", "correctRole", "showAssignedRole", "setShownRole", "setShownAlignment", "setBehaviorMode", "setPerception"]) {
      const text = body(name);
      expect(text, name).toMatch(/resolveRoles|setPerception|setShownRole/);
      for (const forbidden of [/\bset\(/, /patchPlayer/, /players:/, /pushUndo/, /recordIfLive/, /invalidatePrivatePacket/, /pruneInapplicablePrivateInfo/]) {
        expect(text, `${name} must not match ${forbidden}`).not.toMatch(forbidden);
      }
    }
    // The single commit seam.
    const seam = body("resolveRoles");
    expect(seam).toMatch(/planRoleTransaction/);
    expect(seam).toMatch(/applyRolePlan/);
    expect(seam.match(/\bset\(/g)).toHaveLength(1);
    expect(seam.match(/pushUndo\(/g)).toHaveLength(1);
  });

  it("the planner and applyRolePlan are pure: no randomness, clock or store access inside them", () => {
    const source = stripComments(readFileSync(join(SRC, "stores/roleResolution.ts"), "utf8"));
    const start = source.indexOf("export function applyRolePlan");
    const end = source.indexOf("export function changeRoleIntent");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pure = source.slice(start, end);
    for (const forbidden of [/Math\.random/, /Date\.now/, /new Date\b/, /crypto/, /randomUUID/, /useStorytellerStore/, /localStorage/, /\bfetch\(/, /defaultRoleIds/]) {
      expect(pure).not.toMatch(forbidden);
    }
    // Identity generation is injected, never defaulted inside the module's planning logic.
    expect(pure).toMatch(/ids\.packetEpoch\(\)/);
    expect(pure).toMatch(/ids\.historyId\(\)/);
  });

  it("the Role plan may patch only the reviewed player fields -- never Life, Effect, Reminder, alignment or identity state", () => {
    const source = stripComments(readFileSync(join(SRC, "stores/roleResolution.ts"), "utf8"));
    const list = /export const ROLE_PLAN_FIELDS = \[([\s\S]*?)\] as const;/.exec(source)![1]!;
    const fields = [...list.matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(fields.sort()).toEqual(["abilityUsed", "actualRole", "behaviorMode", "isTraveler", "packetEpoch", "privateInfo",
      "publicDisplayRole", "publishedPacket", "shownAlignment", "shownRole", "travelerArrival"].sort());
    for (const forbidden of ["alive", "ghostVote", "exiled", "effects", "reminders", "actualAlignment", "participantId", "statuses"]) {
      expect(fields).not.toContain(forbidden);
    }
  });

  it("the seam never reads Reminders or Effects to decide a Role rule", () => {
    const source = stripComments(readFileSync(join(SRC, "stores/roleResolution.ts"), "utf8"));
    for (const forbidden of [/\.reminders\b/, /\.effects\b/, /reminderResolution/, /effectResolution/, /lifeResolution/, /\.lifeEventWindow/]) {
      expect(source).not.toMatch(forbidden);
    }
  });

  it("the Alignment seam's only Role-field write shape is its AlignmentChange log entry (never a player patch)", () => {
    const source = readFileSync(join(SRC, "stores/alignmentResolution.ts"), "utf8");
    const code = stripComments(source).split("\n");
    const hits = writeLines(source);
    expect(hits.length).toBe(1);
    expect(code.slice(hits[0]! - 2, hits[0]!).join("\n")).toMatch(/changes\.push\(\{[^]*isTraveler: player\.isTraveler \}\);/);
  });

  it("SOL-10F-L7: planted direct writers are caught regardless of formatting (self-check)", () => {
    for (const field of FIELDS) {
      for (const planted of [
        `const next = { ...p, ${field}: "x" };`,
        `const next = { ...p, ${field}: "x" }`,
        `set({ game: patch(game, { ${field}: value }) });`,
        `const next = {\n  ...p,\n  ${field}: value,\n};`,
        `const next = {\n  ...p,\n  ${field}: value\n};`,
        `Object.assign(p, { ${field}: value });`,
        `p.${field} = value;`,
        `p.${field}=value;`,
        `p["${field}"] = value;`,
        `delete p.${field};`,
        `delete p["${field}"];`,
      ]) expect(writeLines(planted), planted).not.toEqual([]);
    }
    // Reads, comparisons and type annotations are not writes.
    expect(writeLines([
      "const view = (p) => p.actualRole;",
      "if (p.actualRole === roleId || p.shownRole == null) x();",
      "const t: { actualRole: string };",
      "type T = { shownAlignment: ShownAlignment | null; behaviorMode: BehaviorMode };",
      "  shownRole: RoleDef | undefined;",
      "  isTraveler?: boolean;",
      '// p.actualRole = "commented out";',
    ].join("\n"))).toEqual([]);
  });
});
