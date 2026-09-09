// OPUS-007 contract suite. rules.spec.ts already proves the Storyteller
// projection/writer/membership-write path against enforced rules.json. This
// file proves the remaining half: the real PLAYER read handshake
// (playerSync.ts) and the real Storyteller app-level orchestration
// (storytellerSync.ts) agree with the same enforced rules, and that a real
// RTDB permission denial propagates to the correct domain outcome instead of
// being swallowed, retried into apparent success, or masked.
//
// Every subject here is real production code: FirebaseRoomBackend,
// SessionWriter, writeProjections, joinLobby/startPlayerHandshake,
// startStorytellerSession, the lobby/membership commands, and the actual
// zustand stores. No MemoryRoomBackend. withSecurityRulesDisabled is used
// only to seed an otherwise-inconvenient precondition (forcing a lease to
// look expired) — never around the operation being asserted.
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import type { Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { SessionWriter } from "./writer";
import { writeProjections } from "./sync";
import { createLobby, readRosterBindings, revokePlayerMembership, seatPlayer } from "./lobby";
import { revokePlayerAndCommit } from "./membershipCommands";
import { joinLobby, startPlayerHandshake } from "./playerSync";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { lifecycleMessage, requireActiveSession } from "./lifecycle";
import { friendlyFirebaseError } from "./errors";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore, type PlayerStatus } from "@/stores/playerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";

let env: RulesTestEnvironment;
beforeAll(async () => {
  const address = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
  if (!address || !/^(127\.0\.0\.1|localhost):\d+$/.test(address)) {
    throw new Error("A local RTDB emulator is required. Run npm run test:rules.");
  }
  const [host, port] = address.split(":");
  env = await initializeTestEnvironment({
    projectId: "demo-silverwick-rules",
    database: { host, port: Number(port), rules: readFileSync(resolve(__dirname, "rules.json"), "utf8") },
  });
});
afterAll(async () => { if (env) await env.cleanup(); });

const disposals: (() => void | Promise<void>)[] = [];
beforeEach(async () => {
  await env.clearDatabase();
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [] });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, error: null, presence: "unknown", online: {}, pending: 0, retry: 0 });
});
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

function backendFor(uid: string): FirebaseRoomBackend {
  return new FirebaseRoomBackend(env.authenticatedContext(uid).database() as unknown as Database);
}

async function waitForPlayerStatus(status: PlayerStatus, timeout = 5000): Promise<void> {
  await vi.waitFor(() => {
    const current = usePlayerStore.getState().status;
    if (current !== status) throw new Error(`expected player status "${status}", got "${current}"`);
  }, { timeout, interval: 100 });
}

/**
 * Real join → real seat → real projection publish, through the real writer.
 * Shared by the tests that need "a legitimately seated player" as their
 * starting state. Not a shim: every step is the same production entry point
 * the app itself calls.
 */
async function establishSeatedPlayer(code: string, st: string, alice: string) {
  const stBackend = backendFor(st);
  await createLobby(stBackend, st, { codeGenerator: () => code });
  const session = await requireActiveSession(stBackend, code);
  const writer = new SessionWriter(stBackend, code, session.id, error =>
    useSessionRuntime.setState({ error: error ? lifecycleMessage(error) : null }));
  await writer.start();

  useStorytellerStore.getState().newGame("tb");
  useStorytellerStore.getState().addPlayer("Alice");
  const [id] = useStorytellerStore.getState().game!.seatOrder as [string];
  useStorytellerStore.getState().setLobby({ code, uid: st, sessionId: session.id, status: "live" });
  useStorytellerStore.getState().assignRole(id, "chef");
  useStorytellerStore.getState().setShownRole(id, "chef");

  const aliceBackend = backendFor(alice);
  await joinLobby(aliceBackend, code, alice, "Alice");
  await seatPlayer(writer, code, alice, id, null);
  const membership = await readRosterBindings(writer, code);
  await writeProjections({
    backend: writer,
    code,
    stState: useStorytellerStore.getState().game!,
    registry: buildRegistry(troubleBrewing),
    online: {},
    membership,
  });

  return { stBackend, aliceBackend, writer, session, id };
}

describe("OPUS-007 contract: real client pathways against enforced Firebase rules", () => {
  test("CONTRACT-001: real join -> seat -> publish -> player handshake reaches authorized seated state", async () => {
    const code = "CT1AAAAA", st = "ct1-storyteller", alice = "ct1-alice";
    const { aliceBackend, writer, id } = await establishSeatedPlayer(code, st, alice);
    disposals.push(() => writer.dispose());

    const stop = startPlayerHandshake(aliceBackend, code, alice);
    disposals.push(stop);

    // This is the load-bearing new proof: if the real handshake ever begins
    // subscribing to a path a seated player is not authorized to read, the
    // real rule denial surfaces as a stuck/erroring status here, not "seated".
    await waitForPlayerStatus("seated");
    expect(usePlayerStore.getState().playerId).toBe(id);
    expect(usePlayerStore.getState().self).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(usePlayerStore.getState().remoteData).toEqual({ membership: "ready", request: "ready", self: "ready", public: "ready" });
    expect(usePlayerStore.getState().publicLobby).not.toBeNull();
    expect(usePlayerStore.getState().publicLobby!.players[id]).toBeTruthy();
    expect(usePlayerStore.getState().error).toBeNull();
  });

  test("CONTRACT-002: a real revocation propagates through the real handshake to a terminal revoked state", async () => {
    const code = "CT2AAAAA", st = "ct2-storyteller", alice = "ct2-alice";
    const { aliceBackend, writer, id } = await establishSeatedPlayer(code, st, alice);
    disposals.push(() => writer.dispose());

    const stop = startPlayerHandshake(aliceBackend, code, alice);
    disposals.push(stop);
    await waitForPlayerStatus("seated");

    // The appropriate production membership pathway — the same call
    // storytellerSync.ts's leave-request watcher makes.
    await revokePlayerAndCommit(writer, code, id, () => useStorytellerStore.getState().unseatPlayer(id));

    await waitForPlayerStatus("revoked");
    expect(usePlayerStore.getState().self).toBeNull();
    expect(usePlayerStore.getState().playerId).toBeNull();
    expect(usePlayerStore.getState().publicLobby).toBeNull();

    // Corroborate (not substitute for) the domain-state proof above: the
    // underlying live read really is denied by the real rule.
    await assertFails(env.authenticatedContext(alice).database().ref(`lobbies/${code}/player/${id}`).once("value"));

    // Stale membership cannot be used to simply rejoin: the durable outcome
    // record blocks it through the same real production entry point.
    await joinLobby(aliceBackend, code, alice, "Alice");
    expect(usePlayerStore.getState().status).toBe("revoked");
  });

  test("CONTRACT-003: an authenticated non-owner player is rejected by every real Storyteller-authoritative pathway", async () => {
    const code = "CT3AAAAA", st = "ct3-storyteller", alice = "ct3-alice", bob = "ct3-bob";
    const { stBackend, writer, session, id } = await establishSeatedPlayer(code, st, alice);
    disposals.push(() => writer.dispose());
    const bobBackend = backendFor(bob);

    // Cannot acquire Storyteller writer authority.
    const rogueWriter = new SessionWriter(bobBackend, code, session.id);
    await expect(rogueWriter.start()).rejects.toThrow(/permission[_ ]denied/i);
    await rogueWriter.dispose().catch(() => {});

    // Cannot invoke the Storyteller-authoritative revocation command for
    // another membership.
    const revokeError: unknown = await revokePlayerMembership(bobBackend, code, id).catch(error => error);
    expect(revokeError).toBeInstanceOf(Error);
    expect((revokeError as Error).message).toMatch(/permission[_ ]denied/i);

    // DISCOVERED PRODUCTION DEFECT, recorded (not fixed here — see the
    // implementation report for adjudication): friendlyFirebaseError's
    // PERMISSION_DENIED heuristics require err.code to be set, or the raw
    // message to contain the literal substring "permission_denied"
    // (underscore). The real Firebase JS SDK (firebase ^12.12.1) throws a
    // plain Error with code:undefined and message:"Permission denied"
    // (space, capitalized) for an RTDB rule denial on get()/transaction().
    // That falls through every heuristic and lands on the generic
    // "Something went wrong" branch instead of the intended actionable
    // "Firebase permission denied" guidance. This assertion records today's
    // actual output; friendlyFirebaseError is not modified by this suite.
    const friendly = friendlyFirebaseError(revokeError, "player");
    expect(friendly.title).toBe("Something went wrong");
    expect(friendly.message).toBe("Permission denied");

    // Cannot read another player's private projection, through the real
    // backend adapter (no legitimate production player flow ever attempts
    // to read a path outside its own binding, so there is no bare
    // application entry point to drive here).
    await expect(bobBackend.get(`lobbies/${code}/player/${id}`)).rejects.toThrow(/permission[_ ]denied/i);

    // None of the above mutated any authoritative state.
    expect(await stBackend.get(`lobbies/${code}/writer`)).toMatchObject({ token: writer.token });
    expect(await stBackend.get(`lobbies/${code}/roster/${alice}`)).toBe(id);
  });

  test("CONTRACT-004: Storyteller orchestration publishes through the real writer under enforced rules", async () => {
    const code = "CT4AAAAA", st = "ct4-storyteller";
    const stBackend = backendFor(st);
    await createLobby(stBackend, st, { codeGenerator: () => code });
    const session = await requireActiveSession(stBackend, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };

    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);

    // Same report wiring useStorytellerSync gives the writer in the app, so a
    // real denial here surfaces exactly where the app would show it.
    const writer = new SessionWriter(stBackend, code, session.id, error =>
      useSessionRuntime.setState({ error: error ? lifecycleMessage(error) : null }));

    // NATURAL REGRESSION TRIPWIRE — deliberately not a fabricated forbidden
    // path. If a future change to writeProjections or startStorytellerSession
    // ever begins reading or writing a path rules.json rejects, this real
    // orchestration's initial flush rejects and this test goes red on its
    // own; nothing here manufactures the failure.
    const manager = await startStorytellerSession(stBackend, lobby, writer);
    disposals.push(async () => { manager.stop(); await writer.dispose(); });

    expect(useSessionRuntime.getState().error).toBeNull();
    expect(writer.token).toBeTruthy();
    expect(await stBackend.get(`lobbies/${code}/writer`)).toMatchObject({ token: writer.token });
    expect(await stBackend.get(`lobbies/${code}/checkpoint`)).toBeTruthy();
    expect(await stBackend.get(`lobbies/${code}/public`)).toMatchObject({ code });
  });

  test("CONTRACT-005: a fenced-out writer's own retry/guard-receipt logic never reports a denied write as successful", async () => {
    const code = "CT5AAAAA", st = "ct5-storyteller";
    const rawSpy = backendFor(st);
    const originalUpdate = rawSpy.update.bind(rawSpy);
    let updateAttempts = 0;
    rawSpy.update = async updates => { updateAttempts++; return originalUpdate(updates); };

    await createLobby(rawSpy, st, { codeGenerator: () => code });
    const session = await requireActiveSession(rawSpy, code);
    const writer1 = new SessionWriter(rawSpy, code, session.id);
    await writer1.start();
    disposals.push(() => writer1.dispose());

    // Precondition seeding only (Section 14 policy): force the lease to look
    // expired so a second writer can legitimately steal it. Rules stay
    // enforced for every assertion below — this is the same technique
    // rules.spec.ts's own second-writer test already uses.
    await env.withSecurityRulesDisabled(async ctx => {
      await ctx.database().ref(`lobbies/${code}/writer/expiresAt`).set(0);
    });
    const writer2 = new SessionWriter(backendFor(st), code, session.id);
    await writer2.start();
    disposals.push(() => writer2.dispose());

    updateAttempts = 0;
    await expect(writer1.set(`lobbies/${code}/storyteller/notes`, "denied write")).rejects.toThrow(/permission[_ ]denied/i);
    // Exactly one attempt: a permission denial is non-transient, so the
    // writer's own retry loop never repeats it into a stale receipt match.
    expect(updateAttempts).toBe(1);
    expect(await backendFor(st).get(`lobbies/${code}/storyteller/notes`)).not.toBe("denied write");
  });

  test("CONTRACT-006: an authenticated non-member is denied public projection access (current OPUS-002 baseline, not fixed here)", async () => {
    const code = "CT6AAAAA", st = "ct6-storyteller", nm = "ct6-nonmember";
    const stBackend = backendFor(st);
    await createLobby(stBackend, st, { codeGenerator: () => code });

    const nmBackend = backendFor(nm);
    // Sanity: this identity is genuinely authenticated and reaches paths any
    // authenticated client is allowed to read before joining.
    await expect(nmBackend.get(`lobbies/${code}/storytellerUid`)).resolves.toBe(st);

    // CURRENT AUTHORIZATION BASELINE, recorded intentionally — an
    // authenticated identity with no Storyteller authority, no roster
    // membership, and no active join request is denied `public` today. This
    // is the OPUS-002 gap the architecture review marked OUT OF SCOPE for
    // 9C.1. This test documents today's behavior so the harness can validate
    // the Phase 9C.6 fix later; it does not weaken rules.json or introduce a
    // display token here.
    await expect(nmBackend.get(`lobbies/${code}/public`)).rejects.toThrow(/permission[_ ]denied/i);
  });
});
