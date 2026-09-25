import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { buildRegistry } from "@/data/roleRegistry";
import { needsShownIdentity } from "./identity";
import { projectLobbyToPublic, projectLobbyToSelfMap, projectToPublic, projectToSelf } from "./projections";
import { diffFields, provenanceOf, recordIfLive } from "./history";
import { participantRefOf } from "./participants";

// Phase 9D.2: generic live-game history/provenance. Current state remains
// authoritative -- history is explanatory bookkeeping only. Each `it` below
// names the exact architectural requirement it proves; several deliberately
// use more than one domain (role/alignment/life/effect/reminder) to
// demonstrate the mechanism is generic, not hard-coded to one example.

const registry = buildRegistry(setupScript);
const game = () => store.getState().game!;
const state = () => store.getState();
const history = () => game().history;
/** Phase 9R.2: the durable participant snapshot a History Record about the
 * CURRENT occupant of `id` must carry (participantId + seat + name now). */
const participantOf = (id: string) => {
  const ref = participantRefOf(game(), id);
  expect(ref).not.toBeNull();
  return ref!;
};

beforeEach(() => store.setState({
  game: null, lobby: null, undoStack: [], customScripts: { [setupScript.id]: setupScript },
}));

function newPlan(total: number, travelers = 0) {
  state().newGame(setupScript.id, { plannedPlayerCount: total, plannedTravelerCount: travelers });
}

function dealtGame(count = 7) {
  newPlan(count);
  for (let i = 0; i < count; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(count));
  expect(state().dealRolePool().ok).toBe(true);
}

/** Advances a freshly dealt Setup game into live play, past the point
 * where any Setup-only command remains reachable. */
function goLive() {
  for (const id of game().seatOrder) {
    const actualRole = game().players[id]!.actualRole;
    if (!actualRole) continue; // Travelers/unseated -- not part of the ordinary bag
    if (needsShownIdentity(actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
}

describe("Phase 9D.2: generic scalar/state mutation", () => {
  it("an eligible live mutation (role) creates exactly one record with correct player, previous/resulting state, and moment", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const before = game().players[id]!.actualRole;
    const target = before === "imp" ? "chef" : "imp"; // guaranteed distinct regardless of the random deal
    state().assignRole(id, target);
    expect(history()).toHaveLength(1);
    const entry = history()[0]!;
    expect(entry.category).toBe("role");
    expect(entry.participant).toEqual(participantOf(id));
    expect(entry.participant).toMatchObject({ kind: "participant", playerId: id });
    expect(entry.change).toEqual({ kind: "value", from: { actualRole: before }, to: { actualRole: target } });
    expect(entry.moment).toEqual({ phase: "night", day: 1 });
  });

  it("an eligible live mutation (alignment) creates exactly one record", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const before = game().players[id]!.actualAlignment;
    const next = before === "evil" ? "good" : "evil";
    state().setActualAlignment(id, next);
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      category: "alignment", participant: participantOf(id),
      change: { kind: "value", from: { actualAlignment: before }, to: { actualAlignment: next } },
    });
  });

  it("old value -> same value creates no record", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const current = game().players[id]!.actualAlignment!;
    state().setActualAlignment(id, current);
    expect(history()).toEqual([]);
    state().assignRole(id, game().players[id]!.actualRole);
    expect(history()).toEqual([]);
  });
});

describe("Phase 9D.2: structured record mutation (generic across semantic types)", () => {
  it("adding a structured effect produces history with a stable snapshot of the item", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true);
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      category: "effect", participant: participantOf(id),
      change: { kind: "added", item: { id: "manual:poisoned", type: "poisoned", lifetime: { kind: "manual" } } },
    });
  });

  it("removing a structured effect produces history with a snapshot of the removed item", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "protected", true);
    state().setStatus(id, "protected", false);
    expect(history()).toHaveLength(2);
    expect(history()[1]).toMatchObject({
      category: "effect", participant: participantOf(id),
      change: { kind: "removed", item: { id: "manual:protected", type: "protected" } },
    });
  });

  it("adding a structured reminder (a different semantic type) also produces history with a stable snapshot", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const reminderId = state().addReminder(id, { label: "Red Herring", lifetime: { kind: "manual" } })!;
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      category: "reminder", participant: participantOf(id),
      change: { kind: "added", item: { id: reminderId, label: "Red Herring" } },
    });
    state().removeReminder(id, reminderId);
    expect(history()).toHaveLength(2);
    expect(history()[1]).toMatchObject({
      category: "reminder", participant: participantOf(id),
      change: { kind: "removed", item: { id: reminderId, label: "Red Herring" } },
    });
  });

  it("re-adding an already-identical structured item (idempotent) creates no duplicate history", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "drunk", true);
    state().setStatus(id, "drunk", true); // same moment, same shape -- idempotent
    expect(history()).toHaveLength(1);
  });

  it("removing something that does not exist creates no fabricated history", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", false); // never was on
    state().removeReminder(id, "not-a-real-id");
    state().removeEffect(id, "not-a-real-id");
    expect(history()).toEqual([]);
  });
});

describe("Phase 9D.2: provenance", () => {
  it("retains supplied provenance (via an effect's own source fields)", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const source = game().seatOrder[1]!;
    state().addEffect(id, {
      type: "poisoned", sourceCharacter: "poisoner", sourcePlayer: source, lifetime: { kind: "untilDawn" },
    });
    expect(history()[0]!.provenance).toEqual({ sourceCharacter: "poisoner", sourceParticipant: participantOf(source) });
  });

  it("leaves provenance absent -- never invented -- when nothing is known", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true); // a manual toggle: no source player/character
    expect(history()[0]!.provenance).toBeUndefined();
    state().setActualAlignment(id, game().players[id]!.actualAlignment === "evil" ? "good" : "evil");
    expect(history()[1]!.provenance).toBeUndefined();
  });
});

describe("Phase 9D.2: Setup boundary", () => {
  it("Setup mutations across multiple domains (role, effect, reminder) never populate history", () => {
    dealtGame(); // the initial deal itself -- role domain, Setup phase
    expect(history()).toEqual([]);
    const id = game().seatOrder[0]!;
    expect(state().replaceSetupRole(id, "imp").ok).toBe(true); // Setup refinement -- role domain
    state().setStatus(id, "poisoned", true); // effect domain, still Setup
    state().addReminder(id, { label: "Note", lifetime: { kind: "manual" } }); // reminder domain, still Setup
    state().setAlive(id, false); // life domain, still Setup
    expect(history()).toEqual([]);
  });

  it("the equivalent live-game mutations, once Night/Day has begun, do produce history", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true);
    state().addReminder(id, { label: "Note", lifetime: { kind: "manual" } });
    state().setAlive(id, false);
    expect(history().map((h) => h.category)).toEqual(["effect", "reminder", "life"]);
  });
});

describe("Phase 9D.2: semantic action deduplication", () => {
  it("one semantic command (kill: alive+ghostVote+exiled together) produces exactly one record, not several", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setAlive(id, false);
    expect(history()).toHaveLength(1);
    expect(history()[0]!.change).toEqual({ kind: "value", from: { alive: true }, to: { alive: false } });

    state().setAlive(id, true); // revival also resets ghostVote -- still one record
    expect(history()).toHaveLength(2);
    expect(history()[1]!.change).toMatchObject({ kind: "value", to: { alive: true } });
  });

  it("exile (a distinct semantic action from generic death) is its own single record, not collapsed into a plain life change", () => {
    dealtGame(6);
    goLive();
    // A late arrival defaults to a Traveler (unchanged Phase 9B behavior).
    state().addPlayerToSeat("Late Traveler");
    const id = game().seatOrder.at(-1)!;
    expect(game().players[id]!.isTraveler).toBe(true);
    state().assignRole(id, "thief");
    // Phase 10A: exile is Day-only and is its own Life Event kind.
    expect(state().advancePhase().ok).toBe(true);
    expect(state().recordExile(id, "died").ok).toBe(true);
    const lifeEntries = history().filter((h) => h.category === "life");
    expect(lifeEntries).toHaveLength(1);
    const entry = lifeEntries[0]!;
    // The presence of `exiled` in the change payload -- and the exile Life
    // Event it mirrors -- distinguishes this from a plain kill.
    expect(entry.change).toEqual({
      kind: "value", from: { alive: true, exiled: false }, to: { alive: false, exiled: true },
    });
    expect(entry.lifeEvent?.added).toMatchObject({ kind: "exile", outcome: "died", moment: { phase: "day", day: 1 } });
  });
});

describe("Phase 9D.2: centralized command behavior", () => {
  it("the existing UI-facing setStatus command produces history through the authoritative path alone -- no second logging call", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "protected", true);
    expect(history()).toHaveLength(1);
    expect(history()[0]!.category).toBe("effect");
  });

  it("the existing UI-facing addReminder/removeReminder commands produce history without any UI-layer bookkeeping call", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const rid = state().addReminder(id, { label: "Chosen", lifetime: { kind: "manual" } })!;
    state().removeReminder(id, rid);
    expect(history()).toHaveLength(2);
    expect(history().map((h) => h.change!.kind)).toEqual(["added", "removed"]);
  });
});

describe("Phase 9D.2: Undo", () => {
  it("Undo restores current state and its history entry together", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true);
    expect(history()).toHaveLength(1);
    expect(game().players[id]!.effects).toHaveLength(1);

    state().undo();
    expect(history()).toEqual([]);
    expect(game().players[id]!.effects).toEqual([]);
  });

  it("Undo across multiple mutations peels off exactly the most recent state+history pair", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true);
    state().setStatus(id, "drunk", true);
    expect(history()).toHaveLength(2);

    state().undo();
    expect(history()).toHaveLength(1);
    expect(history()[0]!.change).toMatchObject({ item: { type: "poisoned" } });
    expect(game().players[id]!.effects.map((e) => e.type)).toEqual(["poisoned"]);
  });
});

describe("Phase 9D.2: historical stability", () => {
  it("a recorded entry remains meaningful after the affected player's current state changes further", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const originalRole = game().players[id]!.actualRole;
    // Guaranteed distinct from whatever was originally dealt, and from
    // each other, regardless of the random deal outcome.
    const firstRole = originalRole === "imp" ? "chef" : "imp";
    const secondRole = firstRole === "imp" ? "chef" : "imp";
    state().assignRole(id, firstRole);
    const firstEntry = history()[0]!;
    state().assignRole(id, secondRole); // change again
    expect(history()).toHaveLength(2);
    // The first entry's snapshot never mutates just because current state moved on.
    expect(history()[0]).toEqual(firstEntry);
    expect(firstEntry.change).toEqual({ kind: "value", from: { actualRole: originalRole }, to: { actualRole: firstRole } });
  });

  it("a recorded entry survives the affected player being removed from the active roster", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true);
    expect(history()).toHaveLength(1);
    const before = history()[0];

    state().unseatPlayer(id);
    expect(game().players[id]!.isEmpty).toBe(true);
    expect(game().players[id]!.effects).toEqual([]); // current truth moved on
    // The historical record is untouched -- it describes what was true then.
    expect(history()).toEqual([before]);
  });
});

describe("Phase 9D.2: migration/persistence — covered further in storytellerStore.test.ts and sync.test.ts", () => {
  it("a freshly created game starts with empty history", () => {
    newPlan(5);
    expect(game().history).toEqual([]);
  });
});

describe("Phase 9D.2: privacy", () => {
  it("history never appears in the public lobby projection or any player's self projection", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true);
    state().addReminder(id, { label: "Secret", note: "ST-only", lifetime: { kind: "manual" } });
    state().setActualAlignment(id, "evil");
    expect(history().length).toBeGreaterThan(0);

    const pub = projectLobbyToPublic(game(), {});
    expect(pub).not.toHaveProperty("history");
    expect(JSON.stringify(pub)).not.toContain("history");

    const selfMap = projectLobbyToSelfMap(game(), registry);
    expect(JSON.stringify(selfMap)).not.toContain("history");

    expect(projectToPublic(game().players[id]!, true)).not.toHaveProperty("history");
    expect(projectToSelf(game().players[id]!, registry)).not.toHaveProperty("history");
  });
});

describe("Phase 9D.2: extensibility", () => {
  it("a brand-new mutation/provenance combination gets correct history through the existing generic mechanism alone", () => {
    // Simulates a hypothetical future (Phase 10) workflow that has never
    // been wired into any existing store command -- it only ever calls the
    // same recordIfLive/diffFields/provenanceOf primitives every other
    // command already uses. No new array, id scheme, moment concept,
    // dedup rule, or persistence path is introduced for it.
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const g = game();
    const before = g.players[id]!;
    const hypotheticalItem = {
      id: "future-1", type: "hexed", sourceCharacter: "witch", note: "a made-up future ability",
      lifetime: { kind: "days" as const, count: 2 },
    };
    const updated = recordIfLive(g, { ...g, players: { ...g.players, [id]: { ...before, effects: [...before.effects, hypotheticalItem] } } }, () => ({
      category: "effect",
      playerId: id,
      change: { kind: "added", item: hypotheticalItem },
      provenance: provenanceOf(hypotheticalItem),
    }));
    expect(updated).not.toBeNull();
    store.setState({ game: updated });
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      category: "effect", participant: participantOf(id),
      change: { kind: "added", item: hypotheticalItem },
      provenance: { sourceCharacter: "witch", note: "a made-up future ability" },
    });
  });

  it("diffFields generalizes to an arbitrary field set without per-domain code", () => {
    const before = { a: 1, b: "x", c: true } as Record<string, unknown>;
    const after = { a: 1, b: "y", c: false } as Record<string, unknown>;
    expect(diffFields(before, after, ["a", "b", "c"])).toEqual({ from: { b: "x", c: true }, to: { b: "y", c: false } });
    expect(diffFields(before, before, ["a", "b", "c"])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 9D.2 closure: standardized Mutation Context -> Provenance flow.
// Every Authoritative Mutation Command below is called directly -- never
// recordIfLive itself -- so this proves the real command surface, not just
// the underlying mechanism (already proven generic above).
// ---------------------------------------------------------------------------
describe("Phase 9D.2 closure: Mutation Context carries Provenance through the authoritative command itself", () => {
  it("assignRole (Actual Role): supplied Mutation Context changes Current State and produces exactly one History Record with that Provenance", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const before = game().players[id]!.actualRole;
    const target = before === "imp" ? "chef" : "imp";
    const provenance = { sourceCharacter: "philosopher", reason: "gained a new role" };
    state().assignRole(id, target, { provenance });
    expect(game().players[id]!.actualRole).toBe(target);
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      category: "role", participant: participantOf(id),
      change: { kind: "value", from: { actualRole: before }, to: { actualRole: target } },
      provenance,
    });
  });

  it("setActualAlignment (Actual Alignment): supplied Mutation Context changes Current State and produces exactly one History Record with that Provenance", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const before = game().players[id]!.actualAlignment;
    const target = before === "evil" ? "good" : "evil";
    const provenance = { sourceCharacter: "philosopher", reason: "became evil" };
    state().setActualAlignment(id, target, { provenance });
    expect(game().players[id]!.actualAlignment).toBe(target);
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      category: "alignment", participant: participantOf(id),
      change: { kind: "value", from: { actualAlignment: before }, to: { actualAlignment: target } },
      provenance,
    });
  });

  it("setAlive (Life State): supplied Mutation Context changes Current State and produces exactly one History Record with that Provenance", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const provenance = { sourceCharacter: "imp", reason: "demon attack" };
    state().setAlive(id, false, { provenance });
    expect(game().players[id]!.alive).toBe(false);
    expect(history()).toHaveLength(1);
    expect(history()[0]).toMatchObject({
      category: "life", participant: participantOf(id),
      change: { kind: "value", from: { alive: true }, to: { alive: false } },
      provenance,
    });
  });

  it("setGhostVote and setTravelerAlignment also carry supplied Provenance through the same Mutation Context", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    // Phase 10A: only a dead player has a ghost vote to spend.
    state().setAlive(id, false);
    state().setGhostVote(id, false, { provenance: { reason: "spent ghost vote" } });
    expect(history()[1]).toMatchObject({ category: "life", provenance: { reason: "spent ghost vote" },
      change: { kind: "value", from: { ghostVote: true }, to: { ghostVote: false } } });

    newPlan(6);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const travelerId = game().seatOrder[0]!;
    state().setIsTraveler(travelerId, true); // convert before dealing, so the ordinary bag matches the remaining 5 seats
    state().setRolePool(standardRoles(5));
    expect(state().dealRolePool().ok).toBe(true);
    state().assignRole(travelerId, "thief");
    state().setTravelerAlignment(travelerId, "good"); // required before Night 1 can begin; still Setup, no history
    goLive();
    state().setTravelerAlignment(travelerId, "evil", { provenance: { reason: "Storyteller selection" } });
    expect(history().at(-1)).toMatchObject({
      category: "alignment", participant: participantOf(travelerId), provenance: { reason: "Storyteller selection" },
    });
  });

  it("the same command with no Mutation Context produces a History Record with no invented Provenance", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const before = game().players[id]!.actualRole;
    const target = before === "imp" ? "chef" : "imp";
    state().assignRole(id, target); // no context argument at all
    expect(history()).toHaveLength(1);
    expect(history()[0]!.provenance).toBeUndefined();

    state().setAlive(id, false); // no context argument at all
    expect(history()[1]!.provenance).toBeUndefined();
  });

  it("a no-op Mutation with a supplied Mutation Context still creates no History Record, and does not needlessly touch Current State", () => {
    dealtGame();
    goLive();
    const id = game().seatOrder[0]!;
    const currentRole = game().players[id]!.actualRole;
    const currentAlignment = game().players[id]!.actualAlignment!;
    const provenance = { reason: "attempted but nothing actually changed" };

    state().assignRole(id, currentRole, { provenance }); // old value -> same value
    state().setActualAlignment(id, currentAlignment, { provenance });
    state().setGhostVote(id, game().players[id]!.ghostVote, { provenance });

    expect(history()).toEqual([]);
    expect(game().players[id]!.actualRole).toBe(currentRole);
    expect(game().players[id]!.actualAlignment).toBe(currentAlignment);
  });

  it("Setup boundary remains unchanged: a Mutation Context supplied during Setup still produces no History Record", () => {
    dealtGame(); // still Setup phase -- no goLive()
    const id = game().seatOrder[0]!;
    const provenance = { reason: "a Setup-time correction" };
    expect(state().replaceSetupRole(id, "imp").ok).toBe(true);
    state().setAlive(id, false, { provenance });
    state().setActualAlignment(id, "evil", { provenance });
    expect(history()).toEqual([]);
  });
});
