import { describe, expect, it } from "vitest";
import { canRefineSetup, matchBagToAssignments } from "./setupRefinement";
import type { StorytellerLobbyRecord } from "@/stores/types";

const baseGame = (over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord => ({
  code: "", storytellerUid: "local", scriptId: "tb", phase: "setup", day: 0,
  players: {}, seatOrder: [], rolePool: [], plannedPlayerCount: 5,
  fabled: [], lorics: [], bluffs: [], notes: "", nightProgress: {}, pendingPlayers: {},
  ...over,
});

describe("canRefineSetup", () => {
  it("refuses before the initial Deal", () => {
    expect(canRefineSetup(baseGame({ rolePool: ["chef"] })).ok).toBe(false);
  });
  it("allows exactly the post-Deal, pre-Reveal window", () => {
    expect(canRefineSetup(baseGame({ setupRolesDealt: true, setupRolesRevealed: false })).ok).toBe(true);
  });
  it("W. refuses once the initial Reveal has completed", () => {
    expect(canRefineSetup(baseGame({ setupRolesDealt: true, setupRolesRevealed: true })).ok).toBe(false);
  });
  it("refuses outside Setup phase entirely", () => {
    expect(canRefineSetup(baseGame({ phase: "night", day: 1, setupRolesDealt: true })).ok).toBe(false);
  });
});

describe("matchBagToAssignments", () => {
  it("null when staged length does not match current assignment count", () => {
    expect(matchBagToAssignments(
      [{ playerId: "a", role: "chef" }],
      ["chef", "empath"],
    )).toBeNull();
  });

  it("P. a one-for-one replacement changes only the affected seat", () => {
    const current = [
      { playerId: "amy", role: "chef" },
      { playerId: "ben", role: "empath" },
      { playerId: "chris", role: "monk" },
      { playerId: "dana", role: "poisoner" },
      { playerId: "eric", role: "imp" },
    ];
    const staged = ["chef", "empath", "monk", "baron", "imp"];
    const result = matchBagToAssignments(current, staged)!;
    const byId = new Map(result.map(r => [r.playerId, r]));
    expect(byId.get("amy")).toMatchObject({ role: "chef", changed: false });
    expect(byId.get("ben")).toMatchObject({ role: "empath", changed: false });
    expect(byId.get("chris")).toMatchObject({ role: "monk", changed: false });
    expect(byId.get("eric")).toMatchObject({ role: "imp", changed: false });
    expect(byId.get("dana")).toMatchObject({ role: "baron", changed: true });
    expect(result.filter(r => r.changed)).toHaveLength(1);
  });

  it("Q. multiple replacements pair affected seats to added roles in stable, deterministic order", () => {
    const current = [
      { playerId: "amy", role: "chef" },
      { playerId: "ben", role: "empath" },
      { playerId: "chris", role: "monk" },
      { playerId: "dana", role: "poisoner" },
      { playerId: "eric", role: "imp" },
    ];
    // Remove Empath + Poisoner; add Fortuneteller + Baron, in that order.
    const staged = ["chef", "fortuneteller", "monk", "baron", "imp"];
    const result = matchBagToAssignments(current, staged)!;
    const byId = new Map(result.map(r => [r.playerId, r]));
    expect(byId.get("amy")).toMatchObject({ role: "chef", changed: false });
    expect(byId.get("chris")).toMatchObject({ role: "monk", changed: false });
    expect(byId.get("eric")).toMatchObject({ role: "imp", changed: false });
    // Affected seats in original seat order (ben, dana) pair with added
    // roles in staged order (fortuneteller, baron) -- never re-sorted.
    expect(byId.get("ben")).toMatchObject({ role: "fortuneteller", changed: true });
    expect(byId.get("dana")).toMatchObject({ role: "baron", changed: true });

    // Re-running with the same inputs is fully deterministic.
    const again = matchBagToAssignments(current, staged)!;
    expect(again).toEqual(result);
  });

  it("R. duplicate-occurrence roles are matched by multiset count, not merely by role id", () => {
    const current = [
      { playerId: "a", role: "villageidiot" },
      { playerId: "b", role: "villageidiot" },
      { playerId: "c", role: "villageidiot" },
      { playerId: "d", role: "poisoner" },
      { playerId: "e", role: "imp" },
    ];
    // Drop one Village Idiot occurrence, add a Chef.
    const staged = ["villageidiot", "villageidiot", "chef", "poisoner", "imp"];
    const result = matchBagToAssignments(current, staged)!;
    const byId = new Map(result.map(r => [r.playerId, r]));
    // Exactly one of the three Village Idiot holders changes -- the last in
    // seat order, since the first two occurrences are consumed as "kept".
    expect(byId.get("a")).toMatchObject({ role: "villageidiot", changed: false });
    expect(byId.get("b")).toMatchObject({ role: "villageidiot", changed: false });
    expect(byId.get("c")).toMatchObject({ role: "chef", changed: true });
    expect(byId.get("d")).toMatchObject({ role: "poisoner", changed: false });
    expect(byId.get("e")).toMatchObject({ role: "imp", changed: false });
    expect(result.filter(r => r.changed)).toHaveLength(1);
  });

  it("an unchanged bag reports every seat as unaffected", () => {
    const current = [{ playerId: "a", role: "chef" }, { playerId: "b", role: "imp" }];
    const result = matchBagToAssignments(current, ["chef", "imp"])!;
    expect(result.every(r => !r.changed)).toBe(true);
  });

  it("preserves every occurrence when the staged bag is identical but reordered", () => {
    const current = [
      { playerId: "a", role: "chef" },
      { playerId: "b", role: "empath" },
      { playerId: "c", role: "imp" },
    ];
    const result = matchBagToAssignments(current, ["imp", "chef", "empath"])!;
    expect(result.every(r => !r.changed)).toBe(true);
  });
});
