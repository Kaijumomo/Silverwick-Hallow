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
// literal / patch value ending in `,` or `}`, a property assignment, a delete);
// a false positive merely asks for review.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const FIELDS = "actualRole|shownRole|shownAlignment|behaviorMode|isTraveler|publicDisplayRole";
const WRITE_PATTERNS = [
  new RegExp(`\\b(${FIELDS})\\s*:\\s*[^;\\n]*[,}]\\s*$`, "gm"),
  new RegExp(`\\.(${FIELDS})\\s*=[^=]`, "g"),
  new RegExp(`delete\\s+[\\w.\\[\\]]*\\.(${FIELDS})\\b`, "g"),
  new RegExp(`\\[\\s*['"](${FIELDS})['"]\\s*\\]\\s*=`, "g"),
];

export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

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

/** The reviewed modules that may contain write-like shapes for these fields,
 * each for a stated, non-live reason. */
const ALLOWED_MODULES: Record<string, string> = {
  "stores/roleResolution.ts": "THE seam: the planner's working state and intent builders",
  "stores/storytellerStore.ts": "constructors, Setup and legacy migration (units audited below)",
  "stores/identity.ts": "dealtIdentity: the Setup Deal's fresh assignment",
  "stores/schemas.ts": "the persisted-shape schemas",
  "stores/gameMigration.ts": "legacy migration",
  "stores/projections.ts": "builds projection RECORDS (public/self), never Current State",
  "firebase/snapshots.ts": "wire decoders for projection records",
  "firebase/membershipCommands.ts": "builds a Role-seam INTENT for a Traveler choice",
  "features/players/PlayerDrawer.tsx": "builds Role-seam INTENTS from the rendered record",
  "features/players/TravelerArrival.tsx": "builds Role-seam INTENTS from the rendered Traveler record (ASTRA-10D-003)",
};

/** Store units (top-level helpers / commands) that may write these fields. */
const ALLOWED_STORE_UNITS = new Set([
  "blankPlayer", "arrivalPlayer", "migrateStoreState", "setIsTraveler",
  // Not player writes: the compatibility adapter builds a perception SPEC it
  // hands to setPerception (checked below), and an Information Delivery
  // records a snapshot of the recipient's Actual Role.
  "setShownRole", "recordInformationDelivery",
]);

function enclosingUnit(source: string, line: number): string {
  const lines = stripComments(source).split("\n");
  for (let i = line - 1; i >= 0; i--) {
    const top = /^(?:export )?(?:const|function|async function) (\w+)/.exec(lines[i]!);
    if (top) return top[1]!;
    const command = /^ {6}(\w+): (?:\(|async \()/.exec(lines[i]!);
    if (command) return command[1]!;
  }
  return "<module>";
}

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

  it("a planted direct writer would be caught by the detector (self-check)", () => {
    const planted = "const next = { ...player, actualRole: roleId, isTraveler: true };\nplayer.shownRole = 'x';\n";
    expect(writeLines(planted).length).toBeGreaterThan(0);
    expect(writeLines("const view = (p) => p.actualRole;\nconst t: { actualRole: string };")).toEqual([]);
  });
});
