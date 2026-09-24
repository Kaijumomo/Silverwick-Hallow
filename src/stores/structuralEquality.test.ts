import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { sameSnapshot } from "./history";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import type { EffectRecord, HistoryRecord, PlayerId, ReminderRecord, StorytellerLobbyRecord } from "./types";

// Phase 9R.4 (Astra B): sameSnapshot() decides true no-ops for the small
// JSON-shaped records commands compare (Effects, Reminders, private info,
// Traveler arrival, one player record). It used to compare
// JSON.stringify() output, so the SAME semantic record with its properties
// inserted in a different order read as a change -- one needless Undo
// entry, one needless localSeq step, and a duplicate semantic History
// event. Object property order must never matter; array order still does.

describe("Phase 9R.4 (Astra B): sameSnapshot is semantic structural equality", () => {
  it("object property insertion order is insignificant, at every depth", () => {
    expect(sameSnapshot({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(sameSnapshot({ nested: { a: 1, b: 2 } }, { nested: { b: 2, a: 1 } })).toBe(true);
    expect(sameSnapshot({ x: [{ a: 1, b: { c: 2, d: 3 } }] }, { x: [{ b: { d: 3, c: 2 }, a: 1 }] })).toBe(true);
  });

  it("array order stays significant", () => {
    expect(sameSnapshot([1, 2], [2, 1])).toBe(false);
    expect(sameSnapshot({ bluffs: ["chef", "empath"] }, { bluffs: ["empath", "chef"] })).toBe(false);
    expect(sameSnapshot([1, 2], [1, 2, 3])).toBe(false);
  });

  it("different keys or values stay unequal", () => {
    expect(sameSnapshot({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameSnapshot({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameSnapshot({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameSnapshot({ a: { b: 1 } }, { a: { b: "1" } })).toBe(false);
    expect(sameSnapshot({ a: null }, { a: {} })).toBe(false);
    expect(sameSnapshot({ a: [] }, { a: {} })).toBe(false);
    expect(sameSnapshot({ a: 0 }, { a: false })).toBe(false);
    expect(sameSnapshot(null, {})).toBe(false);
    expect(sameSnapshot({ a: 1 }, undefined)).toBe(false);
  });

  it("primitives compare by value", () => {
    expect(sameSnapshot("x", "x")).toBe(true);
    expect(sameSnapshot(3, 3)).toBe(true);
    expect(sameSnapshot(true, false)).toBe(false);
    expect(sameSnapshot(undefined, undefined)).toBe(true);
    expect(sameSnapshot(null, null)).toBe(true);
    expect(sameSnapshot(null, undefined)).toBe(false);
  });

  it("an undefined-valued property still equals an absent one (the persisted JSON convention every caller relies on)", () => {
    expect(sameSnapshot({ a: 1, packetEpoch: undefined }, { a: 1 })).toBe(true);
    expect(sameSnapshot({ a: 1 }, { a: 1, note: undefined })).toBe(true);
    expect(sameSnapshot({ a: 1, note: undefined }, { a: 1, note: "" })).toBe(false);
  });

  it("only OWN properties count -- inherited members are never compared", () => {
    const withProto = Object.create({ inherited: 1 }) as Record<string, unknown>;
    withProto.a = 1;
    expect(sameSnapshot(withProto, { a: 1 })).toBe(true);
    expect(sameSnapshot({ a: 1 }, withProto)).toBe(true);
    expect(sameSnapshot({ toString: 1 }, {})).toBe(false);
    expect(sameSnapshot({}, { toString: 1 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Command-level regressions: reordered-but-identical records are inert.
// ---------------------------------------------------------------------------
const state = () => store.getState();
const game = () => state().game!;
const player = (id: PlayerId) => game().players[id]!;

type Baseline = { game: StorytellerLobbyRecord; undoStack: StorytellerLobbyRecord[]; localSeq: number; history: HistoryRecord[] };
const baseline = (): Baseline => ({ game: game(), undoStack: state().undoStack, localSeq: state().localSeq, history: game().history });

function expectInert(before: Baseline) {
  expect(state().game).toBe(before.game);
  expect(state().undoStack).toBe(before.undoStack);
  expect(state().localSeq).toBe(before.localSeq);
  expect(game().history).toBe(before.history);
}
function expectOneMutation(before: Baseline, history: number) {
  expect(state().game).not.toBe(before.game);
  expect(state().localSeq).toBe(before.localSeq + 1);
  expect(state().undoStack).toHaveLength(before.undoStack.length + 1);
  expect(game().history).toHaveLength(before.history.length + history);
}

beforeEach(() => {
  store.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: { [setupScript.id]: setupScript },
  });
  localStorage.clear();
});

function setupFixture() {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  for (let i = 0; i < 7; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  store.setState({ undoStack: [] });
}
function liveFixture() {
  setupFixture();
  for (const id of game().seatOrder) state().showAssignedRole(id);
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  store.setState({ undoStack: [] });
}

describe.each([["Setup", setupFixture, 0], ["Live Play", liveFixture, 1]] as const)(
  "Phase 9R.4 (Astra B): re-submitting an identical record with reordered properties is inert -- %s",
  (_phase, fixture, historyPerMutation) => {
    it("addEffect: same semantic Effect (top-level, nested lifetime and source-snapshot position reordered) is inert; a real value change mutates once", () => {
      fixture();
      const [target, source] = game().seatOrder;
      const first = baseline();
      expect(state().addEffect(target!, {
        id: "e1", type: "poisoned", sourceCharacter: "poisoner", sourcePlayer: source!,
        lifetime: { kind: "nights", count: 2 }, note: "from the Poisoner",
      })).toBe("e1");
      expectOneMutation(first, historyPerMutation);
      const stored = player(target!).effects.find((e) => e.id === "e1")!;

      const same = baseline();
      expect(state().addEffect(target!, {
        note: "from the Poisoner", lifetime: { count: 2, kind: "nights" } as EffectRecord["lifetime"],
        sourcePlayer: source!, type: "poisoned", id: "e1", sourceCharacter: "poisoner",
      })).toBe("e1");
      expectInert(same);
      expect(player(target!).effects.find((e) => e.id === "e1")).toBe(stored);

      const changed = baseline();
      expect(state().addEffect(target!, {
        note: "from the Poisoner", lifetime: { count: 3, kind: "nights" } as EffectRecord["lifetime"],
        sourcePlayer: source!, type: "poisoned", id: "e1", sourceCharacter: "poisoner",
      })).toBe("e1");
      expectOneMutation(changed, historyPerMutation);
      expect(player(target!).effects.find((e) => e.id === "e1")!.lifetime).toEqual({ kind: "nights", count: 3 });
      if (historyPerMutation) expect(game().history.at(-1)).toMatchObject({ category: "effect", change: { kind: "added", item: { id: "e1", lifetime: { count: 3 } } } });
    });

    it("addReminder: same semantic Reminder (reordered) is inert with no duplicate History event; a real change mutates once", () => {
      fixture();
      const [target, source] = game().seatOrder;
      const first = baseline();
      expect(state().addReminder(target!, {
        id: "r1", label: "Red Herring", sourceCharacter: "fortuneteller", sourcePlayer: source!,
        lifetime: { kind: "days", count: 1 }, note: "chosen",
      })).toBe("r1");
      expectOneMutation(first, historyPerMutation);
      const stored = player(target!).reminders.find((r) => r.id === "r1")!;
      const reminderEvents = () => game().history.filter((h) => h.category === "reminder").length;
      const events = reminderEvents();

      const same = baseline();
      expect(state().addReminder(target!, {
        lifetime: { count: 1, kind: "days" } as ReminderRecord["lifetime"], note: "chosen", sourcePlayer: source!,
        sourceCharacter: "fortuneteller", label: "Red Herring", id: "r1",
      })).toBe("r1");
      expectInert(same);
      expect(player(target!).reminders.find((r) => r.id === "r1")).toBe(stored);
      expect(reminderEvents()).toBe(events);

      const changed = baseline();
      expect(state().addReminder(target!, {
        lifetime: { count: 1, kind: "days" } as ReminderRecord["lifetime"], note: "chosen", sourcePlayer: source!,
        sourceCharacter: "fortuneteller", label: "Red Herring (moved)", id: "r1",
      })).toBe("r1");
      expectOneMutation(changed, historyPerMutation);
      expect(player(target!).reminders.find((r) => r.id === "r1")!.label).toBe("Red Herring (moved)");
      expect(reminderEvents()).toBe(events + historyPerMutation);
    });

    it("setStatus: an already-active manual effect stored with a different key order is not re-committed", () => {
      fixture();
      const id = game().seatOrder[0]!;
      state().setStatus(id, "drunk", true);
      const stored = player(id).effects.find((e) => e.id === "manual:drunk")!;
      // Same record, keys reversed (as a migrated or differently-built record may be).
      const reordered = Object.fromEntries(Object.entries(stored).reverse()) as EffectRecord;
      expect(Object.keys(reordered)).not.toEqual(Object.keys(stored));
      store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...player(id), effects: [reordered] } } } });
      const before = baseline();
      state().setStatus(id, "drunk", true);
      expectInert(before);

      const off = baseline();
      state().setStatus(id, "drunk", false);
      expectOneMutation(off, historyPerMutation);
    });
  },
);
