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
  function setupGame(): { p1: string } {
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
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
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().setFabled(["djinn", "doomsayer"]);
    useStorytellerStore.getState().addPlayer("Alice");
    const id = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().assignRole(id, "chef");
    useStorytellerStore.getState().setPlannedPlayerCount(1);
    expect(useStorytellerStore.getState().advancePhase().ok).toBe(true);
    const game = useStorytellerStore.getState().game!;
    expect(game.phase).toBe("night");
    expect(game.fabled).toEqual(["djinn", "doomsayer"]);
  });
});

// ---------------------------------------------------------------------------
// E1: migrateStoreState — schema roundtrip tests
// ---------------------------------------------------------------------------

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
  seatOrder: [],
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
});
