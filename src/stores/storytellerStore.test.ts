import { beforeEach, describe, expect, it } from "vitest";
import {
  useStorytellerStore,
  selectScriptById,
  migrateStoreState,
  takeMigrationResetFlag,
} from "./storytellerStore";
import type { Script } from "./types";

const minimalScript = (id: string, name = "Test Script"): Script => ({
  id,
  name,
  characters: [
    {
      id: "x",
      name: "X",
      type: "townsfolk",
      ability: "Does X.",
    },
  ],
});

beforeEach(() => {
  useStorytellerStore.setState({
    game: null,
    view: "home",
    undoStack: [],
    selectedPlayerId: null,
    customScripts: {},
  });
  // Clear persisted state from a prior run (jsdom localStorage).
  localStorage.clear();
});

describe("addCustomScript", () => {
  it("accepts a unique custom script", () => {
    const result = useStorytellerStore
      .getState()
      .addCustomScript(minimalScript("hb-1", "Homebrew One"));
    expect(result.ok).toBe(true);
    expect(useStorytellerStore.getState().customScripts["hb-1"]).toBeDefined();
  });

  it("rejects a script id that collides with a built-in", () => {
    const r1 = useStorytellerStore.getState().addCustomScript(minimalScript("tb"));
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error).toMatch(/built-in/i);

    const r2 = useStorytellerStore.getState().addCustomScript(minimalScript("snv"));
    expect(r2.ok).toBe(false);
  });

  it("rejects a duplicate custom-script id", () => {
    const a = useStorytellerStore.getState().addCustomScript(minimalScript("dup"));
    expect(a.ok).toBe(true);
    const b = useStorytellerStore.getState().addCustomScript(minimalScript("dup"));
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toMatch(/already imported/i);
  });
});

describe("removeCustomScript", () => {
  it("removes the script from state", () => {
    useStorytellerStore.getState().addCustomScript(minimalScript("hb-2"));
    useStorytellerStore.getState().removeCustomScript("hb-2");
    expect(useStorytellerStore.getState().customScripts["hb-2"]).toBeUndefined();
  });

  it("ends the active game if it uses the removed script", () => {
    useStorytellerStore.getState().addCustomScript(minimalScript("hb-3"));
    useStorytellerStore.getState().newGame("hb-3");
    expect(useStorytellerStore.getState().game).not.toBeNull();
    useStorytellerStore.getState().removeCustomScript("hb-3");
    expect(useStorytellerStore.getState().game).toBeNull();
    expect(useStorytellerStore.getState().view).toBe("home");
  });

  it("leaves an unrelated active game alone", () => {
    useStorytellerStore.getState().addCustomScript(minimalScript("hb-4"));
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().removeCustomScript("hb-4");
    expect(useStorytellerStore.getState().game).not.toBeNull();
  });
});

describe("newGame supports both built-in and custom scripts", () => {
  it("creates a game from a built-in script id", () => {
    useStorytellerStore.getState().newGame("snv");
    const g = useStorytellerStore.getState().game;
    expect(g).not.toBeNull();
    expect(g?.scriptId).toBe("snv");
    expect(useStorytellerStore.getState().view).toBe("game");
  });

  it("creates a game from a custom script id", () => {
    useStorytellerStore.getState().addCustomScript(minimalScript("hb-5"));
    useStorytellerStore.getState().newGame("hb-5");
    expect(useStorytellerStore.getState().game?.scriptId).toBe("hb-5");
  });

  it("throws on an unknown script id", () => {
    expect(() => useStorytellerStore.getState().newGame("ghost")).toThrow(
      /Unknown script id/
    );
  });
});

describe("selectScriptById", () => {
  it("resolves built-in script ids", () => {
    const s = selectScriptById(useStorytellerStore.getState(), "tb");
    expect(s?.id).toBe("tb");
  });

  it("resolves custom script ids", () => {
    useStorytellerStore.getState().addCustomScript(minimalScript("hb-6"));
    const s = selectScriptById(useStorytellerStore.getState(), "hb-6");
    expect(s?.id).toBe("hb-6");
  });

  it("returns undefined for unknown ids", () => {
    expect(selectScriptById(useStorytellerStore.getState(), "ghost")).toBeUndefined();
  });
});

describe("Lunatic / deception state", () => {
  function setupTBGame(): { p1: string; p2: string; p3: string } {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().addPlayer("Bob");
    useStorytellerStore.getState().addPlayer("Cara");
    const order = useStorytellerStore.getState().game!.seatOrder;
    return { p1: order[0]!, p2: order[1]!, p3: order[2]! };
  }

  it("setBluffs writes bluffs into privateInfo", () => {
    const { p1 } = setupTBGame();
    useStorytellerStore.getState().setBluffs(p1, ["chef", "saint", "virgin"]);
    const player = useStorytellerStore.getState().game!.players[p1]!;
    expect(player.privateInfo?.bluffs).toEqual(["chef", "saint", "virgin"]);
  });

  it("setBluffs([]) drops the bluffs key (and privateInfo if empty)", () => {
    const { p1 } = setupTBGame();
    useStorytellerStore.getState().setBluffs(p1, ["chef"]);
    useStorytellerStore.getState().setBluffs(p1, []);
    const player = useStorytellerStore.getState().game!.players[p1]!;
    expect(player.privateInfo).toBeUndefined();
  });

  it("setFakeMinions writes valid players, skips self/unknown", () => {
    const { p1, p2, p3 } = setupTBGame();
    useStorytellerStore.getState().setFakeMinions(p1, [p2, p3, p1, "ghost"]);
    const player = useStorytellerStore.getState().game!.players[p1]!;
    expect(player.privateInfo?.fakeMinions).toEqual([p2, p3]);
  });

  it("assignRole clears bluffs and fakeMinions (deception state cleanup)", () => {
    const { p1, p2 } = setupTBGame();
    useStorytellerStore.getState().assignRole(p1, "imp");
    useStorytellerStore.getState().setBluffs(p1, ["chef", "saint", "virgin"]);
    useStorytellerStore.getState().setFakeMinions(p1, [p2]);
    expect(
      useStorytellerStore.getState().game!.players[p1]!.privateInfo
    ).toBeDefined();
    useStorytellerStore.getState().assignRole(p1, "saint");
    const after = useStorytellerStore.getState().game!.players[p1]!;
    expect(after.privateInfo).toBeUndefined();
    expect(after.behaviorMode).toBe("normal");
    expect(after.shownRole).toBeNull();
  });

  it("removePlayer scrubs dangling fakeMinion references on remaining seats", () => {
    const { p1, p2, p3 } = setupTBGame();
    useStorytellerStore.getState().setFakeMinions(p1, [p2, p3]);
    useStorytellerStore.getState().removePlayer(p2);
    const lunatic = useStorytellerStore.getState().game!.players[p1]!;
    expect(lunatic.privateInfo?.fakeMinions).toEqual([p3]);
  });

  it("setBluffs preserves an existing fakeMinions entry", () => {
    const { p1, p2 } = setupTBGame();
    useStorytellerStore.getState().setFakeMinions(p1, [p2]);
    useStorytellerStore.getState().setBluffs(p1, ["chef"]);
    const player = useStorytellerStore.getState().game!.players[p1]!;
    expect(player.privateInfo?.fakeMinions).toEqual([p2]);
    expect(player.privateInfo?.bluffs).toEqual(["chef"]);
  });
});

describe("setIsTraveler", () => {
  // Phase 9 Setup finalization B4 revision: ordinary -> Traveler is refused
  // if it would drop occupied ordinary players below 5 -- seed enough
  // ordinary players (6) that converting exactly one stays at the floor
  // (5), not below it.
  function setupGame(): { p1: string } {
    useStorytellerStore.getState().newGame("tb");
    for (let i = 0; i < 6; i++) useStorytellerStore.getState().addPlayer("Player " + i);
    const order = useStorytellerStore.getState().game!.seatOrder;
    return { p1: order[0]! };
  }

  it("setIsTraveler(true) sets isTraveler and clears actualRole + privateInfo", () => {
    const { p1 } = setupGame();
    useStorytellerStore.getState().assignRole(p1, "imp");
    useStorytellerStore.getState().setBluffs(p1, ["chef", "saint"]);
    useStorytellerStore.getState().setIsTraveler(p1, true);
    const player = useStorytellerStore.getState().game!.players[p1]!;
    expect(player.isTraveler).toBe(true);
    expect(player.actualRole).toBe("");
    expect(player.privateInfo).toBeUndefined();
  });

  it("setIsTraveler(false) also clears actualRole", () => {
    const { p1 } = setupGame();
    useStorytellerStore.getState().setIsTraveler(p1, true);
    useStorytellerStore.getState().assignRole(p1, "bureaucrat");
    useStorytellerStore.getState().setIsTraveler(p1, false);
    const player = useStorytellerStore.getState().game!.players[p1]!;
    expect(player.isTraveler).toBe(false);
    expect(player.actualRole).toBe("");
  });

  it("setIsTraveler is undoable", () => {
    const { p1 } = setupGame();
    useStorytellerStore.getState().assignRole(p1, "imp");
    useStorytellerStore.getState().setIsTraveler(p1, true);
    expect(useStorytellerStore.getState().game!.players[p1]!.isTraveler).toBe(true);
    useStorytellerStore.getState().undo();
    expect(useStorytellerStore.getState().game!.players[p1]!.isTraveler).toBe(false);
    expect(useStorytellerStore.getState().game!.players[p1]!.actualRole).toBe("imp");
  });

  // Phase 9 Setup finalization B4: explicit ordinary<->Traveler conversion
  // bounds-checking. ordinary -> Traveler is always permitted; Traveler ->
  // ordinary is refused only if it would raise occupied ordinary players
  // above the 15-player composition cap.
  describe("Phase 9 Setup finalization B4 bounds-checking", () => {
    it("returns a SetupCommandResult ({ ok: true }) on a normal conversion", () => {
      const { p1 } = setupGame();
      expect(useStorytellerStore.getState().setIsTraveler(p1, true)).toEqual({ ok: true });
    });

    it("is a no-op returning { ok: true } when the player already has the requested status", () => {
      const { p1 } = setupGame();
      expect(useStorytellerStore.getState().setIsTraveler(p1, false)).toEqual({ ok: true });
      expect(useStorytellerStore.getState().game!.players[p1]!.isTraveler).toBe(false);
    });

    it("refuses a nonexistent player", () => {
      const { p1 } = setupGame();
      const result = useStorytellerStore.getState().setIsTraveler(p1 + "-missing", true);
      expect(result.ok).toBe(false);
    });

    it("ordinary -> Traveler is always allowed, even once occupied ordinary players are already at the 15-player cap", () => {
      useStorytellerStore.getState().newGame("tb");
      for (let i = 0; i < 15; i++) useStorytellerStore.getState().addPlayer("Player " + i);
      const ids = useStorytellerStore.getState().game!.seatOrder;
      expect(ids).toHaveLength(15);
      const result = useStorytellerStore.getState().setIsTraveler(ids[0]!, true);
      expect(result).toEqual({ ok: true });
      expect(useStorytellerStore.getState().game!.players[ids[0]!]!.isTraveler).toBe(true);
    });

    it("Traveler -> ordinary is refused if it would raise occupied ordinary players above 15", () => {
      useStorytellerStore.getState().newGame("tb");
      // The 16th arrival defaults Traveler on its own (the ordinary cap is
      // already reached by the first 15) -- see arrivalsAreTravelers.
      for (let i = 0; i < 16; i++) useStorytellerStore.getState().addPlayer("Player " + i);
      const sixteenth = useStorytellerStore.getState().game!.seatOrder[15]!;
      expect(useStorytellerStore.getState().game!.players[sixteenth]!.isTraveler).toBe(true);
      const before = useStorytellerStore.getState().game;
      const result = useStorytellerStore.getState().setIsTraveler(sixteenth, false);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/maximum/i);
      // Refused: no mutation at all, not even an undo-stack push.
      expect(useStorytellerStore.getState().game).toBe(before);
      expect(useStorytellerStore.getState().game!.players[sixteenth]!.isTraveler).toBe(true);
    });

    it("Traveler -> ordinary is allowed when the resulting ordinary count stays at or below 15", () => {
      const { p1 } = setupGame();
      useStorytellerStore.getState().setIsTraveler(p1, true);
      const result = useStorytellerStore.getState().setIsTraveler(p1, false);
      expect(result).toEqual({ ok: true });
      expect(useStorytellerStore.getState().game!.players[p1]!.isTraveler).toBe(false);
    });
  });
});

describe("planned seat workflow", () => {
  it("fills a planned empty seat before adding a new seat", () => {
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 2 });
    const planned = useStorytellerStore.getState().game!;
    const firstSeat = planned.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice");
    const after = useStorytellerStore.getState().game!;
    expect(after.seatOrder).toHaveLength(2);
    expect(after.players[firstSeat]!.name).toBe("Alice");
    expect(after.players[firstSeat]!.isEmpty).toBe(false);
  });

  it("supports deliberately adding and removing an empty planned seat", () => {
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    useStorytellerStore.getState().addEmptySeat();
    const game = useStorytellerStore.getState().game!;
    expect(game.seatOrder).toHaveLength(2);
    expect(Object.values(game.players).filter((p) => p.isEmpty)).toHaveLength(2);
    expect(useStorytellerStore.getState().removePlayer(game.seatOrder[1]!)).toBe(true);
    expect(useStorytellerStore.getState().game!.seatOrder).toHaveLength(1);
    expect(useStorytellerStore.getState().game!.plannedPlayerCount).toBe(1);
  });
});

describe("setFabled", () => {
  it("setFabled writes fabled array to game", () => {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().setFabled(["djinn", "doomsayer"]);
    expect(useStorytellerStore.getState().game!.fabled).toEqual(["djinn", "doomsayer"]);
  });

  it("setFabled is undoable", () => {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().setFabled(["djinn"]);
    useStorytellerStore.getState().setFabled(["djinn", "doomsayer"]);
    useStorytellerStore.getState().undo();
    expect(useStorytellerStore.getState().game!.fabled).toEqual(["djinn"]);
  });

  it("setFabled([]) clears the fabled list", () => {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().setFabled(["djinn"]);
    useStorytellerStore.getState().setFabled([]);
    expect(useStorytellerStore.getState().game!.fabled).toEqual([]);
  });

  it("game.fabled persists after advancing phase from setup to night", () => {
    // A supported 5-ordinary population -- FINAL POPULATION CLOSURE, Section
    // 10 now hard-blocks Reveal/Begin for an unsupported (e.g. 1-player)
    // population, so this fabled-persistence test needs a real one.
    useStorytellerStore.getState().newGame("tb", { plannedRoles: ["chef", "empath", "fortuneteller", "poisoner", "imp"] });
    useStorytellerStore.getState().setFabled(["djinn", "doomsayer"]);
    for (const name of ["Alice", "Bob", "Carol", "Dave", "Eve"]) useStorytellerStore.getState().addPlayer(name);
    useStorytellerStore.getState().setPlannedPlayerCount(5);
    // Initial ordinary distribution is always the randomized deal.
    expect(useStorytellerStore.getState().dealRolePool().ok).toBe(true);
    for (const id of useStorytellerStore.getState().game!.seatOrder) useStorytellerStore.getState().showAssignedRole(id);
    expect(useStorytellerStore.getState().revealRoles().ok).toBe(true);
    expect(useStorytellerStore.getState().advancePhase().ok).toBe(true);
    const game = useStorytellerStore.getState().game!;
    expect(game.phase).toBe("night");
    expect(game.fabled).toEqual(["djinn", "doomsayer"]);
  });
});

// ---------------------------------------------------------------------------
// E1: migrateStoreState — schema roundtrip tests
// ---------------------------------------------------------------------------

// Phase 9R.5: a persisted game's players and seatOrder must describe one
// coherent seat geometry (schemas.ts checkSeatGeometry), so a fixture that
// supplies players without an explicit seatOrder seats them in key order --
// the order every supported writer appends them in.
const minimalPersistedGame = (
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => ({
  code: "",
  storytellerUid: "",
  scriptId: "tb",
  phase: "setup",
  day: 0,
  notes: "",
  players: {},
  seatOrder: Object.keys((overrides.players as Record<string, unknown> | undefined) ?? {}),
  nightProgress: {},
  fabled: [],
  bluffs: [],
  ...overrides,
});

describe("migrateStoreState", () => {
  beforeEach(() => {
    // Drain the flag so each test starts with it cleared.
    takeMigrationResetFlag();
  });

  it("v1→current: adds nightProgress, fabled, and bluffs to game and undoStack", () => {
    const bareGame = {
      code: "",
      storytellerUid: "",
      scriptId: "tb",
      phase: "setup",
      day: 0,
      notes: "",
      players: {},
      seatOrder: [],
      // deliberately omit nightProgress, fabled, bluffs (v1 shape)
    };
    const state = { game: { ...bareGame }, undoStack: [{ ...bareGame }] };
    const result = migrateStoreState(state, 1) as {
      game: Record<string, unknown>;
      undoStack: Record<string, unknown>[];
    };
    expect(result.game.nightProgress).toEqual({});
    expect(result.game.fabled).toEqual([]);
    expect(result.game.bluffs).toEqual([]);
    expect(result.undoStack[0]!.nightProgress).toEqual({});
    expect(result.undoStack[0]!.fabled).toEqual([]);
    expect(result.undoStack[0]!.bluffs).toEqual([]);
  });

  it("v2→current: adds fabled and bluffs without touching existing nightProgress", () => {
    const existingProgress = { "p:abc": { status: "done", notes: "done" } };
    const state = {
      game: {
        ...minimalPersistedGame({ nightProgress: existingProgress }),
        fabled: undefined,
        bluffs: undefined,
      },
      undoStack: [],
    };
    const result = migrateStoreState(state, 2) as {
      game: Record<string, unknown>;
    };
    expect(result.game.fabled).toEqual([]);
    expect(result.game.bluffs).toEqual([]);
    expect(result.game.nightProgress).toEqual(existingProgress);
  });

  it("v3 (current): valid state passes through — same object reference returned", () => {
    const state = { game: minimalPersistedGame(), undoStack: [] };
    const result = migrateStoreState(state, 3);
    expect(result).toBe(state);
    expect(takeMigrationResetFlag()).toBe(false);
  });

  it("null game passes through without error", () => {
    const state = { game: null, undoStack: [] };
    const result = migrateStoreState(state, 3);
    expect(result).toBe(state);
    expect(takeMigrationResetFlag()).toBe(false);
  });

  it("corrupt state returns clean defaults and sets the reset flag", () => {
    // scriptId must be a string — passing a number should fail validation.
    const corrupt = { game: { scriptId: 42, phase: "setup", day: 0 } };
    migrateStoreState(corrupt, 3);
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("takeMigrationResetFlag is auto-cleared after first read", () => {
    const corrupt = { game: { scriptId: 42 } };
    migrateStoreState(corrupt, 3);
    expect(takeMigrationResetFlag()).toBe(true);
    // Second read must return false — flag was consumed.
    expect(takeMigrationResetFlag()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Phase 9C.2A (OPUS-001): v11 -> v12 reconnect watermark migration
  // -------------------------------------------------------------------------
  it("v11->v12: a legacy store with no localSeq/sync fields migrates safely, initializing localSeq at 0 and sync at null", () => {
    const state = { game: minimalPersistedGame(), undoStack: [] };
    const result = migrateStoreState(state, 11) as { localSeq: number; sync: unknown };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.localSeq).toBe(0);
    expect(result.sync).toBeNull();
  });

  it("v11->v12: does not invent acknowledgement evidence from an existing legacy game's content", () => {
    // A legacy game with substantial content (multiple players, mid-game
    // phase) must still migrate to sync:null — its size/phase/day is never
    // treated as proof of prior acknowledgement.
    const state = {
      game: minimalPersistedGame({
        phase: "night", day: 3,
        players: { a: { id: "a", name: "Alice", seat: 0, joinedAt: 1, actualRole: "chef", shownRole: null, shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null, alive: true, ghostVote: true, abilityUsed: false, statuses: {}, reminders: [], effects: [], stNotes: "", isTraveler: false } },
        seatOrder: ["a"],
      }),
      undoStack: [],
    };
    const result = migrateStoreState(state, 11) as { sync: unknown; game: Record<string, unknown> };
    expect(result.sync).toBeNull();
    expect(result.game.day).toBe(3); // content itself is preserved...
    // ...but that content carries no acknowledgement weight (see
    // reconnectDecision's "no sync metadata" rule: a valid remote checkpoint
    // always outranks unevidenced legacy local state).
  });

  it("v11->v12 does not crash on a legacy store already at a later-but-still-pre-12 hypothetical version and passes schema validation", () => {
    const state = { game: minimalPersistedGame(), undoStack: [], lobby: null };
    expect(() => migrateStoreState(state, 11)).not.toThrow();
    expect(takeMigrationResetFlag()).toBe(false);
  });

  it("a current (v12) state with populated sync/localSeq passes through unchanged (same reference, same values)", () => {
    const state = {
      game: minimalPersistedGame(), undoStack: [], localSeq: 7,
      sync: { code: "ABCD2345", sessionId: "s1", ackedGuard: { token: "t", revision: 2 }, ackedGameSeq: 5, lastAttempt: null },
    };
    const result = migrateStoreState(state, 12) as { localSeq: number; sync: unknown };
    expect(result).toBe(state);
    expect(result.localSeq).toBe(7);
    expect(result.sync).toEqual(state.sync);
  });

  // -------------------------------------------------------------------------
  // Phase 9D.1: v13 -> v14 structured live-state migration
  // -------------------------------------------------------------------------
  const legacyPlayer = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: "a", name: "Alice", seat: 0, joinedAt: 1, actualRole: "chef",
    shownRole: null, shownAlignment: null, behaviorMode: "normal", publicDisplayRole: null,
    alive: true, ghostVote: true, abilityUsed: false,
    statuses: {}, reminders: [], stNotes: "", isTraveler: false,
    ...over,
  });
  type MigratedPlayer = { actualAlignment?: string; effects?: { id: string; type: string }[]; reminders?: unknown[]; statuses?: Record<string, boolean> };
  const migratedPlayer = (state: unknown, id = "a"): MigratedPlayer =>
    (migrateStoreState(state, 13) as { game: { players: Record<string, MigratedPlayer> } }).game.players[id]!;

  it("v13->v14: an ordinary player with an assigned, resolvable role gets its canonical actual alignment", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "chef" }) } }), undoStack: [] };
    expect(migratedPlayer(state).actualAlignment).toBe("good");
    expect(takeMigrationResetFlag()).toBe(false);
  });

  it("v13->v14: an evil-typed ordinary role also derives correctly", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "imp" }) } }), undoStack: [] };
    expect(migratedPlayer(state).actualAlignment).toBe("evil");
  });

  it("v13->v14: an ordinary player with no assigned role is left unresolved (absent), never invented", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "" }) } }), undoStack: [] };
    expect(migratedPlayer(state).actualAlignment).toBeUndefined();
  });

  it("v13->v14: an existing Traveler's explicit actual alignment is preserved verbatim", () => {
    const state = { game: minimalPersistedGame({
      players: { a: legacyPlayer({ isTraveler: true, actualRole: "thief", actualAlignment: "evil" }) },
    }), undoStack: [] };
    expect(migratedPlayer(state).actualAlignment).toBe("evil");
  });

  it("v13->v14: a Traveler with no actual alignment yet chosen is never invented one from their character", () => {
    const state = { game: minimalPersistedGame({
      players: { a: legacyPlayer({ isTraveler: true, actualRole: "thief" }) },
    }), undoStack: [] };
    expect(migratedPlayer(state).actualAlignment).toBeUndefined();
  });

  it.each(["drunk", "poisoned", "protected"] as const)(
    "v13->v14: an active legacy %s boolean becomes its own deterministic manual effect, and clears the boolean",
    (kind) => {
      const state = { game: minimalPersistedGame({
        players: { a: legacyPlayer({ statuses: { [kind]: true } }) },
      }), undoStack: [] };
      const p = migratedPlayer(state);
      expect(p.effects).toEqual([{ id: `manual:${kind}`, type: kind, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }]);
      expect(p.statuses).toEqual({});
    }
  );

  it("v13->v14: existing reminder strings become structured manual/legacy records without losing their text", () => {
    const state = { game: minimalPersistedGame({
      players: { a: legacyPlayer({ reminders: ["Poisoned", "Secret note"] }) },
    }), undoStack: [] };
    const reminders = migratedPlayer(state).reminders as { id: string; label: string; lifetime: unknown }[];
    expect(reminders.map((r) => r.label)).toEqual(["Poisoned", "Secret note"]);
    // Deterministic, per-player stable ids (not a random allocation) --
    // never invented, never reshuffled.
    expect(reminders.map((r) => r.id)).toEqual(["legacy-a-0", "legacy-a-1"]);
    for (const r of reminders) {
      expect(r.lifetime).toEqual({ kind: "manual" });
    }
    // No invented provenance: no sourceCharacter/sourcePlayer/createdAt.
    expect(reminders[0]).not.toHaveProperty("sourceCharacter");
    expect(reminders[0]).not.toHaveProperty("sourcePlayer");
    expect(reminders[0]).not.toHaveProperty("createdAt");
  });

  it("v13->v14: duplicate legacy reminder labels are preserved in order, each with its own distinct deterministic id", () => {
    const state = { game: minimalPersistedGame({
      players: { a: legacyPlayer({ reminders: ["Poisoned", "Poisoned", "Poisoned"] }) },
    }), undoStack: [] };
    const reminders = migratedPlayer(state).reminders as { id: string; label: string }[];
    expect(reminders.map((r) => r.label)).toEqual(["Poisoned", "Poisoned", "Poisoned"]);
    expect(reminders.map((r) => r.id)).toEqual(["legacy-a-0", "legacy-a-1", "legacy-a-2"]);
    expect(new Set(reminders.map((r) => r.id)).size).toBe(3);
  });

  it("v13->v14: two independent clones of the same v13 state migrate to deeply identical v14 state, including reminders", () => {
    const buildLegacyState = () => ({
      game: minimalPersistedGame({
        players: {
          a: legacyPlayer({
            actualRole: "chef",
            statuses: { poisoned: true, drunk: true },
            reminders: ["Poisoned", "Poisoned", "Red Herring"],
          }),
          b: legacyPlayer({
            id: "b", seat: 1, actualRole: "imp", statuses: { protected: true }, reminders: ["Chosen"],
          }),
        },
      }),
      undoStack: [],
    });
    // Two structurally identical but independently allocated copies -- no
    // shared object identity, exactly like two separate localStorage reads
    // of the same persisted blob would produce.
    const clone1 = JSON.parse(JSON.stringify(buildLegacyState()));
    const clone2 = JSON.parse(JSON.stringify(buildLegacyState()));
    const migrated1 = migrateStoreState(clone1, 13);
    const migrated2 = migrateStoreState(clone2, 13);
    expect(migrated1).toEqual(migrated2);
    const players1 = (migrated1 as { game: { players: Record<string, MigratedPlayer> } }).game.players;
    expect(players1.a!.reminders).toEqual([
      { id: "legacy-a-0", label: "Poisoned", lifetime: { kind: "manual" } },
      { id: "legacy-a-1", label: "Poisoned", lifetime: { kind: "manual" } },
      { id: "legacy-a-2", label: "Red Herring", lifetime: { kind: "manual" } },
    ]);
  });

  it("v13->v14: an empty/no-effect legacy player migrates cleanly to empty effects and preserved empty reminders", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer() } }), undoStack: [] };
    const p = migratedPlayer(state);
    expect(p.effects).toEqual([]);
    expect(p.reminders).toEqual([]);
    expect(takeMigrationResetFlag()).toBe(false);
  });

  it("v13->v14: an ordinary player on a CUSTOM/homebrew script derives alignment from THIS state's own persisted customScripts (Phase 9R.1 Finding A2 local-trusted-evidence path -- unaffected by the remote-only canonical-only restriction; see checkpointMigration.test.ts for the remote side of this finding)", () => {
    const homebrewScriptId = "hb-local-13";
    const homebrewScript = {
      id: homebrewScriptId, name: "Local Homebrew",
      characters: [{ id: "custom-good", name: "Custom Good", type: "townsfolk" as const, ability: "Does good things." }],
    };
    const state = {
      game: minimalPersistedGame({ scriptId: homebrewScriptId, players: { a: legacyPlayer({ actualRole: "custom-good" }) } }),
      undoStack: [],
      customScripts: { [homebrewScriptId]: homebrewScript },
    };
    const result = migrateStoreState(state, 13) as { game: { players: Record<string, MigratedPlayer> } };
    expect(result.game.players.a!.actualAlignment).toBe("good");
  });

  it("v13->v14: migration is deterministic and idempotent when re-run against already-migrated data", () => {
    const state = { game: minimalPersistedGame({
      players: { a: legacyPlayer({
        actualRole: "chef", statuses: { poisoned: true },
        reminders: ["Poisoned", "Poisoned", "Red Herring"],
      }) },
    }), undoStack: [] };
    const once = migrateStoreState(state, 13) as { game: { players: Record<string, MigratedPlayer> } };
    const firstPlayer = structuredClone(once.game.players.a);
    // Re-run the same migration block against the now-migrated data.
    const twice = migrateStoreState(once, 13) as { game: { players: Record<string, MigratedPlayer> } };
    expect(twice.game.players.a).toEqual(firstPlayer);
    expect(twice.game.players.a!.effects).toHaveLength(1);
    expect(twice.game.players.a!.reminders).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Phase 9R.1 Astra remediation (Finding M1): migration must never throw on
  // malformed persisted local state -- it should fail safely through the
  // ALREADY-established invalid/reset behavior (takeMigrationResetFlag),
  // never an uncaught runtime exception.
  // -------------------------------------------------------------------------
  it("v13->v14: a malformed effects array containing null, alongside an active legacy status, never dereferences null.id -- resets safely rather than throwing", () => {
    const state = {
      game: minimalPersistedGame({
        players: { a: legacyPlayer({ actualRole: "chef", effects: [null], statuses: { poisoned: true } }) },
      }),
      undoStack: [],
    };
    expect(() => migrateStoreState(state, 13)).not.toThrow();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("v13->v14: malformed persisted custom-script evidence (an unusable Script candidate under the same scriptId the game references) never crashes migration -- resets safely rather than throwing", () => {
    const state = {
      game: minimalPersistedGame({
        scriptId: "hb-malformed", players: { a: legacyPlayer({ actualRole: "custom-role" }) },
      }),
      undoStack: [],
      // A structurally unusable "Script" -- characters is not even an
      // array, so buildRegistry's `for (const r of script.characters)`
      // would throw "is not iterable" if migration assumed this shape
      // were valid before using it as migration evidence.
      customScripts: { "hb-malformed": { id: "hb-malformed", name: "Malformed", characters: "not-an-array" } },
    };
    expect(() => migrateStoreState(state, 13)).not.toThrow();
    // This also independently fails ScriptSchema's own
    // characters: z.array(RoleDefSchema).min(1) requirement, so the
    // overall state resets regardless of what migration does with it --
    // the point of this test is strictly the absence of a thrown exception.
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("v13->v14: a malformed player identifier (an object, not a string) alongside legacy string Reminders never throws during deterministic Reminder id interpolation -- resets safely rather than throwing", () => {
    const state = {
      game: minimalPersistedGame({
        players: { a: legacyPlayer({ id: { toString: 0 }, actualRole: "chef", reminders: ["Red Herring"] }) },
      }),
      undoStack: [],
    };
    expect(() => migrateStoreState(state, 13)).not.toThrow();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("v13->v14: a scriptId of exactly \"__proto__\" never resolves an inherited Object.prototype member as a Script during local migration either -- alignment stays correctly unresolved, no crash", () => {
    const state = {
      game: minimalPersistedGame({ scriptId: "__proto__", players: { a: legacyPlayer({ actualRole: "chef" }) } }),
      undoStack: [],
    };
    let result: { game: { players: Record<string, MigratedPlayer> } } | undefined;
    expect(() => { result = migrateStoreState(state, 13) as typeof result; }).not.toThrow();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result!.game.players.a!.actualAlignment).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Phase 9R.1 Astra remediation (Finding M2): a malformed PRESENT
  // undoStack container -- not absent, not a valid array -- must never
  // throw before the normal migration/reset boundary. Every migration step
  // above that maps or spreads `s.undoStack` assumed any truthy value was
  // already an array; `{}` is truthy but not iterable/mappable, so
  // `[s.game, ...(s.undoStack ?? [])]` threw "is not iterable" instead of
  // failing safely through the ALREADY-established invalid/reset behavior
  // (takeMigrationResetFlag) -- exactly the same malformed-present-field
  // distinction Finding M1 already applies to scriptId/player.id/effects.
  // -------------------------------------------------------------------------
  it.each([13, 14, 15])(
    "v%i->v16: a malformed undoStack container ({} -- Astra's exact reproduction) never throws during migration/hydration -- resets safely via the existing CLEAN_STATE path rather than crashing",
    (fromVersion) => {
      const state = {
        game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "chef" }) } }),
        undoStack: {},
      };
      let result: unknown;
      expect(() => { result = migrateStoreState(state, fromVersion); }).not.toThrow();
      expect(takeMigrationResetFlag()).toBe(true);
      // The reset path returns CLEAN_STATE exactly -- the malformed
      // undoStack is never silently normalized into a valid-looking `[]`
      // that could pass for real Undo content; the whole persisted blob
      // (including the game) is discarded, matching every other
      // malformed-field reset in this file.
      expect(result).toEqual({ game: null, view: "home", undoStack: [], customScripts: {}, lobby: null });
    }
  );

  it('v13->v16: a malformed undoStack container ("bad", a string) never throws -- resets safely rather than crashing', () => {
    const state = {
      game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "chef" }) } }),
      undoStack: "bad",
    };
    expect(() => migrateStoreState(state, 13)).not.toThrow();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("v13->v16: a malformed undoStack container (7, a number) never throws -- resets safely rather than crashing", () => {
    const state = {
      game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "chef" }) } }),
      undoStack: 7,
    };
    expect(() => migrateStoreState(state, 13)).not.toThrow();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("v13->v16: undoStack: null already fails the existing StorytellerStateSchema (undoStack is .optional(), not .nullable()) -- this guard does not change that pre-existing behavior, it only stops a non-null malformed container from throwing first", () => {
    const state = {
      game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "chef" }) } }),
      undoStack: null,
    };
    expect(() => migrateStoreState(state, 13)).not.toThrow();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("v13->v16: a genuinely ABSENT undoStack (the field is simply not present) is unaffected by this guard -- migration proceeds normally, exactly as before", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "chef" }) } }) };
    let result: { game: { players: Record<string, MigratedPlayer> } } | undefined;
    expect(() => { result = migrateStoreState(state, 13) as typeof result; }).not.toThrow();
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result!.game.players.a!.actualAlignment).toBe("good");
  });

  it("v13->v16: a VALID, non-empty undoStack array still migrates normally -- its entries receive the exact same v13->v16 transformation as the live game, never skipped or discarded by this guard", () => {
    const undoEntry = minimalPersistedGame({
      players: { a: legacyPlayer({ actualRole: "imp", statuses: { poisoned: true }, reminders: ["Chosen"] }) },
    });
    const state = {
      game: minimalPersistedGame({ players: { a: legacyPlayer({ actualRole: "chef" }) } }),
      undoStack: [undoEntry],
    };
    const result = migrateStoreState(state, 13) as {
      game: { players: Record<string, MigratedPlayer> };
      undoStack: { players: Record<string, MigratedPlayer> }[];
    };
    expect(takeMigrationResetFlag()).toBe(false);
    expect(result.game.players.a!.actualAlignment).toBe("good");
    // The Undo entry (a DIFFERENT player/role/status/reminder set than the
    // live game) received its own independent v13->v14 migration: an
    // actual alignment derived from its own resolvable role, its own
    // legacy poisoned status converted to a manual Effect, and its own
    // legacy string Reminder converted to a structured record.
    const undoPlayer = result.undoStack[0]!.players.a!;
    expect(undoPlayer.actualAlignment).toBe("evil");
    expect(undoPlayer.effects).toEqual([{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }]);
    expect(undoPlayer.reminders).toEqual([{ id: "legacy-a-0", label: "Chosen", lifetime: { kind: "manual" } }]);
  });

  // -------------------------------------------------------------------------
  // Phase 9D.2: v14 -> v15 history migration
  // -------------------------------------------------------------------------
  it("v14->v15: a legacy game with no history field receives an empty history collection", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer({ effects: [] }) } }), undoStack: [] };
    const result = migrateStoreState(state, 14) as { game: { history?: unknown } };
    expect(result.game.history).toEqual([]);
    expect(takeMigrationResetFlag()).toBe(false);
  });

  it("v14->v15: never fabricates history for pre-existing, already-changed Current State", () => {
    const state = { game: minimalPersistedGame({
      day: 3, phase: "night",
      players: { a: legacyPlayer({
        actualRole: "imp", actualAlignment: "evil",
        effects: [{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" } }],
        reminders: [{ id: "r1", label: "Killed Bob", lifetime: { kind: "manual" } }],
      }) },
    }), undoStack: [] };
    const result = migrateStoreState(state, 14) as { game: { history?: unknown } };
    // Current truth is rich, but none of it proves how or when it changed --
    // migration must not invent a plausible-looking event log to match it.
    expect(result.game.history).toEqual([]);
  });

  it("v14->v15: undo-stack snapshots also receive an empty history collection", () => {
    const state = {
      game: minimalPersistedGame({ players: { a: legacyPlayer({ effects: [] }) } }),
      undoStack: [minimalPersistedGame({ players: { a: legacyPlayer({ effects: [] }) } })],
    };
    const result = migrateStoreState(state, 14) as { undoStack: { history?: unknown }[] };
    expect(result.undoStack[0]!.history).toEqual([]);
  });

  it("v14->v15: migration is deterministic and idempotent when re-run against already-migrated data", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer({ effects: [] }) } }), undoStack: [] };
    const once = migrateStoreState(state, 14) as { game: { history: unknown[] } };
    expect(once.game.history).toEqual([]);
    const twice = migrateStoreState(once, 14) as { game: { history: unknown[] } };
    expect(twice.game.history).toEqual([]);
    expect(twice).toEqual(once);
  });

  // -------------------------------------------------------------------------
  // Phase 9D.3: v15 -> v16 information-delivery migration
  // -------------------------------------------------------------------------
  it("v15->v16: a legacy game with no informationDeliveries field receives an empty collection", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer({ effects: [] }) }, history: [] }), undoStack: [] };
    const result = migrateStoreState(state, 15) as { game: { informationDeliveries?: unknown } };
    expect(result.game.informationDeliveries).toEqual([]);
    expect(takeMigrationResetFlag()).toBe(false);
  });

  it("v15->v16: never fabricates deliveries from Role assignments, night progress, or notes", () => {
    const state = { game: minimalPersistedGame({
      day: 5, phase: "night", notes: "Chef told the pairs count on night 1",
      nightProgress: { "1:chef": { status: "done", notes: "informed" } },
      players: { a: legacyPlayer({ actualRole: "chef", effects: [] }) },
      history: [],
    }), undoStack: [] };
    const result = migrateStoreState(state, 15) as { game: { informationDeliveries?: unknown } };
    // Rich existing context (a role, a completed night step, a note) never
    // proves what was actually communicated -- migration invents nothing.
    expect(result.game.informationDeliveries).toEqual([]);
  });

  it("v15->v16: undo-stack snapshots also receive an empty informationDeliveries collection", () => {
    const state = {
      game: minimalPersistedGame({ players: { a: legacyPlayer({ effects: [] }) }, history: [] }),
      undoStack: [minimalPersistedGame({ players: { a: legacyPlayer({ effects: [] }) }, history: [] })],
    };
    const result = migrateStoreState(state, 15) as { undoStack: { informationDeliveries?: unknown }[] };
    expect(result.undoStack[0]!.informationDeliveries).toEqual([]);
  });

  it("v15->v16: migration is deterministic and idempotent when re-run against already-migrated data", () => {
    const state = { game: minimalPersistedGame({ players: { a: legacyPlayer({ effects: [] }) }, history: [] }), undoStack: [] };
    const once = migrateStoreState(state, 15) as { game: { informationDeliveries: unknown[] } };
    expect(once.game.informationDeliveries).toEqual([]);
    const twice = migrateStoreState(once, 15) as { game: { informationDeliveries: unknown[] } };
    expect(twice.game.informationDeliveries).toEqual([]);
    expect(twice).toEqual(once);
  });

  // -------------------------------------------------------------------------
  // Phase 9D.5 Proof G: the full migration chain through v16, in ONE call
  // per starting version (never a separate call per threshold -- that is
  // not how the real persist middleware invokes this), covering both
  // `game` and an `undoStack` entry together so neither is migrated in
  // isolation from the other. Each fixture is deliberately non-trivial
  // (real legacy statuses/reminders, or real already-migrated
  // history/informationDeliveries content) so a cross-field corruption --
  // migration overwriting legitimate data, duplicating history, or
  // fabricating a delivery -- would actually show up.
  // -------------------------------------------------------------------------
  describe("Phase 9D.5 Proof G: full chain through v16", () => {
    it("v13->v16: a legacy v13 store (structured live-state, History, and Information Delivery all still to come) migrates completely in one call, for game AND undoStack", () => {
      const v13Player = legacyPlayer({
        actualRole: "chef", statuses: { poisoned: true }, reminders: ["Poisoned Reminder"],
      });
      const v13Game = minimalPersistedGame({ players: { a: v13Player }, plannedTravelerCount: 0 });
      const state = { game: v13Game, undoStack: [v13Game] };

      const result = migrateStoreState(state, 13) as {
        game: { players: Record<string, MigratedPlayer>; history: unknown[]; informationDeliveries: unknown[]; plannedTravelerCount: number };
        undoStack: { players: Record<string, MigratedPlayer>; history: unknown[]; informationDeliveries: unknown[] }[];
      };
      expect(takeMigrationResetFlag()).toBe(false);

      for (const entry of [result.game, result.undoStack[0]!]) {
        expect(entry.players.a!.actualAlignment).toBe("good"); // v13->v14: derived from the resolvable chef role
        expect(entry.players.a!.effects).toEqual([{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }]);
        expect(entry.players.a!.reminders).toEqual([{ id: "legacy-a-0", label: "Poisoned Reminder", lifetime: { kind: "manual" } }]);
        expect(entry.players.a!.statuses).toEqual({}); // the legacy boolean is cleared, never left as stale truth
        expect(entry.history).toEqual([]); // v13->v15: nothing to fabricate for a game that never tracked it
        expect(entry.informationDeliveries).toEqual([]); // v13->v16: likewise
      }
      expect(result.game.plannedTravelerCount).toBe(0); // already-present v13 field survives untouched
    });

    it("v14->v16: an already-structured v14 store (real actualAlignment/effects/reminders) migrates only by adding empty History and Information Delivery, for game AND undoStack -- everything else byte-for-byte unchanged", () => {
      const v14Player = legacyPlayer({
        actualRole: "chef", actualAlignment: "good",
        effects: [{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" } }],
        reminders: [{ id: "legacy-a-0", label: "Poisoned Reminder", lifetime: { kind: "manual" } }],
      });
      const v14Game = minimalPersistedGame({ players: { a: v14Player }, plannedTravelerCount: 1 });
      const state = { game: v14Game, undoStack: [v14Game] };

      const result = migrateStoreState(state, 14) as {
        game: { players: Record<string, MigratedPlayer>; history: unknown[]; informationDeliveries: unknown[]; plannedTravelerCount: number };
        undoStack: { players: Record<string, MigratedPlayer>; history: unknown[]; informationDeliveries: unknown[] }[];
      };
      expect(takeMigrationResetFlag()).toBe(false);

      for (const entry of [result.game, result.undoStack[0]!]) {
        // The v14 structured live-state fields are never re-derived or
        // re-converted. (Phase 10B: the v19 -> v20 step only adds each
        // Effect's lifecycle -- active, and no expiry for a manual one.)
        expect(entry.players.a!.actualAlignment).toBe("good");
        expect(entry.players.a!.effects).toEqual([{ id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } }]);
        expect(entry.players.a!.reminders).toEqual([{ id: "legacy-a-0", label: "Poisoned Reminder", lifetime: { kind: "manual" } }]);
        expect(entry.history).toEqual([]);
        expect(entry.informationDeliveries).toEqual([]);
      }
      expect(result.game.plannedTravelerCount).toBe(1);
    });

    it("v15->v17: real, pre-existing History content survives -- only its PlayerId-only participant reference becomes an unresolved legacy ref -- and migration only adds empty Information Delivery, for game AND undoStack", () => {
      const existingHistoryRecord = {
        id: "h-existing-1", category: "life", playerId: "a",
        change: { kind: "value", from: { alive: true }, to: { alive: false } },
      };
      // Phase 9R.2: migration mutates in place, so the expectation is built
      // from an independent deep copy -- never compared against the very
      // object migration itself rewrote.
      const { playerId: _legacyPlayerId, ...recordBody } = structuredClone(existingHistoryRecord);
      const expectedRecord = { ...recordBody, participant: { kind: "legacy", playerId: "a" } };
      const v15Player = legacyPlayer({ actualRole: "chef", actualAlignment: "good", effects: [] });
      const v15Game = minimalPersistedGame({ players: { a: v15Player }, history: [existingHistoryRecord] });
      const state = { game: v15Game, undoStack: [structuredClone(v15Game)] };

      const result = migrateStoreState(state, 15) as {
        game: { history: unknown[]; informationDeliveries: unknown[] };
        undoStack: { history: unknown[]; informationDeliveries: unknown[] }[];
      };
      expect(takeMigrationResetFlag()).toBe(false);

      for (const entry of [result.game, result.undoStack[0]!]) {
        // Not reset to [], not duplicated -- the pre-existing record, its
        // id/category/change/moment unchanged, still the only entry.
        expect(entry.history).toEqual([expectedRecord]);
        expect(entry.history).toHaveLength(1);
        expect(entry.informationDeliveries).toEqual([]);
      }
    });

    it("v16->v17: History/Information Delivery PlayerId references become unresolved legacy refs -- never the current occupant's new identity -- identically for game AND undoStack", () => {
      const existingHistoryRecord = {
        id: "h-existing-1", category: "life", playerId: "a",
        change: { kind: "value", from: { alive: true }, to: { alive: false } },
      };
      const existingDelivery = {
        id: "d-existing-1", recipientPlayerId: "a", actualRole: "chef", informationActionId: "chef-first-night",
        moment: { phase: "night", day: 1 },
        values: [{ requirementId: "pairs", kind: "number", value: 1 }],
      };
      const v16Player = legacyPlayer({ actualRole: "chef", actualAlignment: "good", effects: [] });
      const v16Game = minimalPersistedGame({
        players: { a: v16Player }, history: [existingHistoryRecord], informationDeliveries: [existingDelivery],
      });
      const state = { game: v16Game, undoStack: [structuredClone(v16Game)] };

      const result = migrateStoreState(state, 16) as {
        game: { players: Record<string, { participantId?: string }>; history: unknown[]; informationDeliveries: unknown[] };
        undoStack: { players: Record<string, { participantId?: string }>; history: unknown[]; informationDeliveries: unknown[] }[];
      };
      expect(takeMigrationResetFlag()).toBe(false);
      for (const entry of [result.game, result.undoStack[0]!]) {
        // The CURRENT occupant gets a deterministic identity for their
        // current participation instance...
        expect(entry.players.a!.participantId).toBe("legacy-current:a");
        // ...but no historical record is attached to it.
        expect(entry.history).toEqual([{
          id: "h-existing-1", category: "life", participant: { kind: "legacy", playerId: "a" },
          change: { kind: "value", from: { alive: true }, to: { alive: false } },
        }]);
        expect(entry.informationDeliveries).toEqual([{
          id: "d-existing-1", recipient: { kind: "legacy", playerId: "a" }, actualRole: "chef",
          informationActionId: "chef-first-night", moment: { phase: "night", day: 1 },
          values: [{ requirementId: "pairs", kind: "number", value: 1 }],
        }]);
        expect(JSON.stringify(entry.history)).not.toContain("legacy-current");
        expect(JSON.stringify(entry.informationDeliveries)).not.toContain("legacy-current");
      }
    });

    it("v17->v18: a fully-populated v17 state with no legacy \"identity\" History category (real History AND Information Delivery content) passes through completely unchanged -- same reference, nothing reset or duplicated", () => {
      const participant = { kind: "participant", participantId: "pt-alice", playerId: "a", nameAtTime: "Alice" };
      const existingHistoryRecord = {
        id: "h-existing-1", category: "life", participant,
        change: { kind: "value", from: { alive: true }, to: { alive: false } },
      };
      const existingDelivery = {
        id: "d-existing-1", recipient: participant, actualRole: "chef", informationActionId: "chef-first-night",
        moment: { phase: "night", day: 1 },
        values: [{ requirementId: "pairs", kind: "number", value: 1 }],
      };
      const v17Player = legacyPlayer({ actualRole: "chef", actualAlignment: "good", effects: [], participantId: "pt-alice" });
      const v17Game = minimalPersistedGame({
        players: { a: v17Player }, history: [existingHistoryRecord], informationDeliveries: [existingDelivery],
      });
      const state = { game: v17Game, undoStack: [v17Game] };
      const snapshot = structuredClone(state);

      const result = migrateStoreState(state, 17) as {
        game: { players: Record<string, { participantId?: string }>; history: unknown[]; informationDeliveries: unknown[] };
        undoStack: { history: unknown[]; informationDeliveries: unknown[] }[];
      };
      expect(result).toBe(state); // same top-level reference: a genuinely current state is never rebuilt
      expect(takeMigrationResetFlag()).toBe(false);
      expect(result.game.players.a!.participantId).toBe("pt-alice"); // never regenerated
      expect(result.game.history).toEqual(snapshot.game.history);
      expect(result.game.history).toHaveLength(1);
      expect(result.game.informationDeliveries).toEqual(snapshot.game.informationDeliveries);
      expect(result.game.informationDeliveries).toHaveLength(1);
      expect(result.undoStack[0]!.history).toEqual(snapshot.game.history);
      expect(result.undoStack[0]!.informationDeliveries).toEqual(snapshot.game.informationDeliveries);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.2B.2 (hardening): current-version (v12) persisted state must be
// validated too. Zustand's persist middleware only calls `migrate` — and
// therefore migrateStoreState's own validate-or-reset tail — when the
// persisted version differs from the store's version; a blob already
// tagged v12 previously bypassed that entirely and hydrated unchanged no
// matter what it contained. These exercise the REAL rehydrate() path (not
// migrateStoreState() called directly), because that is exactly the gap:
// the fix lives in the persist config's `merge`, not in migrateStoreState.
// ---------------------------------------------------------------------------
describe("Phase 9C.2B.2 — current-version (v12) persisted state validation", () => {
  const STORAGE_KEY = "new-blood-st";

  beforeEach(() => {
    // The outer beforeEach doesn't touch sync/localSeq; reset them
    // explicitly too, or a prior test's successful hydration would leak
    // into this one before rehydrateFrom() below ever runs.
    useStorytellerStore.setState({ game: null, view: "home", undoStack: [], customScripts: {}, lobby: null, localSeq: 0, sync: null });
    takeMigrationResetFlag(); // drain so each test starts clean
  });

  async function rehydrateFrom(state: Record<string, unknown>) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 12 }));
    await useStorytellerStore.persist.rehydrate();
  }

  const baseState = (sync: unknown, localSeq: unknown) => ({
    game: minimalPersistedGame(), undoStack: [], view: "home" as const,
    customScripts: {}, lobby: null, localSeq, sync,
  });

  it("a valid v12 state round-trips unchanged through a real rehydrate cycle", async () => {
    const sync = { code: "ABCD2345", sessionId: "s1", ackedGuard: { token: "t", revision: 2 }, ackedGameSeq: 5, lastAttempt: null };
    await rehydrateFrom(baseState(sync, 7));
    expect(useStorytellerStore.getState().localSeq).toBe(7);
    expect(useStorytellerStore.getState().sync).toEqual(sync);
    expect(useStorytellerStore.getState().game).toMatchObject({ scriptId: "tb" });
    expect(takeMigrationResetFlag()).toBe(false);
  });

  it("ackedGameSeq > localSeq is rejected: the contradictory watermark never reaches reconnect as trusted evidence", async () => {
    const sync = { code: "ABCD2345", sessionId: "s1", ackedGuard: null, ackedGameSeq: 999, lastAttempt: null };
    await rehydrateFrom(baseState(sync, 5)); // the Phase 9C.2B.2 reproduction: localSeq=5, ackedGameSeq=999
    expect(useStorytellerStore.getState().sync).toBeNull();
    expect(useStorytellerStore.getState().game).toBeNull(); // the existing controlled reset path (CLEAN_STATE)
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a missing required sync field (sessionId) is rejected", async () => {
    const sync = { code: "ABCD2345", ackedGuard: null, ackedGameSeq: 0, lastAttempt: null };
    await rehydrateFrom(baseState(sync, 0));
    expect(useStorytellerStore.getState().sync).toBeNull();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a non-numeric counter is rejected", async () => {
    const sync = { code: "ABCD2345", sessionId: "s1", ackedGuard: null, ackedGameSeq: "5", lastAttempt: null };
    await rehydrateFrom(baseState(sync, 5));
    expect(useStorytellerStore.getState().sync).toBeNull();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("a negative counter is rejected", async () => {
    const sync = { code: "ABCD2345", sessionId: "s1", ackedGuard: null, ackedGameSeq: -1, lastAttempt: null };
    await rehydrateFrom(baseState(sync, 5));
    expect(useStorytellerStore.getState().sync).toBeNull();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("an unsafe integer counter is rejected even when internally consistent with localSeq", async () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 10;
    const sync = { code: "ABCD2345", sessionId: "s1", ackedGuard: null, ackedGameSeq: unsafe, lastAttempt: null };
    await rehydrateFrom(baseState(sync, unsafe));
    expect(useStorytellerStore.getState().sync).toBeNull();
    expect(takeMigrationResetFlag()).toBe(true);
  });

  it("malformed guard metadata (an empty token) is rejected", async () => {
    const sync = { code: "ABCD2345", sessionId: "s1", ackedGuard: { token: "", revision: 2 }, ackedGameSeq: 0, lastAttempt: null };
    await rehydrateFrom(baseState(sync, 5));
    expect(useStorytellerStore.getState().sync).toBeNull();
    expect(takeMigrationResetFlag()).toBe(true);
  });
});
