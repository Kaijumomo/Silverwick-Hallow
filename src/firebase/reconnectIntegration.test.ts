// Phase 9C.2A (OPUS-001) — Step 4 reconnect integration tests. These cover
// the scenarios pure-decision unit tests can't: real SessionWriter lease
// fencing, real checkpoint reads through the real MemoryRoomBackend, and
// the full startStorytellerSession orchestration (decision -> apply ->
// reconcile -> finishLive), including the second-device ("foreign writer")
// safety rule and the "compare only after lease acquisition" ordering.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { buildRichPhase9Game } from "@/test/phase9RichState";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby, revokePlayerMembership } from "./lobby";
import { writeProjections } from "./sync";
import { SessionWriter, LEASE_MS, FENCE_MARGIN_MS } from "./writer";
import { reportRuntimeError, resolveReconnectConflict, startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { lifecycleMessage, requireActiveSession } from "./lifecycle";

const code = "RCIT2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];

beforeEach(() => {
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

function writerFor(b: MemoryRoomBackend, sessionId: string) {
  return new SessionWriter(b, code, sessionId, error => reportRuntimeError("write", error ? lifecycleMessage(error) : null));
}

async function setup(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  useStorytellerStore.getState().newGame("tb", { plannedPlayerCount: 2 });
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  return { session, lobby };
}

async function host(b: MemoryRoomBackend) {
  const ready = await setup(b);
  const writer = writerFor(b, ready.session.id);
  const manager = await startStorytellerSession(b, ready.lobby, writer);
  disposals.push(async () => { manager.stop(); await writer.dispose(); });
  return { ...ready, writer, manager };
}

/** Phase 9D.5: the same real-writer/real-backend hosting flow as host()
 * above, but the local game is the deliberately rich Phase 9 game (Setup,
 * Deal, Reveal, Night 1, a Traveler, structured Effects/Reminders/History,
 * Information Delivery, Storyteller-private notes) built entirely through
 * real production commands, never hand-constructed. setLobby() binds it to
 * this real lobby/session (setting game.code -- required for both the
 * flush gate and checkpoint validation to accept it -- and, as always,
 * clearing the undo stack accumulated while building it; the rich content
 * itself is untouched). */
async function hostRich(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const handles = buildRichPhase9Game();
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  useStorytellerStore.getState().setLobby(lobby);
  const writer = writerFor(b, session.id);
  const manager = await startStorytellerSession(b, lobby, writer);
  disposals.push(async () => { manager.stop(); await writer.dispose(); });
  return { handles, session, lobby, writer, manager };
}

/** Simulate a genuinely separate Storyteller device: a fresh writer with its
 * own token, publishing its own (different) game content directly, never
 * touching this process's useStorytellerStore or its sync/localSeq state —
 * exactly as a different browser/localStorage would not. */
async function foreignDeviceAdvance(b: MemoryRoomBackend, sessionId: string, mutate: (game: StorytellerLobbyRecord) => StorytellerLobbyRecord) {
  const foreignWriter = writerFor(b, sessionId);
  await foreignWriter.start();
  const baseGameRaw = await b.get(`${root}/storyteller`);
  const baseGame = baseGameRaw as unknown as StorytellerLobbyRecord;
  const foreignGame = mutate(structuredClone(baseGame));
  await writeProjections({
    backend: foreignWriter, code, stState: foreignGame,
    registry: buildRegistry(troubleBrewing), online: {}, membership: {},
  });
  await foreignWriter.dispose(); // release the lease so the original device can reconnect
  return foreignGame;
}

describe("Phase 9C.2A reconnect integration: same-lineage", () => {
  it("clean reconnect, same baseline: local game and undo are retained untouched", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    useStorytellerStore.getState().addPlayer("Alice");
    await waitFor(() => expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(useStorytellerStore.getState().localSeq));
    const gameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;
    manager.stop(); await writer.dispose();

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game).toEqual(gameBefore);
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    expect(useSessionRuntime.getState().reconnect).toEqual({ status: "live" });
  });

  it("pending (dirty) local state survives reconnect and gets flushed to the remote projection", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    // Made after the writer stopped: never flushed, never acknowledged.
    useStorytellerStore.getState().addPlayer("Zara");
    expect(useStorytellerStore.getState().localSeq).toBeGreaterThan(useStorytellerStore.getState().sync!.ackedGameSeq);

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.seatOrder.length).toBe(3); // 2 planned + Zara
    expect(useStorytellerStore.getState().localSeq).toBe(useStorytellerStore.getState().sync!.ackedGameSeq); // the initial flush caught up
    const remoteGame = await b.get(`${root}/storyteller`) as unknown as StorytellerLobbyRecord;
    expect(remoteGame.seatOrder.length).toBe(3);
  });

  it("reload with unacknowledged local work: a real localStorage persist/rehydrate cycle preserves sync/localSeq, and the post-reload reconnect still KEEP_LOCALs", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Unsaved before reload");
    const dirtySeq = useStorytellerStore.getState().localSeq;
    const dirtyAckedSeq = useStorytellerStore.getState().sync!.ackedGameSeq;
    expect(dirtySeq).toBeGreaterThan(dirtyAckedSeq);

    // A real "close the tab, reopen it" cycle: persist to the real
    // zustand/localStorage machinery, wipe the in-memory store back to
    // nothing, then rehydrate from exactly what localStorage now holds —
    // no shortcuts through in-memory state.
    await new Promise(resolve => setTimeout(resolve, 0)); // let the persist middleware's own write settle
    const persisted = localStorage.getItem("new-blood-st");
    expect(persisted).toBeTruthy();
    const persistedJson = JSON.parse(persisted!);
    expect(persistedJson.state.localSeq).toBe(dirtySeq);
    expect(persistedJson.state.sync).toMatchObject({ code, sessionId: session.id, ackedGameSeq: dirtyAckedSeq });

    // Wiping in-memory state is itself a state change, which the persist
    // middleware's own subscription would otherwise immediately re-save,
    // clobbering the very snapshot this test means to rehydrate from —
    // explicitly restore the captured string right before rehydrating.
    useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    localStorage.setItem("new-blood-st", persisted!);
    await useStorytellerStore.persist.rehydrate();
    expect(useStorytellerStore.getState().localSeq).toBe(dirtySeq); // survived the real round trip
    expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBe(dirtyAckedSeq);
    expect(useStorytellerStore.getState().game!.seatOrder.some(id => useStorytellerStore.getState().game!.players[id]!.name === "Unsaved before reload")).toBe(true);

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live"); // KEEP_LOCAL survives the real reload, not just an in-memory hop
    expect(useStorytellerStore.getState().game!.seatOrder.some(id => useStorytellerStore.getState().game!.players[id]!.name === "Unsaved before reload")).toBe(true);
  });

  it("lost acknowledgement is recognized without CONFLICT: a commit that landed but was never acked promotes ackedGuard and keeps local", async () => {
    const b = new MemoryRoomBackend();
    const { writer, lobby, session } = await host(b);

    // Hold a commit's resolution back until AFTER it has already applied to
    // the backend, then stop the writer while it's still "in flight" from
    // the writer's own point of view — this is exactly how a commit can
    // land on the server while the local process never gets to record the
    // acknowledgement (crash/close between the write landing and the
    // response being processed).
    const originalUpdate = b.update.bind(b);
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    b.update = async updates => {
      if (intercepted) return originalUpdate(updates);
      intercepted = true;
      await originalUpdate(updates);
      await gate;
    };
    const committing = writer.set(`${root}/storyteller/notes`, "in flight");
    await waitFor(() => expect(intercepted).toBe(true));
    const ackedGuardBefore = useStorytellerStore.getState().sync!.ackedGuard;
    writer.stop(); // the local process "dies" before onAck can fire
    release();
    await committing.catch(() => {}); // the commit's own promise still rejects (writer stopped) — that is fine and expected
    b.update = originalUpdate;

    const syncAfterStop = useStorytellerStore.getState().sync!;
    expect(syncAfterStop.ackedGuard).toEqual(ackedGuardBefore); // NOT advanced by the belated success
    expect(syncAfterStop.lastAttempt).not.toBeNull(); // the attempt is still unresolved evidence
    expect(await b.get(`${root}/writeGuard`)).toEqual(syncAfterStop.lastAttempt); // ...and it DID land on the server
    await writer.dispose();

    // Make local DIRTY too, so this test actually discriminates: if the
    // lost-ack were NOT recognized, "remote advanced beyond baseline" +
    // "dirty local" would produce CONFLICT instead of the correct
    // KEEP_LOCAL — lost-ack recognition must win BEFORE that check runs.
    useStorytellerStore.getState().addPlayer("Dirty edit atop the lost ack");
    expect(useStorytellerStore.getState().localSeq).toBeGreaterThan(useStorytellerStore.getState().sync!.ackedGameSeq);

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live"); // recognized as lost-ack KEEP_LOCAL, not CONFLICT
    expect(useSessionRuntime.getState().reconnect).toEqual({ status: "live" });
    expect(useStorytellerStore.getState().game!.seatOrder.some(id => useStorytellerStore.getState().game!.players[id]!.name === "Dirty edit atop the lost ack")).toBe(true);
    // ackedGuard/lastAttempt have since moved further still (the initial
    // flush that finishLive() performs is itself a fresh, real commit) —
    // the load-bearing proof is that this reconnect went "live" at all
    // rather than "conflict", which the dirty local edit above forces to
    // be a genuine discriminator.
    expect(useStorytellerStore.getState().sync!.lastAttempt).toBeNull();
  });

  it("reconnect after lease expiry with no takeover: an expired-but-unclaimed lease still reconnects live with local retained", async () => {
    const b = new MemoryRoomBackend();
    const { writer, lobby, session } = await host(b);
    useStorytellerStore.getState().addPlayer("Late Arrival");
    await waitFor(() => expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(useStorytellerStore.getState().localSeq));
    // Simulate the tab going dark long enough for the lease to expire,
    // WITHOUT any other Storyteller device ever taking over.
    await b.set(`${root}/writer`, { token: writer.token, expiresAt: 0 });
    const gameBefore = useStorytellerStore.getState().game;

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game).toEqual(gameBefore);
  });

  it("reconnect after a terminal denial (writer.stop() from a real report path) still reconnects live with local retained", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    useStorytellerStore.getState().addPlayer("Post-denial edit");
    await waitFor(() => expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(useStorytellerStore.getState().localSeq));
    // A terminal denial stops the writer directly, the same call the real
    // lease-renewal failure path makes.
    reportRuntimeError("write", "Terminal write failure.");
    writer.stop();
    manager.stop();
    await writer.dispose();

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });
    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.seatOrder.some(id => useStorytellerStore.getState().game!.players[id]!.name === "Post-denial edit")).toBe(true);
  });
});

describe("Phase 9C.2A reconnect integration: foreign-lineage (second device)", () => {
  it("stale CLEAN original + newer foreign remote: the foreign checkpoint is restored", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose(); // local is clean: no edits since the last acknowledged flush

    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 42 }));

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.day).toBe(42);
    expect(useStorytellerStore.getState().game).toEqual(foreignGame);
    expect(useStorytellerStore.getState().undoStack).toEqual([]); // cleared: remote was deliberately accepted
  });

  it("stale DIRTY original + newer foreign remote: CONFLICT is raised and neither side is written", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    // Unacknowledged local edit, made after this device went offline.
    useStorytellerStore.getState().addPlayer("Dirty Local Edit");
    const localGameBefore = useStorytellerStore.getState().game;

    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 7, notes: "foreign device notes" }));

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(() => replacement.dispose());

    expect(recovered.outcome).toBe("conflict");
    expect(useSessionRuntime.getState().reconnect.status).toBe("conflict");
    // Neither side was written: local keeps its own dirty edit...
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
    // ...and the remote still shows the foreign device's own content.
    expect(await b.get(`${root}/storyteller`)).toEqual(foreignGame);
    // No listeners were installed, no flush ran: the writer's lease is the
    // only thing still alive, still renewing, holding the compared remote
    // state frozen while the Storyteller decides.
    await expect(recovered.close()).rejects.toThrow(/conflict/i);
  });

  it("explicit resolution: 'useRemote' restores the still-current foreign checkpoint and goes live", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Dirty Local Edit");

    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 9 }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    expect(recovered.outcome).toBe("conflict");

    const result = await resolveReconnectConflict("useRemote");
    expect(result).toBe("applied");
    expect(useStorytellerStore.getState().game!.day).toBe(9);
    expect(useStorytellerStore.getState().game).toEqual(foreignGame);
    await waitFor(() => expect(useSessionRuntime.getState().reconnect).toEqual({ status: "live" }));
  });

  it("explicit resolution: 'keepLocal' publishes the local snapshot over the (still-current) foreign checkpoint", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Keep Me");
    const localGame = useStorytellerStore.getState().game;

    await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 3 }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    expect(recovered.outcome).toBe("conflict");

    const result = await resolveReconnectConflict("keepLocal");
    expect(result).toBe("applied");
    expect(useStorytellerStore.getState().game).toEqual(localGame); // untouched — this IS "keep mine"
    await waitFor(async () => expect(await b.get(`${root}/storyteller`)).toEqual(localGame)); // published via the normal path
  });

  it("explicit resolution is stale when the remote moved on again after CONFLICT was raised — the choice is not applied", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Dirty Local Edit");
    await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 1 }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    expect(recovered.outcome).toBe("conflict");
    const localGameBefore = useStorytellerStore.getState().game;

    // While CONFLICT holds, `replacement`'s own lease keeps renewing —
    // by design, no other SessionWriter can actually acquire it and write
    // through the normal path (that is exactly the safety property this
    // suite proves elsewhere: the compared remote state stays frozen while
    // the Storyteller decides). The realistic staleness window this test
    // targets is the conflicted writer's lease lapsing during a long
    // pause (e.g. a backgrounded tab whose timers were throttled) and
    // something else claiming and writing during that window — modeled
    // here as a direct backend mutation, seeding the precondition only,
    // not re-deriving lease fencing itself (proven elsewhere).
    await b.set(`${root}/writeGuard`, { token: "some-other-device-writer", revision: 999 });
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: { ...localGameBefore, day: 2 }, roster: {} }));

    const result = await resolveReconnectConflict("useRemote");
    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // the stale choice was never applied
  });

  /**
   * Luna review, Finding 2. Enters CONFLICT normally, then simulates a
   * genuinely different legitimate writer acquiring the server lease
   * WITHOUT publishing a new projection — writeGuard and checkpoint stay
   * byte-identical to the conflict snapshot, and the original conflicted
   * writer's own isStopped() still reads false (no live listeners are
   * installed while in CONFLICT, so nothing local has detected the loss).
   * Neither isStopped() nor guard/checkpoint equality can catch this —
   * only reconfirming actual server lease ownership can.
   */
  async function enterConflictThenLoseLeaseWithoutProjection(b: MemoryRoomBackend) {
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Dirty Local Edit Under Lease Takeover");
    await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 1 }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    expect(recovered.outcome).toBe("conflict");
    const localGameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;
    const guardBefore = await b.get(`${root}/writeGuard`);
    const checkpointBefore = await b.get(`${root}/checkpoint`);

    // Another legitimate writer acquires the lease directly (no projection
    // published, so guard/checkpoint stay exactly as they were) — this
    // models a real takeover, not a fabricated permission denial.
    await b.set(`${root}/writer`, { token: "another-legitimate-writer-token", expiresAt: Date.now() + 30_000 });
    expect(replacement.isStopped()).toBe(false); // locally, nothing detected the loss

    return { replacement, lobby, localGameBefore, undoBefore, guardBefore, checkpointBefore };
  }

  it("authority-loss regression (Luna Finding 2): 'useRemote' applies nothing when another writer has taken the lease without publishing", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, localGameBefore, undoBefore, guardBefore, checkpointBefore } =
      await enterConflictThenLoseLeaseWithoutProjection(b);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    const writeLogLengthBefore = b.writeLog.length;

    const result = await resolveReconnectConflict("useRemote");

    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // local unchanged
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore); // undo unchanged
    expect(await b.get(`${root}/writeGuard`)).toEqual(guardBefore); // remote guard unchanged
    expect(await b.get(`${root}/checkpoint`)).toEqual(checkpointBefore); // remote checkpoint unchanged
    // No reconciliation mutation and no projection from the stale resolver:
    // the only write since the snapshot was captured is the lease-takeover
    // seed itself, already reflected in writeLogLengthBefore.
    expect(b.writeLog.length).toBe(writeLogLengthBefore);
  });

  it("authority-loss regression (Luna Finding 2): 'keepLocal' applies nothing (no reconciliation, no projection) when another writer has taken the lease without publishing", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, localGameBefore, undoBefore, guardBefore, checkpointBefore } =
      await enterConflictThenLoseLeaseWithoutProjection(b);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    const writeLogLengthBefore = b.writeLog.length;

    const result = await resolveReconnectConflict("keepLocal");

    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    expect(await b.get(`${root}/writeGuard`)).toEqual(guardBefore);
    expect(await b.get(`${root}/checkpoint`)).toEqual(checkpointBefore);
    expect(b.writeLog.length).toBe(writeLogLengthBefore);
  });
});

describe("Phase 9C.2A reconnect integration: comparison-window integrity", () => {
  it("a local mutation happening during the checkpoint read is not silently ignored: the decision re-evaluates against the freshest local state", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose(); // local starts CLEAN

    // A foreign device advances the remote while this device is offline —
    // with local clean, an immediate decision would be RESTORE.
    await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 5 }));

    const originalGet = b.get.bind(b);
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/checkpoint` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(path);
    };

    const replacement = writerFor(b, session.id);
    const starting = startStorytellerSession(b, lobby, replacement);
    await waitFor(() => expect(paused).toBe(true));
    // A real local Storyteller edit lands WHILE the checkpoint read is in
    // flight — this makes local newer/dirty relative to the accepted
    // baseline, which must flip the eventual decision from RESTORE to
    // CONFLICT (never silently applying the stale RESTORE-favoring reading).
    useStorytellerStore.getState().addPlayer("Mutated during comparison");
    const localGameDuringComparison = useStorytellerStore.getState().game;
    release();
    b.get = originalGet;

    const recovered = await starting;
    disposals.push(() => replacement.dispose());

    expect(recovered.outcome).toBe("conflict"); // NOT "live" via a stale RESTORE
    expect(useStorytellerStore.getState().game).toEqual(localGameDuringComparison); // the mutation was not discarded
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation, Finding H2 — checkpoint identity is the
// server writeGuard alone, never a serialized checkpoint-content
// comparison. These reproduce Astra's report: conflict revalidation must
// not report "stale" merely because the checkpoint passed through a
// different object pipeline (key insertion order / Zod output ordering /
// stripped unknown keys) than the one that produced the original snapshot.
// ---------------------------------------------------------------------------
describe("Phase 9C.2A.2A remediation — H2 checkpoint identity (writeGuard-only)", () => {
  beforeEach(() => { useStorytellerStore.setState({ customScripts: { [setupScript.id]: setupScript } }); });

  /** A real game shaped by beginNightOne — not a synthetic fixture — using
   * the same recipe setupCommands.test.ts's own readiness tests rely on.
   * Establishes an initial acknowledged flush (via host()'s normal
   * startStorytellerSession path), then advances to night 1 through the
   * setup readiness gate itself, exactly as Astra's reproduction did.
   * Initial ordinary distribution is always the randomized deal — there is
   * no manual initial-assignment path — so this pools the roles and deals
   * them rather than assigning them by hand. */
  async function hostShapedByBeginNightOne(b: MemoryRoomBackend) {
    await createLobby(b, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(b, code);
    useStorytellerStore.getState().newGame(setupScript.id, { plannedPlayerCount: 5, plannedRoles: standardRoles(5) });
    for (let i = 0; i < 5; i++) useStorytellerStore.getState().addPlayerToSeat("Player " + i);
    expect(useStorytellerStore.getState().dealRolePool().ok).toBe(true);
    expect(useStorytellerStore.getState().revealRoles().ok).toBe(true);
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().setLobby(lobby);
    const writer = writerFor(b, session.id);
    const manager = await startStorytellerSession(b, lobby, writer);
    expect(manager.outcome).toBe("live");
    const readiness = useStorytellerStore.getState().beginNightOne();
    expect(readiness.ok).toBe(true); // sanity: this really is a beginNightOne-shaped game
    return { writer, manager, lobby, session };
  }

  it("H2-1: conflict on a real game shaped by beginNightOne resolves successfully when nothing remote changed", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await hostShapedByBeginNightOne(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Dirty edit atop a beginNightOne-shaped game");
    const localGameBefore = useStorytellerStore.getState().game;

    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, notes: "foreign device notes" }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    expect(recovered.outcome).toBe("conflict");

    // Nothing remote changes between CONFLICT being raised and resolution —
    // this must resolve, not report "stale" (Astra's exact reproduction:
    // pre-fix, a differently-ordered re-serialization of the SAME
    // checkpoint content could make this return "stale" indefinitely).
    const result = await resolveReconnectConflict("useRemote");
    expect(result).toBe("applied");
    expect(useStorytellerStore.getState().game).toEqual(foreignGame);
    void localGameBefore;
  });

  it("H2-2: forward-compatible/extra checkpoint fields (a different object pipeline's re-serialization) do not create false staleness — guard identity alone governs", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await hostShapedByBeginNightOne(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Dirty edit for H2-2");

    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, notes: "foreign notes" }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    expect(recovered.outcome).toBe("conflict");

    // Overwrite the checkpoint's own bytes with a re-serialization that
    // carries a forward-compatible extra field and different key order —
    // same guard, same effective content, different bytes. The OLD
    // checkpoint-string comparison would have called this "stale" forever;
    // guard-only identity must not.
    const rawCheckpoint = await b.get(`${root}/checkpoint`) as string;
    const parsed = JSON.parse(rawCheckpoint) as { game: unknown; roster: unknown };
    const reordered = JSON.stringify({ roster: parsed.roster, game: { ...(parsed.game as object), __futureField: "from a later client version" } });
    await b.set(`${root}/checkpoint`, reordered);

    const result = await resolveReconnectConflict("useRemote");
    expect(result).toBe("applied");
    expect(useStorytellerStore.getState().game).toEqual(foreignGame); // the schema strips the unknown field on read
  });

  it("H2-3: a genuine projection advancement (new guard AND new checkpoint) still makes the choice stale", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await hostShapedByBeginNightOne(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Dirty edit for H2-3");
    const localGameBefore = useStorytellerStore.getState().game;

    await foreignDeviceAdvance(b, session.id, g => ({ ...g, notes: "first foreign advance" }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    expect(recovered.outcome).toBe("conflict");

    // A further, genuine projection write lands after CONFLICT was raised.
    // `replacement`'s own lease is still held and renewing throughout
    // CONFLICT (by design — see the module doc comment), so a THIRD real
    // writer cannot legitimately acquire it here; this directly seeds the
    // precondition (a real writer having published while this one's lease
    // had lapsed) the same way the pre-existing "remote moved on again"
    // test above does, rather than re-deriving lease takeover itself.
    await b.set(`${root}/checkpoint`, JSON.stringify({ game: { ...localGameBefore, notes: "second foreign advance, after CONFLICT was raised" }, roster: {} }));
    await b.set(`${root}/writeGuard`, { token: "second-foreign-writer", revision: 999 });

    const result = await resolveReconnectConflict("useRemote");
    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
  });

  it("H2-4: a membership-only guard advancement (checkpoint content unchanged) also makes the choice stale — intentionally conservative", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await hostShapedByBeginNightOne(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("Dirty edit for H2-4");
    const localGameBefore = useStorytellerStore.getState().game;

    await foreignDeviceAdvance(b, session.id, g => ({ ...g, notes: "foreign advance before CONFLICT" }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { replacement.stop(); await replacement.dispose(); });
    expect(recovered.outcome).toBe("conflict");
    const checkpointBefore = await b.get(`${root}/checkpoint`);

    // Advance ONLY the guard — exactly what a membership-only write does in
    // production (writeGuard strictly advances; checkpoint is untouched).
    await b.set(`${root}/writeGuard`, { token: "membership-only-writer", revision: 999 });
    expect(await b.get(`${root}/checkpoint`)).toEqual(checkpointBefore); // checkpoint truly unchanged

    const result = await resolveReconnectConflict("useRemote");
    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation, Finding H1 — conflict authority must remain
// continuously valid through the instant immediately before a destructive
// local mutation. Date.now is mocked (never faked timers/sleeps) to make a
// lease genuinely lapsing during the post-authority reads deterministic and
// instantaneous, reproducing Astra's report that those reads can outlive
// the 30-second lease before useRemote replaces local game state.
// ---------------------------------------------------------------------------
describe("Phase 9C.2A.2A remediation — H1 continuous authority through destructive mutation", () => {
  async function enterConflict(b: MemoryRoomBackend, note: string) {
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer(note);
    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 3 }));
    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    expect(recovered.outcome).toBe("conflict");
    return {
      replacement, lobby, session, foreignGame,
      localGameBefore: useStorytellerStore.getState().game,
      undoBefore: useStorytellerStore.getState().undoStack,
    };
  }

  /** Pauses the very next read of `${root}/writeGuard` — the first server
   * read resolveReconnectConflict performs after reconfirming authority —
   * so a test can advance the mocked clock while that read is "in flight",
   * modeling reads that outlive the lease without any real or fake sleep. */
  function pauseGuardRead(b: MemoryRoomBackend) {
    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/writeGuard` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(path);
    };
    return {
      waitPaused: () => waitFor(() => expect(paused).toBe(true)),
      release: () => { b.get = originalGet; releaseGate(); },
    };
  }

  it("positive control: a delay shorter than the valid lease still applies useRemote", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, foreignGame } = await enterConflict(b, "H1 positive control");
    disposals.push(() => replacement.dispose());
    const { waitPaused, release } = pauseGuardRead(b);
    const realNowAtResolve = Date.now();
    const resolving = resolveReconnectConflict("useRemote");
    await waitPaused(); // real Date.now throughout this wait — safe for waitFor's own internals
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNowAtResolve + 1000); // comfortably inside the 30s lease
    release();
    const result = await resolving;
    nowSpy.mockRestore();
    expect(result).toBe("applied");
    expect(useStorytellerStore.getState().game).toEqual(foreignGame);
  });

  it("Astra's exact H1 reproduction: useRemote is stale once continuous authority lapses during the post-authority reads — no foreign writer required, guard/checkpoint unchanged", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, localGameBefore } = await enterConflict(b, "H1 pure time lapse");
    disposals.push(() => replacement.dispose());
    const { waitPaused, release } = pauseGuardRead(b);
    const realNowAtResolve = Date.now();
    const resolving = resolveReconnectConflict("useRemote");
    await waitPaused();
    // The reads outlive the 30-second lease — nothing else ever touched
    // writeGuard or checkpoint; only time passed.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNowAtResolve + LEASE_MS + 1);
    release();
    const result = await resolving;
    nowSpy.mockRestore();
    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // untouched
  });

  it("useRemote is stale when authority lapses AND a genuinely different writer takes the lease and publishes new content during the reads", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, session, localGameBefore } = await enterConflict(b, "H1 lapse with foreign takeover+publish");
    disposals.push(() => replacement.dispose());
    const { waitPaused, release } = pauseGuardRead(b);
    const realNowAtResolve = Date.now();
    const resolving = resolveReconnectConflict("useRemote");
    await waitPaused();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNowAtResolve + LEASE_MS + 1);
    const takeoverWriter = writerFor(b, session.id);
    await takeoverWriter.start(); // legitimately reclaims — replacement's recorded expiry has genuinely lapsed
    const takeoverGame = { ...localGameBefore!, day: 77, notes: "a real takeover's own content" };
    await writeProjections({ backend: takeoverWriter, code, stState: takeoverGame, registry: buildRegistry(troubleBrewing), online: {}, membership: {} });
    disposals.push(() => takeoverWriter.dispose());
    release();
    const result = await resolving;
    nowSpy.mockRestore();
    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
    expect(await b.get(`${root}/storyteller`)).toEqual(takeoverGame); // the takeover's content stands, untouched by us
  });

  it("keepLocal is also stale when authority lapses during the reads — no reconciliation, no projection", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, localGameBefore, undoBefore } = await enterConflict(b, "H1 keepLocal lapse");
    disposals.push(() => replacement.dispose());
    const writeLogLengthBefore = b.writeLog.length;
    const { waitPaused, release } = pauseGuardRead(b);
    const realNowAtResolve = Date.now();
    const resolving = resolveReconnectConflict("keepLocal");
    await waitPaused();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNowAtResolve + LEASE_MS + 1);
    release();
    const result = await resolving;
    nowSpy.mockRestore();
    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    // Exactly one write happened: reconfirmAuthority()'s own successful
    // lease renewal (it genuinely still held the lease at that instant —
    // only the LATER synchronous gate catches the lapse). No membership
    // reconciliation write and no projection followed it.
    expect(b.writeLog.length).toBe(writeLogLengthBefore + 1);
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation, Finding B1 — a recognized lost acknowledgement
// must become durable accepted evidence SYNCHRONOUSLY, before any later
// await lets a subsequent writer attempt allocate (and overwrite
// `lastAttempt` with) another revision.
// ---------------------------------------------------------------------------
describe("Phase 9C.2A.2A remediation — B1 durable lost-ack promotion", () => {
  it("Astra reproduction: a recovered lost acknowledgement is durably promoted BEFORE the next writer attempt, survives that attempt's own failure, and survives a real localStorage reload", async () => {
    const b = new MemoryRoomBackend();
    const { writer, lobby, session } = await host(b);

    // A1: a commit that lands on the real backend but is never locally
    // acknowledged — the same "lost ack" shape as the existing regression
    // test above, reused here as the starting point for this longer
    // sequence.
    const originalUpdate = b.update.bind(b);
    let releaseA1: () => void = () => {};
    const a1Gate = new Promise<void>(resolve => { releaseA1 = resolve; });
    let a1Intercepted = false;
    b.update = async updates => {
      if (a1Intercepted) return originalUpdate(updates);
      a1Intercepted = true;
      await originalUpdate(updates);
      await a1Gate;
    };
    const a1Commit = writer.set(`${root}/storyteller/notes`, "A1 — lost ack");
    await waitFor(() => expect(a1Intercepted).toBe(true));
    writer.stop(); // the local process "dies" before onAck can fire
    releaseA1();
    await a1Commit.catch(() => {});
    b.update = originalUpdate;
    const a1Guard = useStorytellerStore.getState().sync!.lastAttempt;
    expect(a1Guard).not.toBeNull();
    expect(useStorytellerStore.getState().sync!.ackedGuard).not.toEqual(a1Guard); // not yet promoted
    expect(await b.get(`${root}/writeGuard`)).toEqual(a1Guard); // it DID land on the server
    await writer.dispose();

    // Reconnect: pause the membership read — the first await after the
    // reconnect decision, strictly before finishLive()'s own initial flush
    // ("C2" below) can even be attempted — to observe that durable
    // promotion has ALREADY happened by that point.
    const originalGet = b.get.bind(b);
    let releaseMembership: () => void = () => {};
    const membershipGate = new Promise<void>(resolve => { releaseMembership = resolve; });
    let membershipPaused = false;
    b.get = async path => {
      if (path === `${root}/roster` && !membershipPaused) {
        membershipPaused = true;
        await membershipGate;
      }
      return originalGet(path);
    };
    const replacement = writerFor(b, session.id);
    disposals.push(() => replacement.dispose());
    const reconnecting = startStorytellerSession(b, lobby, replacement);
    await waitFor(() => expect(membershipPaused).toBe(true));

    // Durable promotion, proven strictly BEFORE the next writer attempt: no
    // commit for C2 has been attempted yet, and yet ackedGuard already
    // reflects A1, with lastAttempt already cleared.
    expect(useStorytellerStore.getState().sync!.ackedGuard).toEqual(a1Guard);
    expect(useStorytellerStore.getState().sync!.lastAttempt).toBeNull();
    b.get = originalGet;
    releaseMembership();

    // Now make C2 — finishLive()'s own initial flush — fail OUTRIGHT
    // (never reach the server at all), a non-transient failure the
    // writer's own retry budget does not retry.
    let c2Attempted = false;
    b.update = async updates => {
      if (!c2Attempted && `${root}/storyteller` in updates) {
        c2Attempted = true;
        throw new Error("PERMISSION_DENIED");
      }
      return originalUpdate(updates);
    };
    await expect(reconnecting).rejects.toThrow();
    expect(c2Attempted).toBe(true);
    b.update = originalUpdate;
    await replacement.dispose();

    // The remote guard is UNCHANGED from A1 (C2 never landed) — the
    // store's durable ackedGuard already reflects exactly that, unaffected
    // by C2's own failed attempt having overwritten lastAttempt in between.
    expect(await b.get(`${root}/writeGuard`)).toEqual(a1Guard);
    expect(useStorytellerStore.getState().sync!.ackedGuard).toEqual(a1Guard);

    // Real "close the tab, reopen it" cycle: persist to actual
    // localStorage, wipe in-memory state, rehydrate from exactly what
    // localStorage holds — no in-memory shortcuts.
    await new Promise(resolve => setTimeout(resolve, 0));
    const persisted = localStorage.getItem("new-blood-st");
    expect(persisted).toBeTruthy();
    useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null });
    localStorage.setItem("new-blood-st", persisted!);
    await useStorytellerStore.persist.rehydrate();
    expect(useStorytellerStore.getState().sync!.ackedGuard).toEqual(a1Guard); // survived the real round trip

    // The next reconnect must KEEP_LOCAL against the still-A1 remote guard
    // — exactly baseline_current, never a false CONFLICT from a "forgotten" A1.
    const finalWriter = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, finalWriter);
    disposals.push(async () => { recovered.stop(); await finalWriter.dispose(); });
    expect(recovered.outcome).toBe("live");
    expect(useSessionRuntime.getState().reconnect).toEqual({ status: "live" });
  });

  it("repeats with a lost MEMBERSHIP-ONLY write as A1 (not a game-content flush) — promotion still happens before the next writer attempt, and ackedGameSeq is never advanced by it", async () => {
    const b = new MemoryRoomBackend();
    const { writer, lobby, session } = await host(b);
    const ackedGameSeqBefore = useStorytellerStore.getState().sync!.ackedGameSeq;

    const originalUpdate = b.update.bind(b);
    let releaseA1: () => void = () => {};
    const a1Gate = new Promise<void>(resolve => { releaseA1 = resolve; });
    let a1Intercepted = false;
    b.update = async updates => {
      if (a1Intercepted) return originalUpdate(updates);
      a1Intercepted = true;
      await originalUpdate(updates);
      await a1Gate;
    };
    // A genuine membership command — never touches `game`/seqAtFlush.
    const a1Commit = revokePlayerMembership(writer, code, "no-such-player-id");
    await waitFor(() => expect(a1Intercepted).toBe(true));
    writer.stop();
    releaseA1();
    await a1Commit.catch(() => {});
    b.update = originalUpdate;
    const a1Guard = useStorytellerStore.getState().sync!.lastAttempt;
    expect(a1Guard).not.toBeNull();
    await writer.dispose();

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    // Promoted durably: ackedGuard reflects (at least) A1's revision by
    // the time this resolves (finishLive's own subsequent flush may have
    // advanced it further still — the load-bearing proof is that nothing
    // was forgotten in between).
    expect(useStorytellerStore.getState().sync!.ackedGuard!.revision).toBeGreaterThanOrEqual(a1Guard!.revision);
    // A membership-only recovery must never be inferred as authorizing an
    // ackedGameSeq advance on its own — only finishLive's own real,
    // separately-tracked flush may advance it, and only to what it itself
    // captured.
    expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBeGreaterThanOrEqual(ackedGameSeqBefore);
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation, Finding H1 follow-up (Luna review) —
// membership reconciliation must be fenced by the SAME synchronous
// authority gate as restoreRemoteCheckpoint(): its own local mutations
// (unseatPlayer/assignPendingToSeat) previously ran after an ADDITIONAL,
// un-gated roster read and interleaved with awaited server revocations, so
// a lease that lapsed specifically during that later read could still let
// a stale local membership mutation through even though the earlier
// checkpoint-restore gate had already passed.
// ---------------------------------------------------------------------------
describe("Phase 9C.2A.2A remediation — H1 follow-up: membership reconciliation fencing", () => {
  const ghostUid = "h1-followup-ghost-uid";
  const bobUid = "h1-followup-bob-uid";

  /** Enters CONFLICT via a foreign device whose checkpoint exercises BOTH
   * membership-driven local mutation paths reconciliation can take:
   * `vanishSeatId` is bound to `ghostUid` in the checkpoint's OWN embedded
   * roster (the `priorRoster` diff target for useRemote) but is NOT bound
   * to her in the LIVE `/roster` — triggering unseatPlayer. `recoverSeatId`
   * is EMPTY with a matching pendingPlayers entry in the checkpoint's game,
   * while the LIVE `/roster` DOES bind `bobUid` to it — triggering
   * assignPendingToSeat. */
  async function enterConflictWithMembershipWork(b: MemoryRoomBackend) {
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    useStorytellerStore.getState().addPlayer("H1-follow-up dirty edit");
    // Also queue bobUid locally, so the "recover" scenario is exercisable
    // for BOTH choices: useRemote recovers from the checkpoint's OWN
    // pendingPlayers (set below); keepLocal must recover from exactly
    // this local queue, since it never touches the checkpoint at all.
    useStorytellerStore.getState().addToPendingQueue(bobUid, "Bob");
    const localGameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;

    const foreignWriter = writerFor(b, session.id);
    await foreignWriter.start();
    const baseGame = await foreignWriter.get(`${root}/storyteller`) as unknown as StorytellerLobbyRecord;
    const [vanishSeatId, recoverSeatId] = baseGame.seatOrder as [string, string];
    const foreignGame: StorytellerLobbyRecord = {
      ...structuredClone(baseGame),
      day: 9,
      players: {
        ...structuredClone(baseGame.players),
        // Phase 10A: an occupied seat always carries its participation
        // identity (occupySeat). This v19 checkpoint is current-version data
        // and is never "repaired" by identity migration, so the fabricated
        // occupant carries the same deterministic id that repair produced.
        [vanishSeatId]: { ...baseGame.players[vanishSeatId]!, name: "Ghost (checkpoint-only)", isEmpty: false,
          participantId: `legacy-current:${vanishSeatId}` },
        [recoverSeatId]: { ...baseGame.players[recoverSeatId]!, isEmpty: true },
      },
      pendingPlayers: { [bobUid]: "Bob" },
    };
    await writeProjections({
      backend: foreignWriter, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {},
      membership: { [ghostUid]: vanishSeatId }, // embedded in the CHECKPOINT only
    });
    await foreignWriter.dispose();
    // The LIVE roster: ghostUid is NOT bound (her checkpoint-era binding
    // has vanished); bobUid IS bound to the recover seat (his membership
    // write landed even though the local assignPendingToSeat mutation
    // that should have accompanied it never did).
    await b.set(`${root}/roster/${bobUid}`, recoverSeatId);

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    expect(recovered.outcome).toBe("conflict");
    return { replacement, lobby, session, foreignGame, localGameBefore, undoBefore, vanishSeatId, recoverSeatId };
  }

  /** Pauses the very next read of `${root}/roster` — Luna's exact
   * reproduction step: "delay the roster read long enough that the lease
   * expires". */
  function pauseRosterRead(b: MemoryRoomBackend) {
    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/roster` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(path);
    };
    return {
      waitPaused: () => waitFor(() => expect(paused).toBe(true)),
      release: () => { b.get = originalGet; releaseGate(); },
    };
  }

  it("Luna reproduction: useRemote is stale when the roster read outlives the lease and another writer takes authority — no local membership mutation, no server write", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, session, localGameBefore, undoBefore, vanishSeatId, recoverSeatId } = await enterConflictWithMembershipWork(b);
    disposals.push(() => replacement.dispose());
    // Filtered the same way it's checked below: writer-lease-path writes
    // (ordinary renewals, takeovers) are expected and unrelated to this
    // assertion, which is specifically about revocation/projection writes.
    const writeLogLengthBefore = b.writeLog.filter(w => w.path !== `${root}/writer`).length;
    const { waitPaused, release } = pauseRosterRead(b);
    const realNowAtResolve = Date.now();
    const resolving = resolveReconnectConflict("useRemote");
    await waitPaused(); // real Date.now throughout this wait — safe for waitFor's own internals

    // Authority lapses purely from elapsed (mocked) time, AND a genuinely
    // different writer takes over — both halves of Luna's reproduction.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNowAtResolve + LEASE_MS + 1);
    const takeoverWriter = writerFor(b, session.id);
    await takeoverWriter.start(); // legitimately reclaims — replacement's recorded expiry has genuinely lapsed
    disposals.push(() => takeoverWriter.dispose());
    release();
    const result = await resolving;
    nowSpy.mockRestore();

    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // untouched entirely
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    // Specifically: neither membership-driven local mutation occurred.
    expect(useStorytellerStore.getState().game!.players[vanishSeatId]).toEqual(localGameBefore!.players[vanishSeatId]);
    expect(useStorytellerStore.getState().game!.players[recoverSeatId]).toEqual(localGameBefore!.players[recoverSeatId]);
    expect(useStorytellerStore.getState().game!.pendingPlayers).toEqual(localGameBefore!.pendingPlayers);
    // No server writes from the stale resolver — the takeover's own lease
    // acquisition (a `${root}/writer` write) is the only write since the
    // snapshot; no revocation, no projection.
    expect(b.writeLog.filter(w => w.path !== `${root}/writer`).length).toBe(writeLogLengthBefore);
  });

  it("positive control: a delay shorter than the valid lease still applies useRemote and performs both reconciliation local mutations correctly", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, vanishSeatId, recoverSeatId } = await enterConflictWithMembershipWork(b);
    disposals.push(() => replacement.dispose());
    const { waitPaused, release } = pauseRosterRead(b);
    const realNowAtResolve = Date.now();
    const resolving = resolveReconnectConflict("useRemote");
    await waitPaused();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNowAtResolve + 1000); // comfortably inside the 30s lease
    release();
    const result = await resolving;
    nowSpy.mockRestore();

    expect(result).toBe("applied");
    // Restored to the foreign checkpoint's content, then reconciled: the
    // vanish seat is unseated (ghostUid's binding vanished from the live
    // roster); the recover seat is filled from pendingPlayers (bob).
    const game = useStorytellerStore.getState().game!;
    expect(game.players[vanishSeatId]!.isEmpty).toBe(true);
    expect(game.players[recoverSeatId]!.isEmpty).toBe(false);
    expect(game.players[recoverSeatId]!.name).toBe("Bob");
    expect(game.pendingPlayers[bobUid]).toBeUndefined();
  });

  it("keepLocal path also performs pending-player recovery correctly when authority remains valid (no priorRoster, so no unseat is attempted)", async () => {
    const b = new MemoryRoomBackend();
    const { replacement, localGameBefore, recoverSeatId } = await enterConflictWithMembershipWork(b);
    disposals.push(() => replacement.dispose());
    const { waitPaused, release } = pauseRosterRead(b);
    const realNowAtResolve = Date.now();
    const resolving = resolveReconnectConflict("keepLocal");
    await waitPaused();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNowAtResolve + 1000);
    release();
    const result = await resolving;
    nowSpy.mockRestore();

    expect(result).toBe("applied");
    const game = useStorytellerStore.getState().game!;
    // keepLocal: local game content is unchanged except for the live
    // membership reconciliation that always runs regardless of choice.
    expect(game.day).toBe(localGameBefore!.day);
    expect(game.players[recoverSeatId]!.isEmpty).toBe(false);
    expect(game.players[recoverSeatId]!.name).toBe("Bob");
    expect(game.pendingPlayers[bobUid]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.2B.1 remediation — the automatic startup path (startStorytellerSession
// itself, not resolveReconnectConflict) now carries its own continuous
// AuthorityHandle across the checkpoint/roster reads it performs, gated by
// the same synchronous holdsAuthority() check immediately before any
// destructive local mutation (Finding H1, extended). Reproduces the real
// race: startup's checkpoint/roster read is delayed past lease expiry, a
// genuinely different writer legitimately takes over and publishes newer
// state, and the delayed read resumes — the stale startup must not restore
// remote content, clear undo, commit a stale sync baseline, or perform a
// membership-driven local mutation; the takeover's own state must remain
// untouched. `isStopped()`/the passive ~10s renewal interval alone cannot
// catch this (no real 10s elapses in these tests), which is exactly why
// the earlier automatic path was vulnerable.
// ---------------------------------------------------------------------------
describe("Phase 9C.2B.1 remediation — automatic startup authority fence", () => {
  it("delayed checkpoint takeover: a startup whose checkpoint read outlives its own authority must not restore stale content, clear undo, or alter sync metadata — the genuine takeover's state remains intact", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose(); // local starts CLEAN

    // An initial remote advance so the automatic decision would ordinarily
    // be RESTORE once startup begins.
    await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 5 }));
    const localGameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;
    const syncBefore = useStorytellerStore.getState().sync;

    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/checkpoint` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(path);
    };

    const replacementA = writerFor(b, session.id);
    disposals.push(() => replacementA.dispose());
    const startingA = startStorytellerSession(b, lobby, replacementA);
    await waitFor(() => expect(paused).toBe(true));

    // A's own continuous authority lapses purely from elapsed (mocked) time
    // while its checkpoint read is still in flight...
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + LEASE_MS + 1);
    // ...and a genuinely different writer (B) legitimately reclaims the
    // now-expired lease and publishes newer content.
    const takeoverWriter = writerFor(b, session.id);
    disposals.push(() => takeoverWriter.dispose());
    await takeoverWriter.start(); // legitimately reclaims — A's recorded expiry has genuinely lapsed
    const baseGameRaw = await b.get(`${root}/storyteller`);
    const takeoverGame = { ...(baseGameRaw as unknown as StorytellerLobbyRecord), day: 77, notes: "a real takeover's own content" };
    await writeProjections({ backend: takeoverWriter, code, stState: takeoverGame, registry: buildRegistry(troubleBrewing), online: {}, membership: {} });

    b.get = originalGet;
    releaseGate();

    await expect(startingA).rejects.toThrow(/another/i);
    nowSpy.mockRestore();

    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // never restored to anything
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore); // never cleared
    expect(useStorytellerStore.getState().sync).toEqual(syncBefore); // never committed a stale baseline
    expect(await b.get(`${root}/storyteller`)).toEqual(takeoverGame); // B's state remains intact, untouched by A
  });

  it("delayed roster/membership takeover: authority lost after the checkpoint is processed but before membership reconciliation must not mutate local membership or revoke remotely", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose(); // local starts CLEAN

    const foreignWriter = writerFor(b, session.id);
    await foreignWriter.start();
    const baseGame = await b.get(`${root}/storyteller`) as unknown as StorytellerLobbyRecord;
    const [vanishSeatId] = baseGame.seatOrder as [string];
    const foreignGame: StorytellerLobbyRecord = {
      ...structuredClone(baseGame),
      day: 9,
      players: {
        ...structuredClone(baseGame.players),
        // Phase 10A: an occupied seat always carries its participation
        // identity (occupySeat). This v19 checkpoint is current-version data
        // and is never "repaired" by identity migration, so the fabricated
        // occupant carries the same deterministic id that repair produced.
        [vanishSeatId]: { ...baseGame.players[vanishSeatId]!, name: "Ghost (checkpoint-only)", isEmpty: false,
          participantId: `legacy-current:${vanishSeatId}` },
      },
    };
    await writeProjections({
      backend: foreignWriter, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {},
      membership: { "delayed-roster-ghost-uid": vanishSeatId }, // embedded in the CHECKPOINT only
    });
    await foreignWriter.dispose();
    // The LIVE roster never binds this uid — her checkpoint-era binding has
    // "vanished" — exactly what would trigger unseatPlayer on RESTORE.

    const localGameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;
    const writeLogLengthBefore = b.writeLog.filter(w => w.path !== `${root}/writer`).length;

    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/roster` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(path);
    };

    const replacementA = writerFor(b, session.id);
    disposals.push(() => replacementA.dispose());
    const startingA = startStorytellerSession(b, lobby, replacementA);
    await waitFor(() => expect(paused).toBe(true));

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + LEASE_MS + 1);
    const takeoverWriter = writerFor(b, session.id);
    disposals.push(() => takeoverWriter.dispose());
    await takeoverWriter.start(); // legitimately reclaims — A's recorded expiry has genuinely lapsed

    b.get = originalGet;
    releaseGate();

    await expect(startingA).rejects.toThrow(/another/i);
    nowSpy.mockRestore();

    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // never restored, never unseated
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    // No revocation/projection write from the stale startup — the
    // takeover's own lease acquisition (a `${root}/writer` write) is the
    // only write since the snapshot.
    expect(b.writeLog.filter(w => w.path !== `${root}/writer`).length).toBe(writeLogLengthBefore);
  });

  it("positive control: a delay comfortably inside the valid lease still completes automatic RESTORE and membership reconciliation", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();

    const foreignWriter = writerFor(b, session.id);
    await foreignWriter.start();
    const baseGame = await b.get(`${root}/storyteller`) as unknown as StorytellerLobbyRecord;
    const [vanishSeatId] = baseGame.seatOrder as [string];
    const foreignGame: StorytellerLobbyRecord = {
      ...structuredClone(baseGame),
      day: 9,
      players: {
        ...structuredClone(baseGame.players),
        // Phase 10A: an occupied seat always carries its participation
        // identity (occupySeat). This v19 checkpoint is current-version data
        // and is never "repaired" by identity migration, so the fabricated
        // occupant carries the same deterministic id that repair produced.
        [vanishSeatId]: { ...baseGame.players[vanishSeatId]!, name: "Ghost (checkpoint-only)", isEmpty: false,
          participantId: `legacy-current:${vanishSeatId}` },
      },
    };
    await writeProjections({
      backend: foreignWriter, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {},
      membership: { "positive-control-ghost-uid": vanishSeatId },
    });
    await foreignWriter.dispose();

    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/roster` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(path);
    };

    const replacement = writerFor(b, session.id);
    const starting = startStorytellerSession(b, lobby, replacement);
    await waitFor(() => expect(paused).toBe(true));
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000); // comfortably inside the 30s lease
    b.get = originalGet;
    releaseGate();
    const recovered = await starting;
    nowSpy.mockRestore();
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.day).toBe(9);
    // Unseated: her checkpoint-era binding vanished from the live roster —
    // proof the new gate does not block normal, in-time reconciliation.
    expect(useStorytellerStore.getState().game!.players[vanishSeatId]!.isEmpty).toBe(true);
  });
});

describe("Phase 9C.2B.1 revision — startup guard/authority coherence (G1 -> G2 -> reacquire)", () => {
  // Luna's proven blocker, promoted to permanent regression. The defect the
  // earlier 41922a6 shape allowed: the guard reconnect compares
  // (observedGuard) and the AuthorityHandle that gates the decision could
  // belong to DIFFERENT authority generations, because the guard was read by
  // start() while the handle came from a SEPARATE, later reconfirmAuthority()
  // that could straddle a takeover. A writer that observes G1, loses authority
  // to a legitimate takeover which publishes G2, then legitimately REACQUIRES
  // (a new, VALID generation) must never carry its pre-gap G1 forward: a
  // post-gap valid handle may not legitimize a pre-gap guard. Both tests drive
  // the real startStorytellerSession production path.

  it("G1 -> G2 -> reacquire: a startup that observed G1, was taken over (G2), then legitimately reacquired must reject rather than combine pre-gap G1 with post-gap authority — B's newer G2 game survives", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    // A's own last acknowledged commit IS the current server guard (no foreign
    // advance yet): the guard A observes at startup equals its accepted
    // baseline — the exact shape that decides KEEP_LOCAL (baseline_current)
    // and would flush A's stale local game over any newer remote if trusted.
    manager.stop(); await writer.dispose();
    const localGameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;
    const syncBefore = useStorytellerStore.getState().sync;

    // Pause A's startup AT the writeGuard read (the authority/guard boundary
    // the coherent pair must span) and hand it back the PRE-gap guard value G1
    // — exactly what start() observed the instant before the takeover — while
    // the takeover and A's own reacquisition happen during the pause.
    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    let staleGuard: unknown;
    b.get = async path => {
      if (path === `${root}/writeGuard` && !paused) {
        paused = true;
        staleGuard = await originalGet(path); // capture G1 as observed pre-gap
        await gate;
        return staleGuard;                     // ...and return exactly that, post-gap
      }
      return originalGet(path);
    };

    const replacementA = writerFor(b, session.id);
    disposals.push(() => replacementA.dispose());
    const startingA = startStorytellerSession(b, lobby, replacementA);
    await waitFor(() => expect(paused).toBe(true));

    // 4. A's own continuous authority lapses purely from elapsed (mocked) time.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + LEASE_MS + 1);
    // 5-7. B legitimately reclaims the now-expired lease, publishes newer G2
    // game + guard, and releases.
    const takeoverWriter = writerFor(b, session.id);
    disposals.push(() => takeoverWriter.dispose());
    await takeoverWriter.start();
    const baseGameRaw = await b.get(`${root}/storyteller`);
    const takeoverGame = { ...(baseGameRaw as unknown as StorytellerLobbyRecord), day: 77, notes: "B's newer G2 content" };
    await writeProjections({ backend: takeoverWriter, code, stState: takeoverGame, registry: buildRegistry(troubleBrewing), online: {}, membership: {} });
    const g2Guard = await b.get(`${root}/writeGuard`);
    await takeoverWriter.dispose(); // B releases

    // 8. A LEGITIMATELY reacquires the now-free lease: a genuinely new, VALID
    // authority generation (leaseEpoch advances). The whole point is that this
    // valid post-gap handle must NOT rescue the pre-gap G1 observation.
    const reacquired = await replacementA.reconfirmAuthority();

    b.get = originalGet;
    releaseGate();

    // 9. A resumes — and must reject, never accept a G1 read under the prior,
    // now-superseded generation.
    await expect(startingA).rejects.toThrow(/another/i);
    // A genuinely holds VALID authority at this instant — proof the rejection
    // is a generation-coherence rejection, not merely "A lost the lease".
    expect(replacementA.holdsAuthority(reacquired, FENCE_MARGIN_MS)).toBe(true);
    nowSpy.mockRestore();

    // A never chose KEEP_LOCAL, never flushed, never promoted stale ACK
    // evidence, never minted conflict identity from G1: local game/undo/sync
    // are exactly as before it started.
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    expect(useStorytellerStore.getState().sync).toEqual(syncBefore);
    expect(useSessionRuntime.getState().reconnect.status).not.toBe("conflict");
    // B's newer G2 game AND guard survive intact — A's older local game was
    // never uploaded over them.
    expect(await b.get(`${root}/storyteller`)).toEqual(takeoverGame);
    expect(await b.get(`${root}/writeGuard`)).toEqual(g2Guard);
  });

  it("decision-side gate: authority lost + reacquired during the checkpoint read cancels a would-be CONFLICT rather than minting a conflict identity from pre-gap G1", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    // Local carries unacknowledged work AND the server has legitimately
    // advanced beyond A's baseline (G1): this evidence decides CONFLICT, which
    // returns BEFORE the final RESTORE/membership gate — so ONLY a gate placed
    // before the decision itself can stop a conflict identity being minted
    // from a guard observed across an authority gap.
    useStorytellerStore.getState().addPlayer("Dirty local edit");
    const localGameBefore = useStorytellerStore.getState().game;
    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 12, notes: "foreign advance -> G1" }));

    // The coherent {G1, handle} pair is established fine; pause strictly at the
    // checkpoint read so the gap happens AFTER start() has returned.
    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/checkpoint` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(path);
    };

    const replacementA = writerFor(b, session.id);
    disposals.push(() => replacementA.dispose());
    const startingA = startStorytellerSession(b, lobby, replacementA);
    await waitFor(() => expect(paused).toBe(true));

    // A's authority lapses; B legitimately takes and releases the lease; A
    // legitimately REACQUIRES a new, valid generation — all during the read.
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + LEASE_MS + 1);
    const takeoverWriter = writerFor(b, session.id);
    disposals.push(() => takeoverWriter.dispose());
    await takeoverWriter.start();
    await takeoverWriter.dispose();
    const reacquired = await replacementA.reconfirmAuthority();

    b.get = originalGet;
    releaseGate();

    await expect(startingA).rejects.toThrow(/another/i);
    // A holds VALID authority — just a newer generation than the checkpoint was
    // compared against — so the cancellation is coherence, not lease loss.
    expect(replacementA.holdsAuthority(reacquired, FENCE_MARGIN_MS)).toBe(true);
    nowSpy.mockRestore();

    // No conflict identity was minted from the stale G1/checkpoint pairing:
    // runtime never entered "conflict".
    expect(useSessionRuntime.getState().reconnect.status).not.toBe("conflict");
    // Neither side was written: A kept its own dirty local, and the remote
    // still shows the foreign device's own content.
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
    expect(await b.get(`${root}/storyteller`)).toEqual(foreignGame);
  });
});

describe("Phase 9C.2B.2B revision — RESTORE local-evidence coherence (edit during roster await)", () => {
  // Astra's proven blocker, promoted to permanent regression. Writer authority
  // stays continuously VALID throughout — the coherent startup pair and both
  // authority gates are correct and untouched. The defect is purely LOCAL: a
  // RESTORE decision is chosen against clean local evidence, then a normal
  // Storyteller UI mutation during the awaited roster read injects new local
  // intent, and the earlier RESTORE (which discards local, clears undo, and
  // records the guard as the accepted-clean baseline) would be applied anyway —
  // silently losing the edit AND marking the discarded sequence acknowledged.

  it("RESTORE + local edit during the roster await: authority stays valid, but the stale RESTORE is cancelled — the edit survives, undo is not cleared, sync is not falsely marked clean, and the newer remote is untouched", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose(); // local starts CLEAN

    // Legitimate newer remote checkpoint → decideReconnect() correctly picks RESTORE.
    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 42, notes: "legit newer remote" }));
    const foreignGuard = await b.get(`${root}/writeGuard`);
    const ackedSeqBefore = useStorytellerStore.getState().sync!.ackedGameSeq;

    // Pause the roster read — the exact window between the RESTORE decision and
    // its application (step 7 of Astra's reproduction).
    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/roster` && !paused) { paused = true; await gate; }
      return originalGet(path);
    };

    const replacementA = writerFor(b, session.id);
    disposals.push(() => replacementA.dispose());
    const startingA = startStorytellerSession(b, lobby, replacementA);
    await waitFor(() => expect(paused).toBe(true));

    // Normal Storyteller UI action through the real store command path, while
    // the roster read is still awaited. localSeq advances; local is now dirty.
    useStorytellerStore.getState().addPlayer("Roster-window local edit");
    const editedSeq = useStorytellerStore.getState().localSeq;
    const editedGame = useStorytellerStore.getState().game;
    const undoAfterEdit = useStorytellerStore.getState().undoStack;
    const hasEdit = () => useStorytellerStore.getState().game!.seatOrder.some(
      id => useStorytellerStore.getState().game!.players[id]!.name === "Roster-window local edit");
    expect(editedSeq).toBeGreaterThan(ackedSeqBefore); // the edit is genuinely new intent
    expect(undoAfterEdit.length).toBeGreaterThan(0);
    expect(hasEdit()).toBe(true);

    b.get = originalGet;
    releaseGate();

    // Authority never lapsed, so the cancellation must be attributable to LOCAL
    // evidence, not the authority fence: it carries the local-change message,
    // never the "another Storyteller tab" authority message.
    await expect(startingA).rejects.toThrow(/local game changed/i);
    await expect(startingA).rejects.not.toThrow(/another Storyteller/i);

    // Explicitly prove authority remained valid and uninterrupted — its epoch
    // never advanced beyond start()'s own single acquisition (no takeover, no
    // expiry ever happened here).
    const handle = await replacementA.reconfirmAuthority();
    expect(handle.epoch).toBe(1);
    expect(replacementA.holdsAuthority(handle, FENCE_MARGIN_MS)).toBe(true);

    // The Storyteller's edit survived: local game not restored to the
    // checkpoint, undo not cleared.
    expect(useStorytellerStore.getState().game).toEqual(editedGame);
    expect(hasEdit()).toBe(true);
    expect(useStorytellerStore.getState().undoStack).toEqual(undoAfterEdit);

    // sync was NOT falsely advanced to mark the discarded edit clean: the
    // accepted baseline is exactly where it was, and local is still dirty.
    expect(useStorytellerStore.getState().sync!.ackedGameSeq).toBe(ackedSeqBefore);
    expect(useStorytellerStore.getState().localSeq).toBe(editedSeq);
    expect(useStorytellerStore.getState().localSeq).toBeGreaterThan(useStorytellerStore.getState().sync!.ackedGameSeq);

    // No stale RESTORE-derived membership mutation; the newer remote
    // checkpoint/guard/game remain untouched.
    expect(useStorytellerStore.getState().game).not.toEqual(foreignGame);
    expect(await b.get(`${root}/storyteller`)).toEqual(foreignGame);
    expect(await b.get(`${root}/writeGuard`)).toEqual(foreignGuard);
  });

  it("recovery: after the stale RESTORE cancels with local now dirty, a fresh reconnect against the same newer remote classifies both-sides-diverged as CONFLICT via the existing table", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();

    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({ ...g, day: 21 }));

    // First attempt: RESTORE cancelled by an edit during the roster await.
    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/roster` && !paused) { paused = true; await gate; }
      return originalGet(path);
    };
    const replacementA = writerFor(b, session.id);
    disposals.push(() => replacementA.dispose());
    const first = startStorytellerSession(b, lobby, replacementA);
    await waitFor(() => expect(paused).toBe(true));
    useStorytellerStore.getState().addPlayer("Recovered-into-conflict edit");
    b.get = originalGet;
    releaseGate();
    await expect(first).rejects.toThrow(/local game changed/i);
    await replacementA.dispose(); // release the lease so a fresh attempt can reclaim

    // Local is now genuinely dirty; the remote is unchanged and still newer.
    expect(useStorytellerStore.getState().localSeq).toBeGreaterThan(useStorytellerStore.getState().sync!.ackedGameSeq);

    // Second attempt: a fresh reconnect. The existing decision table sees newer
    // remote + newer local unacknowledged work → CONFLICT. No new semantics.
    const replacementB = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacementB);
    disposals.push(async () => { recovered.stop(); await replacementB.dispose(); });

    expect(recovered.outcome).toBe("conflict");
    expect(useSessionRuntime.getState().reconnect.status).toBe("conflict");
    // Neither side written: local keeps its edit, remote keeps its own content.
    expect(useStorytellerStore.getState().game!.seatOrder.some(
      id => useStorytellerStore.getState().game!.players[id]!.name === "Recovered-into-conflict edit")).toBe(true);
    expect(await b.get(`${root}/storyteller`)).toEqual(foreignGame);
  });

  it("KEEP_LOCAL positive control: a local edit during the roster await is NOT cancelled — the RESTORE gate is narrow, so KEEP_LOCAL keeps the current (edited) local game and goes live", async () => {
    const b = new MemoryRoomBackend();
    const { writer, manager, lobby, session } = await host(b);
    manager.stop(); await writer.dispose();
    // No foreign advance: the server guard still equals the accepted baseline →
    // decideReconnect() picks KEEP_LOCAL (baseline_current), whose surviving
    // side is intentionally the CURRENT local game.

    const originalGet = b.get.bind(b);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    b.get = async path => {
      if (path === `${root}/roster` && !paused) { paused = true; await gate; }
      return originalGet(path);
    };

    const replacement = writerFor(b, session.id);
    const starting = startStorytellerSession(b, lobby, replacement);
    await waitFor(() => expect(paused).toBe(true));

    useStorytellerStore.getState().addPlayer("KEEP_LOCAL roster-window edit");
    const editedSeq = useStorytellerStore.getState().localSeq;

    b.get = originalGet;
    releaseGate();
    const recovered = await starting;
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    // Not cancelled: KEEP_LOCAL goes live, and the edit made during the roster
    // await is preserved (KEEP_LOCAL's surviving side is the current local
    // game, so the narrow RESTORE-only gate must not touch it).
    expect(recovered.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.seatOrder.some(
      id => useStorytellerStore.getState().game!.players[id]!.name === "KEEP_LOCAL roster-window edit")).toBe(true);
    expect(useStorytellerStore.getState().localSeq).toBe(editedSeq);
  });
});

// ---------------------------------------------------------------------------
// Phase 9D.5 Proofs C & D — Recovery & Phase 9 Integration. These reuse the
// exact same real SessionWriter/MemoryRoomBackend/startStorytellerSession
// machinery proven above, substituting the deliberately rich Phase 9 game
// (src/test/phase9RichState.ts) for the minimal two-seat fixture, to prove
// the already-approved reconnect paths carry every Phase 9 structured
// domain -- History with Provenance, Information Delivery, structured
// Effects/Reminders with lifetime and source, Traveler public
// character/private alignment/exile, Setup/Deal/Reveal state, night
// progress, and Storyteller-private notes -- through intact and unmixed,
// never fabricated or reconstructed from History.
// ---------------------------------------------------------------------------
describe("Phase 9D.5 Proof C: same-lineage reconnect integrity for a rich Phase 9 game", () => {
  it("clean reconnect: the full rich game -- History, Information Delivery, Effects/Reminders, Traveler alignment/exile, private notes -- survives untouched", async () => {
    const b = new MemoryRoomBackend();
    const { handles, writer, manager, lobby, session } = await hostRich(b);
    await waitFor(() => expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(useStorytellerStore.getState().localSeq));
    const gameBefore = useStorytellerStore.getState().game!;
    manager.stop(); await writer.dispose();

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    const gameAfter = useStorytellerStore.getState().game!;
    // Whole-object equality first: a same-lineage clean reconnect must
    // retain local UNTOUCHED -- catches any field a narrower check would miss.
    expect(gameAfter).toEqual(gameBefore);
    expect(gameAfter.history).toEqual(gameBefore.history);
    expect(gameAfter.history.length).toBeGreaterThan(0);
    expect(gameAfter.informationDeliveries).toEqual(gameBefore.informationDeliveries);
    expect(gameAfter.informationDeliveries.length).toBe(2);
    expect(gameAfter.players[handles.chefId]!.effects).toEqual(gameBefore.players[handles.chefId]!.effects);
    expect(gameAfter.players[handles.washerwomanId]!.reminders).toEqual(gameBefore.players[handles.washerwomanId]!.reminders);
    expect(gameAfter.players[handles.chefId]!.stNotes).toBe("SENTINEL-PRIVATE-CHEF-NOTE");
    expect(gameAfter.players[handles.travelerId]!.isTraveler).toBe(true);
    expect(gameAfter.players[handles.travelerId]!.actualAlignment).toBe("evil");
    expect(gameAfter.players[handles.travelerId]!.exiled).toBe(true);
    expect(gameAfter.players[handles.deadOrdinaryId]!.alive).toBe(false);
    expect(gameAfter.players[handles.ghostVoteToggledId]!.ghostVote).toBe(false);
    // Phase 10A: the Life Event Window reconnects untouched, in order.
    expect(gameAfter.lifeEventWindow).toEqual(gameBefore.lifeEventWindow);
    expect(gameAfter.lifeEventWindow.events.map((e) => e.kind)).toEqual(["death", "execution", "exile"]);
  });

  it("dirty reconnect: an unacknowledged local edit atop the rich game survives reconnect and flushes intact to the remote projection, without disturbing unrelated recorded domains", async () => {
    const b = new MemoryRoomBackend();
    const { handles, writer, manager, lobby, session } = await hostRich(b);
    await waitFor(() => expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(useStorytellerStore.getState().localSeq));
    manager.stop(); await writer.dispose();

    // Made after the writer stopped: never flushed, never acknowledged.
    useStorytellerStore.getState().addReminder(handles.investigatorId, {
      label: "Dirty edit reminder", lifetime: { kind: "manual" },
    });
    const dirtyGame = useStorytellerStore.getState().game!;
    expect(useStorytellerStore.getState().localSeq).toBeGreaterThan(useStorytellerStore.getState().sync!.ackedGameSeq);

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    const gameAfter = useStorytellerStore.getState().game!;
    expect(gameAfter.players[handles.investigatorId]!.reminders.map(r => r.label)).toEqual(["Dirty edit reminder"]);
    // Everything the dirty edit did not touch is exactly as it was --
    // proves the reconnect neither dropped nor cross-mixed unrelated
    // players'/domains' data while carrying the dirty edit through.
    expect(gameAfter.players[handles.chefId]!.effects).toEqual(dirtyGame.players[handles.chefId]!.effects);
    expect(gameAfter.players[handles.washerwomanId]!.effects).toEqual(dirtyGame.players[handles.washerwomanId]!.effects);
    expect(gameAfter.history).toEqual(dirtyGame.history);
    expect(gameAfter.informationDeliveries).toEqual(dirtyGame.informationDeliveries);
    expect(gameAfter.players[handles.travelerId]!.actualAlignment).toBe("evil");
    expect(gameAfter.players[handles.chefId]!.stNotes).toBe("SENTINEL-PRIVATE-CHEF-NOTE");
    expect(useStorytellerStore.getState().localSeq).toBe(useStorytellerStore.getState().sync!.ackedGameSeq); // the initial flush caught up

    const remoteGame = await b.get(`${root}/storyteller`) as unknown as StorytellerLobbyRecord;
    expect(remoteGame.players[handles.investigatorId]!.reminders.map(r => r.label)).toEqual(["Dirty edit reminder"]);
    expect(remoteGame.history.length).toBe(dirtyGame.history.length);
    expect(remoteGame.informationDeliveries.length).toBe(2);
  });
});

describe("Phase 9D.5 Proof D: remote checkpoint restore integrity for a rich Phase 9 game", () => {
  it("a clean local device restores a foreign device's further-advanced rich checkpoint with every structured domain intact, and never fabricates an Undo snapshot for it", async () => {
    const b = new MemoryRoomBackend();
    const { handles, writer, manager, lobby, session } = await hostRich(b);
    await waitFor(() => expect(useStorytellerStore.getState().sync?.ackedGameSeq).toBe(useStorytellerStore.getState().localSeq));
    manager.stop(); await writer.dispose(); // local is clean: no edits since the last acknowledged flush

    // A genuinely different device advances the SAME rich checkpoint
    // further -- proves RESTORE both preserves everything the rich local
    // game already carried AND correctly layers in the foreign delta.
    // Phase 10B (SOL-10B-R4): the foreign delta no longer jumps `day`
    // without a phase transition -- that would leave the rich game's Night 2
    // Effect overdue, invalid v20 state recovery must reject (covered in
    // effectMigration.test.ts). The adopted foreign delta is the addendum.
    const foreignGame = await foreignDeviceAdvance(b, session.id, g => ({
      ...g,
      players: {
        ...g.players,
        [handles.chefId]: {
          ...g.players[handles.chefId]!,
          stNotes: g.players[handles.chefId]!.stNotes + " -- foreign device addendum",
        },
      },
    }));

    const replacement = writerFor(b, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    const gameAfter = useStorytellerStore.getState().game!;
    expect(gameAfter).toEqual(foreignGame);
    expect(gameAfter.day).toBe(foreignGame.day);
    // Phase 10A: the restored window is the checkpoint's, exactly.
    expect(gameAfter.lifeEventWindow).toEqual(foreignGame.lifeEventWindow);
    expect(gameAfter.lifeEventWindow.events).toHaveLength(3);
    expect(gameAfter.history).toEqual(foreignGame.history);
    expect(gameAfter.history.length).toBeGreaterThan(0);
    expect(gameAfter.informationDeliveries).toEqual(foreignGame.informationDeliveries);
    expect(gameAfter.informationDeliveries.length).toBe(2);
    expect(gameAfter.players[handles.chefId]!.stNotes).toBe("SENTINEL-PRIVATE-CHEF-NOTE -- foreign device addendum");
    expect(gameAfter.players[handles.travelerId]!.isTraveler).toBe(true);
    expect(gameAfter.players[handles.travelerId]!.actualAlignment).toBe("evil");
    expect(gameAfter.players[handles.travelerId]!.exiled).toBe(true);
    expect(gameAfter.players[handles.chefId]!.effects.some(e => e.type === "poisoned")).toBe(true);
    expect(gameAfter.players[handles.washerwomanId]!.effects.some(e => e.type === "protected")).toBe(true);
    expect(gameAfter.players[handles.deadOrdinaryId]!.alive).toBe(false);
    // restoreRemoteCheckpoint always clears the undo stack outright (Phase
    // 9C semantics, unchanged here): adopting a remote checkpoint must
    // never leave behind -- or fabricate -- an Undo snapshot that could
    // later "undo" back into a lineage this device never actually lived
    // through.
    expect(useStorytellerStore.getState().undoStack).toEqual([]);
  });
});
