// Phase 10G, Slice 6: terminal Finish Game, bounded free text and projection
// stability (PHASE10G Sections 17-20, 23).
// Traceability: 10G-AC-33..36, AC-39..42, AC-46; proof areas 10-14, 16.
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store, migrateStoreState, takeMigrationResetFlag } from "./storytellerStore";
import { PIT_HAG_ARBITRARY_DEATHS, gameRuleFactActive } from "./gameRuleFacts";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { MAX_NIGHT_STEP_NOTES, MAX_ST_NOTES, StorytellerGamePersistedSchema, StorytellerStateSchema } from "./schemas";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { asV24 } from "@/test/v20Migration";
import { buildRegistry } from "@/data/roleRegistry";
import type { ParticipantBinding } from "./abilityResolution";
import type { StorytellerLobbyRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];
const KEY = "new-blood-st";

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const p of Object.values(g.players)) p.actualAlignment = registry.alignmentOf(p.actualRole);
  return g;
}
beforeEach(() => {
  localStorage.clear();
  store.setState({ game: liveGame(), lobby: null, undoStack: [], localSeq: 3, sync: null, customScripts: { [setupScript.id]: setupScript }, view: "game" });
});
const bind = (id: string): ParticipantBinding => ({ playerId: id, participantId: game().players[id]!.participantId! });

describe("10G-AC-34 / AC-36: Finish Game retains a terminal snapshot (proof area 10)", () => {
  it("an offline live game becomes the retained ended snapshot; Undo is cleared and cannot restore Night/Day", () => {
    state().recordDeath("p0");
    state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] });
    const before = game();
    expect(state().undoStack.length).toBeGreaterThan(0);
    expect(state().finishGame()).toEqual({ ok: true });
    expect(game()).toEqual({ ...before, phase: "ended" });
    expect(state().undoStack).toEqual([]);
    expect(state().localSeq).toBeGreaterThan(3);
    // Final Rule-Fact state is frozen (no expiry ran; it still stands).
    expect(gameRuleFactActive(game(), PIT_HAG_ARBITRARY_DEATHS)).toBe(true);
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    state().undo();
    expect(game().phase).toBe("ended");
    expect(state().advancePhase()).toMatchObject({ ok: false });
    expect(state().setPhase("night")).toMatchObject({ ok: false });
    expect(game().phase).toBe("ended");
  });

  it("is refused for Setup and for an already-ended game (nothing changes)", () => {
    store.setState({ game: liveGame({ phase: "setup", day: 0 }) });
    const setup = game();
    expect(state().finishGame()).toMatchObject({ ok: false });
    expect(game()).toBe(setup);
    store.setState({ game: liveGame({ phase: "ended" }) });
    const ended = game();
    expect(state().finishGame()).toMatchObject({ ok: false });
    expect(game()).toBe(ended);
  });

  it("10G-AC-39: no winner / result is created", () => {
    state().finishGame();
    expect(game()).not.toHaveProperty("winner");
    expect(projectLobbyToPublic(game(), {})).not.toHaveProperty("winner");
  });
});

describe("10G-AC-33 / AC-35: multiplayer detachment (proof areas 11-12)", () => {
  it("while a lobby is still attached (its close has not succeeded), the game stays live and unchanged", () => {
    store.setState({ lobby: { code: "ABCD", uid: "st", sessionId: "s1", status: "live" }, undoStack: [liveGame()] });
    const before = { game: game(), undo: state().undoStack, seq: state().localSeq };
    expect(state().finishGame()).toMatchObject({ ok: false, message: expect.stringMatching(/multiplayer lobby/) });
    expect(game()).toBe(before.game);
    expect(state().undoStack).toBe(before.undo);
    expect(state().localSeq).toBe(before.seq);
    expect(state().lobby).not.toBeNull();
  });

  it("after the close succeeded, the retained snapshot carries no active lobby or reconnect metadata -- even after a reload", async () => {
    store.setState({ game: liveGame({ code: "ABCD", storytellerUid: "st" }), lobby: null,
      sync: { code: "ABCD", sessionId: "s1", ackedGuard: null, ackedGameSeq: 0, lastAttempt: null } });
    expect(state().finishGame()).toEqual({ ok: true });
    expect(state().lobby).toBeNull();
    expect(state().sync).toBeNull();
    expect(game().code).toBe("ABCD"); // historical record fidelity only
    const saved = localStorage.getItem(KEY)!;
    expect(JSON.parse(saved).state.lobby).toBeNull();
    store.setState({ game: null, lobby: null });
    localStorage.setItem(KEY, saved);
    await store.persist.rehydrate();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(state().lobby).toBeNull();
    expect(state().sync).toBeNull();
    expect(game().phase).toBe("ended");
  });
});

describe("Section 20: bounded free text (proof areas 13-14)", () => {
  it("10G-AC-40: changed participant notes over the limit are refused, never truncated; the limit itself is accepted", () => {
    const seq = state().localSeq;
    expect(state().setNotes("p0", "x".repeat(MAX_ST_NOTES + 1))).toMatchObject({ ok: false });
    expect(game().players.p0!.stNotes).toBe("");
    expect(state().localSeq).toBe(seq);
    expect(state().setNotes("p0", "x".repeat(MAX_ST_NOTES))).toEqual({ ok: true });
    expect(game().players.p0!.stNotes).toHaveLength(MAX_ST_NOTES);
  });

  it("10G-AC-41: changed Night-step notes over the limit are refused, never truncated", () => {
    expect(state().setNightStepNotes(2, "manual:x", "y".repeat(MAX_NIGHT_STEP_NOTES + 1))).toMatchObject({ ok: false });
    expect(game().nightProgress["2:manual:x"]).toBeUndefined();
    expect(state().setNightStepNotes(2, "manual:x", "y".repeat(MAX_NIGHT_STEP_NOTES))).toEqual({ ok: true });
  });

  it("10G-AC-42: a saved game with oversized legacy notes stays loadable; the unchanged value is a true no-op", () => {
    const legacy = liveGame();
    legacy.players.p0 = { ...legacy.players.p0!, stNotes: "n".repeat(MAX_ST_NOTES + 500) };
    legacy.nightProgress = { "2:manual:old": { status: "pending", notes: "m".repeat(MAX_NIGHT_STEP_NOTES + 500) } };
    expect(StorytellerGamePersistedSchema.safeParse(legacy).success).toBe(true);
    // Through v24 -> v25 migration too.
    const migrated = migrateStoreState({ game: asV24(structuredClone(legacy)), undoStack: [] }, 24) as { game: StorytellerLobbyRecord };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(migrated.game.players.p0!.stNotes).toHaveLength(MAX_ST_NOTES + 500);
    expect(StorytellerStateSchema.safeParse({ game: legacy }).success).toBe(true);
    store.setState({ game: legacy, undoStack: [] });
    const seq = state().localSeq;
    expect(state().setNotes("p0", legacy.players.p0!.stNotes)).toEqual({ ok: true });
    expect(state().setNightStepNotes(2, "manual:old", legacy.nightProgress["2:manual:old"]!.notes)).toEqual({ ok: true });
    expect(state().localSeq).toBe(seq);
    expect(state().undoStack).toEqual([]);
  });
});

describe("10G-AC-46 / proof area 16: no new private bookkeeping in public/self projections", () => {
  it("Rule Facts, game History, Manual deliveries, ability use and Actual Alignment never project", () => {
    state().resolveGameRuleFacts({ intents: [{ kind: "apply", type: PIT_HAG_ARBITRARY_DEATHS }] });
    state().resolveAbility({ mode: "manual", reason: "Secret reason", outcome: { operations: [
      { domain: "life", intents: [{ kind: "useAbility", target: bind("p1") }] },
      { domain: "manualInformation", recipient: bind("p5"), text: "WHISPERED-SECRET" },
    ] } });
    store.setState({ game: { ...game(), players: { ...game().players, p5: { ...game().players.p5!, actualAlignment: "evil" } } } });
    for (const phase of ["night", "day", "ended"] as const) {
      const g = { ...game(), phase };
      const wire = JSON.stringify([projectLobbyToPublic(g, {}), projectLobbyToSelfMap(g, registry)]);
      for (const secret of ["gameRuleFacts", PIT_HAG_ARBITRARY_DEATHS, "WHISPERED-SECRET", "Secret reason", "abilityUsed", "actualAlignment", "history", "informationDeliveries", "participantId"]) {
        expect(wire, `${phase}: ${secret}`).not.toContain(secret);
      }
    }
  });
});
