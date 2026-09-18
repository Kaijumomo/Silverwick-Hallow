import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { setupScript } from "@/test/setupFixtures";
import { validateInformationValues, validateRequirementsCoherent } from "./informationDelivery";
import type { InformationAction } from "./types";

// Phase 9D.4: Authoritative Commands & BOTC Invariants. Silverwick enforces
// known structural/BOTC invariants; the Storyteller retains judgment over
// gameplay decisions. Each `it` names the exact requirement it proves.

const registry = buildRegistry(setupScript);
const game = () => store.getState().game!;
const state = () => store.getState();
const deliveries = () => game().informationDeliveries;

beforeEach(() => store.setState({
  game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript },
}));

function freshGame(count = 5) {
  state().newGame(setupScript.id, { plannedPlayerCount: count, plannedTravelerCount: 0 });
  for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
}

function atNight(day = 1) {
  store.setState({ game: { ...game(), phase: "night", day } });
}

function seatAs(index: number, roleId: string) {
  const id = game().seatOrder[index]!;
  state().assignRole(id, roleId);
  return id;
}

describe("Phase 9D.4: Information Action timing", () => {
  it("a firstNight Action during Night 1 is accepted", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 0 },
    ]);
    expect(result.ok).toBe(true);
  });

  it("a firstNight Action during a later Night is rejected, with no delivery created", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(2);
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 0 },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });

  it("an otherNight Action during a later Night is accepted", () => {
    freshGame();
    const id = seatAs(0, "undertaker");
    atNight(2);
    const result = state().recordInformationDelivery(id, "undertaker-other-night", [
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("an otherNight Action during Night 1 is rejected, with no delivery created", () => {
    freshGame();
    const id = seatAs(0, "undertaker");
    atNight(1);
    const result = state().recordInformationDelivery(id, "undertaker-other-night", [
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });

  it("a triggered Action remains Storyteller-controlled -- accepted on any Night", () => {
    freshGame();
    const id = seatAs(0, "ravenkeeper");
    const target = game().seatOrder[1]!;
    atNight(1); // no fixed cadence is enforced for "triggered"
    const result = state().recordInformationDelivery(id, "ravenkeeper-triggered", [
      { requirementId: "chosenPlayer", kind: "player", playerIds: [target] },
      { requirementId: "role", kind: "role", roleId: "imp" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("a manual-timing Action remains Storyteller-controlled -- accepted at any Game Moment, including Setup", () => {
    const manualAction: InformationAction = {
      id: "manual-action", timing: { kind: "manual" },
      requirements: [{ id: "note", kind: "text" }],
    };
    const homebrewScript = {
      ...setupScript,
      characters: setupScript.characters.map((c) => c.id === "chef" ? { ...c, informationActions: [manualAction] } : c),
    };
    store.setState({ customScripts: { [setupScript.id]: homebrewScript } });
    freshGame(); // still Setup phase -- manual timing is unconstrained
    const id = seatAs(0, "chef");
    const result = state().recordInformationDelivery(id, "manual-action", [
      { requirementId: "note", kind: "text", value: "resolved at will" },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("Phase 9D.4: Player reference integrity", () => {
  it("valid Player references are accepted", () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    const p2 = game().seatOrder[1]!;
    const p3 = game().seatOrder[2]!;
    atNight(1);
    const result = state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [p2, p3] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("an unknown Player reference is rejected, with no delivery created", () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    const p2 = game().seatOrder[1]!;
    atNight(1);
    const result = state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [p2, "not-a-real-player-id"] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });
});

describe("Phase 9D.4: Role reference integrity", () => {
  it("a valid Role reference is accepted", () => {
    freshGame();
    const id = seatAs(0, "undertaker");
    atNight(2);
    const result = state().recordInformationDelivery(id, "undertaker-other-night", [
      { requirementId: "role", kind: "role", roleId: "imp" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("an unknown Role reference is rejected, with no delivery created", () => {
    freshGame();
    const id = seatAs(0, "undertaker");
    atNight(2);
    const result = state().recordInformationDelivery(id, "undertaker-other-night", [
      { requirementId: "role", kind: "role", roleId: "not-a-real-role" },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });
});

describe("Phase 9D.4: Information Requirement integrity", () => {
  it("duplicate Requirement ids within an Information Action are rejected (malformed Role Information fails safely)", () => {
    const malformed: InformationAction = {
      id: "malformed-action", timing: { kind: "manual" },
      requirements: [{ id: "x", kind: "number" }, { id: "x", kind: "boolean" }],
    };
    expect(validateRequirementsCoherent(malformed.requirements)).toEqual({
      ok: false,
      message: expect.stringContaining("duplicate requirement id"),
    });
  });

  it("an invalid cardinality count is rejected", () => {
    const malformed = [{ id: "x", kind: "player" as const, cardinality: { kind: "exactly" as const, count: 0 } }];
    expect(validateRequirementsCoherent(malformed).ok).toBe(false);
  });

  it("duplicate supplied values for the same Requirement are rejected, never silently collapsed", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
      { requirementId: "pairs", kind: "number", value: 2 }, // ambiguous duplicate
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });

  it("a missing required value is rejected", () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    atNight(1);
    const result = state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [game().seatOrder[1]!, game().seatOrder[2]!] },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });

  it("an extra/unknown value is rejected", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
      { requirementId: "not-a-real-requirement", kind: "text", value: "extra" },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });
});

describe("Phase 9D.4: Role Ownership / homebrew boundary", () => {
  it("an official Role resolves the intended canonical Information Actions", () => {
    const actions = registry.informationActionsOf("chef");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.id).toBe("chef-first-night");
  });

  it("a Role's own defined Information Actions override the canonical fallback", () => {
    const override: InformationAction = {
      id: "override", timing: { kind: "manual" }, requirements: [],
    };
    const script = {
      ...setupScript,
      characters: setupScript.characters.map((c) => c.id === "chef" ? { ...c, informationActions: [override] } : c),
    };
    expect(buildRegistry(script).informationActionsOf("chef")).toEqual([override]);
  });

  it("a custom/homebrew Role with an official-looking id does NOT inherit canonical Information Actions", () => {
    // A homebrew "chef" with different ability text and no canonical
    // provenance -- reuses the official id, but is not the official Role.
    const script = {
      ...setupScript,
      characters: setupScript.characters.map((c) =>
        c.id === "chef" ? { id: "chef", name: "Chef", type: "townsfolk" as const, ability: "A completely different homebrew ability." } : c
      ),
    };
    expect(buildRegistry(script).informationActionsOf("chef")).toEqual([]);
  });

  it("a Role stripped of its canonical provenance (but otherwise identical) also gets no fallback -- ownership is never guessed", () => {
    const canonicalChef = registry.get("chef")!;
    const script = {
      ...setupScript,
      characters: setupScript.characters.map((c) =>
        c.id === "chef" ? { ...canonicalChef, provenance: undefined } : c
      ),
    };
    expect(buildRegistry(script).informationActionsOf("chef")).toEqual([]);
  });
});

describe("Phase 9D.4: atomic rejection", () => {
  it("a rejected recordInformationDelivery leaves Current State, Information Deliveries, History, and Undo unchanged", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const beforeGame = game();
    const beforeUndoLength = state().undoStack.length;

    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "boolean", value: true }, // wrong type
    ]);

    expect(result.ok).toBe(false);
    expect(game()).toBe(beforeGame); // same reference -- nothing was ever set()
    expect(deliveries()).toEqual([]);
    expect(game().history).toEqual([]);
    expect(state().undoStack.length).toBe(beforeUndoLength);
  });

  it("a rejected timing violation leaves everything unchanged the same way", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(2); // wrong night for a firstNight Action
    const beforeGame = game();
    const beforeUndoLength = state().undoStack.length;

    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ]);

    expect(result.ok).toBe(false);
    expect(game()).toBe(beforeGame);
    expect(deliveries()).toEqual([]);
    expect(state().undoStack.length).toBe(beforeUndoLength);
  });
});

describe("Phase 9D.4: Storyteller authority is preserved under the new invariants", () => {
  it("a structurally valid but mechanically unusual answer is still accepted", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    // "0 pairs of evil players" in a game that (per Current State) has a
    // minion and a demon seated -- mechanically implausible, structurally
    // fine. Silverwick does not recalculate or reject it.
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 0 },
    ]);
    expect(result.ok).toBe(true);
    expect(deliveries()[0]!.values).toEqual([{ requirementId: "pairs", kind: "number", value: 0 }]);
  });
});

describe("Phase 9D.4: existing Authoritative Mutation Command regression", () => {
  it("Actual Role (assignRole): accepted change and true no-op both behave as in 9D.1-9D.3", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const beforeGame = game();
    state().assignRole(id, "chef"); // no-op: identical role
    expect(game()).toBe(beforeGame);
    expect(game().history).toEqual([]);

    state().assignRole(id, "imp"); // real change
    expect(game().players[id]!.actualRole).toBe("imp");
    expect(game().history).toHaveLength(1);
  });

  it("Actual Alignment (setActualAlignment): accepted change and true no-op both behave as in 9D.1-9D.3", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const current = game().players[id]!.actualAlignment!;
    const beforeGame = game();
    state().setActualAlignment(id, current); // no-op
    expect(game()).toBe(beforeGame);

    const next = current === "evil" ? "good" : "evil";
    state().setActualAlignment(id, next);
    expect(game().players[id]!.actualAlignment).toBe(next);
    expect(game().history).toHaveLength(1);
  });

  it("Life State (setAlive/setGhostVote): a true no-op now leaves Current State and Undo untouched, not only History", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const beforeGame = game();
    const beforeUndoLength = state().undoStack.length;

    state().setAlive(id, true); // already alive, never exiled -- true no-op
    expect(game()).toBe(beforeGame);
    expect(state().undoStack.length).toBe(beforeUndoLength);

    state().setGhostVote(id, game().players[id]!.ghostVote); // true no-op
    expect(game()).toBe(beforeGame);
    expect(state().undoStack.length).toBe(beforeUndoLength);

    state().setAlive(id, false); // real change
    expect(game().players[id]!.alive).toBe(false);
    expect(game().history).toHaveLength(1);
  });

  it("Effect (setStatus/addEffect): a true no-op now leaves Current State and Undo untouched, not only History", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    state().setStatus(id, "poisoned", true);
    const afterFirstToggle = game();
    const undoLengthAfterFirst = state().undoStack.length;

    state().setStatus(id, "poisoned", true); // identical manual effect already active -- true no-op
    expect(game()).toBe(afterFirstToggle);
    expect(state().undoStack.length).toBe(undoLengthAfterFirst);

    state().setStatus(id, "poisoned", false); // real change
    expect(game().players[id]!.effects).toEqual([]);
  });

  it("Reminder (addReminder): existing accepted/duplicate behavior is preserved", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const a = state().addReminder(id, { label: "Poisoned", lifetime: { kind: "manual" } });
    const b = state().addReminder(id, { label: "Poisoned", lifetime: { kind: "manual" } }); // distinct label, distinct auto id -- still two records
    expect(a).not.toBe(b);
    expect(game().players[id]!.reminders).toHaveLength(2);
  });
});

describe("Phase 9D.4: validateInformationValues generalizes reference integrity across shapes", () => {
  it("rejects an unknown player id and an unknown role id independently of any specific Role", () => {
    const requirements = [
      { id: "p", kind: "player" as const },
      { id: "r", kind: "role" as const },
    ];
    const knownPlayers = { has: (id: string) => id === "real-player" };
    const knownRoles = { has: (id: string) => id === "real-role" };
    expect(validateInformationValues(requirements, [
      { requirementId: "p", kind: "player", playerIds: ["real-player"] },
      { requirementId: "r", kind: "role", roleId: "real-role" },
    ], { playerIds: knownPlayers, roleIds: knownRoles })).toEqual({ ok: true });
    expect(validateInformationValues(requirements, [
      { requirementId: "p", kind: "player", playerIds: ["fake-player"] },
      { requirementId: "r", kind: "role", roleId: "real-role" },
    ], { playerIds: knownPlayers, roleIds: knownRoles }).ok).toBe(false);
  });
});
