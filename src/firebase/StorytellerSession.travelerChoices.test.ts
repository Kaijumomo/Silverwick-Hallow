import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { useSessionRuntime } from "./storytellerSync";
import { useApplyTravelerChoices } from "./StorytellerSession";
import { rosterEntryPath } from "./paths";
import { travelerChoicePath } from "./lifecycle";

// Phase 9 Setup finalization B4: the player-side Traveler character choice
// is applied automatically, with no Storyteller click, through the exact
// same assignRole() command the Storyteller's own manual override uses.
//
// FINAL SETUP INTEGRATION REVISION, Section 1: this must go through the
// same fenced writer authority (useSessionRuntime().backend) every other
// membership command uses -- never StorytellerSession's own raw connection,
// which is available before writer authority is ever claimed and cannot
// satisfy this collection's writer-guard-fenced write rule. See
// rules.spec.ts's "clearing a Traveler choice without the fenced writer's
// guard is rejected against real rules" for the real-rules proof; this
// suite proves the production wiring itself uses that authority correctly.

const code = "TRVL2345";

function resetStores() {
  useStorytellerStore.setState({ game: null, undoStack: [], selectedPlayerId: null, lobby: null });
  useSessionRuntime.setState({ backend: null, travelerChoices: {} });
}

beforeEach(resetStores);
afterEach(() => { cleanup(); resetStores(); });

// Mirrors firebase/travelers.test.ts's own setup: a real fenced SessionWriter
// over a MemoryRoomBackend, claimed the same way production code claims one.
async function withWriter() {
  const b = new MemoryRoomBackend();
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const writer = new SessionWriter(b, code, session.id);
  return { b, writer };
}

describe("useApplyTravelerChoices", () => {
  // setIsTraveler (Phase 9 Setup finalization B4 revision) refuses ordinary
  // -> Traveler once occupied ordinary would drop below 5 -- seed enough
  // extra ordinary players first so the single seat under test can convert.
  function seedExtraOrdinary(n: number) {
    for (let i = 0; i < n; i++) useStorytellerStore.getState().addPlayer("Extra " + i);
  }

  it("applies an observed choice via assignRole and clears the request, through the fenced writer authority", async () => {
    const { b, writer } = await withWriter();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice");
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    await b.set(rosterEntryPath(code, "uid-alice"), playerId);
    useSessionRuntime.setState({ backend: writer, travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });

    renderHook(() => useApplyTravelerChoices(code));

    await waitFor(() => expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("thief"));
    await waitFor(async () => expect(await b.get(travelerChoicePath(code, "uid-alice"))).toBeUndefined());
  });

  it("never applies a choice for a player who is no longer a Traveler", async () => {
    const { b, writer } = await withWriter();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice"); // ordinary, never marked Traveler
    await b.set(rosterEntryPath(code, "uid-alice"), playerId);
    useSessionRuntime.setState({ backend: writer, travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });

    renderHook(() => useApplyTravelerChoices(code));

    await waitFor(async () => expect(await b.get(travelerChoicePath(code, "uid-alice"))).toBeUndefined());
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("");
  });

  it("a current Storyteller-assigned Traveler character wins over a stale pending choice", async () => {
    const { b, writer } = await withWriter();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice");
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    // Storyteller assigns Gunslinger before the pending Thief request is processed.
    useStorytellerStore.getState().assignRole(playerId, "gunslinger");
    await b.set(rosterEntryPath(code, "uid-alice"), playerId);
    useSessionRuntime.setState({ backend: writer, travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });

    renderHook(() => useApplyTravelerChoices(code));

    await waitFor(async () => expect(await b.get(travelerChoicePath(code, "uid-alice"))).toBeUndefined());
    // Gunslinger remains -- the stale Thief request never overwrote it.
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("gunslinger");
  });

  it("skips unresolved requests without throwing", () => {
    useSessionRuntime.setState({ backend: null, travelerChoices: { "uid-alice": { playerId: null, roleId: "thief" } } });
    expect(() => renderHook(() => useApplyTravelerChoices(code))).not.toThrow();
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("does not process until the authoritative writer is available", () => {
    // No writer claimed yet (e.g. StorytellerSession's raw connection is up
    // but useStorytellerSync hasn't finished claiming writer authority) --
    // a pending request must wait, never fall back to an unfenced write.
    useSessionRuntime.setState({ backend: null, travelerChoices: { "uid-alice": { playerId: "p1", roleId: "thief" } } });
    expect(() => renderHook(() => useApplyTravelerChoices(code))).not.toThrow();
    expect(useStorytellerStore.getState().game).toBeNull();
  });

  it("does nothing without a code", () => {
    useSessionRuntime.setState({ travelerChoices: { "uid-alice": { playerId: "p1", roleId: "thief" } } });
    expect(() => renderHook(() => useApplyTravelerChoices(undefined))).not.toThrow();
  });

  it("a rejected apply is caught and reported, never an unhandled rejection, and leaves the request for retry", async () => {
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice");
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    const b = new MemoryRoomBackend();
    await b.set(rosterEntryPath(code, "uid-alice"), playerId);
    // A minimal fenced-shaped backend whose remote write fails (e.g. a
    // network error deep inside an otherwise-valid, still-fenced writer) --
    // this must be caught and reported, never an unhandled rejection, and
    // must never silently drop the request or desync from the local commit.
    const failing = { runExclusive: undefined, get: (p: string) => b.get(p),
      set: () => Promise.reject(new Error("simulated network failure")),
      transaction: () => Promise.reject(new Error("unused")),
      update: () => Promise.reject(new Error("unused")),
      setIfAbsent: () => Promise.reject(new Error("unused")) };
    const failingWriter = { runExclusive: (op: (inner: typeof failing) => Promise<unknown>) => op(failing) };
    useSessionRuntime.setState({
      backend: failingWriter as unknown as SessionWriter,
      travelerChoices: { "uid-alice": { playerId, roleId: "thief" } },
    });

    renderHook(() => useApplyTravelerChoices(code));

    await waitFor(() => expect(useSessionRuntime.getState().errors["traveler-choice"]).toBeTruthy());
    // The local side still committed -- the failure is on the remote clear,
    // not a reason to desync from it.
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("thief");
  });
});
