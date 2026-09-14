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
import type { Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { SessionWriter } from "./writer";
import { writeProjections } from "./sync";
import { createLobby, readRosterBindings, revokePlayerMembership, seatPlayer } from "./lobby";
import { joinLobby, startPlayerHandshake } from "./playerSync";
import { playerPath } from "./paths";
import { reportRuntimeError, startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { lifecycleMessage, requireActiveSession } from "./lifecycle";
import { friendlyFirebaseError } from "./errors";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
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
});
