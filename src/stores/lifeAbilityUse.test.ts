// Phase 10F, Slice 2: the narrow 10A amendment -- composable ability use
// through the Life boundary (PHASE10F Section 6). `useAbility` (gameplay) and
// `correctAbilityUsed` (correction) are ordinary Life intents: they plan purely
// against the evolving working state, compose atomically with other Life
// intents of the same resolution, and keep resurrection / Role-change resets
// distinct. setAbilityUsed is an adapter; no other writer exists.
// Traceability: 10F-AC-15, 10F-AC-16, 10F-AC-01.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { applyLifePlan, planLifeTransaction, type LifeIdSource } from "./lifeResolution";
import { changeRoleIntent, correctRoleIntent } from "./roleResolution";
import { StorytellerGamePersistedSchema } from "./schemas";
import { stripComments } from "./roleArchitecture.test";
import { setupGame, setupScript } from "@/test/setupFixtures";
import type { PlayerId, StorytellerLobbyRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;
const ROLES = ["slayer", "chef", "empath", "fortuneteller", "monk", "poisoner", "imp"];

beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript } }));

function live(phase: "night" | "day" = "day", over: Partial<StorytellerLobbyRecord> = {}) {
  store.setState({ game: setupGame(ROLES, { phase, day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over }), undoStack: [] });
  return { slayer: "p0", chef: "p1", empath: "p2" };
}
const counterIds = (): LifeIdSource => {
  let e = 0; let h = 0;
  return { eventId: () => `le-${++e}`, historyId: () => `h-${++h}` };
};
const baseline = () => ({ game: game(), undo: state().undoStack, seq: state().localSeq });
function expectOneCommit(b: ReturnType<typeof baseline>) {
  expect(game()).not.toBe(b.game);
  expect(state().undoStack).toHaveLength(b.undo.length + 1);
  expect(state().undoStack.at(-1)).toEqual(b.game);
  expect(state().localSeq).toBe(b.seq + 1);
}
function expectInert(b: ReturnType<typeof baseline>) {
  expect(game()).toBe(b.game);
  expect(state().undoStack).toBe(b.undo);
  expect(state().localSeq).toBe(b.seq);
}

describe("10F-AC-15: useAbility / correctAbilityUsed are Life intents", () => {
  it("useAbility is a gameplay use: abilityUsed false -> true with one truthful (non-correction) Life History record", () => {
    const { slayer } = live();
    const b = baseline();
    expect(state().resolveLife({ intents: [{ kind: "useAbility", playerId: slayer }], context: { provenance: { sourceCharacter: "slayer", reason: "ability" } } }))
      .toEqual({ ok: true, changed: true, eventIds: [] });
    expectOneCommit(b);
    expect(player(slayer).abilityUsed).toBe(true);
    const record = game().history.at(-1)!;
    expect(record).toMatchObject({ category: "life", change: { kind: "value", from: { abilityUsed: false }, to: { abilityUsed: true } },
      provenance: { sourceCharacter: "slayer", reason: "ability" }, moment: { phase: "day", day: 2 } });
    expect(record.correction).toBeUndefined();
    expect(record.lifeEvent).toBeUndefined(); // ability use is not a Life Event
    expect(game().lifeEventWindow).toBe(b.game.lifeEventWindow);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });

  it("useAbility on an already-used ability is refused atomically (never a silent repeat)", () => {
    const { slayer, chef } = live();
    expect(state().resolveLife({ intents: [{ kind: "useAbility", playerId: slayer }] }).ok).toBe(true);
    const b = baseline();
    // Even combined with a legal intent, nothing commits.
    expect(state().resolveLife({ intents: [{ kind: "death", playerId: chef }, { kind: "useAbility", playerId: slayer }] }))
      .toMatchObject({ ok: false, code: "refused" });
    expectInert(b);
    expect(player(chef).alive).toBe(true);
  });

  it("correctAbilityUsed is a distinct CORRECTION; the already-held value contributes nothing (true no-op)", () => {
    const { slayer } = live();
    const b0 = baseline();
    expect(state().resolveLife({ intents: [{ kind: "correctAbilityUsed", playerId: slayer, used: false }] })).toEqual({ ok: true, changed: false, eventIds: [] });
    expectInert(b0);
    const b = baseline();
    expect(state().resolveLife({ intents: [{ kind: "correctAbilityUsed", playerId: slayer, used: true }] }).ok).toBe(true);
    expectOneCommit(b);
    expect(game().history.at(-1)).toMatchObject({ category: "life", correction: true, change: { from: { abilityUsed: false }, to: { abilityUsed: true } } });
    expect(state().resolveLife({ intents: [{ kind: "correctAbilityUsed", playerId: slayer, used: false }] }).ok).toBe(true);
    expect(player(slayer).abilityUsed).toBe(false);
    expect(game().history.at(-1)).toMatchObject({ correction: true, change: { from: { abilityUsed: true }, to: { abilityUsed: false } } });
  });

  it("a correction never mixes with gameplay (the History correction flag stays truthful)", () => {
    const { slayer, chef } = live();
    const b = baseline();
    expect(state().resolveLife({ intents: [{ kind: "useAbility", playerId: slayer }, { kind: "correctAbilityUsed", playerId: chef, used: true }] }))
      .toMatchObject({ ok: false, code: "refused" });
    expectInert(b);
  });

  it("malformed input is refused safely, never thrown", () => {
    const { slayer } = live();
    for (const intent of [{ kind: "correctAbilityUsed", playerId: slayer }, { kind: "correctAbilityUsed", playerId: slayer, used: "yes" },
      { kind: "useAbility", playerId: "toString" }, { kind: "useAbility", playerId: 7 }, { kind: "useAbility" }]) {
      expect(() => planLifeTransaction(game(), { intents: [intent as never] })).not.toThrow();
      expect(planLifeTransaction(game(), { intents: [intent as never] })).toMatchObject({ ok: false });
    }
  });

  it("ability use is a Live Play mutation: refused in Setup and after the game ends", () => {
    live();
    for (const phase of ["setup", "ended"] as const) {
      store.setState({ game: { ...game(), phase } });
      const b = baseline();
      expect(state().resolveLife({ intents: [{ kind: "useAbility", playerId: "p0" }] })).toMatchObject({ ok: false });
      expect(state().setAbilityUsed("p0", true)).toMatchObject({ ok: false });
      expectInert(b);
    }
  });
});

describe("10F-AC-15 / AC-16: composition in one Life transaction", () => {
  it("a once-per-game use and its outcome commit together (useAbility + death, one Undo/localSeq, one Life Event)", () => {
    const { slayer, chef } = live();
    const b = baseline();
    const result = state().resolveLife({ intents: [{ kind: "useAbility", playerId: slayer }, { kind: "death", playerId: chef }], resolutionId: "res-slay" });
    expect(result).toMatchObject({ ok: true, changed: true });
    expectOneCommit(b);
    expect(player(slayer).abilityUsed).toBe(true);
    expect(player(chef).alive).toBe(false);
    expect(game().lifeEventWindow.events).toHaveLength(1);
    expect(game().lifeEventWindow.events[0]).toMatchObject({ kind: "death", resolutionId: "res-slay" });
    // One record per affected participant, in first-touched order.
    expect(game().history.slice(-2).map((h) => h.participant.playerId)).toEqual([slayer, chef]);
  });

  it("plans purely against an evolving working snapshot (no store write; deterministic ids)", () => {
    const { slayer, chef } = live();
    const before = game();
    const a = planLifeTransaction(before, { intents: [{ kind: "useAbility", playerId: slayer }, { kind: "death", playerId: chef }] }, counterIds());
    const b = planLifeTransaction(before, { intents: [{ kind: "useAbility", playerId: slayer }, { kind: "death", playerId: chef }] }, counterIds());
    expect(a).toEqual(b);
    expect(game()).toBe(before);
    if (!a.ok || !a.changed) throw new Error("expected a plan");
    const working = applyLifePlan(before, a.plan);
    // A later plan against the working snapshot observes the first one.
    expect(planLifeTransaction(working, { intents: [{ kind: "useAbility", playerId: slayer }] })).toMatchObject({ ok: false });
    expect(planLifeTransaction(working, { intents: [{ kind: "death", playerId: chef }] })).toMatchObject({ ok: false });
  });

  it("intent order is preserved: resurrection then use leaves the ability used; use then resurrection restores it", () => {
    const { chef } = live();
    store.setState({ game: { ...game(), players: { ...game().players, [chef]: { ...player(chef), alive: false } } } });
    expect(state().resolveLife({ intents: [{ kind: "resurrection", playerId: chef }, { kind: "useAbility", playerId: chef }] }).ok).toBe(true);
    expect(player(chef)).toMatchObject({ alive: true, abilityUsed: true });
    live();
    store.setState({ game: { ...game(), players: { ...game().players, [chef]: { ...player(chef), alive: false } } } });
    expect(state().resolveLife({ intents: [{ kind: "useAbility", playerId: chef }, { kind: "resurrection", playerId: chef }] }).ok).toBe(true);
    expect(player(chef)).toMatchObject({ alive: true, abilityUsed: false }); // generic resurrection reset preserved
  });
});

describe("existing resets stay distinct and unchanged", () => {
  it("a gameplay Role change resets abilityUsed; a Role correction preserves it", () => {
    const { chef, empath } = live("night");
    expect(state().setAbilityUsed(chef, true).ok).toBe(true);
    expect(state().setAbilityUsed(empath, true).ok).toBe(true);
    expect(state().resolveRoles({ intents: [changeRoleIntent(player(chef), "monk")] }).ok).toBe(true);
    expect(player(chef).abilityUsed).toBe(false);
    expect(state().resolveRoles({ intents: [correctRoleIntent(player(empath), "monk")] }).ok).toBe(true);
    expect(player(empath).abilityUsed).toBe(true);
  });

  it("setAbilityUsed is a thin adapter: true -> gameplay useAbility, false -> correction, current value inert", () => {
    const { slayer } = live();
    const b = baseline();
    expect(state().setAbilityUsed(slayer, false)).toEqual({ ok: true, changed: false, eventIds: [] });
    expectInert(b);
    expect(state().setAbilityUsed(slayer, true).ok).toBe(true);
    expect(game().history.at(-1)!.correction).toBeUndefined();
    expect(state().setAbilityUsed(slayer, false).ok).toBe(true);
    expect(game().history.at(-1)!.correction).toBe(true);
    const source = stripComments(readFileSync(resolve(__dirname, "storytellerStore.ts"), "utf8"));
    const start = source.search(/^ {6}setAbilityUsed: \(/m);
    const body = source.slice(start, source.indexOf("\n      resolveEffects:", start));
    expect(body).toMatch(/resolveLife\(/);
    for (const forbidden of [/\bset\(/, /patchPlayer/, /pushUndo/, /abilityUsed:\s*(true|false|abilityUsed)\b/]) expect(body).not.toMatch(forbidden);
  });
});

// ---------------------------------------------------------------------------
// Architecture guard: no new abilityUsed writer (10F-AC-15, Section 6)
// ---------------------------------------------------------------------------
const SRC = resolve(__dirname, "..");
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
const WRITES = [/\babilityUsed\s*:\s*(?!boolean\b)[^;\n,}]+[,}]/g, /\.abilityUsed\s*=[^=]/g, /delete\s+[\w.[\]]*\.abilityUsed\b/g, /\[\s*['"]abilityUsed['"]\s*\]\s*=/g];
const writeCount = (source: string) => WRITES.reduce((n, pattern) => n + (stripComments(source).match(pattern)?.length ?? 0), 0);

/** The reviewed abilityUsed writers and why each is allowed. */
const ALLOWED: Record<string, string> = {
  "stores/lifeResolution.ts": "THE boundary: useAbility / correctAbilityUsed / resurrection reset and the plan application",
  "stores/roleResolution.ts": "10D gameplay Role change reset (ROLE_PLAN_FIELDS)",
  "stores/storytellerStore.ts": "blankPlayer construction and Setup freshAssignment reset (audited below)",
  "stores/schemas.ts": "persisted shape",
  "features/nightOrder/nightOrder.ts": "copies the value into a READ-ONLY Night step view, never Current State",
};

describe("Architecture guard: abilityUsed has no writer outside the reviewed seams", () => {
  it("only the reviewed modules contain abilityUsed write shapes", () => {
    const offenders = productionSources().filter((module) => writeCount(readFileSync(join(SRC, module), "utf8")) > 0 && !(module in ALLOWED));
    expect(offenders).toEqual([]);
  });
  it("inside the store, only blankPlayer and freshAssignment write it", () => {
    const code = stripComments(readFileSync(join(SRC, "stores/storytellerStore.ts"), "utf8"));
    const lines = code.split("\n");
    const units = new Set<string>();
    lines.forEach((line, index) => {
      if (!WRITES.some((pattern) => { pattern.lastIndex = 0; return pattern.test(line); })) return;
      for (let i = index; i >= 0; i--) {
        const top = /^(?:export )?(?:const|function) (\w+)/.exec(lines[i]!) ?? /^ {6}(\w+): (?:\(|async \()/.exec(lines[i]!);
        if (top) { units.add(top[1]!); break; }
      }
    });
    expect([...units].sort()).toEqual(["blankPlayer", "freshAssignment"]);
  });
  it("a planted writer is detected (self-check)", () => {
    expect(writeCount("const next = { ...p, abilityUsed: true };\n")).toBeGreaterThan(0);
    expect(writeCount("p.abilityUsed = true;")).toBeGreaterThan(0);
    expect(writeCount("const used = p.abilityUsed;")).toBe(0);
  });
});
