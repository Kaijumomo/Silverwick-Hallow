import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store, migrateStoreState, type SeatSwapBinding } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";

const state = () => store.getState();
const game = () => state().game!;
const binding = (id: string): SeatSwapBinding => ({ playerId: id, participantId: game().players[id]!.participantId! });
const initialPositions = { p0: { x: 100, y: 120 }, p1: { x: 600, y: 400 }, p2: { x: 300, y: 300 } };

beforeEach(() => {
  localStorage.clear();
  usePrivacyStore.getState().reset();
  const game = setupGame(standardRoles(5), { phase: "night", day: 1, setupRolesDealt: true, setupRolesRevealed: true });
  game.players.p0!.stNotes = "Keep this player's notes";
  game.players.p0!.reminders = [{ id: "poison-note", label: "Poisoned", sourceCharacter: "poisoner" }];
  game.players.p1!.alive = false;
  game.players.p1!.ghostVote = false;
  store.setState({ game, lobby: null, terminalClose: null, undoStack: [], customScripts: { [setupScript.id]: setupScript },
    tokenPositions: structuredClone(initialPositions), seatSwapUndo: [], grimoireMode: "freeRoam", localSeq: 0 });
});

describe("positional seat swap", () => {
  it("atomically swaps seat order and free-roam coordinates, preserving all player state, with one complete Undo", () => {
    const before = structuredClone(game());
    const updates: unknown[] = [];
    const unsubscribe = store.subscribe(next => updates.push(next));
    try {
      expect(state().swapPlayerSeats(binding("p0"), binding("p1"))).toEqual({ ok: true });
    } finally { unsubscribe(); }
    expect(updates).toHaveLength(1);
    expect(state().localSeq).toBe(1);
    expect(game().seatOrder).toEqual(["p1", "p0", "p2", "p3", "p4"]);
    for (const id of game().seatOrder) {
      expect({ ...game().players[id], seat: before.players[id]!.seat }).toEqual(before.players[id]);
    }
    expect(state().tokenPositions).toEqual({ p0: initialPositions.p1, p1: initialPositions.p0, p2: initialPositions.p2 });
    expect(state().undoStack).toEqual([before]);
    // Layout data stays out of authoritative and persisted game snapshots.
    expect(game()).not.toHaveProperty("tokenPositions");
    expect(state().undoStack[0]).not.toHaveProperty("tokenPositions");
    state().undo();
    expect(game()).toEqual(before);
    expect(state().tokenPositions).toEqual(initialPositions);
    expect(state().undoStack).toEqual([]);
    expect(state().localSeq).toBe(2);
  });

  it("preserves unrelated later layout edits when undoing a swap beneath another game action", () => {
    const before = structuredClone(game());
    expect(state().swapPlayerSeats(binding("p0"), binding("p1")).ok).toBe(true);
    state().renamePlayer("p2", "Renamed");
    state().setTokenPosition("p2", 750, 550);
    const swapped = structuredClone(state().tokenPositions);
    state().undo();
    expect(state().tokenPositions).toEqual(swapped);
    expect(game().seatOrder[0]).toBe("p1");
    state().undo();
    expect(game()).toEqual(before);
    expect(state().tokenPositions).toEqual({ ...initialPositions, p2: { x: 750, y: 550 } });
  });

  it("restores each coordinate exchange when consecutive swaps are undone", () => {
    expect(state().swapPlayerSeats(binding("p0"), binding("p1")).ok).toBe(true);
    const first = structuredClone(state().tokenPositions);
    expect(state().swapPlayerSeats(binding("p1"), binding("p2")).ok).toBe(true);
    state().undo();
    expect(state().tokenPositions).toEqual(first);
    state().undo();
    expect(state().tokenPositions).toEqual(initialPositions);
    expect(game().seatOrder).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("ring mode keeps saved free-roam positions coherent when modes change before Undo", () => {
    store.setState({ grimoireMode: "ring" });
    expect(state().swapPlayerSeats(binding("p0"), binding("p1")).ok).toBe(true);
    expect(state().tokenPositions).toEqual({ p0: initialPositions.p1, p1: initialPositions.p0, p2: initialPositions.p2 });
    state().setGrimoireMode("freeRoam");
    state().undo();
    expect(state().tokenPositions).toEqual(initialPositions);
  });

  it.each(["ring", "freeRoam"] as const)("restores a %s swap through validated persisted local metadata", mode => {
    store.setState({ grimoireMode: mode });
    const before = structuredClone(game());
    expect(state().swapPlayerSeats(binding("p0"), binding("p1")).ok).toBe(true);
    const persisted = JSON.parse(JSON.stringify({ game: game(), undoStack: state().undoStack, tokenPositions: state().tokenPositions, seatSwapUndo: state().seatSwapUndo }));
    store.setState(migrateStoreState(persisted, 26) as Partial<ReturnType<typeof state>>);
    state().undo();
    expect(game()).toEqual(before);
    expect(state().tokenPositions).toEqual(initialPositions);
  });

  it.each(["movePlayer", "setSeatOrder"] as const)("never restores coordinates for legacy %s Undo, including after reload", action => {
    const before = structuredClone(game());
    if (action === "movePlayer") state().movePlayer("p0", "right");
    else state().setSeatOrder(["p1", "p0", "p2", "p3", "p4"]);
    expect(state().tokenPositions).toEqual(initialPositions);
    const persisted = JSON.parse(JSON.stringify({ game: game(), undoStack: state().undoStack, tokenPositions: state().tokenPositions, seatSwapUndo: state().seatSwapUndo }));
    store.setState(migrateStoreState(persisted, 26) as Partial<ReturnType<typeof state>>);
    state().undo();
    expect(game()).toEqual(before);
    expect(state().tokenPositions).toEqual(initialPositions);
  });

  it("keeps explicit layout metadata aligned when Undo history is trimmed at its limit", () => {
    for (let i = 0; i < 19; i++) state().renamePlayer("p2", "Before " + i);
    expect(state().swapPlayerSeats(binding("p0"), binding("p1")).ok).toBe(true);
    for (let i = 0; i < 5; i++) state().renamePlayer("p2", "After " + i);
    expect(state().undoStack).toHaveLength(20);
    expect(state().seatSwapUndo).toHaveLength(20);
    for (let i = 0; i < 5; i++) state().undo();
    state().undo();
    expect(state().tokenPositions).toEqual(initialPositions);
    expect(game().seatOrder).toEqual(["p0", "p1", "p2", "p3", "p4"]);
  });

  it("drops local layout metadata when game history is cleared", () => {
    state().swapPlayerSeats(binding("p0"), binding("p1"));
    expect(state().seatSwapUndo.some(Boolean)).toBe(true);
    state().newGame(setupScript.id, { plannedPlayerCount: 5 });
    expect(state().seatSwapUndo).toEqual([]);
  });

  it("defaults old saves and discards malformed or incorrectly bound layout metadata without losing the game", () => {
    state().swapPlayerSeats(binding("p0"), binding("p1"));
    const base = { game: structuredClone(game()), undoStack: structuredClone(state().undoStack) };
    const good = structuredClone(state().seatSwapUndo);
    good[0]![0].participantId = "different-participant";
    for (const extra of [{}, { seatSwapUndo: "invalid" }, { seatSwapUndo: [[{ x: Infinity }]] }, { seatSwapUndo: good }]) {
      const migrated = migrateStoreState(structuredClone({ ...base, ...extra }), 26) as Partial<ReturnType<typeof state>>;
      expect(migrated.game).toEqual(base.game);
      expect(migrated.undoStack).toEqual(base.undoStack);
      expect(migrated.seatSwapUndo?.some(Boolean)).toBeFalsy();
    }
  });

  it("does not infer layout restoration for a history entry that also changes player identity", () => {
    const previous = structuredClone(game());
    const changed = structuredClone(previous);
    changed.seatOrder = ["p1", "p0", "p2", "p3", "p4"];
    changed.players.p0!.seat = 1;
    changed.players.p1!.seat = 0;
    changed.players.p0!.actualRole = "chef";
    store.setState({ game: changed, undoStack: [previous] });
    const positions = state().tokenPositions;
    state().undo();
    expect(state().tokenPositions).toBe(positions);
  });

  it("refuses a free-roam swap with a missing coordinate without inventing one or changing seat order", () => {
    store.setState({ tokenPositions: { p0: initialPositions.p0 } });
    const before = state();
    expect(state().swapPlayerSeats(binding("p0"), binding("p1")).ok).toBe(false);
    expect(state()).toBe(before);
  });

  it("same-player selection is a true no-op", () => {
    const before = state();
    expect(state().swapPlayerSeats(binding("p0"), binding("p0"))).toEqual({ ok: true });
    expect(state()).toBe(before);
  });

  it.each(["stale source", "stale target", "inherited id", "missing seat", "empty seat", "malformed order"])("refuses %s without any mutation", reason => {
    const source = binding("p0"), target = binding("p1");
    if (reason === "stale source") source.participantId = "old-participant";
    if (reason === "stale target") target.participantId = "old-participant";
    if (reason === "inherited id") source.playerId = "__proto__";
    if (reason === "missing seat") store.setState({ game: { ...game(), seatOrder: game().seatOrder.slice(1) } });
    if (reason === "empty seat") store.setState({ game: { ...game(), players: { ...game().players, p0: { ...game().players.p0!, isEmpty: true } } } });
    if (reason === "malformed order") store.setState({ game: { ...game(), seatOrder: ["p0", "p0", "p1"] } });
    const before = state();
    expect(state().swapPlayerSeats(source, target).ok).toBe(false);
    expect(state()).toBe(before);
  });

  it.each(["ended", "privacy", "closing"])("refuses while %s without coordinate or authoritative changes", mode => {
    if (mode === "ended") store.setState({ game: { ...game(), phase: "ended" } });
    if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (mode === "closing") expect(state().beginTerminalClose({ kind: "noResult" })).toBe(true);
    const before = state();
    expect(state().swapPlayerSeats(binding("p0"), binding("p1")).ok).toBe(false);
    expect(state()).toBe(before);
  });

  it("cannot apply a local layout Undo while terminal closure locks game Undo", () => {
    expect(state().swapPlayerSeats(binding("p0"), binding("p1")).ok).toBe(true);
    expect(state().beginTerminalClose({ kind: "noResult" })).toBe(true);
    const before = state();
    state().undo();
    expect(state()).toBe(before);
  });
});

describe("exact empty-seat occupancy", () => {
  it("fills the requested empty reservation rather than the first empty seat", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 5 });
    const [first, second] = game().seatOrder;
    const before = structuredClone(game());
    state().addPlayerToSeat("Ada", second);
    expect(game().players[first!]!.isEmpty).toBe(true);
    expect(game().players[second!]!).toMatchObject({ isEmpty: false, name: "Ada", seat: 1 });
    expect(game().plannedPlayerCount).toBe(5);
    expect(game().seatOrder).toEqual(before.seatOrder);
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(game()).toEqual(before);
  });

  it("refuses a stale occupied or missing target without filling some other seat", () => {
    state().newGame(setupScript.id, { plannedPlayerCount: 5 });
    const [first, second] = game().seatOrder;
    state().addPlayerToSeat("Ada", second);
    for (const target of [second!, "missing", "__proto__"]) {
      const before = state();
      state().addPlayerToSeat("Bram", target);
      expect(state()).toBe(before);
      expect(game().players[first!]!.isEmpty).toBe(true);
    }
  });
});
