// Phase 10F Slice 7: architecture guards for the proof-character semantics
// modules and the new authority boundaries (Red Herring fact, verified Night
// trigger, star-pass bookkeeping, Toymaker hook, Setup-owned Baron).
// Each detector has a planted self-check proving it would catch a regression.
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { VERIFIED_DESCRIPTORS } from "./index";

const DIR = resolve(__dirname);
const SRC = resolve(__dirname, "../..");
const modules = readdirSync(DIR).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
const read = (path: string) => stripComments(readFileSync(path, "utf8"));
const characterCode = () => modules.map((name) => ({ name, code: read(join(DIR, name)) }));

/** Reminder / History reads: notation and explanation are never mechanics. */
const TRUTH_SOURCES = [/\.reminders\b/, /\bReminderRecord\b/, /\.history\b/, /\bHistoryRecord\b/, /"reminder"\s*\)/, /lifeEventWindow\.events/];
/** Ability prose / night-sheet text is never executable. */
const PROSE = [/\.(ability|flavor|firstNightPrompt|otherNightPrompt|firstNightReminder|otherNightReminder|remindersGlobal)\b/];
/** Store commands / commits: evaluators are pure; the coordinator commits once. */
const STORE = [/useStorytellerStore/, /\.getState\(\)/, /\bresolve(Life|Effects|Reminders|Roles|Alignments|Ability)\(/, /\bpushUndo\b/, /\bsetNightStepStatus\(/];
const IMPURE = [/Math\.random/, /Date\.now/, /new Date\b/, /localStorage/, /\bfetch\(/];
const offenders = (code: string, patterns: RegExp[]) => patterns.filter((pattern) => pattern.test(code)).map(String);

describe("Slice 7 guards: proof-character semantics modules", () => {
  it("never read Reminders or History as truth", () => {
    for (const { name, code } of characterCode()) expect(offenders(code, TRUTH_SOURCES), name).toEqual([]);
  });

  it("never parse ability prose or night-sheet text", () => {
    for (const { name, code } of characterCode()) expect(offenders(code, PROSE), name).toEqual([]);
  });

  it("never call a store command or commit (star-pass included) and stay pure", () => {
    for (const { name, code } of characterCode()) expect(offenders(code, [...STORE, ...IMPURE]), name).toEqual([]);
  });

  it("every module traces to the frozen matrix", () => {
    for (const name of modules.filter((n) => !["index.ts", "shared.ts", "classification.ts"].includes(n))) {
      expect(readFileSync(join(DIR, name), "utf8"), name).toMatch(/PHASE10F_CHARACTER_RULES_MATRIX\.md|matrix Section/);
    }
  });

  it("the detectors catch planted regressions (self-check)", () => {
    expect(offenders('const rh = player.reminders.find((r) => r.label === "Red Herring");', TRUTH_SOURCES)).not.toEqual([]);
    expect(offenders("const died = game.history.some((h) => h.category === \"life\");", TRUTH_SOURCES)).not.toEqual([]);
    expect(offenders('if (role.ability.includes("die")) kill();', PROSE)).not.toEqual([]);
    expect(offenders("useStorytellerStore.getState().resolveRoles({ intents });", STORE)).not.toEqual([]);
    expect(offenders("store.resolveAbility(request)", STORE)).not.toEqual([]);
    // ...while ordinary evaluator vocabulary does not trip them.
    expect(offenders("context.query.abilityFunctions(binding); player.abilityUsed;", [...PROSE, ...STORE])).toEqual([]);
  });
});

describe("Slice 7 guards: authority boundaries", () => {
  it("the Red Herring is read only through the authoritative fact query", () => {
    const ft = read(join(DIR, "fortuneteller.ts"));
    expect(ft).toMatch(/factHolders\(RED_HERRING\)/);
    expect(read(join(SRC, "stores/rulesQuery.ts"))).toMatch(/fortuneTellerRedHerring:\s*"storytellerFact"/);
  });

  it("the Night trigger is evaluated from the Life Event Window only, and only for a declared trigger", () => {
    const invocation = read(join(SRC, "abilities/invocation.ts"));
    expect(invocation).toMatch(/query\.lifeEvents\(/);
    expect(offenders(invocation, TRUTH_SOURCES)).toEqual([]);
    expect(invocation).toMatch(/path === "nightTrigger" && !descriptor\.nightTrigger/);
    // Exactly one verified descriptor declares a Night trigger: the Ravenkeeper.
    expect(VERIFIED_DESCRIPTORS.filter((d) => d.nightTrigger).map((d) => d.roleId)).toEqual(["ravenkeeper"]);
  });

  it("the Toymaker hook never reads Reminders or claims skip history", () => {
    const hooks = read(join(DIR, "modifierHooks.ts"));
    expect(offenders(hooks, [...TRUTH_SOURCES, /skipped\s*[:=]/])).toEqual([]);
  });

  it("Baron (Setup-owned) and the verified-Manual characters are never live semantics", () => {
    for (const id of ["baron", "tinker", "toymaker", "drunk"]) {
      expect(CANONICAL_ABILITY_SEMANTICS.has(id), id).toBe(false);
      expect(VERIFIED_DESCRIPTORS.some((d) => d.roleId === id), id).toBe(false);
    }
  });

  it("the star-pass suppresses the new Imp through participant-scoped Night progress, never abilityUsed", () => {
    const imp = read(join(DIR, "imp.ts"));
    expect(imp).toMatch(/domain: "nightStep"[^}]*participantStepKey\(/);
    expect(imp).not.toMatch(/abilityUsed|useAbility|correctAbilityUsed/);
  });
});
