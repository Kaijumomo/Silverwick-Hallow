import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "./storytellerStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "./identity";
import { executionsAt, deathsAt, momentOrdinal } from "./lifeEvents";
import type { LifeConfirmationToken } from "./lifeResolution";
import type { PlayerId, StorytellerLobbyRecord } from "./types";

// Phase 10A Astra remediation, Package A1:
//  - 10A-ASTRA-001: live time is monotonic through the phase API.
//  - 10A-ASTRA-002: a pending confirmation authorizes only the exact
//    participation instance and Game Moment it was issued for.

const game = () => store.getState().game!;
const state = () => store.getState();
const player = (id: PlayerId) => game().players[id]!;
const NIGHT1 = { phase: "night", day: 1 } as const;
const DAY1 = { phase: "day", day: 1 } as const;
const NIGHT2 = { phase: "night", day: 2 } as const;
const DAY2 = { phase: "day", day: 2 } as const;

beforeEach(() => store.setState({
  game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
  customScripts: { [setupScript.id]: setupScript },
}));

/** A revealed game at Night 1; seat 0 is seated through the knock/UID path
 * (uid-alice) so a later same-UID participation can be exercised. */
function liveNight(): PlayerId[] {
  state().newGame(setupScript.id, { plannedPlayerCount: 7, plannedTravelerCount: 0 });
  state().addToPendingQueue("uid-alice", "Alice");
  expect(state().assignPendingToSeat("uid-alice", game().seatOrder[0]!)).toBe(true);
  for (let i = 1; i < 7; i++) state().addPlayerToSeat("Player " + i);
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(player(id).actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
  return [...game().seatOrder];
}

const momentOf = (g: StorytellerLobbyRecord) => ({ phase: g.phase, day: g.day });
/** Timeline position of the current live phase. */
const ordinalNow = () => momentOrdinal({ phase: game().phase as "night" | "day", day: game().day });

describe("10A-ASTRA-001: monotonic live phase progression", () => {
  it("setPhase follows the chronological sequence: Night 1 -> Day 1 -> Night 2 -> Day 2", () => {
    liveNight();
    expect(state().setPhase("day").ok).toBe(true);
    expect(momentOf(game())).toEqual(DAY1);
    expect(state().setPhase("night").ok).toBe(true);
    expect(momentOf(game())).toEqual(NIGHT2); // never back to Night 1
    expect(state().setPhase("day").ok).toBe(true);
    expect(momentOf(game())).toEqual(DAY2);
  });

  it("setPhase and advancePhase produce the identical transition (phase, day, window rollover, Undo, localSeq, History)", () => {
    const ids = liveNight();
    state().recordDeath(ids[1]!);
    for (const target of ["day", "night", "day", "night"] as const) {
      const start = { game: game(), undoStack: state().undoStack, localSeq: state().localSeq };
      expect(state().setPhase(target).ok).toBe(true);
      const viaSetPhase = { game: game(), undo: state().undoStack, seq: state().localSeq };
      store.setState({ game: start.game, undoStack: start.undoStack, localSeq: start.localSeq });
      expect(state().advancePhase().ok).toBe(true);
      expect(game()).toEqual(viaSetPhase.game);
      expect(state().undoStack).toEqual(viaSetPhase.undo);
      expect(state().localSeq).toBe(viaSetPhase.seq);
      expect(game().history).toBe(start.game.history); // no History for a phase change
    }
  });

  it("Luna/Astra reproduction: a Day 1 execution survives Day 1 -> Night 2 and is never replaced by a false 'known none'", () => {
    const ids = liveNight();
    expect(state().setPhase("day").ok).toBe(true);
    expect(state().recordExecution(ids[1]!, "died").ok).toBe(true);
    expect(state().setPhase("night").ok).toBe(true);           // Day 1 -> Night 2 (not Night 1)
    expect(momentOf(game())).toEqual(NIGHT2);
    expect(executionsAt(game(), DAY1)).toMatchObject({ status: "known", events: [{ kind: "execution" }] });
    expect(state().setPhase("day").ok).toBe(true);             // Night 2 -> Day 2 (not Day 1)
    expect(momentOf(game())).toEqual(DAY2);
    // Day 1 has now expired at the correct later boundary: unknown, never "none".
    expect(executionsAt(game(), DAY1)).toMatchObject({ status: "unknown", reason: "expired" });
    expect(executionsAt(game(), DAY2)).toEqual({ status: "known", events: [] });
  });

  it("Night 2 events survive into Day 2, and expire at Night 3", () => {
    const ids = liveNight();
    state().setPhase("day"); state().setPhase("night"); // Night 2
    expect(state().recordDeath(ids[2]!).ok).toBe(true);
    state().setPhase("day");                             // Day 2
    expect(deathsAt(game(), NIGHT2)).toMatchObject({ status: "known", events: [{ kind: "death" }] });
    state().setPhase("night");                           // Night 3
    expect(deathsAt(game(), NIGHT2)).toMatchObject({ status: "unknown", reason: "expired" });
  });

  it("no sequence of phase API calls ever reaches an earlier Game Moment", () => {
    liveNight();
    let last = ordinalNow();
    for (const target of ["night", "day", "day", "night", "night", "day", "night", "day"] as const) {
      state().setPhase(target);
      state().advancePhase();
      const now = ordinalNow();
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    expect(state().setPhase("setup").ok).toBe(false);
    expect(ordinalNow()).toBe(last);
  });

  it("repeated advance / Undo is exact", () => {
    const ids = liveNight();
    state().recordDeath(ids[1]!);
    const snapshots: StorytellerLobbyRecord[] = [structuredClone(game())];
    for (let i = 0; i < 4; i++) {
      expect((i % 2 ? state().setPhase(game().phase === "night" ? "day" : "night") : state().advancePhase()).ok).toBe(true);
      snapshots.push(structuredClone(game()));
    }
    for (let i = snapshots.length - 2; i >= 0; i--) {
      state().undo();
      expect(game()).toEqual(snapshots[i]);
    }
  });
});

describe("10A-ASTRA-002: confirmations are bound to participation identity and Game Moment", () => {
  /** Day 1; the Traveler at seat 0's PlayerId is chosen as the exceptional
   * executee and a confirmation token is issued. */
  function pendingTravelerConfirmation(name = "Tess"): { seat: PlayerId; token: LifeConfirmationToken; ids: PlayerId[] } {
    const ids = liveNight();
    state().addToPendingQueue("uid-tess", name);
    state().addEmptySeat();
    const seat = game().seatOrder.at(-1)!;
    expect(state().assignPendingToSeat("uid-tess", seat)).toBe(true);
    expect(player(seat).isTraveler).toBe(true);
    state().assignRole(seat, "thief");
    state().advancePhase(); // Day 1
    const refusal = state().recordExecution(seat, "died");
    expect(refusal).toMatchObject({ ok: false, code: "needsConfirmation" });
    const token = !refusal.ok && refusal.code === "needsConfirmation" ? refusal.confirmation : undefined;
    expect(token).toMatchObject({ kind: "travelerExecutee", participantId: player(seat).participantId, moment: DAY1 });
    return { seat, token: token!, ids };
  }

  function expectStaleAndUnchanged(run: () => ReturnType<ReturnType<typeof state>["recordExecution"]>) {
    const before = { game: game(), undo: state().undoStack, seq: state().localSeq };
    expect(run()).toMatchObject({ ok: false, code: "stale" });
    expect(state().game).toBe(before.game);
    expect(state().undoStack).toBe(before.undo);
    expect(state().localSeq).toBe(before.seq);
  }

  it("the original participant's confirmation succeeds", () => {
    const { seat, token } = pendingTravelerConfirmation();
    expect(state().recordExecution(seat, "died", { confirmations: [token] }).ok).toBe(true);
    expect(player(seat).alive).toBe(false);
  });

  it("seat reuse: Alice's confirmation never executes Bob, the new occupant of the same PlayerId", () => {
    const { seat, token } = pendingTravelerConfirmation();
    expect(state().unseatPlayer(seat)).toBe(true);
    state().addToPendingQueue("uid-bob", "Bob");
    expect(state().assignPendingToSeat("uid-bob", seat)).toBe(true);
    expect(player(seat).participantId).not.toBe(token.participantId);
    expectStaleAndUnchanged(() => state().recordExecution(seat, "died", { confirmations: [token] }));
    expect(player(seat)).toMatchObject({ name: "Bob", alive: true });
    expect(game().lifeEventWindow.events).toEqual([]);
  });

  it("same display name: a replacement also called 'Tess' is still refused", () => {
    const { seat, token } = pendingTravelerConfirmation("Tess");
    state().unseatPlayer(seat);
    state().addToPendingQueue("uid-other", "Tess");
    expect(state().assignPendingToSeat("uid-other", seat)).toBe(true);
    expectStaleAndUnchanged(() => state().recordExecution(seat, "died", { confirmations: [token] }));
    expect(player(seat).alive).toBe(true);
  });

  it("same UID: a later participation instance of the same person is still refused", () => {
    const { seat, token } = pendingTravelerConfirmation();
    state().unseatPlayer(seat);
    state().addToPendingQueue("uid-tess", "Tess");
    expect(state().assignPendingToSeat("uid-tess", seat)).toBe(true);
    expect(player(seat).participantId).not.toBe(token.participantId);
    expectStaleAndUnchanged(() => state().recordExecution(seat, "died", { confirmations: [token] }));
    expect(player(seat).alive).toBe(true);
  });

  it("moment change: a Day 1 confirmation is refused on Day 2 for the very same participant", () => {
    const { seat, token } = pendingTravelerConfirmation();
    state().advancePhase(); state().advancePhase(); // Night 2 -> Day 2
    expectStaleAndUnchanged(() => state().recordExecution(seat, "died", { confirmations: [token] }));
    expect(player(seat).alive).toBe(true);
    // A fresh confirmation for Day 2 works.
    const refusal = state().recordExecution(seat, "died");
    const fresh = !refusal.ok && refusal.code === "needsConfirmation" ? refusal.confirmation : undefined;
    expect(fresh?.moment).toEqual(DAY2);
    expect(state().recordExecution(seat, "died", { confirmations: [fresh!] }).ok).toBe(true);
  });

  it("an additional-execution confirmation stays functional and is bound to its participant", () => {
    const ids = liveNight();
    state().advancePhase();
    expect(state().recordExecution(ids[1]!, "survived").ok).toBe(true);
    const refusal = state().recordExecution(ids[2]!, "died");
    const token = !refusal.ok && refusal.code === "needsConfirmation" ? refusal.confirmation : undefined;
    expect(token).toMatchObject({ kind: "additionalExecution", participantId: player(ids[2]!).participantId });
    // Presented for a different participant: stale, nothing changes.
    expectStaleAndUnchanged(() => state().recordExecution(ids[3]!, "died", { confirmations: [token!] }));
    expect(state().recordExecution(ids[2]!, "died", { confirmations: [token!] }).ok).toBe(true);
    expect(executionsAt(game(), DAY1)).toMatchObject({ status: "known", events: [{ outcome: "survived" }, { outcome: "died" }] });
  });

  it("a forged or malformed token is refused as stale", () => {
    const { seat, token } = pendingTravelerConfirmation();
    for (const bad of [{ ...token, moment: NIGHT1 }, { ...token, kind: "bogus" }, { kind: token.kind }, null]) {
      expectStaleAndUnchanged(() => state().recordExecution(seat, "died", { confirmations: [bad as never] }));
    }
  });
});
