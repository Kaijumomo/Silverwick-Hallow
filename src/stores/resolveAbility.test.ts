// Phase 10F, Slice 4: the one-store-commit ability command (PHASE10F Section
// 3.4). One accepted ability resolution = one game replacement, one Undo
// entry, one localSeq step, one projection cycle. A refusal at any internal
// stage, or a true no-op, commits nothing. Never a nested store command.
// Traceability: 10F-AC-01, AC-02, AC-06, AC-08, AC-11, AC-19, AC-26, AC-27.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { captureFingerprint, type AbilityOutcome, type ParticipantBinding } from "./abilityResolution";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { FIXTURE_SEMANTICS } from "@/test/abilityFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];

beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript } }));

function live(phase: "night" | "day" = "night", day = 2, over: Partial<StorytellerLobbyRecord> = {}) {
  const g = setupGame(ROLES, { phase, day, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  g.players.p6 = { ...g.players.p6!, shownRole: "empath", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" };
  store.setState({ game: g, undoStack: [], localSeq: 5 });
}
const bind = (id: string): ParticipantBinding => ({ playerId: id, participantId: game().players[id]!.participantId! });
const baseline = () => ({ game: game(), undo: state().undoStack, seq: state().localSeq });
function expectInert(b: ReturnType<typeof baseline>) {
  expect(game()).toBe(b.game);
  expect(state().undoStack).toBe(b.undo);
  expect(state().localSeq).toBe(b.seq);
}
/** Counts authoritative game replacements (each one is a projection cycle --
 * the sync layer reacts to a new `game` reference). */
function watchGame() {
  const seen: StorytellerLobbyRecord[] = [];
  const unsubscribe = store.subscribe((next, prev) => { if (next.game !== prev.game && next.game) seen.push(next.game); });
  return { seen, unsubscribe };
}

const multiDomain = (): AbilityOutcome => ({ mechanicalOrder: "declared", operations: [
  { domain: "role", intents: [{ kind: "changeActualRole", target: bind("p5"), expectedActualRole: "chef", expectedIsTraveler: false, actualRole: "monk" }] },
  { domain: "alignment", intents: [{ kind: "changeActualAlignment", target: bind("p5"), expectedActualAlignment: "good", expectedIsTraveler: false, actualAlignment: "evil" } as never] },
  { domain: "effect", intents: [{ kind: "apply", target: bind("p2"), effect: { type: "marked", lifetime: { kind: "manual" } } }] },
  { domain: "life", intents: [{ kind: "death", target: bind("p3") }] },
  { domain: "reminder", intents: [{ kind: "place", target: bind("p3"), reminder: { label: "Killed" } }] },
  { domain: "information", recipient: bind("p2"), informationActionId: "empath-other-night", values: [{ requirementId: "evilNeighbors", kind: "number", value: 1 }] },
] });

describe("10F-AC-01 / AC-02: one accepted resolution = one commit", () => {
  it("a six-domain manual resolution commits once: one replacement, one Undo entry, one localSeq step", () => {
    live();
    const b = baseline();
    const watch = watchGame();
    const result = state().resolveAbility({ mode: "manual", outcome: multiDomain(), reason: "Unmodeled interaction" });
    watch.unsubscribe();
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(watch.seen).toHaveLength(1);
    expect(state().undoStack).toHaveLength(b.undo.length + 1);
    expect(state().undoStack.at(-1)).toEqual(b.game);
    expect(state().localSeq).toBe(b.seq + 1);
    const g = game();
    expect(g.players.p5).toMatchObject({ actualRole: "monk", actualAlignment: "evil" });
    expect(g.players.p2!.effects.map((e) => e.type)).toEqual(["marked"]);
    expect(g.players.p3!.alive).toBe(false);
    expect(g.players.p3!.reminders.map((r) => r.label)).toEqual(["Killed"]);
    expect(g.informationDeliveries).toHaveLength(1);
    // One resolution id correlates every record that carries one.
    const resolutionId = result.ok && result.changed ? result.resolutionId : "";
    expect(g.informationDeliveries[0]!.resolutionId).toBe(resolutionId);
    expect(g.lifeEventWindow.events.at(-1)!.resolutionId).toBe(resolutionId);
    expect(g.history.filter((h) => h.category !== "life").every((h) => h.resolutionId === resolutionId)).toBe(true);
  });

  it("Undo restores the whole pre-resolution snapshot in one step (the delivery record included)", () => {
    live();
    const before = game();
    expect(state().resolveAbility({ mode: "manual", outcome: multiDomain(), reason: "Unmodeled interaction" }).ok).toBe(true);
    state().undo();
    expect(game()).toEqual(before);
    expect(game().informationDeliveries).toEqual([]);
  });

  it("a refusal at ANY internal stage commits nothing", () => {
    live();
    const outcome = multiDomain();
    // The last mechanical step refuses (the Life target is already dead).
    store.setState({ game: { ...game(), players: { ...game().players, p3: { ...game().players.p3!, alive: false } } } });
    const b = baseline();
    const watch = watchGame();
    expect(state().resolveAbility({ mode: "manual", outcome, reason: "x" })).toMatchObject({ ok: false, code: "domain", domain: "life", operationIndex: 3 });
    watch.unsubscribe();
    expect(watch.seen).toHaveLength(0);
    expectInert(b);
  });

  it("a true no-op commits nothing", () => {
    live("day");
    const b = baseline();
    expect(state().resolveAbility({ mode: "manual", reason: "x", outcome: { operations: [{ domain: "life", intents: [{ kind: "correctAbilityUsed", target: bind("p1"), used: false }] }] } }))
      .toEqual({ ok: true, changed: false });
    expectInert(b);
  });
});

describe("10F-AC-08 / AC-26: synchronous final stale revalidation", () => {
  it("a workflow opened before another change is refused at commit, never applied against the new state", () => {
    live();
    const fingerprint = captureFingerprint(game(), "p0")!;
    const request = { mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint, roleId: "monk", inputs: { target: { kind: "participant" as const, participants: [bind("p2")] } } };
    // Something else changes the actor in between (e.g. a Role correction).
    store.setState({ game: { ...game(), players: { ...game().players, p0: { ...game().players.p0!, shownRole: "chef" } } } });
    const b = baseline();
    expect(state().resolveAbility(request, FIXTURE_SEMANTICS)).toMatchObject({ ok: false, code: "stale" });
    expectInert(b);
  });

  it("seat reuse between opening and commit refuses the chosen target", () => {
    live();
    const request = { mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint: captureFingerprint(game(), "p0")!, roleId: "monk", inputs: { target: { kind: "participant" as const, participants: [bind("p2")] } } };
    store.setState({ game: { ...game(), players: { ...game().players, p2: { ...game().players.p2!, participantId: "a-new-person" } } } });
    const b = baseline();
    expect(state().resolveAbility(request, FIXTURE_SEMANTICS)).toMatchObject({ ok: false, code: "stale" });
    expectInert(b);
  });

  it("a guided resolution and its step completion commit together once", () => {
    live();
    const stepKey = `p:${game().players.p0!.participantId}:monk`;
    const b = baseline();
    // SOL-10F-L1: the script carries the Monk's jinx partners, but no partner
    // is REPRESENTED, so the store's modifier gate does not ask.
    const result = state().resolveAbility({ mode: "guided", invocationPath: "nightOrder", fingerprint: captureFingerprint(game(), "p0", { day: 2, stepKey })!, roleId: "monk",
      inputs: { target: { kind: "participant", participants: [bind("p2")] } }, completeStep: true }, FIXTURE_SEMANTICS);
    expect(result).toMatchObject({ ok: true, changed: true });
    expect(state().undoStack).toHaveLength(b.undo.length + 1);
    expect(state().localSeq).toBe(b.seq + 1);
    expect(game().nightProgress[`2:${stepKey}`]?.status).toBe("done");
    expect(game().players.p2!.effects).toHaveLength(1);
  });

  it("a represented unverified jinx keeps the entire action manual despite a legacy judgment", () => {
    live();
    // Seat p5 now holds the canonical Leviathan: the Leviathan / Monk jinx is active.
    store.setState({ game: { ...game(), players: { ...game().players, p5: { ...game().players.p5!, actualRole: "leviathan" } } } });
    const request = () => ({ mode: "guided" as const, invocationPath: "nightOrder" as const, fingerprint: captureFingerprint(game(), "p0")!, roleId: "monk",
      inputs: { target: { kind: "participant" as const, participants: [bind("p2")] } } });
    const b = baseline();
    expect(state().resolveAbility(request(), FIXTURE_SEMANTICS)).toMatchObject({ ok: false, code: "unsupported" });
    expectInert(b);
    expect(state().resolveAbility({ ...request(), judgments: { "modifier:jinx:leviathan+monk": { kind: "boolean", value: true } } }, FIXTURE_SEMANTICS))
      .toMatchObject({ ok: false, code: "unsupported" });
    expectInert(b);
  });

  it("a canonical character without verified production semantics: a guided request is unsupported and points to Manual", () => {
    live();
    const b = baseline();
    expect(state().resolveAbility({ mode: "guided", invocationPath: "nightOrder", fingerprint: captureFingerprint(game(), "p5")!, roleId: "chef",
      inputs: {} })).toMatchObject({ ok: false, code: "unsupported" });
    expectInert(b);
  });
});

describe("architecture: one commit seam, no nested store commands (10F-AC-02, AC-27)", () => {
  it("resolveAbility never calls another store command; the coordinator never touches the store", () => {
    live();
    const spies = (["resolveLife", "resolveEffects", "resolveReminders", "resolveRoles", "resolveAlignments", "recordInformationDelivery", "setNightStepStatus"] as const)
      .map((name) => { const spy = vi.fn(); store.setState({ [name]: spy } as never); return spy; });
    expect(state().resolveAbility({ mode: "manual", outcome: multiDomain(), reason: "x" }).ok).toBe(true);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    const code = stripComments(readFileSync(resolve(__dirname, "abilityResolution.ts"), "utf8"));
    for (const forbidden of [/useStorytellerStore/, /\bresolveLife\b/, /\bresolveEffects\b/, /\bresolveReminders\b/, /\bresolveRoles\b/, /\bresolveAlignments\b/,
      /recordInformationDelivery/, /setNightStepStatus/, /localStorage/, /\bfetch\(/, /firebase/i]) {
      expect(code).not.toMatch(forbidden);
    }
    const storeCode = stripComments(readFileSync(resolve(__dirname, "storytellerStore.ts"), "utf8"));
    const start = storeCode.search(/^ {6}resolveAbility: \(/m);
    const body = storeCode.slice(start, storeCode.indexOf("\n      assignRole:", start));
    expect(body).toMatch(/planAbilityResolution\(/);
    expect(body.match(/commitAuthoritativeState\(/g)).toHaveLength(1);
    expect(body).not.toMatch(/\bset\(|pushUndo\(/);
    const commitStart = storeCode.indexOf("const commitAuthoritativeState =");
    // Stop at this helper's closing brace; the shell adds other local commit
    // helpers before the returned store, each with its own publication.
    const commitEnd = storeCode.indexOf("\n      };", commitStart);
    expect(commitStart).toBeGreaterThanOrEqual(0);
    expect(commitEnd).toBeGreaterThan(commitStart);
    const commit = storeCode.slice(commitStart, commitEnd);
    expect(commit.match(/\bset\(/g)).toHaveLength(1);
    expect(commit.match(/pushUndo\(/g)).toHaveLength(1);
    expect(commit.indexOf("localStorage.setItem")).toBeLessThan(commit.indexOf("set({ game:"));
    expect(body).not.toMatch(/get\(\)\.(resolve|record|set)\w+\(/);
  });
});
