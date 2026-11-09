import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { setupGame, setupScript, standardRoles } from "@/test/setupFixtures";
import { makeSTPlayer } from "@/test/fixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const stagedPool = ["chef", "empath", "monk", "scarletwoman", "imp"];

// The central commit seam intentionally rotates reveal tokens when Undo
// restores a different visible identity. Every other game field is restored.
function withoutRevealTokens(value: StorytellerLobbyRecord) {
  const copy = structuredClone(value);
  for (const player of Object.values(copy.players)) delete player.revealToken;
  return copy;
}

function prepare(withTraveler = false) {
  const next = setupGame(standardRoles(5), { rolePool: standardRoles(5), notes: "Preserve my setup notes." });
  for (const player of Object.values(next.players)) {
    player.actualRole = "";
    player.shownRole = null;
    player.shownAlignment = null;
  }
  if (withTraveler) {
    next.players.traveler = makeSTPlayer({
      id: "traveler", name: "Lior", seat: 5, isTraveler: true,
      actualRole: "thief", shownRole: "thief", actualAlignment: "evil", shownAlignment: "evil",
      stNotes: "Traveler notes", reminders: [{ id: "traveler-note", label: "Custom reminder" }],
    });
    next.seatOrder.push("traveler");
    next.plannedPlayerCount = 6;
    next.plannedTravelerCount = 1;
  }
  store.setState({ game: next });
}

beforeEach(() => {
  localStorage.clear();
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript } });
  prepare();
});
afterEach(() => vi.restoreAllMocks());

describe("staged role distribution", () => {
  it.each([
    ["empty", []],
    ["too few", stagedPool.slice(1)],
    ["too many", [...stagedPool, "washerwoman"]],
    ["unknown character", ["unknown", ...stagedPool.slice(1)]],
    ["Traveler in resident bag", ["thief", ...stagedPool.slice(1)]],
  ])("refuses an invalid %s draft without touching current pool, assignments, or Undo", (_name, pool) => {
    const before = state();
    const snapshot = structuredClone(game());
    const random = vi.spyOn(Math, "random");
    expect(state().dealRolePool(pool as string[]).ok).toBe(false);
    expect(state()).toBe(before);
    expect(game()).toEqual(snapshot);
    expect(state().undoStack).toBe(before.undoStack);
    expect(random).not.toHaveBeenCalled();
  });

  it("commits the staged draft and randomized resident assignments together, leaving the Traveler intact", () => {
    prepare(true);
    const before = structuredClone(game());
    const traveler = game().players.traveler;
    const draft = [...stagedPool];
    // A zero Fisher-Yates source rotates the supplied bag left by one.
    vi.spyOn(Math, "random").mockReturnValue(0);
    const updates: unknown[] = [];
    const unsubscribe = store.subscribe(next => updates.push(next.game));
    try {
      expect(state().dealRolePool(draft)).toEqual({ ok: true });
    } finally {
      unsubscribe();
    }
    expect(updates).toHaveLength(1);
    expect(game()).toMatchObject({ setupRolesDealt: true, setupRolesRevealed: false, phase: "setup", day: 0, rolePool: [] });
    const residentRoles = game().seatOrder.filter(id => id !== "traveler").map(id => game().players[id]!.actualRole);
    expect(residentRoles).toEqual([...stagedPool.slice(1), stagedPool[0]]);
    expect(game().players.traveler).toBe(traveler);
    expect(game().seatOrder).toEqual(before.seatOrder);
    for (const id of game().seatOrder) {
      expect(game().players[id]!.participantId).toBe(before.players[id]!.participantId);
      expect(game().players[id]!.name).toBe(before.players[id]!.name);
      expect(game().players[id]!.seat).toBe(before.players[id]!.seat);
    }
    expect(draft).toEqual(stagedPool);
    expect(state().undoStack).toEqual([before]);
    const dealt = structuredClone(game());
    state().undo();
    expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(before));
    for (const id of game().seatOrder.filter(id => id !== "traveler")) {
      expect(game().players[id]!.revealToken).toBeTruthy();
      expect(game().players[id]!.revealToken).not.toBe(dealt.players[id]!.revealToken);
    }
    expect(state().undoStack).toEqual([]);
  });

  it("allows another staged deal before Reveal and undoes it in one step", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.999999);
    expect(state().dealRolePool(stagedPool).ok).toBe(true);
    const first = structuredClone(game());
    const priorUndo = [...state().undoStack];
    const second = ["washerwoman", "librarian", "investigator", "poisoner", "imp"];
    expect(state().dealRolePool(second).ok).toBe(true);
    expect(game().seatOrder.map(id => game().players[id]!.actualRole)).toEqual(second);
    expect(game().setupRolesRevealed).toBe(false);
    expect(state().undoStack).toEqual([...priorUndo, first]);
    const redealt = structuredClone(game());
    state().undo();
    expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(first));
    for (const id of game().seatOrder) {
      if (first.players[id]!.shownRole === redealt.players[id]!.shownRole) continue;
      expect(game().players[id]!.revealToken).not.toBe(redealt.players[id]!.revealToken);
      expect(game().players[id]!.revealToken).not.toBe(first.players[id]!.revealToken);
    }
    expect(state().undoStack).toEqual(priorUndo);
  });

  it("rejects a stale staged draft if a resident leaves before Distribute", () => {
    const draft = [...stagedPool];
    state().unseatPlayer(game().seatOrder[0]!);
    const before = state();
    expect(state().dealRolePool(draft).ok).toBe(false);
    expect(state()).toBe(before);
  });

  it.each(["revealed", "night", "day", "returned to setup"] as const)("cannot distribute a new draft after %s", stage => {
    expect(state().dealRolePool(stagedPool).ok).toBe(true);
    expect(state().revealRoles().ok).toBe(true);
    if (stage !== "revealed") {
      expect(state().beginNightOne().ok).toBe(true);
      if (stage === "day") state().setPhase("day");
      if (stage === "returned to setup") state().setPhase("setup");
    }
    const before = state();
    const result = state().dealRolePool(standardRoles(5));
    expect(result).toMatchObject({ ok: false, message: "Role distribution is only available during private setup." });
    expect(state()).toBe(before);
  });
});
