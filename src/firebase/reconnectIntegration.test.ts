// Phase 9C.2A (OPUS-001) — Step 4 reconnect integration tests. These cover
// the scenarios pure-decision unit tests can't: real SessionWriter lease
// fencing, real checkpoint reads through the real MemoryRoomBackend, and
// the full startStorytellerSession orchestration (decision -> apply ->
// reconcile -> finishLive), including the second-device ("foreign writer")
// safety rule and the "compare only after lease acquisition" ordering.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { writeProjections } from "./sync";
import { SessionWriter } from "./writer";
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
