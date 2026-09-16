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
//
// Phase 9C.1 remediation (this revision): CONTRACT-001 now proves the LIVE
// waiting -> seated transition (the handshake starts before the seat/publish
// exist, not after), CONTRACT-002 isolates the real private-listener denial
// from the durable outcome convergence in two phases, CONTRACT-003 adds the
// two previously-missing negative production paths (writeProjections and
// seatPlayer from a non-owner player), and CONTRACT-004 adds a rejected
// orchestration-flush case alongside the existing successful one.
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { goOffline, goOnline, type Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { SessionWriter, LEASE_MS, FENCE_MARGIN_MS } from "./writer";
import { writeProjections } from "./sync";
import { createLobby, readRosterBindings, revokePlayerMembership, seatPlayer } from "./lobby";
import { joinLobby, leaveLobby, startPlayerHandshake } from "./playerSync";
import { acceptLeaveRequest, rejectLeaveRequest } from "./membershipCommands";
import { playerPath, publicPath } from "./paths";
import { reportRuntimeError, resolveReconnectConflict, startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { lifecycleMessage, requireActiveSession } from "./lifecycle";
import { friendlyFirebaseError } from "./errors";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { subscribeToPublicLobby } from "./publicSync";
import { authorizePublicDisplay, ensurePublicDisplayAccess, rotatePublicDisplayAccess } from "./publicDisplayAuth";
import type { PublicLobbyRecord } from "@/stores/types";

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
  useStorytellerStore.setState({ game: null, lobby: null, undoStack: [], sync: null, localSeq: 0 });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, retry: 0 });
});
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
  // Quiescent teardown: a just-stopped handshake/writer can still have a
  // fire-and-forget write in flight (e.g. playerSync.ts stop()'s presence
  // clear). Give it one real round trip against the emulator to settle
  // before the next test's clearDatabase() runs.
  await env.authenticatedContext("quiesce").database().ref("lobbies/QUIESCE0/session").once("value");
});

function backendFor(uid: string): FirebaseRoomBackend {
  return new FirebaseRoomBackend(env.authenticatedContext(uid).database() as unknown as Database);
}

/** A single composite snapshot of everything a contract test cares about, so
 * a wait can assert the COMPLETE expected state (status + remote-data +
 * self/public + error) rather than a lone status field that can go green
 * while a subscription is silently stuck, erroring, or reading stale data. */
function playerSnapshot() {
  const { status, playerId, self, publicLobby, remoteData, error } = usePlayerStore.getState();
  return { status, playerId, self, publicLobby, remoteData, error };
}
async function waitForPlayer(
  check: (snapshot: ReturnType<typeof playerSnapshot>) => boolean,
  label: string,
  timeout = 5000,
): Promise<void> {
  await vi.waitFor(() => {
    const snapshot = playerSnapshot();
    if (!check(snapshot)) throw new Error(`expected ${label}; got ${JSON.stringify(snapshot)}`);
  }, { timeout, interval: 100 });
}

/**
 * Real join → real seat → real projection publish, through the real writer.
 * Shared by tests that need "a legitimately seated player" as their starting
 * state (not the live transition itself — see CONTRACT-001 for that). Not a
 * shim: every step is the same production entry point the app itself calls.
 * Cleanup for the writer is registered with `register` immediately upon
 * construction (eager disposal), before any awaited step that could throw.
 */
async function establishSeatedPlayer(
  code: string,
  st: string,
  alice: string,
  register: (dispose: () => void | Promise<void>) => void,
) {
  const stBackend = backendFor(st);
  await createLobby(stBackend, st, { codeGenerator: () => code });
  const session = await requireActiveSession(stBackend, code);
  const writer = new SessionWriter(stBackend, code, session.id, error =>
    reportRuntimeError("write", error ? lifecycleMessage(error) : null));
  register(() => writer.dispose());
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
  test("CONTRACT-001: the live waiting -> seated transition holds up under a handshake that starts before the seat/publish exist", async () => {
    const code = "CT1AAAAA", st = "ct1-storyteller", alice = "ct1-alice";
    const stBackend = backendFor(st);
    await createLobby(stBackend, st, { codeGenerator: () => code });
    const session = await requireActiveSession(stBackend, code);
    const writer = new SessionWriter(stBackend, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    disposals.push(() => writer.dispose());
    await writer.start();

    // Prepare Storyteller game/seat/role state, but do NOT seat or publish
    // yet — the player must reach "waiting" against a real, live handshake
    // first, before any of that exists.
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    const [id] = useStorytellerStore.getState().game!.seatOrder as [string];
    useStorytellerStore.getState().setLobby({ code, uid: st, sessionId: session.id, status: "live" });
    useStorytellerStore.getState().assignRole(id, "chef");
    useStorytellerStore.getState().setShownRole(id, "chef");

    const aliceBackend = backendFor(alice);
    await joinLobby(aliceBackend, code, alice, "Alice");
    const stop = startPlayerHandshake(aliceBackend, code, alice);
    disposals.push(stop);

    await waitForPlayer(s =>
      s.status === "waiting" && s.playerId === null && s.self === null && s.error === null &&
      s.remoteData.membership === "ready" && s.remoteData.request === "ready" &&
      s.remoteData.public !== "invalid" && s.remoteData.public !== "error",
      "a live waiting state with no binding, no self, and no error");

    // The Storyteller seats the player WHILE the handshake is already live,
    // then publishes projections as a separate step.
    await seatPlayer(writer, code, alice, id, null);
    const membership = await readRosterBindings(writer, code);
    await writeProjections({
      backend: writer, code, stState: useStorytellerStore.getState().game!,
      registry: buildRegistry(troubleBrewing), online: {}, membership,
    });

    // This is the load-bearing new proof: the same live subscriptions that
    // were sitting in "waiting" converge to a fully ready seated state,
    // rather than a fresh handshake reconverging onto already-established
    // membership.
    await waitForPlayer(s =>
      s.status === "seated" && s.playerId === id &&
      s.self !== null && s.self.shownRole === "chef" && s.self.shownAlignment === "good" &&
      s.remoteData.membership === "ready" && s.remoteData.request === "ready" &&
      s.remoteData.self === "ready" && s.remoteData.public === "ready" &&
      s.publicLobby !== null && !!s.publicLobby.players[id] &&
      s.error === null,
      "seated with the correct playerId, shown identity, and fully ready remote data");

    // A second Storyteller projection update, changing an observable shown
    // field, proves the live subscription stays alive (and error-free) after
    // initial convergence rather than only proving a one-shot read.
    useStorytellerStore.getState().setShownRole(id, "washerwoman");
    await writeProjections({
      backend: writer, code, stState: useStorytellerStore.getState().game!,
      registry: buildRegistry(troubleBrewing), online: {}, membership,
    });

    await waitForPlayer(s =>
      s.status === "seated" && s.self !== null && s.self.shownRole === "washerwoman" && s.error === null,
      "the live subscription delivered the second projection update");
  });

  test("CONTRACT-002: a real private-listener denial clears secret state, then the durable outcome converges the client terminally", async () => {
    const code = "CT2AAAAA", st = "ct2-storyteller", alice = "ct2-alice";
    const { aliceBackend, writer, id } = await establishSeatedPlayer(code, st, alice, dispose => disposals.push(dispose));

    // TEST-ONLY tracer wrapped around the REAL FirebaseRoomBackend.subscribe,
    // for exactly one path: this player's private player/{id} listener (same
    // technique CONTRACT-005 already uses to wrap `update` on a real
    // backend). It delegates untouched for every other path (session,
    // outcome, roster, joinRequest, public), and for the traced path it
    // invokes the ORIGINAL, UNMODIFIED production onError callback FIRST —
    // never intercepting, altering, or fabricating what it receives — then
    // records only that the real callback fired, the real error Firebase
    // gave it, and the player store's `self` value immediately after that
    // production callback returned.
    //
    // Why this is needed: self===null alone cannot attribute WHICH listener
    // cleared it. Removing the roster binding also denies the PUBLIC
    // listener (public access depends on roster/joinRequest status too, and
    // seatPlayer already cleared this player's joinRequest), and every
    // watch()-installed onError in playerSync.ts — private, public, or
    // otherwise — funnels into the same shared fail() handler, which
    // unconditionally clears self regardless of which path was denied.
    // Instrumenting the subscribe() boundary for the private path
    // specifically proves the private listener's own onError really ran,
    // instead of inferring it from store state a different listener could
    // equally have produced.
    const tracedPath = playerPath(code, id);
    const originalSubscribe = aliceBackend.subscribe.bind(aliceBackend);
    const privateDenials: { error: unknown; selfImmediatelyAfter: unknown }[] = [];
    aliceBackend.subscribe = (path, cb, onError) => {
      if (path !== tracedPath || !onError) return originalSubscribe(path, cb, onError);
      return originalSubscribe(path, cb, error => {
        onError(error); // the real, unmodified production handler runs first
        privateDenials.push({ error, selfImmediatelyAfter: usePlayerStore.getState().self });
      });
    };

    const stop = startPlayerHandshake(aliceBackend, code, alice);
    disposals.push(stop);
    await waitForPlayer(s => s.status === "seated" && s.playerId === id && s.self !== null, "seated before revocation");

    // PHASE A — isolate the real private-listener denial. Remove the
    // read-authorizing roster binding and the player projection through a
    // real guarded write, WITHOUT yet writing an outcome. No outcome exists,
    // so the authorized outcome listener cannot itself terminalize the
    // client here — only the real denied player/{id} subscription's onError
    // path can react, which is exactly what this phase isolates.
    await writer.update({
      [`lobbies/${code}/roster/${alice}`]: null,
      [`lobbies/${code}/player/${id}`]: null,
    });

    // A. Source-attribution proof: the LIVE private player/{id} subscription
    // really received its own permission-denied onError callback from the
    // real emulator + enforced rules — observed directly at the real
    // backend's subscribe() boundary, not inferred from store state a
    // different listener (e.g. public) could equally have produced. If the
    // production private-listener onError were broken or never invoked, this
    // wait times out and the test fails here.
    await vi.waitFor(() => {
      if (privateDenials.length === 0) {
        throw new Error("expected the live private player/{id} subscription's own onError to fire with a real permission denial");
      }
    }, { timeout: 5000, interval: 100 });
    const [denial] = privateDenials;
    expect(String(denial.error instanceof Error ? denial.error.message : denial.error)).toMatch(/permission[_ ]denied/i);
    // B. The load-bearing proof: by the moment the ORIGINAL production
    // private-listener callback (fail()) had returned, secret state was
    // already cleared — recorded synchronously right after that specific
    // callback executed, not merely eventually true somewhere in the store.
    expect(denial.selfImmediatelyAfter).toBeNull();

    // Corroborate with the store's own eventual convergence too (this does
    // not substitute for the source-attributed proof above). `status`
    // normally moves off "seated" in the same beat (typically to "error"
    // then "reconnecting"), but a reconcile racing the very same multi-path
    // denial can rarely leave it transiently unchanged until Phase B's
    // unconditional write forces a fresh read — this is the already-deferred
    // reconnect-state race (OPUS-001, Phase 9C.2), not a 9C.1 regression, so
    // it is checked best-effort here rather than gating the test on it.
    await waitForPlayer(s => s.self === null, "the real denied private read cleared secret state");
    await waitForPlayer(s => s.status !== "seated", "status reflects the denial", 1500).catch(() => {});

    // PHASE B — converge terminally: the Storyteller writes the durable
    // outcome through the real guarded writer.
    await writer.update({ [`lobbies/${code}/outcomes/${alice}`]: "revoked" });
    await waitForPlayer(s =>
      s.status === "revoked" && s.self === null && s.playerId === null && s.publicLobby === null,
      "terminal revoked convergence");

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
    const { stBackend, writer, session, id } = await establishSeatedPlayer(code, st, alice, dispose => disposals.push(dispose));
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

    // A. The literal OPUS-007 projection chokepoint: a non-owner player
    // cannot drive writeProjections directly.
    await expect(writeProjections({
      backend: bobBackend, code, stState: useStorytellerStore.getState().game!,
      registry: buildRegistry(troubleBrewing), online: {}, membership: {},
    })).rejects.toThrow(/permission[_ ]denied/i);

    // B. A non-owner player cannot seat a player either.
    await expect(seatPlayer(bobBackend, code, bob, "rogue-seat", null)).rejects.toThrow(/permission[_ ]denied/i);

    // None of the above mutated any authoritative state.
    expect(await stBackend.get(`lobbies/${code}/writer`)).toMatchObject({ token: writer.token });
    expect(await stBackend.get(`lobbies/${code}/roster/${alice}`)).toBe(id);
    expect(await stBackend.get(`lobbies/${code}/roster/${bob}`)).toBeUndefined();
    expect(await stBackend.get(`lobbies/${code}/public`)).toMatchObject({ code });
    expect(await stBackend.get(`lobbies/${code}/player/${id}`)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    expect(await stBackend.get(`lobbies/${code}/storyteller`)).toBeTruthy();
    expect(await stBackend.get(`lobbies/${code}/checkpoint`)).toBeTruthy();
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
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    let manager: Awaited<ReturnType<typeof startStorytellerSession>> | undefined;
    // Eager disposal: registered immediately, before the awaited
    // startStorytellerSession call that could itself throw.
    disposals.push(async () => { manager?.stop(); await writer.dispose(); });

    // NATURAL REGRESSION TRIPWIRE — deliberately not a fabricated forbidden
    // path. If a future change to writeProjections or startStorytellerSession
    // ever begins reading or writing a path rules.json rejects, this real
    // orchestration's initial flush rejects and this test goes red on its
    // own; nothing here manufactures the failure.
    manager = await startStorytellerSession(stBackend, lobby, writer);

    expect(useSessionRuntime.getState().error).toBeNull();
    expect(writer.token).toBeTruthy();
    expect(await stBackend.get(`lobbies/${code}/writer`)).toMatchObject({ token: writer.token });
    expect(await stBackend.get(`lobbies/${code}/checkpoint`)).toBeTruthy();
    expect(await stBackend.get(`lobbies/${code}/public`)).toMatchObject({ code });
  });

  test("CONTRACT-004: a rejected orchestration flush surfaces a write error, does not mask it, and lands no forbidden state", async () => {
    const code = "CT4BAAAA", st = "ct4b-storyteller";
    const stBackend = backendFor(st);
    await createLobby(stBackend, st, { codeGenerator: () => code });
    const session = await requireActiveSession(stBackend, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };

    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);

    const writer = new SessionWriter(stBackend, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    let manager: Awaited<ReturnType<typeof startStorytellerSession>> | undefined;
    disposals.push(async () => { manager?.stop(); await writer.dispose(); });

    manager = await startStorytellerSession(stBackend, lobby, writer);
    expect(useSessionRuntime.getState().error).toBeNull();

    // Count real Firebase write attempts from here on — the shutdown proof
    // below needs to show the count stops advancing, not just that some
    // local flag reads a particular way (Phase 9C.1 REVISE, finding 2: the
    // previous `useSessionRuntime.getState().backend === null` assertion was
    // ineffective because bare startStorytellerSession never sets `backend`
    // to the writer in the first place, so it read null before AND after the
    // failure regardless of whether the writer actually stopped).
    let updateAttempts = 0;
    const originalUpdate = stBackend.update.bind(stBackend);
    stBackend.update = async updates => { updateAttempts++; return originalUpdate(updates); };

    // Precondition seeding ONLY (Section 14/9 policy): force the writer's own
    // lease to look expired while keeping its token unchanged. Every
    // assertion below still runs through the normal, rules-enforced writer
    // path — this only seeds the precondition.
    await env.withSecurityRulesDisabled(async ctx => {
      await ctx.database().ref(`lobbies/${code}/writer/expiresAt`).set(0);
    });

    // Mutate Storyteller state so the production store subscription
    // schedules a real flush through the normal orchestration path.
    useStorytellerStore.getState().addPlayer("Bob");

    await vi.waitFor(() => {
      if (useSessionRuntime.getState().error == null) throw new Error("expected a non-null write error");
    }, { timeout: 5000, interval: 100 });

    // The error is not a fleeting flicker masked moments later by an
    // unrelated success.
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(useSessionRuntime.getState().error).not.toBeNull();

    // Exactly one real Firebase write attempt was made for the denied
    // flush: a permission denial is non-transient, so the writer's own
    // retry loop never repeats it (same invariant CONTRACT-005 proves for a
    // fenced-out writer's direct commit).
    const attemptsAtDenial = updateAttempts;
    expect(attemptsAtDenial).toBe(1);

    // STRENGTHENED SHUTDOWN PROOF (Phase 9C.1 REVISE, finding 2). Meaningful,
    // externally observable production behavior that actually distinguishes
    // "writer stopped" from "writer still running": attempt a further
    // production write directly through the writer, and separately schedule
    // a further production flush the normal way (mutating the Storyteller
    // store, exactly like the denied write above). If the stop-on-failure
    // call in writer.ts's commit() catch were ever removed, both of these
    // would reach Firebase again (a fresh, real permission_denied each time,
    // since the lease is still expired) and `updateAttempts` would climb
    // past `attemptsAtDenial`. Because the writer has genuinely stopped,
    // neither one issues a new Firebase write attempt at all.
    await expect(writer.runExclusive(async inner => {
      await inner.update({ [`lobbies/${code}/storyteller/notes`]: "must never reach Firebase" });
    })).rejects.toThrow(/closing|writable|stopped|cancelled/i);
    expect(updateAttempts).toBe(attemptsAtDenial);

    useStorytellerStore.getState().addPlayer("Carol");
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(updateAttempts).toBe(attemptsAtDenial);

    // Corroborating (not substituting): the writer's own internal state
    // agrees with the externally observed behavior above.
    expect(writer.isStopped()).toBe(true);

    // No forbidden state landed either.
    const publicState = await stBackend.get(`lobbies/${code}/public`);
    expect(publicState).toMatchObject({ code });
    expect(JSON.stringify(publicState)).not.toContain("Bob");
    expect(JSON.stringify(publicState)).not.toContain("Carol");
    expect(await stBackend.get(`lobbies/${code}/storyteller/notes`)).not.toBe("must never reach Firebase");
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

  test("CONTRACT-007: a lease-renewal denial's terminal write error survives an older write's belated success (Phase 9C.1 REVISE, finding 1)", async () => {
    // Reproduces, against real enforced emulator rules, the exact ordering
    // Astra found in production:
    //   1. Firebase accepts a write but its completion is delayed.
    //   2. A later lease renewal receives a real permission_denied.
    //   3. Production stops the writer and surfaces the denial.
    //   4. The older successful write's completion is released.
    //   5. Its success must NOT clear the same "write" error owner.
    //   6. The writer stays stopped AND the error stays visible.
    //
    // The lease-renewal interval is the one operation in SessionWriter that
    // runs outside the commit queue (writer.ts's `runExclusive`/`this.tail`
    // serializes every commit strictly FIFO, so a second commit can never
    // race an in-flight one — only the independent renewal timer can). That
    // is why the real race Astra found requires the renewal path specifically.
    const code = "CT7AAAAA", st = "ct7-storyteller";
    const rawSpy = backendFor(st);
    const originalUpdate = rawSpy.update.bind(rawSpy);

    // TEST-ONLY delay wrapper around the REAL backend's update(), for exactly
    // one write: the real Firebase call fires immediately and is left to
    // genuinely settle on its own — the wrapper only withholds that outcome
    // from the caller until this test releases it. Nothing about the write's
    // real outcome is fabricated or altered (same non-interception technique
    // CONTRACT-002/CONTRACT-005 already use at this backend boundary).
    let delayNext = false;
    let olderRealSettled = false;
    let releaseOlderWrite: () => void = () => {};
    const olderWriteGate = new Promise<void>(resolve => { releaseOlderWrite = resolve; });
    rawSpy.update = async updates => {
      if (!delayNext) return originalUpdate(updates);
      delayNext = false;
      const real = originalUpdate(updates);
      real.then(() => { olderRealSettled = true; }, () => { olderRealSettled = true; });
      await olderWriteGate;
      return real;
    };

    await createLobby(rawSpy, st, { codeGenerator: () => code });
    const session = await requireActiveSession(rawSpy, code);
    // Same report wiring useStorytellerSync gives the writer in the app.
    const writer = new SessionWriter(rawSpy, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    disposals.push(() => writer.dispose());
    await writer.start();

    // The OLDER write: its completion will be delayed, but it lands for real
    // against the emulator while the session is still genuinely active and
    // the lease is still genuinely valid.
    delayNext = true;
    const olderWrite = writer.set(`lobbies/${code}/storyteller/notes`, "older write");
    await vi.waitFor(() => {
      if (!olderRealSettled) throw new Error("expected the older write to actually complete against Firebase first");
    }, { timeout: 3000, interval: 20 });

    // Precondition seeding ONLY (never the assertion itself, per Section 10
    // policy): make the session look inactive so the writer's own NEXT
    // scheduled lease renewal — the one operation outside the commit queue,
    // so it can genuinely race the still-in-flight older write above —
    // receives a REAL, rules-enforced permission_denied rather than a
    // fabricated one. The `writer` path's rule requires an active v2 session
    // for any non-zero-expiry write; renewal always writes a non-zero
    // expiresAt with this writer's own unchanged token, so with the session
    // inactive the rule denies it outright (this is not the app-level
    // "another tab" conflict path — no other token is involved).
    await env.withSecurityRulesDisabled(async ctx => {
      await ctx.database().ref(`lobbies/${code}/session/state`).set("ended");
    });

    // Wait for the real renewal interval (LEASE_MS/3 = 10s) to fire, receive
    // the real denial, stop the writer, and surface the error — with no
    // arbitrary delay or timing assumption baked into production: this is
    // production's own real, scheduled renewal cadence.
    await vi.waitFor(() => {
      if (useSessionRuntime.getState().error == null) throw new Error("expected the real lease-renewal denial to surface a write error");
    }, { timeout: 15000, interval: 100 });
    const terminalMessage = useSessionRuntime.getState().error;
    expect(terminalMessage).not.toBeNull();
    expect(writer.isStopped()).toBe(true);

    // NOW release the older write's already-successful completion.
    releaseOlderWrite();
    await olderWrite;

    // The stopped-writer error must remain visible: the belated success must
    // not have cleared the same "write" error owner it does not own.
    expect(useSessionRuntime.getState().error).toBe(terminalMessage);
    expect(useSessionRuntime.getState().error).not.toBeNull();
    expect(writer.isStopped()).toBe(true);
  }, 25000);

  // ---------------------------------------------------------------------
  // Phase 9C.2A (OPUS-001) — reconnect decision against REAL enforced
  // Firebase rules. rules.spec.ts already proves the underlying lease and
  // revision fencing primitives this decision relies on ("an earlier
  // revision cannot overwrite a later projection", "writer fields deny
  // other UIDs..."); CONTRACT-005 above already proves a fenced-out
  // writer's own commit is denied. What's new here — never exercised
  // against a real emulator anywhere else — is startStorytellerSession's
  // full reconnect decision itself reading a REAL enforced writeGuard and
  // checkpoint and landing on the correct outcome.
  // ---------------------------------------------------------------------

  /** Precondition seeding ONLY (Section 14/9 policy) — same technique
   * CONTRACT-005/CONTRACT-004 already use: force the lease to look expired
   * so the next SessionWriter's own real, rules-enforced acquisition can
   * legitimately succeed. A disposed writer's natural release() is not
   * itself under test here (rules.spec.ts's own "a second writer is denied
   * until expiry, then the old token is fenced" test already covers that
   * expiry path); every assertion below still runs through the normal
   * writer/decision path with rules enforced throughout. */
  async function forceLeaseExpiry(code: string) {
    await env.withSecurityRulesDisabled(async ctx => {
      await ctx.database().ref(`lobbies/${code}/writer/expiresAt`).set(0);
    });
  }

  test("OPUS-001-CONTRACT-1: a second real device's advancement is RESTOREd into a clean stale device, and CONFLICTs against a dirty one — real enforced rules", async () => {
    const code = "OP1AAAAA", st = "op1-storyteller";

    // --- Device A: establish the lobby and an initial acknowledged game.
    const deviceA1 = backendFor(st);
    await createLobby(deviceA1, st, { codeGenerator: () => code });
    const session = await requireActiveSession(deviceA1, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);
    const writerA1 = new SessionWriter(deviceA1, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    const managerA1 = await startStorytellerSession(deviceA1, lobby, writerA1);
    // Device A "goes offline" clean: no local edits since the last flush.
    managerA1.stop();
    await writerA1.dispose();
    await forceLeaseExpiry(code);

    // --- Device B: a genuinely separate SessionWriter/backend instance for
    // the same Storyteller uid, acquiring the now-released real lease and
    // publishing different content through the real writeProjections path.
    const deviceB = backendFor(st);
    const writerB = new SessionWriter(deviceB, code, session.id);
    await writerB.start();
    const foreignGame = { ...useStorytellerStore.getState().game!, day: 11, notes: "device B's own content" };
    await writeProjections({
      backend: writerB, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {}, membership: {},
    });
    await writerB.dispose(); // releases the real lease
    await forceLeaseExpiry(code);

    // --- Device A reconnects CLEAN: expect RESTORE.
    const deviceA2 = backendFor(st);
    const writerA2 = new SessionWriter(deviceA2, code, session.id);
    const managerA2 = await startStorytellerSession(deviceA2, lobby, writerA2);
    disposals.push(async () => { managerA2.stop(); await writerA2.dispose(); });
    expect(managerA2.outcome).toBe("live");
    expect(useStorytellerStore.getState().game!.day).toBe(11);
    expect(useStorytellerStore.getState().game!.notes).toBe("device B's own content");
    managerA2.stop();
    await writerA2.dispose();
    await forceLeaseExpiry(code);

    // --- Device B advances again, so device A has a fresh real baseline to
    // go stale against for the DIRTY half of this test.
    const deviceB2 = backendFor(st);
    const writerB2 = new SessionWriter(deviceB2, code, session.id);
    await writerB2.start();
    const foreignGame2 = { ...useStorytellerStore.getState().game!, day: 22, notes: "device B's second update" };
    await writeProjections({
      backend: writerB2, code, stState: foreignGame2,
      registry: buildRegistry(troubleBrewing), online: {}, membership: {},
    });
    await writerB2.dispose();
    await forceLeaseExpiry(code);

    // Device A now makes an unacknowledged local edit — this is what makes
    // reconnect DIRTY relative to whatever it last knew was acknowledged.
    useStorytellerStore.getState().addPlayer("Unacknowledged local edit");
    const dirtyLocalGame = useStorytellerStore.getState().game;

    const deviceA3 = backendFor(st);
    const writerA3 = new SessionWriter(deviceA3, code, session.id);
    const managerA3 = await startStorytellerSession(deviceA3, lobby, writerA3);
    disposals.push(() => writerA3.dispose());

    // Core OPUS-001 second-device safety rule, proven against real
    // enforced rules: a stale device may not publish its local state over
    // newer real state written by another Storyteller device.
    expect(managerA3.outcome).toBe("conflict");
    expect(useStorytellerStore.getState().game).toEqual(dirtyLocalGame); // untouched
    // Real RTDB omits empty/null fields on round-trip (an empty object or
    // array node simply doesn't exist), so a raw read is compared on the
    // discriminating content fields rather than a full deep-equal against
    // an in-memory (never round-tripped) object.
    const remoteAfterConflict = await deviceA3.get(`lobbies/${code}/storyteller`) as { day: number; notes: string };
    expect(remoteAfterConflict.day).toBe(foreignGame2.day); // untouched
    expect(remoteAfterConflict.notes).toBe(foreignGame2.notes); // untouched
    await expect(managerA3.close()).rejects.toThrow(/conflict/i);
  }, 30000);

  test("OPUS-001-CONTRACT-2: a lost acknowledgement against a REAL enforced writeGuard is recognized without CONFLICT", async () => {
    const code = "OP2AAAAA", st = "op2-storyteller";
    const stBackend = backendFor(st);
    await createLobby(stBackend, st, { codeGenerator: () => code });
    const session = await requireActiveSession(stBackend, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);
    const writer = new SessionWriter(stBackend, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    const manager = await startStorytellerSession(stBackend, lobby, writer);
    disposals.push(async () => { manager.stop(); await writer.dispose(); });

    // TEST-ONLY delay wrapper (same non-interception technique CONTRACT-007
    // uses): the real Firebase write fires and genuinely settles on its
    // own; only the caller's visibility into that outcome is withheld,
    // until this test releases it — modeling a local process that dies
    // after a commit has genuinely landed on the real server but before it
    // could record the acknowledgement.
    const originalUpdate = stBackend.update.bind(stBackend);
    let release: () => void = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let intercepted = false;
    stBackend.update = async updates => {
      if (intercepted) return originalUpdate(updates);
      intercepted = true;
      const result = await originalUpdate(updates);
      await gate;
      return result;
    };
    const committing = writer.set(`lobbies/${code}/storyteller/notes`, "in flight against real Firebase");
    await vi.waitFor(() => { if (!intercepted) throw new Error("expected the real write to be in flight"); }, { timeout: 5000, interval: 50 });
    const ackedGuardBefore = useStorytellerStore.getState().sync!.ackedGuard;
    writer.stop();
    release();
    await committing.catch(() => {});
    stBackend.update = originalUpdate;

    const syncAfterStop = useStorytellerStore.getState().sync!;
    expect(syncAfterStop.ackedGuard).toEqual(ackedGuardBefore); // not advanced by the belated success
    expect(syncAfterStop.lastAttempt).not.toBeNull();
    expect(await stBackend.get(`lobbies/${code}/writeGuard`)).toEqual(syncAfterStop.lastAttempt); // it DID land on the real server
    await writer.dispose();
    await forceLeaseExpiry(code); // seeds lease availability only — writeGuard (checked below) is untouched

    // Dirty atop it, so this discriminates: an unrecognized lost ack would
    // fall through to "remote advanced beyond baseline" + "dirty local" =
    // CONFLICT instead of the correct KEEP_LOCAL.
    useStorytellerStore.getState().addPlayer("Dirty edit atop the real lost ack");

    const replacementBackend = backendFor(st);
    const replacement = new SessionWriter(replacementBackend, code, session.id);
    const recovered = await startStorytellerSession(replacementBackend, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });

    expect(recovered.outcome).toBe("live");
    expect(useSessionRuntime.getState().reconnect).toEqual({ status: "live" });
    expect(useStorytellerStore.getState().game!.seatOrder.some(id =>
      useStorytellerStore.getState().game!.players[id]!.name === "Dirty edit atop the real lost ack")).toBe(true);
  }, 30000);

  // ---------------------------------------------------------------------
  // Luna review, Finding 2 — real enforced-rules regression. isStopped()
  // and guard/checkpoint equality alone cannot detect a genuine server
  // lease takeover that publishes no new projection; only reconfirming
  // actual server writer authority (a real renew() transaction against the
  // real `writer` path) can. reconnectIntegration.test.ts already proves
  // this against MemoryRoomBackend; what's new here is the same regression
  // against a REAL RTDB emulator with rules.json enforced throughout — the
  // truth being tested (who legitimately owns the writer lease right now)
  // is exactly what rules.json's own writer-path CAS adjudicates, so a
  // fake/in-memory lease can only approximate it. withSecurityRulesDisabled
  // is used below ONLY to force the conflicted writer's own lease to look
  // expired (the same precondition-seeding technique OPUS-001-CONTRACT-1
  // and CONTRACT-004/005 already use to model a long backgrounded-tab
  // pause) — the takeover writer's real acquisition, and the authority
  // reconfirmation resolveReconnectConflict performs, both run under fully
  // enforced rules.
  // ---------------------------------------------------------------------

  /** Establishes a real CONFLICT via two genuinely separate real writers
   * (same technique as OPUS-001-CONTRACT-1), then has a real THIRD writer
   * for the same storyteller identity legitimately reclaim the real
   * `writer` lease — after forcing the conflicted writer's own lease to
   * look expired — WITHOUT publishing any new checkpoint/writeGuard, so
   * both remain byte-identical to the conflict snapshot. Returns everything
   * a caller needs to assert the "stale" outcome. */
  async function establishConflictWithRealLeaseTakeover(code: string, st: string) {
    const deviceA1 = backendFor(st);
    await createLobby(deviceA1, st, { codeGenerator: () => code });
    const session = await requireActiveSession(deviceA1, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);
    const writerA1 = new SessionWriter(deviceA1, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    const managerA1 = await startStorytellerSession(deviceA1, lobby, writerA1);
    managerA1.stop();
    await writerA1.dispose(); // clean release: no edits since the last flush
    await forceLeaseExpiry(code);

    // Device B: a genuinely separate real writer, same storyteller uid,
    // publishes different content — the foreign lineage device A will
    // conflict against.
    const deviceB = backendFor(st);
    const writerB = new SessionWriter(deviceB, code, session.id);
    await writerB.start();
    const foreignGame = { ...useStorytellerStore.getState().game!, day: 5, notes: "device B's own content" };
    await writeProjections({
      backend: writerB, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {}, membership: {},
    });
    await writerB.dispose();
    await forceLeaseExpiry(code);

    // Device A reconnects DIRTY: an unacknowledged local edit makes this a
    // real CONFLICT against device B's real remote content.
    useStorytellerStore.getState().addPlayer("Unacknowledged local edit under real lease takeover");
    const localGameBefore = useStorytellerStore.getState().game;

    const deviceA2 = backendFor(st);
    const writerA2 = new SessionWriter(deviceA2, code, session.id);
    const managerA2 = await startStorytellerSession(deviceA2, lobby, writerA2);
    expect(managerA2.outcome).toBe("conflict");
    const undoBefore = useStorytellerStore.getState().undoStack;
    const guardBefore = await deviceA2.get(`lobbies/${code}/writeGuard`);
    const checkpointBefore = await deviceA2.get(`lobbies/${code}/checkpoint`);

    // Force the CONFLICTED writer's own lease to look expired — precondition
    // seeding only, same technique used throughout this suite — so a real
    // fourth writer, the SAME storyteller identity (a genuinely different
    // device/tab; rules.json only ever lets this uid hold this lobby's
    // writer lease — see CONTRACT-003), can legitimately reclaim it through
    // the real, enforced `writer` CAS. No checkpoint or writeGuard is
    // published by this takeover.
    await forceLeaseExpiry(code);
    const deviceC = backendFor(st);
    const takeoverWriter = new SessionWriter(deviceC, code, session.id);
    await takeoverWriter.start(); // real, rules-enforced lease acquisition

    // Nothing local has detected the loss yet: writerA2's own isStopped()
    // still reads false (its renewal interval has not fired — LEASE_MS/3 is
    // 10s, comfortably longer than this synchronous setup), and the remote
    // guard/checkpoint are still byte-identical to the conflict snapshot.
    expect(writerA2.isStopped()).toBe(false);
    expect(await deviceA2.get(`lobbies/${code}/writeGuard`)).toEqual(guardBefore);
    expect(await deviceA2.get(`lobbies/${code}/checkpoint`)).toEqual(checkpointBefore);

    return { writerA2, takeoverWriter, deviceA2, localGameBefore, undoBefore, guardBefore, checkpointBefore };
  }

  test("OPUS-001-CONTRACT-3: 'useRemote' refuses to apply when another real writer has legitimately taken the server lease without publishing (Luna Finding 2) — real enforced rules", async () => {
    const code = "OP3AAAAA", st = "op3-storyteller";
    const { writerA2, takeoverWriter, deviceA2, localGameBefore, undoBefore, guardBefore, checkpointBefore } =
      await establishConflictWithRealLeaseTakeover(code, st);
    disposals.push(() => writerA2.dispose(), () => takeoverWriter.dispose());

    // The load-bearing proof: only a real re-confirmation of server writer
    // authority (a real renew() transaction against the real `writer` path,
    // legitimately denied because takeoverWriter's token now holds it) can
    // catch this — isStopped() and guard/checkpoint equality, checked above,
    // both read as if nothing had changed.
    const result = await resolveReconnectConflict("useRemote");

    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // local unchanged
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore); // undo unchanged
    expect(await deviceA2.get(`lobbies/${code}/writeGuard`)).toEqual(guardBefore); // remote guard unchanged
    expect(await deviceA2.get(`lobbies/${code}/checkpoint`)).toEqual(checkpointBefore); // remote checkpoint unchanged
  }, 30000);

  test("OPUS-001-CONTRACT-3: 'keepLocal' refuses to apply (no reconciliation, no projection) when another real writer has legitimately taken the server lease without publishing (Luna Finding 2) — real enforced rules", async () => {
    const code = "OP3BAAAA", st = "op3b-storyteller";
    const { writerA2, takeoverWriter, deviceA2, localGameBefore, undoBefore, guardBefore, checkpointBefore } =
      await establishConflictWithRealLeaseTakeover(code, st);
    disposals.push(() => writerA2.dispose(), () => takeoverWriter.dispose());

    const result = await resolveReconnectConflict("keepLocal");

    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    expect(await deviceA2.get(`lobbies/${code}/writeGuard`)).toEqual(guardBefore);
    expect(await deviceA2.get(`lobbies/${code}/checkpoint`)).toEqual(checkpointBefore);
    // "keepLocal" applying would have published a fresh projection through
    // the normal writer path (bumping writeGuard's revision) — asserting
    // writeGuard above already proves that never happened.
  }, 30000);
});

/** Precondition seeding ONLY (Section 10/14 policy) — same technique
 * OPUS-001-CONTRACT-1/2/3 above already use, hoisted to module scope so the
 * H1/H3 remediation suites below (declared outside that describe block)
 * can reuse it too: force a lease to look expired so the next
 * SessionWriter's own real, rules-enforced acquisition can legitimately
 * succeed. */
async function forceLeaseExpiry(code: string) {
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.database().ref(`lobbies/${code}/writer/expiresAt`).set(0);
  });
}

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation, Finding H1 — continuous authority through
// destructive mutation, proven against a REAL emulator with rules enforced
// throughout, and — deliberately — with NO mocked clock: the real Firebase
// SDK's own internals (transaction rerun scheduling, connection health)
// depend on Date.now() too, so mocking it globally alongside a live
// connection is unsafe here. Instead this genuinely waits out the real 30s
// lease while this writer's own periodic renewal is prevented from
// extending it (its underlying transaction calls are made to hang, exactly
// as an unresponsive network would, never via writer.stop() or a fake
// clock) — reproducing Astra's report (reads outliving the lease before
// useRemote replaces local game state) with real elapsed time.
// ---------------------------------------------------------------------------
describe("OPUS-001-CONTRACT-H1: continuous authority against real enforced rules", () => {
  test("useRemote is stale once this writer's own bookkeeping shows continuous authority has genuinely lapsed during the post-authority reads — Astra's exact H1 reproduction, real rules and real elapsed time throughout", async () => {
    const code = "OP4AAAAA", st = "op4-storyteller";
    const deviceA1 = backendFor(st);
    await createLobby(deviceA1, st, { codeGenerator: () => code });
    const session = await requireActiveSession(deviceA1, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);
    const writerA1 = new SessionWriter(deviceA1, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    const managerA1 = await startStorytellerSession(deviceA1, lobby, writerA1);
    managerA1.stop();
    await writerA1.dispose();
    await forceLeaseExpiry(code);

    const deviceB = backendFor(st);
    const writerB = new SessionWriter(deviceB, code, session.id);
    await writerB.start();
    const foreignGame = { ...useStorytellerStore.getState().game!, day: 5, notes: "device B's own content" };
    await writeProjections({
      backend: writerB, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {}, membership: {},
    });
    await writerB.dispose();
    await forceLeaseExpiry(code);

    useStorytellerStore.getState().addPlayer("Unacknowledged local edit under real H1 lapse");
    const localGameBefore = useStorytellerStore.getState().game;

    const deviceA2 = backendFor(st);
    const writerA2 = new SessionWriter(deviceA2, code, session.id);
    const managerA2 = await startStorytellerSession(deviceA2, lobby, writerA2);
    disposals.push(() => writerA2.dispose());
    expect(managerA2.outcome).toBe("conflict");
    const guardBefore = await deviceA2.get(`lobbies/${code}/writeGuard`);
    const checkpointBefore = await deviceA2.get(`lobbies/${code}/checkpoint`);

    // Let exactly the NEXT /writer transaction (reconfirmAuthority()'s own
    // renewal, called synchronously at the very start of
    // resolveReconnectConflict) through normally; every /writer transaction
    // AFTER that — in particular this writer's own periodic renewal
    // interval's next tick — hangs forever, exactly as an unresponsive
    // network would. leaseExpiresAt is therefore frozen at whatever
    // reconfirmAuthority() just set it to, while real time keeps moving.
    const originalTransaction = deviceA2.transaction.bind(deviceA2);
    let writerTransactionCount = 0;
    deviceA2.transaction = (transactionPath, change) => {
      if (transactionPath === `lobbies/${code}/writer`) {
        writerTransactionCount++;
        if (writerTransactionCount > 1) return new Promise<boolean>(() => {});
      }
      return originalTransaction(transactionPath, change);
    };

    // Pause the very next guard read — the first server read
    // resolveReconnectConflict performs AFTER reconfirming authority — so
    // the real wait below lands strictly between reconfirmAuthority()
    // succeeding and the synchronous authority gate being checked.
    const originalGet = deviceA2.get.bind(deviceA2);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    deviceA2.get = async readPath => {
      if (readPath === `lobbies/${code}/writeGuard` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(readPath);
    };

    const resolving = resolveReconnectConflict("useRemote");
    await vi.waitFor(() => {
      if (!paused) throw new Error("expected the guard read to be paused");
    }, { timeout: 5000, interval: 20 });

    // Genuinely wait past the real 30s lease — no mocked clock, no fake
    // timers. Nothing else touches writeGuard/checkpoint during this wait.
    await new Promise(resolve => setTimeout(resolve, LEASE_MS + 2000));

    deviceA2.get = originalGet;
    releaseGate();
    const result = await resolving;
    deviceA2.transaction = originalTransaction;

    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // untouched
    expect(await deviceA2.get(`lobbies/${code}/writeGuard`)).toEqual(guardBefore); // unchanged throughout
    expect(await deviceA2.get(`lobbies/${code}/checkpoint`)).toEqual(checkpointBefore);
  }, 45000);
});

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation, Finding H1 follow-up (Luna review) —
// membership reconciliation must be fenced by the SAME synchronous
// authority gate as restoreRemoteCheckpoint(): reconcileMembership's own
// local mutations (unseatPlayer/assignPendingToSeat) and its awaited
// server revocations previously ran entirely AFTER the gate, behind an
// additional un-gated roster read — so a lease that lapsed specifically
// during THAT read could still let a stale local membership mutation
// through. Proven here against a real emulator with rules enforced
// throughout and a real elapsed 30s+ wait — no mocked clock.
// ---------------------------------------------------------------------------
describe("OPUS-001-CONTRACT-H1-FOLLOWUP: membership reconciliation fencing against real enforced rules", () => {
  test("useRemote is stale once the roster read outlives the real 30s lease — no local membership mutation, no server write", async () => {
    const code = "OP5AAAAA", st = "op5-storyteller";
    const ghostUid = "op5-ghost-uid"; // bound in the checkpoint's own embedded roster, never in the live roster
    const deviceA1 = backendFor(st);
    await createLobby(deviceA1, st, { codeGenerator: () => code });
    const session = await requireActiveSession(deviceA1, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);
    const seatId = useStorytellerStore.getState().game!.seatOrder[0]!;
    const writerA1 = new SessionWriter(deviceA1, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    const managerA1 = await startStorytellerSession(deviceA1, lobby, writerA1);
    managerA1.stop();
    await writerA1.dispose();
    await forceLeaseExpiry(code);

    // Device B publishes a checkpoint whose OWN embedded roster binds
    // ghostUid to seatId (this becomes `restored.roster`, the prior-roster
    // diff target for useRemote) with that seat shown occupied — while the
    // LIVE `/roster` node (a separate path, untouched by writeProjections)
    // never gets that binding at all. This is exactly "a seat this device
    // once believed was uid-bound, absent now" — reconciliation must
    // unseat it.
    const deviceB = backendFor(st);
    const writerB = new SessionWriter(deviceB, code, session.id);
    await writerB.start();
    const foreignGame = {
      ...useStorytellerStore.getState().game!, day: 5,
      players: { ...useStorytellerStore.getState().game!.players,
        [seatId]: { ...useStorytellerStore.getState().game!.players[seatId]!, name: "Ghost", isEmpty: false } },
    };
    await writeProjections({
      backend: writerB, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {}, membership: { [ghostUid]: seatId },
    });
    await writerB.dispose();
    await forceLeaseExpiry(code);

    useStorytellerStore.getState().addPlayer("Unacknowledged local edit under real H1-followup lapse");
    const localGameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;

    const deviceA2 = backendFor(st);
    const writerA2 = new SessionWriter(deviceA2, code, session.id);
    const managerA2 = await startStorytellerSession(deviceA2, lobby, writerA2);
    disposals.push(() => writerA2.dispose());
    expect(managerA2.outcome).toBe("conflict");
    const guardBefore = await deviceA2.get(`lobbies/${code}/writeGuard`);
    const checkpointBefore = await deviceA2.get(`lobbies/${code}/checkpoint`);
    const rosterBefore = await deviceA2.get(`lobbies/${code}/roster`);

    // Let exactly the next /writer transaction (reconfirmAuthority()'s own
    // renewal) through; every one after that hangs forever — this
    // writer's own periodic renewal can never extend the lease again, so
    // leaseExpiresAt stays frozen while real time keeps moving.
    const originalTransaction = deviceA2.transaction.bind(deviceA2);
    let writerTransactionCount = 0;
    deviceA2.transaction = (transactionPath, change) => {
      if (transactionPath === `lobbies/${code}/writer`) {
        writerTransactionCount++;
        if (writerTransactionCount > 1) return new Promise<boolean>(() => {});
      }
      return originalTransaction(transactionPath, change);
    };

    // Pause the roster read specifically — Luna's exact reproduction step:
    // "delay the roster read long enough that the lease expires".
    const originalGet = deviceA2.get.bind(deviceA2);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    deviceA2.get = async readPath => {
      if (readPath === `lobbies/${code}/roster` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(readPath);
    };

    const resolving = resolveReconnectConflict("useRemote");
    await vi.waitFor(() => {
      if (!paused) throw new Error("expected the roster read to be paused");
    }, { timeout: 5000, interval: 20 });

    // Genuinely wait past the real 30s lease — no mocked clock.
    await new Promise(resolve => setTimeout(resolve, LEASE_MS + 2000));

    deviceA2.get = originalGet;
    releaseGate();
    const result = await resolving;
    deviceA2.transaction = originalTransaction;

    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // untouched entirely
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    // Specifically: no membership-driven local mutation occurred — the
    // seat that WOULD have been unseated is exactly as it was locally.
    expect(useStorytellerStore.getState().game!.players[seatId]).toEqual(localGameBefore!.players[seatId]);
    // No server writes from the stale resolver — writeGuard, checkpoint
    // and roster are all exactly as they were (the takeover-free lease
    // renewal attempts above never landed either, since they hung).
    expect(await deviceA2.get(`lobbies/${code}/writeGuard`)).toEqual(guardBefore);
    expect(await deviceA2.get(`lobbies/${code}/checkpoint`)).toEqual(checkpointBefore);
    expect(await deviceA2.get(`lobbies/${code}/roster`)).toEqual(rosterBefore);
  }, 45000);
});

// ---------------------------------------------------------------------------
// Phase 9C.2A H1 proof-completion, Gap 1 — H1-FOLLOWUP above proves the
// synchronous holdsAuthority gate fires once real elapsed time outlives THIS
// writer's own recorded lease bookkeeping; it never lets a genuinely
// separate writer actually win the real `/writer` lease during the paused
// window, so it never ties that local bookkeeping back to actual server
// truth. This closes that gap: reconfirmAuthority() succeeds first (this
// writer legitimately holds the lease at that instant), then — while the
// roster read is paused and real time is allowed to pass the real 30s lease
// — a genuinely separate real SessionWriter for the SAME storyteller
// identity actually acquires the real `/writer` lease under fully enforced
// rules, publishing no projection of its own. No mocked clock, no mocked
// lease result; withSecurityRulesDisabled (via forceLeaseExpiry) seeds only
// the very first handoff's precondition, never the takeover itself.
// ---------------------------------------------------------------------------
describe("OPUS-001-CONTRACT-H1-TAKEOVER: a genuinely separate real writer's actual lease acquisition — not just this writer's own expired bookkeeping — is what 'stale' proves, real enforced rules throughout", () => {
  test("useRemote is stale because a real competing SessionWriter actually wins the /writer lease under enforced rules while the roster read is paused — the takeover writer remains the sole authoritative lease holder", async () => {
    const code = "OP6AAAAA", st = "op6-storyteller";
    const ghostUid = "op6-ghost-uid"; // bound in the checkpoint's own embedded roster, never in the live roster
    const deviceA1 = backendFor(st);
    await createLobby(deviceA1, st, { codeGenerator: () => code });
    const session = await requireActiveSession(deviceA1, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);
    const seatId = useStorytellerStore.getState().game!.seatOrder[0]!;
    const writerA1 = new SessionWriter(deviceA1, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    const managerA1 = await startStorytellerSession(deviceA1, lobby, writerA1);
    managerA1.stop();
    await writerA1.dispose();
    await forceLeaseExpiry(code);

    // Device B publishes a checkpoint whose OWN embedded roster binds
    // ghostUid to seatId — the priorRoster diff target for useRemote —
    // while the LIVE `/roster` node never gets that binding at all.
    // Reconciliation would schedule an unseat; this test proves it never
    // actually runs.
    const deviceB = backendFor(st);
    const writerB = new SessionWriter(deviceB, code, session.id);
    await writerB.start();
    const foreignGame = {
      ...useStorytellerStore.getState().game!, day: 5,
      players: { ...useStorytellerStore.getState().game!.players,
        [seatId]: { ...useStorytellerStore.getState().game!.players[seatId]!, name: "Ghost", isEmpty: false } },
    };
    await writeProjections({
      backend: writerB, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {}, membership: { [ghostUid]: seatId },
    });
    await writerB.dispose();
    await forceLeaseExpiry(code);

    useStorytellerStore.getState().addPlayer("Unacknowledged local edit under real takeover");
    const localGameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;

    const deviceA2 = backendFor(st);
    const writerA2 = new SessionWriter(deviceA2, code, session.id);
    const managerA2 = await startStorytellerSession(deviceA2, lobby, writerA2);
    disposals.push(() => writerA2.dispose());
    expect(managerA2.outcome).toBe("conflict");
    const guardBefore = await deviceA2.get(`lobbies/${code}/writeGuard`);
    const checkpointBefore = await deviceA2.get(`lobbies/${code}/checkpoint`);
    const rosterBefore = await deviceA2.get(`lobbies/${code}/roster`);

    // Let exactly the next /writer transaction (reconfirmAuthority()'s own
    // renewal) through; every one after that — this writer's own periodic
    // renewal in particular — hangs forever, exactly as an unresponsive
    // network would.
    const originalTransaction = deviceA2.transaction.bind(deviceA2);
    let writerTransactionCount = 0;
    deviceA2.transaction = (transactionPath, change) => {
      if (transactionPath === `lobbies/${code}/writer`) {
        writerTransactionCount++;
        if (writerTransactionCount > 1) return new Promise<boolean>(() => {});
      }
      return originalTransaction(transactionPath, change);
    };

    // Pause the roster read — the last server read before the synchronous
    // authority gate.
    const originalGet = deviceA2.get.bind(deviceA2);
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    let paused = false;
    deviceA2.get = async readPath => {
      if (readPath === `lobbies/${code}/roster` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(readPath);
    };

    const resolving = resolveReconnectConflict("useRemote");
    await vi.waitFor(() => {
      if (!paused) throw new Error("expected the roster read to be paused");
    }, { timeout: 5000, interval: 20 });

    // reconfirmAuthority() already succeeded before the roster read paused
    // (it's the first thing resolveReconnectConflict does) — nothing local
    // has detected any loss yet.
    expect(writerA2.isStopped()).toBe(false);

    // Genuinely wait past the real 30s lease this writer's own bookkeeping
    // is tracking — no mocked clock, no fake timers.
    await new Promise(resolve => setTimeout(resolve, LEASE_MS + 2000));

    // NOW, while the roster read is still paused, a genuinely separate
    // real SessionWriter for the same storyteller identity actually
    // acquires the real /writer lease under fully enforced rules — the
    // exact same CAS transaction every writer goes through — publishing no
    // checkpoint/projection of its own.
    const deviceC = backendFor(st);
    const takeoverWriter = new SessionWriter(deviceC, code, session.id);
    await takeoverWriter.start(); // real, rules-enforced lease acquisition
    disposals.push(() => takeoverWriter.dispose());

    // Still nothing LOCAL has caught up: writerA2's own isStopped() can
    // still legitimately read false (its renewal interval is blocked, not
    // notified of the takeover), and the remote guard/checkpoint/roster
    // are still byte-identical to the conflict snapshot — the takeover
    // published no projection of its own.
    expect(writerA2.isStopped()).toBe(false);
    expect(await deviceA2.get(`lobbies/${code}/writeGuard`)).toEqual(guardBefore);
    expect(await deviceA2.get(`lobbies/${code}/checkpoint`)).toEqual(checkpointBefore);
    expect(await deviceA2.get(`lobbies/${code}/roster`)).toEqual(rosterBefore);

    deviceA2.get = originalGet;
    releaseGate();
    const result = await resolving;
    deviceA2.transaction = originalTransaction;

    // The load-bearing proof: the synchronous holdsAuthority gate catches
    // a REAL foreign takeover, not merely this writer's own passage of
    // time.
    expect(result).toBe("stale");
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore); // untouched entirely
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    // No local membership mutation — the seat that WOULD have been
    // unseated is exactly as it was locally.
    expect(useStorytellerStore.getState().game!.players[seatId]).toEqual(localGameBefore!.players[seatId]);
    // No server writes from the stale resolver: no revocation, no
    // projection, no checkpoint restore.
    expect(await deviceA2.get(`lobbies/${code}/writeGuard`)).toEqual(guardBefore);
    expect(await deviceA2.get(`lobbies/${code}/checkpoint`)).toEqual(checkpointBefore);
    expect(await deviceA2.get(`lobbies/${code}/roster`)).toEqual(rosterBefore);
    // The takeover writer remains the sole authoritative lease holder —
    // this is what "stale" actually protects against: a genuinely
    // different real writer, not merely this writer's own expired
    // bookkeeping.
    const writerNode = await deviceA2.get(`lobbies/${code}/writer`) as { token: string; expiresAt: number };
    expect(writerNode.token).toBe(takeoverWriter.token);
  }, 45000);
});

// ---------------------------------------------------------------------------
// Phase 9C.2A H1 proof-completion, Gap 2 — every existing positive
// ("applied") reconciliation test exercises only unseatPlayer/
// assignPendingToSeat (local-only mutations); none exercises the plan's
// third branch, toRevoke, which is the ONLY branch that reaches the
// network (performMembershipRevocations -> revokePlayerMembership, through
// the same SessionWriter/writeGuard chokepoint every other write uses).
// This proves that branch end-to-end against a real emulator with rules
// enforced throughout: a real live-roster binding the restored checkpoint
// cannot resolve locally is genuinely revoked on the server, through the
// writer's normal path, with authority valid throughout — no lease games
// here; Gap 1 above proves the fencing, this proves the positive path it
// fences.
// ---------------------------------------------------------------------------
describe("OPUS-001-CONTRACT-H1-GAP2: valid-authority reconciliation that requires an actual server-side revocation, real enforced rules throughout", () => {
  test("useRemote applies and genuinely revokes an unresolvable live roster binding through the real writer — single write path, correct local and remote state", async () => {
    const code = "OP8AAAAA", st = "op8-storyteller";
    const ghostUid = "op8-ghost-uid"; // seated for real on the LIVE roster; unresolvable against the restored checkpoint
    const deviceA1 = backendFor(st);
    await createLobby(deviceA1, st, { codeGenerator: () => code });
    const session = await requireActiveSession(deviceA1, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);
    const seatId = useStorytellerStore.getState().game!.seatOrder[0]!;
    const writerA1 = new SessionWriter(deviceA1, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    const managerA1 = await startStorytellerSession(deviceA1, lobby, writerA1);
    managerA1.stop();
    await writerA1.dispose();
    await forceLeaseExpiry(code);

    // Device B: a real seatPlayer ACK lands on the LIVE roster/player
    // paths for ghostUid...
    const deviceB = backendFor(st);
    const writerB = new SessionWriter(deviceB, code, session.id);
    await writerB.start();
    await seatPlayer(writerB, code, ghostUid, seatId, { shownRole: "chef", shownAlignment: "good" });
    // ...and ghostUid genuinely files a leave request through the real
    // player-side production path (leaveLobby), under her own auth, per
    // rules.json's leaveRequests/$uid rule (requires the roster binding
    // seatPlayer just created). This is a normal rules-enforced client
    // write — not test-only seeding via withSecurityRulesDisabled — so
    // there is a genuine pre-existing leaveRequests/{ghostUid} record for
    // revocation to clean up (Luna: the prior assertion was vacuous
    // without this).
    const ghostBackend = backendFor(ghostUid);
    usePlayerStore.getState().setSession({ code, uid: ghostUid, requestedName: "Ghost" });
    await leaveLobby(ghostBackend);
    // ...but the checkpoint about to be published shows that seat
    // unoccupied and unrecoverable (no matching pendingPlayers entry) — a
    // crash between the remote membership ACK and the next local flush,
    // exactly the scenario buildMembershipReconciliation's own doc comment
    // describes. The checkpoint's OWN embedded roster is left empty so
    // toUnseat stays empty — this isolates the toRevoke branch from the
    // toUnseat/toRecoverPending branches OPUS-001-CONTRACT-H1-FOLLOWUP
    // already covers.
    const foreignGame = {
      ...useStorytellerStore.getState().game!, day: 5,
      players: { ...useStorytellerStore.getState().game!.players,
        [seatId]: { ...useStorytellerStore.getState().game!.players[seatId]!, isEmpty: true } },
    };
    await writeProjections({
      backend: writerB, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {}, membership: {},
    });
    await writerB.dispose();
    await forceLeaseExpiry(code);

    useStorytellerStore.getState().addPlayer("Unacknowledged local edit under real Gap2 revocation");

    const deviceA2 = backendFor(st);
    const writerA2 = new SessionWriter(deviceA2, code, session.id);
    const managerA2 = await startStorytellerSession(deviceA2, lobby, writerA2);
    disposals.push(() => writerA2.dispose());
    expect(managerA2.outcome).toBe("conflict");
    const guardBefore = await deviceA2.get(`lobbies/${code}/writeGuard`) as { token: string; revision: number };
    // Sanity: the live binding and its real private content genuinely exist
    // before resolution — this is what revocation must clean up.
    expect(await deviceA2.get(`lobbies/${code}/roster/${ghostUid}`)).toBe(seatId);
    expect(await deviceA2.get(`lobbies/${code}/player/${seatId}`)).toEqual({ shownRole: "chef", shownAlignment: "good" });
    // Sanity: the leave request genuinely exists before resolution — this
    // is what revocation must also clean up (rules.json's
    // leaveRequests/$uid schema stores exactly the literal `true`).
    expect(await deviceA2.get(`lobbies/${code}/leaveRequests/${ghostUid}`)).toBe(true);

    // Authority remains valid throughout — no lease games here. Gap 1
    // proves the fencing; this proves the positive path it fences.
    const result = await resolveReconnectConflict("useRemote");

    expect(result).toBe("applied");
    // Local state: restored to the foreign checkpoint's content; the
    // revoked seat stays exactly as the checkpoint showed it (revocation
    // is a remote-only write — unlike unseatPlayer/assignPendingToSeat, it
    // never mutates local game state itself).
    const game = useStorytellerStore.getState().game!;
    expect(game.day).toBe(5);
    expect(game.players[seatId]!.isEmpty).toBe(true);
    expect(useStorytellerStore.getState().undoStack).toEqual([]); // restoreRemoteCheckpoint always clears it

    // Remote: the unresolvable live roster binding is genuinely gone...
    expect(await deviceA2.get(`lobbies/${code}/roster/${ghostUid}`)).toBeUndefined();
    // ...matching player-private state is cleaned...
    expect(await deviceA2.get(`lobbies/${code}/player/${seatId}`)).toBeUndefined();
    // ...and recorded per existing command semantics, exactly like any
    // other revocation.
    expect(await deviceA2.get(`lobbies/${code}/outcomes/${ghostUid}`)).toBe("revoked");
    // ...and her genuinely pre-existing leave request (asserted present,
    // above) is cleaned up by the same revocation write — no longer
    // vacuous: existing leave request -> reconciliation revocation ->
    // leave request removed.
    expect(await deviceA2.get(`lobbies/${code}/leaveRequests/${ghostUid}`)).toBeUndefined();

    // Single write path: writeGuard advanced through writerA2's own normal
    // commit chokepoint (its own token), not a second path.
    const guardAfter = await deviceA2.get(`lobbies/${code}/writeGuard`) as { token: string; revision: number };
    expect(guardAfter.token).toBe(writerA2.token);
    expect(guardAfter.revision).toBeGreaterThan(guardBefore.revision);
  }, 30000);
});

// ---------------------------------------------------------------------------
// Phase 9C.3 (OPUS-003) contract coverage — the request/approval workflow's
// own real-client-against-enforced-rules proof. Every step below is the
// same production entry point the app itself calls: the real player client
// (leaveLobby/startPlayerHandshake) and the real Storyteller command layer
// (acceptLeaveRequest/rejectLeaveRequest), against rules.json enforced by
// the emulator throughout — never withSecurityRulesDisabled around the
// operation under test. The load-bearing proof both flows share: writing
// the request alone (leaveLobby) never destroys roster/private membership;
// only an explicit Storyteller decision does.
// ---------------------------------------------------------------------------
describe("OPUS-003-CONTRACT: real player client + enforced rules prove both the reject and accept leave-request flows", () => {
  test("reject flow: a real leave request survives Storyteller rejection and the player's handshake returns to seated with private access intact", async () => {
    const code = "OPC3AAAA", st = "opc3-storyteller", alice = "opc3-alice";
    const { stBackend, aliceBackend, writer, id } = await establishSeatedPlayer(code, st, alice, dispose => disposals.push(dispose));

    const stop = startPlayerHandshake(aliceBackend, code, alice);
    disposals.push(stop);
    await waitForPlayer(s =>
      s.status === "seated" && s.playerId === id && s.self !== null && s.error === null,
      "a live seated state with private data before any leave request");

    // Real player client, real enforced rules: the request itself must not
    // touch membership.
    await leaveLobby(aliceBackend);
    expect(await stBackend.get(`lobbies/${code}/leaveRequests/${alice}`)).toBe(true);
    expect(await stBackend.get(`lobbies/${code}/roster/${alice}`)).toBe(id);
    expect(await stBackend.get(`lobbies/${code}/player/${id}`)).not.toBeUndefined();
    expect(await stBackend.get(`lobbies/${code}/outcomes/${alice}`)).toBeUndefined();
    await waitForPlayer(s => s.status === "leaving", "leaving while the request is pending");

    // Explicit Storyteller rejection ("keep seated"), through the existing
    // fenced writer path — clears only the request.
    await rejectLeaveRequest(writer, code, alice);

    expect(await stBackend.get(`lobbies/${code}/leaveRequests/${alice}`)).toBeUndefined();
    expect(await stBackend.get(`lobbies/${code}/roster/${alice}`)).toBe(id);
    expect(await stBackend.get(`lobbies/${code}/outcomes/${alice}`)).toBeUndefined();

    // The player's real, still-live handshake recovers on its own — no
    // reconnect needed — and private access remains valid.
    await waitForPlayer(s =>
      s.status === "seated" && s.playerId === id && s.self !== null && s.error === null,
      "recovered to seated with private access still valid after rejection");
  }, 20000);

  test("accept flow: a real leave request survives while pending, then Storyteller acceptance runs the existing Firebase-first revocation and the player terminates as revoked", async () => {
    const code = "OPC3BAAA", st = "opc3b-storyteller", alice = "opc3b-alice";
    const { stBackend, aliceBackend, writer, id } = await establishSeatedPlayer(code, st, alice, dispose => disposals.push(dispose));

    const stop = startPlayerHandshake(aliceBackend, code, alice);
    disposals.push(stop);
    await waitForPlayer(s => s.status === "seated" && s.playerId === id, "seated before any leave request");

    await leaveLobby(aliceBackend);
    // Roster/private data remain intact while pending — writing the request
    // alone never destroys membership.
    expect(await stBackend.get(`lobbies/${code}/roster/${alice}`)).toBe(id);
    expect(await stBackend.get(`lobbies/${code}/player/${id}`)).not.toBeUndefined();
    await waitForPlayer(s => s.status === "leaving", "leaving while the request is pending");

    // Explicit Storyteller acceptance re-resolves the current uid->playerId
    // binding and runs the existing Firebase-first revocation path.
    await acceptLeaveRequest(writer, code, alice, playerId => useStorytellerStore.getState().unseatPlayer(playerId));

    expect(await stBackend.get(`lobbies/${code}/roster/${alice}`)).toBeUndefined();
    expect(await stBackend.get(`lobbies/${code}/player/${id}`)).toBeUndefined();
    expect(await stBackend.get(`lobbies/${code}/leaveRequests/${alice}`)).toBeUndefined();
    expect(await stBackend.get(`lobbies/${code}/outcomes/${alice}`)).toBe("revoked");
    // The seat itself survives as an empty/planned seat.
    expect(useStorytellerStore.getState().game!.players[id]).toBeDefined();
    expect(useStorytellerStore.getState().game!.players[id]!.isEmpty).toBe(true);

    // The revoked outcome becomes visible to the player's real, still-live
    // handshake, and it terminates as removed/revoked.
    await waitForPlayer(s =>
      s.status === "revoked" && s.playerId === null && s.self === null,
      "terminated as revoked, with private access cleared");
  }, 20000);
});

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation (OPUS-001-CONTRACT-H1-DELAYED-RENEWAL) — the
// exact real-emulator race the architecture review reproduced: renew()
// previously decided whether a renewal was a "reclaim" (and therefore
// whether to advance leaseEpoch) from a `now` captured, and a
// continuous-vs-reclaiming decision made, BEFORE its own Firebase
// transaction was ever awaited. A renewal that begins while this writer's
// lease is still genuinely valid, but whose REAL, already-dispatched-to-the-
// SDK Firebase transaction is then stalled — long enough that the lease
// expires and a completely separate real writer legitimately takes over AND
// releases before that transaction finally resolves — would, under the old
// code, refresh leaseExpiresAt without ever bumping leaseEpoch: "reclaiming"
// had already been decided (false) from pre-transaction bookkeeping that
// still believed the old lease was valid.
//
// PROOF FIDELITY (Luna, second pass): an earlier version of this test
// monkey-patched deviceA2.transaction itself to hold a plain JS Promise
// BEFORE ever calling the real Firebase backend's transaction() — proving
// only that renew() awaits *something* spanning the gap, not that a REAL,
// already-in-flight Firebase transaction survives it. This version never
// intercepts backend.transaction() at all. Instead it uses the Firebase
// client SDK's own real connectivity controls (goOffline/goOnline) on this
// writer's own actual Database connection: every one of this writer's own
// real runTransaction() calls on /writer — the resolver's own
// reconfirmAuthority() (still online, giving the resolver its pre-gap
// handle) and, crucially, this writer's own background renewal-interval
// ticks that fire once offline — genuinely enters the Firebase SDK's
// backend transaction path (a real read-modify-write cycle registered with
// the SDK's own pending-transaction machinery), and is then held unresolved
// — by the SDK's own documented offline-queuing behavior, not a test stub —
// across the entire real gap: this writer's real 30s lease expiring, a
// genuinely separate writer legitimately acquiring and publishing through
// /writer, and legitimately releasing it. Reconnecting (goOnline) makes the
// SDK itself flush and re-resolve those queued transactions against the
// CURRENT server record, exactly as it would after any real network drop —
// this is what "resumes/retries/resolves against the post-takeover state"
// means for a real RTDB transaction, not a simulated approximation of it.
//
// goOffline/goOnline operate only on this writer's own Database instance
// (each backendFor() call opens a genuinely independent connection — never
// shared across devices, confirmed by B/C's takeover succeeding below while
// A2 is offline), so this is a real, isolated network partition for this
// writer alone: TEST-ONLY (both are public firebase/database SDK functions
// called directly from this spec, never a production hook), and no
// production API, timing constant, or SessionWriter internal is touched.
//
// Timing: going offline immediately after the resolver's own
// reconfirmAuthority() call (rather than delaying that trigger) is
// deliberate on two counts. First, it fixes this writer's REAL server lease
// deadline at that renewal's own expiry — if further online renewals were
// allowed to keep extending it (this writer's own renewal interval would
// otherwise refresh the real lease every LEASE_MS/3), "a separate writer
// legitimately acquires /writer" could never actually happen on any bounded
// real-time budget. Second, since every renewal after that point is queued
// offline and none of their `await`s resolve until reconnection, the old
// code's pre-await `now`/`reclaiming` capture for EACH of them is compared
// against `leaseExpiresAt` as this renewal's own call left it — never
// advanced further offline — so all of them read as "still valid" and none
// bump the epoch once they finally do resolve; deliberately never delaying
// the trigger itself close to real expiry (as a naive read of "trigger
// late" might do) avoids the OTHER failure mode: a stale
// `now + LEASE_MS` from a too-early trigger masking the epoch defect behind
// a coincidental EXPIRY mismatch in holdsAuthority() instead of the epoch
// mismatch this test exists to isolate (see the mutation proof in the
// review notes) — going offline early leaves ~2 renewal-interval ticks
// genuinely in flight across the gap by the time reconnection resolves
// them, each one a real transaction proving the same closure contract, not
// weakening it.
// ---------------------------------------------------------------------------
describe("OPUS-001-CONTRACT-H1-DELAYED-RENEWAL: a renewal begun while valid, whose REAL in-flight Firebase transaction only resolves after a genuine foreign takeover and release, must advance the epoch and invalidate the pre-gap handle", () => {
  test("useRemote is stale once this writer's own real, already-dispatched renewal transactions legitimately reacquire the lease across a real foreign takeover/release; a freshly reconfirmed handle afterward remains valid", async () => {
    const code = "OP9AAAAA", st = "op9-storyteller";
    const ghostUid = "op9-ghost-uid"; // genuinely seated on the LIVE roster; unresolvable against the restored checkpoint
    const deviceA1 = backendFor(st);
    await createLobby(deviceA1, st, { codeGenerator: () => code });
    const session = await requireActiveSession(deviceA1, code);
    const lobby = { code, uid: st, sessionId: session.id, status: "live" as const };
    useStorytellerStore.getState().newGame("tb");
    useStorytellerStore.getState().addPlayer("Alice");
    useStorytellerStore.getState().setLobby(lobby);
    const seatId = useStorytellerStore.getState().game!.seatOrder[0]!;
    const writerA1 = new SessionWriter(deviceA1, code, session.id, error =>
      reportRuntimeError("write", error ? lifecycleMessage(error) : null));
    const managerA1 = await startStorytellerSession(deviceA1, lobby, writerA1);
    managerA1.stop();
    await writerA1.dispose();
    await forceLeaseExpiry(code);

    // Device B publishes a checkpoint whose OWN embedded roster binds
    // ghostUid to seatId (this becomes `restored.roster`, the prior-roster
    // diff target for useRemote) with that seat shown occupied — while the
    // LIVE `/roster` node (a separate path, untouched by writeProjections)
    // never gets that binding at all (same technique as
    // OPUS-001-CONTRACT-H1-FOLLOWUP/H1-TAKEOVER above). This is exactly "a
    // seat this device once believed was uid-bound, absent now" — a real,
    // non-vacuous reconciliation target if authority incorrectly held —
    // and, being a purely LOCAL unseat rather than a network revocation,
    // it keeps this test's failure mode a clean assertion mismatch rather
    // than a rules-level write rejection if the epoch gate is ever bypassed.
    const deviceB = backendFor(st);
    const writerB = new SessionWriter(deviceB, code, session.id);
    await writerB.start();
    const foreignGame = {
      ...useStorytellerStore.getState().game!, day: 5,
      players: { ...useStorytellerStore.getState().game!.players,
        [seatId]: { ...useStorytellerStore.getState().game!.players[seatId]!, name: "Ghost", isEmpty: false } },
    };
    await writeProjections({
      backend: writerB, code, stState: foreignGame,
      registry: buildRegistry(troubleBrewing), online: {}, membership: { [ghostUid]: seatId },
    });
    await writerB.dispose();
    await forceLeaseExpiry(code);

    useStorytellerStore.getState().addPlayer("Unacknowledged local edit under real delayed renewal");
    const localGameBefore = useStorytellerStore.getState().game;
    const undoBefore = useStorytellerStore.getState().undoStack;

    // A2's own real Database connection, retained alongside the
    // FirebaseRoomBackend wrapper backendFor() would otherwise build alone,
    // specifically so this test can drive REAL SDK connectivity
    // (goOffline/goOnline) on it below — a genuinely independent connection
    // from every other device in this test (each backendFor() call opens
    // its own; devices B and C below remain fully online throughout).
    const db2 = env.authenticatedContext(st).database() as unknown as Database;
    const deviceA2 = new FirebaseRoomBackend(db2);
    const writerA2 = new SessionWriter(deviceA2, code, session.id);
    const startedAt = Date.now(); // anchors A2's own real 30s lease window below
    const managerA2 = await startStorytellerSession(deviceA2, lobby, writerA2);
    disposals.push(() => writerA2.dispose());
    expect(managerA2.outcome).toBe("conflict");
    const guardBefore = await deviceA2.get(`lobbies/${code}/writeGuard`);
    const rosterBefore = await deviceA2.get(`lobbies/${code}/roster`);
    const writerPath = `lobbies/${code}/writer`;

    // Pause the roster read — the last server read before the final
    // authority gate — exactly like OPUS-001-CONTRACT-H1-TAKEOVER. This
    // portion is unchanged from the prior revision: it isolates
    // holdsAuthority() as the remaining protection, which is not itself
    // what this correction targets.
    const originalGet = deviceA2.get.bind(deviceA2);
    let paused = false;
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>(resolve => { releaseGate = resolve; });
    deviceA2.get = async readPath => {
      if (readPath === `lobbies/${code}/roster` && !paused) {
        paused = true;
        await gate;
      }
      return originalGet(readPath);
    };

    const resolving = resolveReconnectConflict("useRemote");
    await vi.waitFor(() => {
      if (!paused) throw new Error("expected the roster read to be paused");
    }, { timeout: 5000, interval: 20 });

    // By this point resolveReconnectConflict's own reconfirmAuthority() —
    // the very first thing it does — has already genuinely completed
    // ONLINE: the resolver holds its real pre-gap AuthorityHandle (item 2 of
    // the reproduction). Going offline HERE, immediately, is what fixes A2's
    // real server lease deadline at that renewal's own expiry: every one of
    // this writer's own subsequent renewal-interval ticks (every LEASE_MS/3
    // — no production timing touched, this is the writer's existing
    // schedule) is about to fire, still genuinely believing itself
    // authoritative (item 4), and each one's real runTransaction() call
    // genuinely enters the Firebase SDK's own backend transaction path
    // (item 5) — but with this connection offline, none of their awaits can
    // resolve; the SDK queues each one exactly as it documents for a real
    // network drop, not as a test stub. If any renewal were instead allowed
    // to complete online after this point, it would keep re-extending the
    // REAL server lease every ~10s, and "a separate writer legitimately
    // acquires /writer" (item 6) could never happen on any bounded wait.
    goOffline(db2);

    // Genuinely wait until well past A2's real 30s lease (anchored at
    // `startedAt`, extended once by the resolver's own already-completed
    // reconfirmAuthority() above, never again since every renewal from here
    // is offline) has expired — no mocked clock. By now at least one, and
    // typically two, of this writer's own renewal-interval ticks have fired
    // and are genuinely queued offline on /writer, each a real transaction
    // that began while this writer still believed itself authoritative.
    const targetTime = startedAt + LEASE_MS + 2000;
    const remainingWait = targetTime - Date.now();
    if (remainingWait > 0) await new Promise(resolve => setTimeout(resolve, remainingWait));

    // A genuinely separate real SessionWriter for the same storyteller
    // identity, on its own always-online connection, legitimately acquires
    // the now-expired /writer lease under fully enforced rules (item 6),
    // publishes newer guard/checkpoint/roster state through the real
    // production path (item 6), and then legitimately releases it (item
    // 6) — all while A2's own real renewal transactions remain queued
    // offline, having never observed any of this yet.
    const deviceC = backendFor(st);
    const takeoverWriter = new SessionWriter(deviceC, code, session.id);
    await takeoverWriter.start();
    const takeoverGame = { ...foreignGame, day: 9, notes: "takeover writer's own newer content" };
    await writeProjections({
      backend: takeoverWriter, code, stState: takeoverGame,
      registry: buildRegistry(troubleBrewing), online: {}, membership: {},
    });
    await takeoverWriter.dispose();

    // Read through deviceC (still online) rather than deviceA2, which is
    // deliberately still offline at this point — a read on an offline
    // connection with no cached value for the path would itself hang
    // waiting for connectivity, which is not what these snapshots are for.
    const guardAfterTakeover = await deviceC.get(`lobbies/${code}/writeGuard`);
    const checkpointAfterTakeover = await deviceC.get(`lobbies/${code}/checkpoint`);
    const rosterAfterTakeover = await deviceC.get(`lobbies/${code}/roster`);
    expect(guardAfterTakeover).not.toEqual(guardBefore); // genuinely newer than the conflict snapshot

    // Reconnect A2 (item 7): the Firebase SDK itself — not this test — now
    // flushes and resolves this writer's own queued renewal transactions
    // against the CURRENT server record (the takeover writer's released
    // lease), re-running their updaters against real, fresh data exactly as
    // it documents for reconnection after a real network drop. Polled
    // rather than awaited on a single held promise: this test never
    // captured one, and should not need to — this writer's own real
    // transactions resolve however many of them there genuinely are.
    goOnline(db2);
    await vi.waitFor(async () => {
      const node = await deviceA2.get(writerPath) as { token: string; expiresAt: number } | undefined;
      if (!node || node.token !== writerA2.token) throw new Error("expected A2 to have genuinely reacquired /writer after reconnecting");
    }, { timeout: 15000, interval: 100 });

    // Resume the paused roster read.
    deviceA2.get = originalGet;
    releaseGate();
    // Awaited through a try/catch rather than a bare `await`: if the epoch
    // gate is ever bypassed, the resolver does not merely return the wrong
    // string — it proceeds into finishLive()'s own initial flush, whose
    // writeGuard revision collides with the takeover writer's already-newer
    // one and is rejected by Firebase's own revision-monotonicity rule, so
    // the whole call rejects instead of resolving. Capturing that here
    // turns it into a clear, diagnosable assertion below rather than an
    // uncaught rejection escaping the test.
    let result: string | undefined;
    let unexpectedRejection: unknown;
    try { result = await resolving; }
    catch (error) { unexpectedRejection = error; }

    expect(unexpectedRejection).toBeUndefined();
    // The resolver's pre-gap handle is stale: the delayed renewal advanced
    // the epoch out from under it.
    expect(result).toBe("stale");

    // No stale local restoration, no undo mutation, and specifically no
    // local membership mutation — the seat that WOULD have been unseated
    // (per B's checkpoint-embedded ghostUid binding, absent from the live
    // roster) is exactly as it was locally, and no outcome/revocation was
    // ever recorded for ghostUid (there is no live binding for her to
    // revoke in the first place — this setup isolates the toUnseat branch,
    // exactly like H1-FOLLOWUP/H1-TAKEOVER above).
    expect(useStorytellerStore.getState().game).toEqual(localGameBefore);
    expect(useStorytellerStore.getState().undoStack).toEqual(undoBefore);
    expect(useStorytellerStore.getState().game!.players[seatId]).toEqual(localGameBefore!.players[seatId]);
    expect(await deviceA2.get(`lobbies/${code}/outcomes/${ghostUid}`)).toBeUndefined();
    // No overwrite of the takeover writer's newer state — guard, checkpoint
    // and roster remain exactly as it left them.
    expect(await deviceA2.get(`lobbies/${code}/writeGuard`)).toEqual(guardAfterTakeover);
    expect(await deviceA2.get(`lobbies/${code}/checkpoint`)).toEqual(checkpointAfterTakeover);
    expect(await deviceA2.get(`lobbies/${code}/roster`)).toEqual(rosterAfterTakeover);
    expect(await deviceA2.get(`lobbies/${code}/roster`)).toEqual(rosterBefore); // untouched throughout

    // A itself is not permanently dead: a NEW AuthorityHandle, obtained
    // after the reacquisition above, is genuinely valid. Reacquisition is
    // allowed for future work — only the specific handle issued before the
    // gap (held by the now-resolved resolver above) never becomes valid
    // again.
    const freshHandle = await writerA2.reconfirmAuthority();
    expect(writerA2.holdsAuthority(freshHandle, FENCE_MARGIN_MS)).toBe(true);
  }, 45000);
});

// ---------------------------------------------------------------------------
// Phase 9C.2A.2A remediation, Finding H3 — disposal must prove lease
// release, against a real emulator with rules enforced throughout. `release()`
// no longer uses a transaction at all (the historical bug's precondition —
// a transaction updater invoked against a locally-cached, possibly-stale
// view of /writer that can legitimately abort without ever reaching the
// server), so the empty-cache class of bug this closes cannot recur by
// construction; the tests below prove the DIRECT fenced write's observable
// behavior across every outcome the finding's classification names.
// ---------------------------------------------------------------------------
describe("OPUS-001-CONTRACT-H3: disposal proves lease release against real enforced rules", () => {
  test("H3-1: a successful dispose() genuinely changes server state — verified via an independent connection, not merely a locally-resolved promise", async () => {
    const code = "H31AAAAA", st = "h31-storyteller";
    const raw = backendFor(st);
    await createLobby(raw, st, { codeGenerator: () => code });
    const session = await requireActiveSession(raw, code);
    const writer = new SessionWriter(raw, code, session.id);
    await writer.start();
    await writer.dispose();
    // A genuinely independent connection/context confirms the server no
    // longer regards this token's lease as valid.
    const lease = await backendFor(st).get(`lobbies/${code}/writer`) as { token: string; expiresAt: number } | undefined;
    expect(!lease || lease.token !== writer.token || lease.expiresAt <= Date.now()).toBe(true);
  });

  test("H3-2: successful dispose() allows an immediate replacement writer to acquire the lease — no forced-expiry precondition needed", async () => {
    const code = "H32AAAAA", st = "h32-storyteller";
    const raw = backendFor(st);
    await createLobby(raw, st, { codeGenerator: () => code });
    const session = await requireActiveSession(raw, code);
    const writer = new SessionWriter(raw, code, session.id);
    await writer.start();
    await writer.dispose(); // no forceLeaseExpiry: dispose() alone must be sufficient
    const replacement = new SessionWriter(backendFor(st), code, session.id);
    disposals.push(() => replacement.dispose());
    await replacement.start(); // must succeed immediately, not throw "Another Storyteller tab..."
    expect(await backendFor(st).get(`lobbies/${code}/writer`)).toMatchObject({ token: replacement.token });
  });

  test("H3-3: disposing a stale writer whose lease was legitimately reclaimed by another valid writer resolves without altering the foreign lease", async () => {
    const code = "H33AAAAA", st = "h33-storyteller";
    const rawA = backendFor(st);
    await createLobby(rawA, st, { codeGenerator: () => code });
    const session = await requireActiveSession(rawA, code);
    const writerA = new SessionWriter(rawA, code, session.id);
    await writerA.start();
    await forceLeaseExpiry(code);
    const writerB = new SessionWriter(backendFor(st), code, session.id);
    disposals.push(() => writerB.dispose());
    await writerB.start(); // legitimately reclaims — writerA is now stale
    const foreignLeaseBefore = await backendFor(st).get(`lobbies/${code}/writer`);

    await writerA.dispose(); // stale writer disposes AFTER already losing the lease — must not throw

    const foreignLeaseAfter = await backendFor(st).get(`lobbies/${code}/writer`);
    expect(foreignLeaseAfter).toEqual(foreignLeaseBefore); // untouched by the stale writer's disposal
  });

  test("H3-4: a release that cannot reach the server over the network causes dispose() to reject, rather than silently reporting success", async () => {
    const code = "H34AAAAA", st = "h34-storyteller";
    const raw = backendFor(st);
    await createLobby(raw, st, { codeGenerator: () => code });
    const session = await requireActiveSession(raw, code);
    const writer = new SessionWriter(raw, code, session.id);
    await writer.start();
    const originalSet = raw.set.bind(raw);
    let calls = 0;
    raw.set = async () => { calls++; throw new Error("network offline"); };
    await expect(writer.dispose()).rejects.toThrow();
    expect(calls).toBeGreaterThan(1); // the writer's own retry budget was actually spent, not a single silent guess
    raw.set = originalSet;
    await writer.dispose(); // clean up for real, now that "the network" is back
  }, 15000);

  test("H3-5: rapid reconnect stays healthy against real enforced rules — dispose then immediately re-acquire, repeated", async () => {
    const code = "H35AAAAA", st = "h35-storyteller";
    const seedBackend = backendFor(st);
    await createLobby(seedBackend, st, { codeGenerator: () => code });
    const session = await requireActiveSession(seedBackend, code);
    let previous: SessionWriter | null = null;
    for (let i = 0; i < 3; i++) {
      if (previous) await previous.dispose();
      const writer = new SessionWriter(backendFor(st), code, session.id);
      await writer.start(); // must never spuriously fail with "Another Storyteller tab..."
      previous = writer;
    }
    disposals.push(() => previous!.dispose());
  });
});

// ---------------------------------------------------------------------------
// Phase 9C.6 (OPUS-002) — real separate-device Public Display contract.
// CONTRACT-006 above remains the negative baseline, unchanged: an
// authenticated non-member with no capability is denied `/public`. These
// tests prove the POSITIVE fix using real production code throughout: a
// genuinely separate display UID, authorized ONLY through the real
// publicDisplayAuth commands and a real SessionWriter, actually receives the
// real public projection via the real subscribeToPublicLobby listener — and
// every other authorization boundary (unrelated UIDs, private paths, token
// rotation, session end) holds against the real enforced rules.json. No
// MemoryRoomBackend substitute anywhere in this describe block.
// ---------------------------------------------------------------------------
describe("Phase 9C.6 (OPUS-002): real separate-device Public Display contract", () => {
  /** Real lobby + real writer + a real minimal public projection + a real
   * ensured capability + a real separate display UID enrolled through
   * authorizePublicDisplay. Every step is the actual production entry point
   * a live game and a live display would use. */
  async function establishAuthorizedDisplay(code: string, st: string, displayUid: string) {
    const stBackend = backendFor(st);
    await createLobby(stBackend, st, { codeGenerator: () => code });
    const session = await requireActiveSession(stBackend, code);
    const writer = new SessionWriter(stBackend, code, session.id);
    await writer.start();
    await writer.set(publicPath(code), { code, scriptId: "tb", phase: "setup", day: 0 });
    const token = await ensurePublicDisplayAccess(writer, code, session.id);
    const displayBackend = backendFor(displayUid);
    await authorizePublicDisplay(displayBackend, code, displayUid, token);
    return { stBackend, writer, session, token, displayBackend };
  }

  test("CONTRACT-OPUS002-1: a genuinely separate display UID, authorized solely by capability, observes the real public projection through a real live listener", async () => {
    const code = "PD1AAAAA", st = "pd1-storyteller", displayUid = "pd1-display";
    const { writer, session, displayBackend } = await establishAuthorizedDisplay(code, st, displayUid);
    disposals.push(() => writer.dispose());

    const received: (PublicLobbyRecord | null)[] = [];
    const unsub = subscribeToPublicLobby(displayBackend, code, value => received.push(value));
    disposals.push(() => unsub());
    await vi.waitFor(() => {
      if (!received.length || received.at(-1) === null) throw new Error("expected the real public projection to arrive for the display");
    }, { timeout: 5000, interval: 50 });
    expect(received.at(-1)).toMatchObject({ code, scriptId: "tb" });

    // No roster membership, no join request, no Storyteller authority — its
    // access comes solely from the display capability.
    expect(await displayBackend.get(`lobbies/${code}/roster/${displayUid}`)).toBeUndefined();
    expect(await displayBackend.get(`lobbies/${code}/joinRequests/${displayUid}`)).toBeUndefined();
    const rogueWriter = new SessionWriter(displayBackend, code, session.id);
    await expect(rogueWriter.start()).rejects.toThrow(/permission[_ ]denied/i);
    await rogueWriter.dispose().catch(() => {});
  });

  test("CONTRACT-OPUS002-2: an unrelated authenticated UID with no capability still receives a genuine permission denial from /public", async () => {
    const code = "PD2AAAAA", st = "pd2-storyteller", displayUid = "pd2-display", stranger = "pd2-stranger";
    const { writer } = await establishAuthorizedDisplay(code, st, displayUid);
    disposals.push(() => writer.dispose());

    const strangerBackend = backendFor(stranger);
    await expect(strangerBackend.get(`lobbies/${code}/public`)).rejects.toThrow(/permission[_ ]denied/i);
  });

  test("CONTRACT-OPUS002-3: the authorized display UID still receives a genuine permission denial from every Storyteller/private/security path", async () => {
    const code = "PD3AAAAA", st = "pd3-storyteller", displayUid = "pd3-display";
    const { writer, displayBackend } = await establishAuthorizedDisplay(code, st, displayUid);
    disposals.push(() => writer.dispose());

    await expect(displayBackend.get(`lobbies/${code}/storyteller`)).rejects.toThrow(/permission[_ ]denied/i);
    await expect(displayBackend.get(`lobbies/${code}/checkpoint`)).rejects.toThrow(/permission[_ ]denied/i);
    await expect(displayBackend.get(`lobbies/${code}/roster`)).rejects.toThrow(/permission[_ ]denied/i);
    await expect(displayBackend.get(`lobbies/${code}/displayAccess`)).rejects.toThrow(/permission[_ ]denied/i);
    await expect(displayBackend.set(`lobbies/${code}/public/day`, 99)).rejects.toThrow(/permission[_ ]denied/i);
    await expect(displayBackend.set(playerPath(code, "p-alice"), { shownRole: "imp" })).rejects.toThrow(/permission[_ ]denied/i);
  });

  test("CONTRACT-OPUS002-4: token rotation revokes an already-authorized LIVE display subscription with no intervening /public write, and the new token restores access", async () => {
    const code = "PD4AAAAA", st = "pd4-storyteller", displayUid = "pd4-display";
    const { writer, session, displayBackend, token: oldToken } = await establishAuthorizedDisplay(code, st, displayUid);
    disposals.push(() => writer.dispose());

    // A real live listener on the raw client SDK ref (same technique
    // rules.spec.ts's "revocation cancels an already-authorized live private
    // subscription" test uses) so the denial is observed directly from the
    // real Firebase callback, not inferred from a later one-shot read.
    const record = env.authenticatedContext(displayUid).database().ref(`lobbies/${code}/public`);
    let ready!: () => void;
    const firstValue = new Promise<void>((resolve) => { ready = resolve; });
    const denied = new Promise<Error>((resolve) => { record.on("value", () => ready(), resolve); });
    let newToken: string;
    try {
      await firstValue; // the live subscription has genuinely observed the old-token-authorized data
      // Rotate via the real SessionWriter — no /public write happens in between.
      newToken = await rotatePublicDisplayAccess(writer, code, session.id);
      expect((await denied).message).toMatch(/permission[_ ]denied/i);
    } finally { record.off(); }
    expect(newToken!).not.toBe(oldToken);

    // Authorizing with the NEW token restores real access for the same UID.
    await authorizePublicDisplay(displayBackend, code, displayUid, newToken!);
    await expect(displayBackend.get(`lobbies/${code}/public`)).resolves.toMatchObject({ code });
  });

  test("CONTRACT-OPUS002-5: ending the session through the real fenced lifecycle path (writer.close) revokes display /public authorization", async () => {
    const code = "PD5AAAAA", st = "pd5-storyteller", displayUid = "pd5-display";
    const { writer, displayBackend } = await establishAuthorizedDisplay(code, st, displayUid);
    disposals.push(() => writer.dispose());

    await expect(displayBackend.get(`lobbies/${code}/public`)).resolves.toMatchObject({ code });

    await writer.close([]);

    await expect(displayBackend.get(`lobbies/${code}/public`)).rejects.toThrow(/permission[_ ]denied/i);
  });
});
