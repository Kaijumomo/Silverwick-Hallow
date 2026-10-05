// Phase 10H, Slice 1: the functional support foundation (10H-IMPLEMENTATION-
// CONTRACT-v1.0 §§12-16) at the store / schema / projection layer.
// Traceability: 10H-AC-003, AC-031..034, AC-036, AC-037, AC-039..041,
// AC-043..047, AC-051.
import { beforeEach, describe, expect, it } from "vitest";
import { declaredResult, useStorytellerStore as store, migrateStoreState, takeMigrationResetFlag } from "./storytellerStore";
import { GAME_SCHEMA_VERSION, GameResultSchema, PlayerResultRecordSchema, StorytellerGamePersistedSchema, REVEAL_TOKEN_PATTERN } from "./schemas";
import { detectLegacyGameVersion, hasV26Evidence, migrateGameEntry } from "./gameMigration";
import { newRevealToken, revealViewed, visibleIdentityKey, withRevealTokens } from "./revealTokens";
import { ownLifeOf, projectLobbyToPublic, projectLobbyToSelfEnvelopeMap, projectLobbyToSelfMap, selfEnvelopeOf } from "./projections";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { asV25, withV26Stamp } from "@/test/v20Migration";
import { withoutRevealTokens } from "@/test/revealTokens";
import { buildRegistry } from "@/data/roleRegistry";
import type { StorytellerLobbyRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const player = (id: string) => game().players[id]!;
const registry = buildRegistry(setupScript);
const ROLES = ["monk", "slayer", "empath", "pithag", "imp", "chef", "drunk"];
type Raw = Record<string, unknown>;

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const p of Object.values(g.players)) {
    p.actualAlignment = registry.alignmentOf(p.actualRole);
    p.shownRole = p.actualRole === "drunk" ? "chef" : p.actualRole;
  }
  return g;
}
/** Opens the fixture as if every participation had been created through the
 * store's seam: withRevealTokens(null, g) is exactly what the seam applies to
 * a new participation (a fresh token each). A fixture set WITHOUT it models a
 * pre-v26 participation, which keeps no token until its identity changes. */
function open(g: StorytellerLobbyRecord) {
  store.setState({ game: withRevealTokens(null, g, registry), lobby: null, undoStack: [], localSeq: 3, sync: null, customScripts: { [setupScript.id]: setupScript }, view: "game", terminalClose: null });
}
const holder = (role: string) => game().seatOrder.find((id) => player(id).actualRole === role)!;
const tokensOf = (g: StorytellerLobbyRecord) => Object.fromEntries(Object.entries(g.players).map(([id, p]) => [id, p.revealToken]));

beforeEach(() => {
  localStorage.clear();
  open(liveGame());
});

// ---------------------------------------------------------------------------
describe("10H-AC-003 / AC-043: v26 schema", () => {
  it("the current version is 26 and the game carries no result until it ends", () => {
    expect(GAME_SCHEMA_VERSION).toBe(26);
    expect(game().gameSchemaVersion).toBe(26);
    expect(game()).not.toHaveProperty("result");
    expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
  });

  it("a Game Result is valid ONLY on an ended game, declared no later than its final day", () => {
    const result = { winner: "good" as const, declaredAt: { phase: "day" as const, day: 2 } };
    for (const phase of ["setup", "night", "day"] as const) {
      expect(StorytellerGamePersistedSchema.safeParse({ ...game(), phase, day: phase === "setup" ? 0 : 2, result }).success).toBe(false);
    }
    expect(StorytellerGamePersistedSchema.safeParse({ ...game(), phase: "ended", result }).success).toBe(true);
    // An earlier published declaration (lost-response recovery) stays valid...
    expect(StorytellerGamePersistedSchema.safeParse({ ...game(), phase: "ended", result: { ...result, declaredAt: { phase: "day", day: 1 } } }).success).toBe(true);
    // ...but never one after the game's final day.
    expect(StorytellerGamePersistedSchema.safeParse({ ...game(), phase: "ended", result: { ...result, declaredAt: { phase: "day", day: 3 } } }).success).toBe(false);
  });

  it("GameResult is exactly { winner, declaredAt: { phase: day|night, day >= 1 } } -- no reason taxonomy", () => {
    expect(GameResultSchema.safeParse({ winner: "evil", declaredAt: { phase: "night", day: 1 } }).success).toBe(true);
    for (const bad of [
      { winner: "draw", declaredAt: { phase: "day", day: 1 } },
      { winner: "good", declaredAt: { phase: "setup", day: 1 } },
      { winner: "good", declaredAt: { phase: "day", day: 0 } },
      { winner: "good", declaredAt: { phase: "day", day: 1.5 } },
      { winner: "good", declaredAt: { phase: "day", day: 1 }, reason: "demon executed" },
      { winner: "good", declaredAt: { phase: "day", day: 1, why: "x" } },
    ]) expect(GameResultSchema.safeParse(bad).success).toBe(false);
  });

  it("an empty seat never carries a reveal token (rejected, never repaired)", () => {
    const g = liveGame();
    const empty = g.seatOrder[0]!;
    g.players[empty] = { ...g.players[empty]!, isEmpty: true, name: "", actualRole: "", shownRole: null, revealToken: newRevealToken() };
    delete g.players[empty]!.participantId;
    const issues = StorytellerGamePersistedSchema.safeParse(g);
    expect(issues.success).toBe(false);
  });

  it("the player result payload is an exact allowlist", () => {
    const ok = { version: 1, sessionId: "s", winner: "good", declaredAt: { phase: "day", day: 3 } };
    expect(PlayerResultRecordSchema.safeParse(ok).success).toBe(true);
    for (const extra of [{ actualRole: "imp" }, { participantId: "pt" }, { youWon: true }, { notes: "x" }]) {
      expect(PlayerResultRecordSchema.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("10H-AC-034 / AC-044: v25 -> v26 migration invents nothing", () => {
  it("marker 25 receives exactly the stamp: no reveal token, no result, no winner -- Current State, every Undo entry and checkpoint recovery agree", () => {
    state().finishGame({ kind: "declare", winner: "good" });
    const ended = asV25(game()) as unknown as Raw;
    const live = asV25(liveGame()) as unknown as Raw;
    for (const v25 of [ended, live]) {
      expect(hasV26Evidence(v25)).toBe(false);
      expect(detectLegacyGameVersion(v25)).toBe(25);
      const copy = structuredClone(v25);
      migrateGameEntry(copy, 25, { kind: "canonical-only" });
      expect(copy).toEqual(withV26Stamp(v25));
      expect(copy).not.toHaveProperty("result");
      for (const p of Object.values(copy.players as Record<string, Raw>)) expect(p).not.toHaveProperty("revealToken");
      expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(true);
      const again = structuredClone(copy);
      migrateGameEntry(again, 25, { kind: "canonical-only" });
      expect(again).toEqual(copy);
    }
    const result = migrateStoreState({ game: structuredClone(ended), undoStack: [structuredClone(live), structuredClone(live)] }, 25) as { game: Raw; undoStack: Raw[] };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game).toEqual(withV26Stamp(ended));
    expect((result.game as unknown as StorytellerLobbyRecord).phase).toBe("ended");
    expect(result.game).not.toHaveProperty("result"); // a legacy ended game: No recorded result
    for (const entry of result.undoStack) expect(entry).toEqual(withV26Stamp(live));
  });

  it("v26-only evidence under marker 25 (or marker-less) is malformed current data: never stamped, rejected", () => {
    const withToken = asV25(liveGame()) as unknown as Raw & { players: Record<string, Raw> };
    Object.values(withToken.players)[0]!.revealToken = newRevealToken();
    const withResult = { ...(asV25(liveGame()) as unknown as Raw), phase: "ended", result: { winner: "good", declaredAt: { phase: "night", day: 2 } } };
    for (const bad of [withToken, withResult]) {
      expect(hasV26Evidence(bad)).toBe(true);
      const copy = structuredClone(bad);
      migrateGameEntry(copy, 25, { kind: "canonical-only" });
      expect(copy).toEqual(bad); // untouched, unstamped
      expect(StorytellerGamePersistedSchema.safeParse(copy).success).toBe(false);
      const markerless = structuredClone(bad) as Raw;
      delete markerless.gameSchemaVersion;
      expect(detectLegacyGameVersion(markerless)).toBe(26);
    }
  });
});

// ---------------------------------------------------------------------------
describe("10H-AC-031..033: reveal-token lifecycle at the one commit seam", () => {
  it("AC-034: a participation that predates v26 keeps NO token until its visible identity changes", () => {
    store.setState({ game: liveGame() }); // as migrated from v25: no tokens
    const id = holder("empath");
    state().recordDeath(holder("monk")); // an unrelated commit invents none
    expect(player(id)).not.toHaveProperty("revealToken");
    state().setShownRole(id, "chef");
    expect(player(id).revealToken).toMatch(REVEAL_TOKEN_PATTERN);
  });

  it("every occupied participation has an opaque, random token never derived from its ParticipantId; empty seats have none", () => {
    for (const id of game().seatOrder) {
      const p = player(id);
      expect(p.revealToken).toMatch(REVEAL_TOKEN_PATTERN);
      expect(p.revealToken).not.toContain(p.participantId!);
      expect(p.revealToken).not.toContain(p.id);
    }
    expect(new Set(game().seatOrder.map((id) => player(id).revealToken)).size).toBe(game().seatOrder.length);
  });

  it("AC-031: a visible-identity change (Shown Role, or player-facing Shown Alignment) rotates the token", () => {
    const id = holder("empath");
    const t0 = player(id).revealToken;
    expect(state().setShownRole(id, "chef")).toMatchObject({ ok: true });
    const t1 = player(id).revealToken;
    expect(t1).toMatch(REVEAL_TOKEN_PATTERN);
    expect(t1).not.toBe(t0);
    expect(state().setShownAlignment(id, "evil")).toMatchObject({ ok: true });
    const t2 = player(id).revealToken;
    expect(t2).not.toBe(t1);
    // Not Told: the alignment disappears from the player view -- also visible.
    expect(state().setShownAlignment(id, "undisclosed")).toMatchObject({ ok: true });
    expect(player(id).revealToken).not.toBe(t2);
  });

  it("AC-033: A -> B -> A mints a NEW token on every transition (an old A acknowledgement never becomes valid again)", () => {
    const id = holder("empath");
    const tA = player(id).revealToken!;
    state().setShownRole(id, "chef");
    const tB = player(id).revealToken!;
    state().setShownRole(id, "empath");
    const tA2 = player(id).revealToken!;
    expect(new Set([tA, tB, tA2]).size).toBe(3);
    expect(revealViewed(player(id), tA)).toBe(false);
    expect(revealViewed(player(id), tA2)).toBe(true);
  });

  it("AC-033: Undo of a visible change is itself a transition -- a fresh token, never the older one", () => {
    const id = holder("empath");
    const tA = player(id).revealToken!;
    state().setShownRole(id, "chef");
    const tB = player(id).revealToken!;
    state().undo();
    expect(player(id).shownRole).toBe("empath");
    expect([tA, tB]).not.toContain(player(id).revealToken);
  });

  it("AC-032: hidden Actual / mechanical changes never rotate the token (Actual Role, Actual Alignment, Life, notes)", () => {
    const id = holder("empath");
    const before = tokensOf(game());
    expect(state().setActualAlignment(id, "evil")).toMatchObject({ ok: true });
    expect(state().recordDeath(id)).toMatchObject({ ok: true });
    state().setNotes(id, "hidden bookkeeping");
    expect(tokensOf(game())).toEqual(before);
    // A hidden Actual Role change while the player stays shown the same role.
    const drunk = holder("drunk");
    const tDrunk = player(drunk).revealToken;
    expect(player(drunk).shownRole).toBe("chef");
    state().setShownAlignment(drunk, null); // unchanged derived alignment: no-op or same identity
    expect(player(drunk).revealToken).toBe(tDrunk);
  });

  it("AC-038: unseat -> reseat (seat reuse) is a NEW participation with a NEW token; the empty seat holds none", () => {
    const id = holder("chef");
    const old = player(id).revealToken!;
    expect(state().unseatPlayer(id)).toBe(true);
    expect(player(id).isEmpty).toBe(true);
    expect(player(id)).not.toHaveProperty("revealToken");
    state().addToPendingQueue("uid-zed", "Zed");
    expect(state().assignPendingToSeat("uid-zed", id)).toBe(true);
    expect(player(id).revealToken).toMatch(REVEAL_TOKEN_PATTERN);
    expect(player(id).revealToken).not.toBe(old);
    expect(revealViewed(player(id), old)).toBe(false);
  });

  it("an adopted remote checkpoint keeps the tokens it carries (it is what players were shown)", () => {
    const remote = structuredClone(game());
    const id = holder("empath");
    remote.players[id]!.revealToken = "R".repeat(22);
    state().restoreRemoteCheckpoint(remote, { token: "w", revision: 9 });
    expect(player(id).revealToken).toBe("R".repeat(22));
  });

  it("withRevealTokens: visibleIdentityKey follows projectIdentity; an unsafe Shown Role projects nothing", () => {
    const id = holder("empath");
    expect(visibleIdentityKey(player(id), registry)).toBe(JSON.stringify(["empath", "good"]));
    const unsafe = { ...player(id), shownRole: "no-such-role" };
    expect(visibleIdentityKey(unsafe, registry)).toBeNull();
    const g = game();
    expect(withRevealTokens(g, g, registry)).toBe(g); // nothing to do keeps the reference
  });
});

// ---------------------------------------------------------------------------
describe("10H-AC-036 / AC-037: Viewed is current-token equality only; acknowledgement is never game state", () => {
  it("revealViewed: only the exact current token; a missing token, stale/wrong ack or an empty seat is not viewed", () => {
    const id = holder("monk");
    const p = player(id);
    expect(revealViewed(p, p.revealToken)).toBe(true);
    expect(revealViewed(p, undefined)).toBe(false);
    expect(revealViewed(p, "x".repeat(22))).toBe(false);
    const legacy = { ...p };
    delete legacy.revealToken; // a pre-v26 participation
    expect(revealViewed(legacy, p.revealToken)).toBe(false);
    expect(revealViewed({ ...p, isEmpty: true }, p.revealToken)).toBe(false);
    expect(revealViewed(undefined, p.revealToken)).toBe(false);
  });

  it("no acknowledgement field exists in the game, History, Undo, delivery or checkpoint shapes", () => {
    const json = JSON.stringify([game(), state().undoStack]);
    expect(json).not.toMatch(/revealAck|acknowledg|viewed/i);
  });
});

// ---------------------------------------------------------------------------
describe("10H-AC-039..041: own Life in the private self envelope; public Night Life unchanged", () => {
  it("AC-039: at Night the player's own self envelope carries their own current Life", () => {
    const id = holder("empath");
    state().recordDeath(id);
    const self = projectLobbyToSelfEnvelopeMap(game(), registry)[id]!;
    expect(game().phase).toBe("night");
    expect(self.life).toEqual({ alive: false, ghostVote: true });
    expect(self.revealToken).toBe(player(id).revealToken);
    expect(self.shownRole).toBe("empath");
    expect(selfEnvelopeOf(player(id), projectLobbyToSelfMap(game(), registry)[id]!)).toEqual(self);
  });

  it("AC-040: the public Night projection still withholds every Life field for every player (unchanged)", () => {
    state().recordDeath(holder("empath"));
    const pub = projectLobbyToPublic(game(), {});
    for (const p of Object.values(pub.players)) {
      expect(p).not.toHaveProperty("alive");
      expect(p).not.toHaveProperty("ghostVote");
      expect(p).not.toHaveProperty("exiled");
    }
  });

  it("AC-041: a self envelope holds no Life Event, no other player's Life, no ParticipantId", () => {
    const id = holder("empath");
    state().recordDeath(holder("monk"));
    const self = projectLobbyToSelfEnvelopeMap(game(), registry)[id]!;
    expect(Object.keys(self).sort()).toEqual(["life", "revealToken", "shownAlignment", "shownRole"]);
    expect(self.life).toEqual({ alive: true, ghostVote: true });
    const text = JSON.stringify(self);
    expect(text).not.toContain(player(id).participantId!);
    expect(text).not.toMatch(/event|death|execution|resurrection/i);
  });

  it("the Setup all-or-none barrier withholds the envelope with the identity", () => {
    open(liveGame({ phase: "setup", day: 0, setupRolesRevealed: false }));
    expect(projectLobbyToSelfEnvelopeMap(game(), registry)).toEqual({});
  });

  it("ownLifeOf uses the one Life normalization (exiled death)", () => {
    expect(ownLifeOf({ ...player(holder("monk")), alive: false, ghostVote: false, isTraveler: true, exiled: true })).toEqual({ alive: false, ghostVote: false, exiled: true });
  });
});

// ---------------------------------------------------------------------------
describe("10H-AC-045..047: one terminal seam, explicit intents, Undo-free, nothing inferred", () => {
  it("Declare Good / Declare Evil store the declared result at the live Game Moment; End Without Result stores none", () => {
    for (const [intent, expected] of [
      [{ kind: "declare", winner: "good" }, { winner: "good", declaredAt: { phase: "night", day: 2 } }],
      [{ kind: "declare", winner: "evil" }, { winner: "evil", declaredAt: { phase: "night", day: 2 } }],
      [{ kind: "noResult" }, undefined],
    ] as const) {
      open(liveGame());
      const before = withoutRevealTokens(game());
      expect(state().finishGame(intent)).toEqual({ ok: true });
      expect(game().phase).toBe("ended");
      expect(game().result).toEqual(expected);
      if (!expected) expect(game()).not.toHaveProperty("result");
      expect(withoutRevealTokens({ ...game(), result: undefined })).toEqual({ ...before, phase: "ended", result: undefined });
      expect(StorytellerGamePersistedSchema.safeParse(game()).success).toBe(true);
    }
  });

  it("a Day declaration records Day", () => {
    open(liveGame({ phase: "day", day: 4 }));
    state().finishGame({ kind: "declare", winner: "evil" });
    expect(game().result).toEqual({ winner: "evil", declaredAt: { phase: "day", day: 4 } });
  });

  it("AC-046: the terminal result is Undo-free -- Undo can never restore live play or drop the result", () => {
    state().recordDeath(holder("monk"));
    expect(state().undoStack.length).toBeGreaterThan(0);
    state().finishGame({ kind: "declare", winner: "good" });
    expect(state().undoStack).toEqual([]);
    state().undo();
    expect(game().phase).toBe("ended");
    expect(game().result?.winner).toBe("good");
  });

  it("malformed intents are refused and change nothing", () => {
    const before = game();
    for (const bad of [{ kind: "declare", winner: "draw" }, { kind: "auto" }, null, undefined, { kind: "declare" }]) {
      expect(state().finishGame(bad as never)).toMatchObject({ ok: false });
      expect(game()).toBe(before);
    }
    expect(declaredResult({ kind: "declare", winner: "good" }, { phase: "setup", day: 0 })).toBe("invalid");
  });

  it("a result published by the remote close wins over the intent (recovery keeps local = published)", () => {
    state().finishGame({ kind: "noResult" }, { winner: "evil", declaredAt: { phase: "night", day: 2 } });
    expect(game().result).toEqual({ winner: "evil", declaredAt: { phase: "night", day: 2 } });
  });

  it("AC-047: nothing in the store evaluates a win condition or ends a game automatically", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = ["storytellerStore.ts", "revealTokens.ts", "projections.ts"].map((f) => readFileSync(resolve(__dirname, f), "utf8")).join("\n");
    expect(src).not.toMatch(/winCandidate|evaluateWin|checkWin|autoEnd|winCondition\(/i);
    // Killing the Demon does not end the game.
    state().recordDeath(holder("imp"));
    expect(game().phase).toBe("night");
    expect(game()).not.toHaveProperty("result");
  });
});

// ---------------------------------------------------------------------------
describe("10H-AC-051: the terminal-close mutation lock", () => {
  it("while closing, game and Undo changes are dropped at the commit seam; failure restores mutation; the terminal commit passes", () => {
    const id = holder("monk");
    expect(state().beginTerminalClose({ kind: "declare", winner: "good" })).toBe(true);
    expect(state().beginTerminalClose({ kind: "noResult" })).toBe(false); // one close at a time
    const frozen = game();
    const seq = state().localSeq;
    state().recordDeath(id);
    state().setNotes(id, "changed during close");
    state().undo();
    expect(game()).toBe(frozen);
    expect(state().localSeq).toBe(seq);
    state().failTerminalClose("network");
    expect(state().terminalClose).toMatchObject({ status: "failed", message: "network", intent: { kind: "declare", winner: "good" } });
    expect(state().recordDeath(id)).toMatchObject({ ok: true });
    expect(player(id).alive).toBe(false);
    // Retry: lock again, then the terminal commit itself passes and clears the lock.
    expect(state().beginTerminalClose({ kind: "declare", winner: "good" })).toBe(true);
    expect(state().finishGame({ kind: "declare", winner: "good" })).toEqual({ ok: true });
    expect(state().terminalClose).toBeNull();
    expect(game().result?.winner).toBe("good");
    expect(player(id).alive).toBe(false);
  });

  it("refused without a live game; never persisted", () => {
    open(liveGame({ phase: "setup", day: 0 }));
    expect(state().beginTerminalClose({ kind: "noResult" })).toBe(false);
    open(liveGame());
    state().beginTerminalClose({ kind: "noResult" });
    expect(localStorage.getItem("new-blood-st") ?? "").not.toContain("terminalClose");
  });
});
