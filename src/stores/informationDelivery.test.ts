import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { setupScript } from "@/test/setupFixtures";
import { projectLobbyToPublic, projectLobbyToSelfMap, projectToPublic, projectToSelf } from "./projections";
import { validateInformationValues, validateRequirementsCoherent } from "./informationDelivery";
import type { InformationAction, InformationValue } from "./types";

// Phase 9D.3: Role Information & Delivery system. Silverwick understands
// a Role's Information Actions and Information Requirements from Role
// data alone; the Storyteller remains the sole authority on what
// information was actually communicated. Each `it` below names the exact
// requirement it proves.

const registry = buildRegistry(setupScript);
const game = () => store.getState().game!;
const state = () => store.getState();
const deliveries = () => game().informationDeliveries;

beforeEach(() => store.setState({
  game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript },
}));

/** Minimal Setup: no deal/reveal machinery -- recordInformationDelivery
 * does not gate on phase (Phase 9D.3 Section 14: it is not a History
 * Mutation), so tests only need a seated player with a forced Actual Role. */
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

describe("Phase 9D.3: different BOTC Information Requirements resolve from Role data", () => {
  it("Chef: a Number-only Information Requirement", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ]);
    expect(result.ok).toBe(true);
  });

  it("Washerwoman: a Players + Role Information Requirement", () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    const p2 = game().seatOrder[1]!;
    const p3 = game().seatOrder[2]!;
    atNight(1);
    const result = state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [p2, p3] },
      { requirementId: "role", kind: "role", roleId: "empath" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("Ravenkeeper: a single Player + Role Information Requirement (distinct cardinality from Washerwoman)", () => {
    freshGame();
    const id = seatAs(0, "ravenkeeper");
    const target = game().seatOrder[1]!;
    atNight(2);
    const result = state().recordInformationDelivery(id, "ravenkeeper-triggered", [
      { requirementId: "chosenPlayer", kind: "player", playerIds: [target] },
      { requirementId: "role", kind: "role", roleId: "imp" },
    ]);
    expect(result.ok).toBe(true);
  });

  it("Fortune Teller: a Players + Boolean Information Requirement", () => {
    freshGame();
    const id = seatAs(0, "fortuneteller");
    const p2 = game().seatOrder[1]!;
    const p3 = game().seatOrder[2]!;
    atNight(1);
    const result = state().recordInformationDelivery(id, "fortuneteller-first-night", [
      { requirementId: "players", kind: "player", playerIds: [p2, p3] },
      { requirementId: "isDemon", kind: "boolean", value: false },
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("Phase 9D.3: Role data resolution -- never a production Role-id branch", () => {
  it("resolves Information Actions from RoleRegistry.informationActionsOf, backed by centralized Role data", () => {
    const actions = registry.informationActionsOf("chef");
    expect(actions).toHaveLength(1);
    expect(actions[0]!.id).toBe("chef-first-night");
    expect(actions[0]!.requirements).toEqual([{ id: "pairs", kind: "number", label: "Number of evil pairs" }]);
  });

  it("an unknown Role id resolves to no Information Actions, never a thrown error", () => {
    expect(registry.informationActionsOf("not-a-real-role")).toEqual([]);
  });

  it("a Role's own informationActions (e.g. a homebrew script) take precedence over the centralized canonical map", () => {
    const customAction: InformationAction = {
      id: "custom-action", timing: { kind: "manual" },
      requirements: [{ id: "note", kind: "text" }],
    };
    const homebrewScript = {
      ...setupScript,
      characters: setupScript.characters.map((c) =>
        c.id === "chef" ? { ...c, informationActions: [customAction] } : c
      ),
    };
    const homebrewRegistry = buildRegistry(homebrewScript);
    expect(homebrewRegistry.informationActionsOf("chef")).toEqual([customAction]);
  });

  it("recordInformationDelivery itself contains no Role-id conditional -- it works identically for any Role with structured actions", () => {
    freshGame();
    const chefId = seatAs(0, "chef");
    const washerwomanId = seatAs(1, "washerwoman");
    atNight(1);
    const chefResult = state().recordInformationDelivery(chefId, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 2 },
    ]);
    const wwResult = state().recordInformationDelivery(washerwomanId, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [chefId, game().seatOrder[2]!] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(chefResult.ok).toBe(true);
    expect(wwResult.ok).toBe(true);
    expect(deliveries()).toHaveLength(2);
  });
});

describe("Phase 9D.3: structural validation", () => {
  it("correct Information Values are accepted", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    expect(state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 0 },
    ]).ok).toBe(true);
  });

  it("an incorrect Information Value type is rejected", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "boolean", value: true } as unknown as InformationValue,
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });

  it("incorrect cardinality (too few Players) is rejected", () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    atNight(1);
    const result = state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [game().seatOrder[1]!] }, // only 1, needs exactly 2
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });

  it("a missing required value is rejected as incomplete", () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    atNight(1);
    const result = state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [game().seatOrder[1]!, game().seatOrder[2]!] },
      // "role" omitted entirely
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
  });

  it("validateInformationValues generalizes the same rule across requirement shapes without per-Role code", () => {
    const requirements = [
      { id: "a", kind: "number" as const },
      { id: "b", kind: "player" as const, cardinality: { kind: "atLeast" as const, count: 1 } },
    ];
    expect(validateInformationValues(requirements, [
      { requirementId: "a", kind: "number", value: 3 },
      { requirementId: "b", kind: "player", playerIds: ["x", "y"] },
    ])).toEqual({ ok: true });
    expect(validateInformationValues(requirements, [
      { requirementId: "a", kind: "number", value: 3 },
      { requirementId: "b", kind: "player", playerIds: [] },
    ]).ok).toBe(false);
  });
});

describe("Phase 9D.3: Information Delivery Record", () => {
  it("a successful command creates exactly one record with Recipient, Actual Role snapshot, Action, values, and Game Moment", () => {
    freshGame();
    const id = seatAs(0, "undertaker");
    atNight(3);
    const result = state().recordInformationDelivery(id, "undertaker-other-night", [
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(result.ok).toBe(true);
    expect(deliveries()).toHaveLength(1);
    const record = deliveries()[0]!;
    expect(record).toMatchObject({
      recipientPlayerId: id,
      actualRole: "undertaker",
      informationActionId: "undertaker-other-night",
      values: [{ requirementId: "role", kind: "role", roleId: "chef" }],
      moment: { phase: "night", day: 3 },
    });
    expect(result.ok && result.id).toBe(record.id);
  });
});

describe("Phase 9D.3: Storyteller Authority", () => {
  it("structurally valid Storyteller-provided information is stored even when it contradicts Current State", () => {
    freshGame();
    // Fortune Teller's real alignment says the two chosen players are both
    // good -- the Storyteller nonetheless records "yes, one is the Demon"
    // (a red herring / false positive is a legitimate BOTC outcome).
    const id = seatAs(0, "fortuneteller");
    const good1 = seatAs(1, "chef");
    const good2 = seatAs(2, "washerwoman");
    atNight(1);
    const result = state().recordInformationDelivery(id, "fortuneteller-first-night", [
      { requirementId: "players", kind: "player", playerIds: [good1, good2] },
      { requirementId: "isDemon", kind: "boolean", value: true }, // mechanically "wrong" -- Silverwick does not object
    ]);
    expect(result.ok).toBe(true);
    expect(deliveries()[0]!.values).toContainEqual({ requirementId: "isDemon", kind: "boolean", value: true });
  });
});

describe("Phase 9D.3: Actual Role stability", () => {
  it("a prior Information Delivery Record keeps identifying the original Actual Role after it changes", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ]);
    const originalRecord = deliveries()[0]!;

    state().assignRole(id, "washerwoman"); // Current State moves on
    expect(game().players[id]!.actualRole).toBe("washerwoman");

    expect(deliveries()).toHaveLength(1);
    expect(deliveries()[0]).toEqual(originalRecord);
    expect(deliveries()[0]!.actualRole).toBe("chef");
    expect(deliveries()[0]!.informationActionId).toBe("chef-first-night");
    expect(deliveries()[0]!.values).toEqual([{ requirementId: "pairs", kind: "number", value: 1 }]);
  });
});

describe("Phase 9D.3: Provenance", () => {
  it("supplied Provenance is preserved on the Information Delivery Record", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const provenance = { reason: "manually re-confirmed with the player" };
    state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ], { provenance });
    expect(deliveries()[0]!.provenance).toEqual(provenance);
  });

  it("absent Mutation Context leaves Provenance uninvented", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ]);
    expect(deliveries()[0]!.provenance).toBeUndefined();
  });
});

describe("Phase 9D.3: corrections", () => {
  it("removeInformationDelivery removes exactly the named record and leaves unrelated Current State unchanged", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const before = structuredClone(game().players);
    const r1 = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ]);
    const r2 = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 2 },
    ]);
    expect(r1.ok && r2.ok).toBe(true);
    expect(deliveries()).toHaveLength(2);

    state().removeInformationDelivery(r1.ok ? r1.id : "");
    expect(deliveries()).toHaveLength(1);
    expect(deliveries()[0]!.id).toBe(r2.ok ? r2.id : "");
    // Unrelated Current State (players) is untouched.
    expect(game().players).toEqual(before);
  });

  it("a correction is remove-then-record-again, producing the corrected value with no leftover of the old one", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const original = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ]);
    expect(original.ok).toBe(true);
    if (original.ok) state().removeInformationDelivery(original.id);
    const corrected = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 2 },
    ]);
    expect(corrected.ok).toBe(true);
    expect(deliveries()).toHaveLength(1);
    expect(deliveries()[0]!.values).toEqual([{ requirementId: "pairs", kind: "number", value: 2 }]);
  });

  it("removing a delivery that does not exist is a safe no-op", () => {
    freshGame();
    state().removeInformationDelivery("not-a-real-id");
    expect(deliveries()).toEqual([]);
  });
});

describe("Phase 9D.3: privacy", () => {
  it("Information Delivery Records never appear in public, self, or lobby-level projections", () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    const p2 = seatAs(1, "chef");
    state().setShownRole(id, "washerwoman"); // so the self projection isn't null
    atNight(1);
    state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [p2, game().seatOrder[2]!] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ], { provenance: { note: "secret-provenance-text" } });
    expect(deliveries().length).toBeGreaterThan(0);

    const pub = projectLobbyToPublic(game(), {});
    expect(pub).not.toHaveProperty("informationDeliveries");
    expect(JSON.stringify(pub)).not.toContain("secret-provenance-text");

    const selfMap = projectLobbyToSelfMap(game(), registry);
    expect(JSON.stringify(selfMap)).not.toContain("informationDeliveries");
    expect(JSON.stringify(selfMap)).not.toContain("secret-provenance-text");

    expect(projectToPublic(game().players[id]!, true)).not.toHaveProperty("informationDeliveries");
    expect(projectToSelf(game().players[id]!, registry)).not.toHaveProperty("informationDeliveries");
  });
});

describe("Phase 9D.3: Undo", () => {
  it("Undo restores Current State and the Information Delivery Record together", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: 1 },
    ]);
    expect(deliveries()).toHaveLength(1);

    state().undo();
    expect(deliveries()).toEqual([]);
  });
});

describe("Phase 9D.3: a freshly created game starts with no Information Deliveries", () => {
  it("newGame initializes an empty collection", () => {
    freshGame();
    expect(deliveries()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 9R.1 (Finding B3): Information validation integrity.
// ---------------------------------------------------------------------------

/** Snapshots every piece of state a rejected command must leave completely
 * unchanged, and asserts nothing moved -- by reference, not merely by deep
 * equality, since that is the strongest possible proof no store mutation
 * (and therefore no Undo push, no localSeq bump, no cloud dirty marking)
 * ever ran. */
function captureAtomicityBaseline() {
  return { game: state().game, undoStack: state().undoStack, localSeq: state().localSeq };
}
function expectUnchangedSince(before: ReturnType<typeof captureAtomicityBaseline>) {
  expect(state().game).toBe(before.game);
  expect(state().undoStack).toBe(before.undoStack);
  expect(state().localSeq).toBe(before.localSeq);
}

describe("Phase 9R.1 Finding B3.1: non-finite Number Information Values are rejected", () => {
  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["-Infinity", -Infinity],
  ])("rejects %s atomically, leaving Current State/History/Deliveries/Undo/localSeq untouched", (_label, value) => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    const before = captureAtomicityBaseline();
    const result = state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
    expect(game().history).toEqual([]);
    expectUnchangedSince(before);
  });

  it("a valid finite number (including 0 and negative values) is still accepted", () => {
    freshGame();
    const id = seatAs(0, "chef");
    atNight(1);
    expect(state().recordInformationDelivery(id, "chef-first-night", [
      { requirementId: "pairs", kind: "number", value: -3 },
    ]).ok).toBe(true);
  });
});

describe("Phase 9R.1 Finding B3.2: Player references must be actual own player records", () => {
  it('rejects an inherited Object.prototype property name ("toString") as a Player reference, atomically', () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    atNight(1);
    const before = captureAtomicityBaseline();
    const result = state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: ["toString", game().seatOrder[1]!] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
    expectUnchangedSince(before);
  });

  it("a genuine, actually-seated Player id is still accepted (the fix never alters valid references)", () => {
    freshGame();
    const id = seatAs(0, "washerwoman");
    const p2 = game().seatOrder[1]!;
    const p3 = game().seatOrder[2]!;
    atNight(1);
    expect(state().recordInformationDelivery(id, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [p2, p3] },
      { requirementId: "role", kind: "role", roleId: "chef" },
    ]).ok).toBe(true);
  });
});

describe("Phase 9R.1 Finding B3.3: scalar Information Values cannot satisfy a multi-value cardinality", () => {
  it("a malformed custom Role declaring a Number requirement with cardinality exactly:2 fails safely rather than silently accepting one scalar value, atomically", () => {
    const malformedAction: InformationAction = {
      id: "malformed-scalar-action", timing: { kind: "manual" },
      requirements: [{ id: "count", kind: "number", cardinality: { kind: "exactly", count: 2 } }],
    };
    const homebrewScript = {
      ...setupScript,
      characters: setupScript.characters.map((c) =>
        c.id === "chef" ? { ...c, informationActions: [malformedAction] } : c
      ),
    };
    store.setState({ customScripts: { [setupScript.id]: setupScript } });
    state().newGame(setupScript.id, { plannedPlayerCount: 3, plannedTravelerCount: 0 });
    for (let i = 0; i < 3; i++) state().addPlayerToSeat("Player " + i);
    // Swap in the homebrew script's Role data for THIS already-created game
    // (a malformed Role definition, not a malformed player input) without
    // going through newGame again.
    store.setState({ customScripts: { [setupScript.id]: homebrewScript } });
    const id = seatAs(0, "chef");
    atNight(1);
    const before = captureAtomicityBaseline();

    const result = state().recordInformationDelivery(id, "malformed-scalar-action", [
      { requirementId: "count", kind: "number", value: 1 },
    ]);
    expect(result.ok).toBe(false);
    expect(deliveries()).toEqual([]);
    expectUnchangedSince(before);
  });

  it("exactly:1 and optional remain coherent for scalar kinds -- and a Player requirement's own multi-value cardinality is untouched by the fix", () => {
    expect(validateRequirementsCoherent([
      { id: "a", kind: "number", cardinality: { kind: "exactly", count: 1 } },
      { id: "b", kind: "text", cardinality: { kind: "optional" } },
      { id: "c", kind: "boolean" }, // no cardinality at all -- implicitly exactly:1, still coherent
      { id: "d", kind: "player", cardinality: { kind: "exactly", count: 2 } }, // Player DOES carry an array
    ])).toEqual({ ok: true });
  });

  it("a scalar requirement declaring atLeast:2 is rejected the same way as exactly:2", () => {
    expect(validateRequirementsCoherent([
      { id: "a", kind: "text", cardinality: { kind: "atLeast", count: 2 } },
    ]).ok).toBe(false);
  });
});
