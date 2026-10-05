// Phase 10C architecture guard: REMINDERS ARE NOTATION, NEVER MECHANICS INPUT.
//
// A Reminder is Storyteller-private, non-authoritative bookkeeping. No
// mechanic, rule query, planner or future ability evaluator may answer a
// rules question from `player.reminders` (and labels/notes are never parsed).
// Future Phase 10F ability logic may WRITE Reminder notation through the
// reminderResolution seam; it must never READ Reminders to determine rules.
//
// This guard scans real source (comments stripped, so prose about Reminders
// never trips it) in two complementary ways:
//
//  1. Named mechanics modules -- Life, Effects, setup analysis, night order,
//     identity/projection/perception -- must not touch Reminders at all.
//  2. Every other production module is scanned too: any file that reads
//     Reminder state or imports a Reminder module must be on the short,
//     reviewed allowlist of persistence / seam / presentation modules. A new
//     module that starts reading Reminders fails here until it is reviewed.
//
// Role-DATA fields named `reminders` / `remindersGlobal` (the canonical
// physical token lists on RoleDef) and night-order `...Reminder` prompt text
// are unrelated to player Reminders and are not matched.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");

/** Strips block and line comments (string literals are kept; good enough for
 * this codebase's sources and deliberately conservative: a false positive
 * only asks for review, never hides a read). */
export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Reminder coupling: reading/writing player Reminder state or importing a
 * Reminder module. */
const REMINDER_COUPLING = [
  /\.reminders\b/,
  /\breminders\s*[:=]/,
  /\breminders\s*\)/,
  /["'`]reminders["'`]\s*\]/,
  /\bReminderRecord\b/,
  /reminderResolution/,
  /reminderPresentation/,
  /features\/reminders\//,
];

export function reminderCoupling(source: string): string[] {
  const code = stripComments(source);
  return REMINDER_COUPLING.filter((pattern) => pattern.test(code)).map(String);
}

/** Mechanics / rules / projection modules that must never read Reminders. */
const MECHANICS_MODULES = [
  "stores/lifeResolution.ts",
  "stores/lifeEvents.ts",
  "stores/lifeState.ts",
  "stores/effectResolution.ts",
  "stores/effects.ts",
  "stores/effectRegistry.ts",
  "stores/identity.ts",
  "stores/wakeIdentity.ts",
  "stores/travelers.ts",
  "stores/privatePackets.ts",
  "stores/projections.ts",
  "stores/informationDelivery.ts",
  "stores/participants.ts",
  "features/setup/setupAnalyzer.ts",
  "features/setup/setupReadiness.ts",
  "features/setup/setupContext.ts",
  "features/setup/setupRefinement.ts",
  "features/setup/setupPolicies.ts",
  "features/setup/revealReadiness.ts",
  "features/nightOrder/nightOrder.ts",
  "features/nightOrder/nightRules.ts",
  "features/publicDisplay/presenters.ts",
  // Phase 10F: the Rules Query and the ability semantics / modifier contract
  // answer rules questions -- they never touch Reminders at all.
  "stores/rulesQuery.ts",
  "abilities/semantics.ts",
  "abilities/modifiers.ts",
];

/** The reviewed modules allowed to touch Reminder state: persistence
 * (types/schemas/migration), the one mutation seam and its store adapter,
 * History bookkeeping, and Storyteller-only presentation. None is mechanics. */
const ALLOWED = new Set([
  "stores/types.ts",
  "stores/schemas.ts",
  "stores/gameMigration.ts",
  "stores/history.ts",
  "stores/reminderResolution.ts",
  "stores/storytellerStore.ts",
  "features/reminders/reminderPresentation.ts",
  "features/reminders/ReminderControls.tsx",
  "features/players/PlayerDrawer.tsx",
  "features/grimoire/GrimoireCircle.tsx",
  // Phase 10F: the ability coordinator WRITES notation through the 10C seam
  // (planReminderTransaction / applyReminderPlan) -- never reads Reminders;
  // checked precisely below.
  "stores/abilityResolution.ts",
  // Phase 10G: the read-only ended-game participant review (Storyteller-only
  // presentation via reminderPresentation; it mounts no control at all).
  "features/game/EndedParticipantReview.tsx",
  // Phase 10H: the Roster / Labels readers of the Table (Storyteller-only
  // presentation via reminderPresentation; DOM-absent under Privacy Mode).
  "features/grimoire/RosterView.tsx",
]);

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

describe("Phase 10C architecture guard: Reminders are notation, never mechanics input", () => {
  it.each(MECHANICS_MODULES)("%s never reads Reminders or imports a Reminder module", (module) => {
    const source = readFileSync(join(SRC, module), "utf8");
    expect(reminderCoupling(source)).toEqual([]);
  });

  it("every production module that touches Reminders is a reviewed persistence / seam / presentation module", () => {
    const coupled = productionSources().filter((module) => reminderCoupling(readFileSync(join(SRC, module), "utf8")).length > 0);
    expect(coupled.filter((module) => !ALLOWED.has(module))).toEqual([]);
    // No mechanics module is ever allowlisted.
    expect(MECHANICS_MODULES.filter((module) => ALLOWED.has(module))).toEqual([]);
  });

  it("Phase 10F (10F-AC-20): the ability coordinator only WRITES Reminders through the seam; it never reads them", () => {
    const code = stripComments(readFileSync(join(SRC, "stores/abilityResolution.ts"), "utf8"));
    for (const forbidden of [/\.reminders\b/, /\bReminderRecord\b/, /reminderPresentation/, /features\/reminders\//, /reminderCleanupStatus/]) {
      expect(code).not.toMatch(forbidden);
    }
    const imported = /import \{([^}]*)\} from "\.\/reminderResolution";/.exec(code)?.[1]?.split(",").map((name) => name.trim()).filter(Boolean).sort();
    expect(imported).toEqual(["applyReminderPlan", "planReminderTransaction", "type ReminderIdSource", "type ReminderIntent"].sort());
  });

  it("the Reminder seam itself contains no rule logic: it never reads Effects, Life State, Roles or Alignment", () => {
    const code = stripComments(readFileSync(join(SRC, "stores/reminderResolution.ts"), "utf8"));
    for (const forbidden of [/\.effects\b/, /\.alive\b/, /\.ghostVote\b/, /\.abilityUsed\b/, /\.actualRole\b/, /\.actualAlignment\b/, /\.(label|note)\s*(===|!==)\s*["'`]/, /\.(label|note)\s*\.\s*(match|includes|startsWith|endsWith|toLowerCase|search|split)\b/]) {
      expect(code).not.toMatch(forbidden);
    }
  });

  it("the detector itself works (planted violations are caught; prose and role-data lists are not)", () => {
    expect(reminderCoupling("const poisoned = player.reminders.some((r) => r.label === 'Poisoned');")).not.toEqual([]);
    expect(reminderCoupling("import { reminderCleanupStatus } from './reminderResolution';")).not.toEqual([]);
    expect(reminderCoupling("const { reminders } = player; use(reminders)")).not.toEqual([]);
    expect(reminderCoupling("// players' reminders are notation\n/* reminders: never */ const x = 1;")).toEqual([]);
    expect(reminderCoupling("const prompt = role.firstNightReminder ?? role.otherNightReminder;")).toEqual([]);
  });
});
