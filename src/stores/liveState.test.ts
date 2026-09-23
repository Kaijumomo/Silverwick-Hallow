import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { participantRefOf } from "./participants";
import { buildRegistry } from "@/data/roleRegistry";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { projectToPublic, projectToSelf } from "./projections";
import { hasEffect } from "./effects";

// Phase 9D.1: core live-state schema -- universal actual alignment,
// structured effects (replacing bare status booleans), and structured
// reminder records (replacing plain strings). See PHASE9D1.md-equivalent
// task description for the full spec; each `it` below names the exact
// requirement it proves.

const registry = buildRegistry(setupScript);
const game = () => store.getState().game!;
const state = () => store.getState();

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

describe("Phase 9D.1: universal actual alignment", () => {
  it("ordinary Deal assigns explicit default actual alignment from the dealt character", () => {
    dealtGame();
    for (const id of game().seatOrder) {
      const p = game().players[id]!;
      expect(p.actualAlignment).toBe(registry.alignmentOf(p.actualRole));
    }
  });

  it("Setup role replacement (pre-Reveal) freshens default alignment to the new character's", () => {
    dealtGame();
    const id = game().seatOrder.find((sid) => registry.alignmentOf(game().players[sid]!.actualRole) === "good")!;
    expect(state().replaceSetupRole(id, "imp").ok).toBe(true);
    expect(game().players[id]!.actualRole).toBe("imp");
    expect(game().players[id]!.actualAlignment).toBe("evil");
  });

  it("a gameplay character change (assignRole) preserves the existing actual alignment", () => {
    dealtGame();
    const id = game().seatOrder.find((sid) => registry.alignmentOf(game().players[sid]!.actualRole) === "good")!;
    const before = game().players[id]!.actualAlignment;
    expect(before).toBe("good");
    state().assignRole(id, "imp"); // a different, evil-typed character
    expect(game().players[id]!.actualRole).toBe("imp");
    // Alignment is an independent live truth -- it is never auto-derived
    // from a mid-game character change.
    expect(game().players[id]!.actualAlignment).toBe(before);
  });

  it("setActualAlignment explicitly changes an ordinary player's alignment", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    const before = game().players[id]!.actualAlignment;
    const next = before === "evil" ? "good" : "evil";
    state().setActualAlignment(id, next);
    expect(game().players[id]!.actualAlignment).toBe(next);
  });

  it("Traveler alignment remains Storyteller-selected -- never inferred from character", () => {
    newPlan(6);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    expect(state().setIsTraveler(id, true).ok).toBe(true);
    state().assignRole(id, "thief");
    // Dealing/assigning a Traveler character never establishes an actual
    // alignment on its own.
    expect(game().players[id]!.actualAlignment).toBeUndefined();
    state().setTravelerAlignment(id, "evil");
    expect(game().players[id]!.actualAlignment).toBe("evil");
  });

  it("setActualAlignment also works generically on a Traveler", () => {
    newPlan(6);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const id = game().seatOrder[0]!;
    state().setIsTraveler(id, true);
    state().setActualAlignment(id, "good");
    expect(game().players[id]!.actualAlignment).toBe("good");
  });

  it("public projection never leaks actual alignment, for ordinary players or Travelers", () => {
    dealtGame();
    const ordinaryId = game().seatOrder[0]!;
    expect(projectToPublic(game().players[ordinaryId]!, true)).not.toHaveProperty("actualAlignment");
    expect(projectToSelf(game().players[ordinaryId]!, registry)).not.toHaveProperty("actualAlignment");

    newPlan(6);
    for (let i = 0; i < 6; i++) state().addPlayerToSeat("Player " + i);
    const travelerId = game().seatOrder[0]!;
    state().setIsTraveler(travelerId, true);
    state().assignRole(travelerId, "thief");
    state().setTravelerAlignment(travelerId, "evil");
    expect(projectToPublic(game().players[travelerId]!, true)).not.toHaveProperty("actualAlignment");
    // The Traveler's own self projection legitimately mirrors alignment as
    // `shownAlignment` (unchanged Phase 9C.6 behavior) -- but never as the
    // raw `actualAlignment` field itself.
    expect(projectToSelf(game().players[travelerId]!, registry)).not.toHaveProperty("actualAlignment");
  });
});

describe("Phase 9D.1: structured active effects", () => {
  it.each(["drunk", "poisoned", "protected"] as const)(
    "manual %s toggle ON creates a structured effect, and OFF removes exactly that effect",
    (kind) => {
      dealtGame();
      const id = game().seatOrder[0]!;
      state().setStatus(id, kind, true);
      const effect = game().players[id]!.effects.find((e) => e.id === `manual:${kind}`);
      expect(effect).toBeDefined();
      expect(effect).toMatchObject({ id: `manual:${kind}`, type: kind, lifetime: { kind: "manual" } });
      expect(hasEffect(game().players[id]!, kind)).toBe(true);

      state().setStatus(id, kind, false);
      expect(game().players[id]!.effects.find((e) => e.id === `manual:${kind}`)).toBeUndefined();
      expect(hasEffect(game().players[id]!, kind)).toBe(false);
    }
  );

  it("two effects of the same semantic type -- one manual, one differently sourced -- coexist", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true);
    const sourcedId = state().addEffect(id, {
      type: "poisoned",
      sourceCharacter: "poisoner",
      sourcePlayer: game().seatOrder[1]!,
      lifetime: { kind: "untilDawn" },
    });
    expect(sourcedId).not.toBeNull();
    expect(game().players[id]!.effects).toHaveLength(2);
    expect(hasEffect(game().players[id]!, "poisoned")).toBe(true);
  });

  it("removing the manual Poisoned effect never removes a differently sourced Poisoned effect", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "poisoned", true);
    const sourcedId = state().addEffect(id, {
      type: "poisoned", sourceCharacter: "poisoner", lifetime: { kind: "untilDawn" },
    })!;
    state().setStatus(id, "poisoned", false);
    const remaining = game().players[id]!.effects;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(sourcedId);
    // The status indicator is still active -- the ability-sourced effect survives.
    expect(hasEffect(game().players[id]!, "poisoned")).toBe(true);
  });

  it("removeEffect removes exactly the named effect and leaves others untouched", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    const a = state().addEffect(id, { type: "custom-a", lifetime: { kind: "manual" } })!;
    const b = state().addEffect(id, { type: "custom-b", lifetime: { kind: "manual" } })!;
    state().removeEffect(id, a);
    expect(game().players[id]!.effects.map((e) => e.id)).toEqual([b]);
  });

  it("effects never leak into public or self projections", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    state().setStatus(id, "protected", true);
    expect(projectToPublic(game().players[id]!, true)).not.toHaveProperty("effects");
    expect(projectToSelf(game().players[id]!, registry)).not.toHaveProperty("effects");
  });
});

describe("Phase 9D.1: structured reminder tokens", () => {
  it("addReminder creates a structured reminder record with provenance", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    const source = game().seatOrder[1]!;
    const reminderId = state().addReminder(id, {
      label: "Red Herring", sourceCharacter: "fortuneteller", sourcePlayer: source, lifetime: { kind: "manual" },
    });
    expect(reminderId).not.toBeNull();
    const record = game().players[id]!.reminders.find((r) => r.id === reminderId);
    // Phase 9R.2: the live source PlayerId is stored as the durable snapshot
    // of whoever occupied that seat when the reminder was created.
    expect(record).toMatchObject({ label: "Red Herring", sourceCharacter: "fortuneteller", sourceParticipant: participantRefOf(game(), source) });
    expect(record!.sourceParticipant).toMatchObject({ kind: "participant", playerId: source, nameAtTime: game().players[source]!.name });
    expect(record).not.toHaveProperty("sourcePlayer");
  });

  it("removeReminder removes exactly the named reminder", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    const a = state().addReminder(id, { label: "Chosen", lifetime: { kind: "manual" } })!;
    const b = state().addReminder(id, { label: "Protected", lifetime: { kind: "manual" } })!;
    state().removeReminder(id, a);
    expect(game().players[id]!.reminders.map((r) => r.id)).toEqual([b]);
  });

  it("adding the same label twice is deterministic -- two distinct records, never merged or deduplicated", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    const a = state().addReminder(id, { label: "Poisoned", lifetime: { kind: "manual" } })!;
    const b = state().addReminder(id, { label: "Poisoned", lifetime: { kind: "manual" } })!;
    expect(a).not.toBe(b);
    expect(game().players[id]!.reminders).toHaveLength(2);
  });

  it("reminder provenance never leaks into public or self projections", () => {
    dealtGame();
    const id = game().seatOrder[0]!;
    state().addReminder(id, {
      label: "Secret", sourceCharacter: "poisoner", note: "ST-only context", lifetime: { kind: "manual" },
    });
    const pub = JSON.stringify(projectToPublic(game().players[id]!, true));
    const self = JSON.stringify(projectToSelf(game().players[id]!, registry));
    for (const leak of ["reminders", "Secret", "sourceCharacter", "ST-only context"]) {
      expect(pub).not.toContain(leak);
      expect(self).not.toContain(leak);
    }
  });
});
