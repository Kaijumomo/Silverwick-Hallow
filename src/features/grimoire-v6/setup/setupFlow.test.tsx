// Package 4C: the unified Setup flow of the Grimoire, as plain actions over the real stores (no Firebase, no UI).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { buildSetupGame, useStorytellerStore as store } from "@/stores/storytellerStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { useV6Ui } from "../v6Store";
import { isDraftGame, planExtras, travellersOf, useDraftGame, wizardIsDraft, wizardScript } from "./draft";
import { beginOffline, changeSeatCount, emptySeats, nameNextSeat, waitingOf } from "./seating";
import { enterTown, leaveTown, setWizardCount, startWizard, useSetupFlow, wizardHome, wizardTo } from "./flow";

const ui = () => useV6Ui.getState();
const game = () => store.getState().game;

beforeEach(() => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  useSessionRuntime.setState({ backend: null, joined: [], presence: "unknown", status: "idle" });
  store.setState({ game: null, lobby: null, view: "home", undoStack: [], selectedPlayerId: null });
  ui().set({ wiz: null });
  useSetupFlow.getState().set({ busy: false, lobby: "idle", notice: null, gathered: false, queueOpen: false });
});
afterEach(() => { vi.restoreAllMocks(); });

const pickScript = (id = "tb", count?: number) => {
  const wiz = ui().wiz!;
  ui().set({ wiz: { ...wiz, script: id, ...(count ? { count } : {}) } });
};

describe("draft preview", () => {
  it("counts Travellers only beyond the fifteen-seat table", () => {
    expect([5, 15, 16, 20].map(travellersOf)).toEqual([0, 0, 1, 5]);
  });

  it("splits chosen extras into the Fabled and Loric catalogues the store plans with", () => {
    expect(planExtras(["angel", "bigwig", "not-a-role"])).toEqual({ plannedFabled: ["angel"], plannedLorics: ["bigwig"] });
  });

  it("is built by the store's pristine builder, flagged as a draft, and never stored", () => {
    startWizard();
    pickScript("tb", 12);
    const { result } = renderHook(() => useDraftGame(ui().wiz, true));
    const draft = result.current!;
    expect(isDraftGame(draft)).toBe(true);
    expect(draft.seatOrder).toHaveLength(12);
    expect(Object.values(draft.players).every((p) => p.isEmpty)).toBe(true);
    expect(game()).toBeNull();
    expect(isDraftGame(buildSetupGame(BUILTIN_SCRIPTS.tb!, { plannedPlayerCount: 5 }))).toBe(false);
  });

  it("keeps its seat ids while the wizard is browsed and rebuilds when the count changes", () => {
    startWizard();
    pickScript("tb", 8);
    const { result, rerender } = renderHook(() => useDraftGame(ui().wiz, true));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    act(() => setWizardCount(9));
    rerender();
    expect(result.current).not.toBe(first);
    expect(result.current!.seatOrder).toHaveLength(9);
  });

  it("is only a draft before the town step, or while the town step has no game", () => {
    startWizard();
    const wiz = ui().wiz!;
    expect(wizardIsDraft(wiz, null)).toBe(true);
    expect(wizardIsDraft({ ...wiz, step: "town" }, null)).toBe(true);
    store.getState().newGame("tb", { plannedPlayerCount: 5, keepView: true });
    expect(wizardIsDraft({ ...wiz, step: "town" }, game())).toBe(false);
    expect(wizardIsDraft(null, game())).toBe(false);
  });

  it("finds an imported script by its store id, never by name", () => {
    const wiz = { ...ui().wiz ?? { step: "script" as const, script: null, customName: null, count: 10, extras: [], focus: null, xtab: "fabled" as const } };
    const custom = { ...BUILTIN_SCRIPTS.tb!, id: "custom-1", name: "Mine" };
    expect(wizardScript({ ...wiz, script: "custom", customName: "custom-1" }, { "custom-1": custom })?.name).toBe("Mine");
    expect(wizardScript({ ...wiz, script: "custom", customName: "Mine" }, { "custom-1": custom })).toBeNull();
    expect(wizardScript({ ...wiz, script: null }, {})).toBeNull();
  });
});

describe("wizard flow", () => {
  it("New Game opens the wizard on Step I and the newgame view", () => {
    startWizard();
    expect(ui().wiz).toMatchObject({ step: "script", script: null, count: 10, extras: [] });
    expect(store.getState().view).toBe("newgame");
  });

  it("clamps the count to 5..20 and holds Step II until a script is chosen", () => {
    startWizard();
    setWizardCount(2);
    expect(ui().wiz!.count).toBe(5);
    setWizardCount(40);
    expect(ui().wiz!.count).toBe(20);
    wizardTo("extras");
    expect(ui().wiz!.step).toBe("script");
    pickScript();
    wizardTo("extras");
    expect(ui().wiz!.step).toBe("extras");
  });

  it("Home from the wizard leaves no game behind when none was made", () => {
    startWizard();
    wizardHome();
    expect(ui().wiz).toBeNull();
    expect(store.getState().view).toBe("home");
    expect(game()).toBeNull();
  });

  it("Prepare the town creates the real setup game with the planned seats, Fabled and Loric", async () => {
    startWizard();
    pickScript("tb", 7);
    ui().set({ wiz: { ...ui().wiz!, extras: ["angel", "bigwig"] } });
    await act(async () => { await enterTown(); });
    expect(ui().wiz!.step).toBe("town");
    expect(store.getState().view).toBe("game");
    const g = game()!;
    expect(g.phase).toBe("setup");
    expect(g.seatOrder).toHaveLength(7);
    expect(g.fabled).toEqual(["angel"]);
    expect(g.lorics).toEqual(["bigwig"]);
    expect(store.getState().lobby).toBeNull(); // the lobby exists only once "Players join by code" is chosen
  });

  it("Prepare the town without a script creates nothing", async () => {
    startWizard();
    await act(async () => { await enterTown(); });
    expect(game()).toBeNull();
    expect(ui().wiz!.step).toBe("script");
  });

  it("going back from the town discards the untouched setup game; names and dealt roles ask first", async () => {
    startWizard();
    pickScript("tb", 6);
    await act(async () => { await enterTown(); });
    await act(async () => { expect(await leaveTown("extras")).toBe(true); });
    expect(game()).toBeNull();
    expect(ui().wiz!.step).toBe("extras");
    expect(ui().ask).toBeNull();

    await act(async () => { await enterTown(); });
    nameNextSeat("Ada");
    // The question is the Grimoire's own dialog; dismissing it keeps the town.
    let left!: Promise<boolean>;
    act(() => { left = leaveTown("script"); });
    expect(ui().ask?.title).toBe("Go back");
    await act(async () => { const ask = ui().ask!; ui().set({ ask: null }); ask.cancel!(); expect(await left).toBe(false); });
    expect(game()).not.toBeNull();
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe("offline seating", () => {
  const town = async (count = 6) => {
    startWizard();
    pickScript("tb", count);
    await act(async () => { await enterTown(); });
  };

  it("names fill the empty seats in seat order and trim to twenty characters", async () => {
    await town();
    expect(nameNextSeat("   ")).toBe(false);
    expect(nameNextSeat("Ada")).toBe(true);
    expect(nameNextSeat("A very very long player name indeed")).toBe(true);
    const g = game()!;
    expect(g.players[g.seatOrder[0]!]!.name).toBe("Ada");
    expect(g.players[g.seatOrder[1]!]!.name).toHaveLength(20);
    expect(emptySeats(g)).toHaveLength(4);
  });

  it("begins only with five names, and numbers the seats nobody named", async () => {
    await town();
    ["Ada", "Bram", "Cleo", "Dmitri"].forEach(nameNextSeat);
    expect(beginOffline()).toBe(false);
    expect(useSetupFlow.getState().gathered).toBe(false);
    nameNextSeat("Elspeth");
    expect(beginOffline()).toBe(true);
    expect(useSetupFlow.getState().gathered).toBe(true);
    const g = game()!;
    expect(emptySeats(g)).toHaveLength(0);
    expect(g.players[g.seatOrder[5]!]!.name).toBe("Player 6");
  });

  it("changes the plan in lockstep with physical seats and refuses to drop below five or release a named seat", async () => {
    await town(5);
    changeSeatCount(-1);
    expect(game()!.seatOrder).toHaveLength(5);
    changeSeatCount(1);
    expect(game()!.seatOrder).toHaveLength(6);
    changeSeatCount(-1);
    expect(game()!.seatOrder).toHaveLength(5);
  });

  it("never seats an arrival by itself: the waiting queue only grows from pending players", async () => {
    await town();
    expect(waitingOf(game())).toEqual([]);
    store.getState().addToPendingQueue("uid-1", "Wren");
    store.getState().addToPendingQueue("uid-2", "Sol");
    expect(waitingOf(game()).map((w) => w.name)).toEqual(["Wren", "Sol"]); // arrival order
    expect(emptySeats(game()!)).toHaveLength(6); // the Storyteller seats them; nothing does it automatically
  });
});
