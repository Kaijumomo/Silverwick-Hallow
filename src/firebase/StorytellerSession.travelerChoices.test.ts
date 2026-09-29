import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { useSessionRuntime } from "./storytellerSync";
import { useApplyTravelerChoices } from "./StorytellerSession";
import { rosterEntryPath, rosterParticipantPath } from "./paths";
import { travelerChoicePath } from "./lifecycle";
import { revokePlayerMembership, seatPlayer } from "./lobby";
import type { RoomBackend } from "./backend";
import { newParticipantId } from "@/stores/participants";

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

// Phase 10D: the choice is applied to the participation the AUTHORITATIVE
// roster record names (rosterParticipants/{uid}, written with the binding in
// production), and only when the local occupant is that participant.
async function bindRoster(b: MemoryRoomBackend, playerId: string, participantId?: string) {
  await b.set(rosterEntryPath(code, "uid-alice"), playerId);
  await b.set(rosterParticipantPath(code, "uid-alice"), {
    playerId, participantId: participantId ?? useStorytellerStore.getState().game!.players[playerId]!.participantId!, name: "Alice",
  });
}

/** The player's own request node, as the player writes it in production. */
const request = (b: MemoryRoomBackend, roleId: string) => b.set(travelerChoicePath(code, "uid-alice"), roleId);

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

  it("applies an observed choice through the Role seam and clears the request, through the fenced writer authority", async () => {
    const { b, writer } = await withWriter();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice");
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    await bindRoster(b, playerId);
    await request(b, "thief");
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
    await bindRoster(b, playerId);
    await request(b, "thief");
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
    await bindRoster(b, playerId);
    await request(b, "thief");
    useSessionRuntime.setState({ backend: writer, travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });

    renderHook(() => useApplyTravelerChoices(code));

    await waitFor(async () => expect(await b.get(travelerChoicePath(code, "uid-alice"))).toBeUndefined());
    // Gunslinger remains -- the stale Thief request never overwrote it.
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("gunslinger");
  });

  it("Phase 10D: a request whose roster record names a different participation than the local occupant is never applied -- nor consumed by that occupant's callback", async () => {
    const { b, writer } = await withWriter();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice");
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    await bindRoster(b, playerId, "pt-an-earlier-participation");
    await request(b, "thief");
    useSessionRuntime.setState({ backend: writer, travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });

    renderHook(() => useApplyTravelerChoices(code));

    await writer.runExclusive(async () => {}); // the observed callback ran before this
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("");
    // ASTRA-10D-001: attributed to another participation -- not consumed.
    expect(await b.get(travelerChoicePath(code, "uid-alice"))).toBe("thief");
    // One replay would have applied it; give any straggler a turn.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useStorytellerStore.getState().game!.players[playerId]!.actualRole).toBe("");
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
    await bindRoster(b, playerId);
    await request(b, "thief");
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

  // ASTRA-10D-001: the production wiring binds each request to the
  // participation holding the seat WHEN IT IS OBSERVED. A writer whose
  // exclusive queue is held stands in for the observed callback waiting behind
  // the Storyteller's own earlier-queued membership work.
  function heldWriter(b: MemoryRoomBackend) {
    const queued: (() => Promise<unknown>)[] = [];
    const writer = { runExclusive: <T,>(op: (inner: RoomBackend) => Promise<T>) =>
      new Promise<T>((resolve, reject) => { queued.push(() => op(b).then(resolve, reject)); }) };
    return { writer: writer as unknown as SessionWriter, queued };
  }

  it("ASTRA-10D-001 CHOICE1 (production wiring): a callback observed for A that runs after A is revoked and the same uid re-seated as B never touches B", async () => {
    const b = new MemoryRoomBackend();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!;
    useStorytellerStore.getState().addPlayerToSeat("Alice");
    seedExtraOrdinary(5);
    expect(useStorytellerStore.getState().setIsTraveler(playerId, true).ok).toBe(true);
    const a = useStorytellerStore.getState().game!.players[playerId]!.participantId!;
    await bindRoster(b, playerId);
    await request(b, "thief");
    const { writer, queued } = heldWriter(b);
    useSessionRuntime.setState({ backend: writer, travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });

    renderHook(() => useApplyTravelerChoices(code));
    await waitFor(() => expect(queued).toHaveLength(1)); // observed (bound to A) and queued

    // Before it runs: A is revoked, the same uid is seated again as B (a new
    // ParticipantId, same seat), and B asks for the IDENTICAL character.
    await revokePlayerMembership(b, code, playerId);
    expect(useStorytellerStore.getState().unseatPlayer(playerId)).toBe(true);
    const bPid = newParticipantId();
    useStorytellerStore.getState().addToPendingQueue("uid-alice", "Alice");
    await seatPlayer(b, code, "uid-alice", playerId, null, { participantId: bPid, name: "Alice" });
    expect(useStorytellerStore.getState().assignPendingToSeat("uid-alice", playerId, bPid)).toBe(true);
    expect(useStorytellerStore.getState().game!.players[playerId]).toMatchObject({ participantId: bPid, isTraveler: true, actualRole: "" });
    await request(b, "thief");
    const before = useStorytellerStore.getState().game;

    await queued[0]!();

    expect(a).not.toBe(bPid);
    expect(useStorytellerStore.getState().game).toBe(before); // B untouched
    expect(await b.get(travelerChoicePath(code, "uid-alice"))).toBe("thief"); // B's own request, not consumed
  });

  it("ASTRA-10D-001: nothing is queued for a request observed while its seat holds no participation", async () => {
    const b = new MemoryRoomBackend();
    useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 1 });
    const playerId = useStorytellerStore.getState().game!.seatOrder[0]!; // an empty planned seat
    await request(b, "thief");
    const { writer, queued } = heldWriter(b);
    useSessionRuntime.setState({ backend: writer, travelerChoices: { "uid-alice": { playerId, roleId: "thief" } } });
    renderHook(() => useApplyTravelerChoices(code));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queued).toHaveLength(0);
    expect(await b.get(travelerChoicePath(code, "uid-alice"))).toBe("thief");
  });
});
