// Phase 10H (10H-IMPLEMENTATION-CONTRACT-v1.0 §§12, 15-17): enforced-rules
// proofs for the two authorized new RTDB paths -- revealAcks/{uid} and
// results/{uid} -- against the real emulator. Required emulator tests: setup
// failure fails the suite, never skips it.
//
// Traceability: 10H-AC-035 / AC-059 (revealAcks authorization), AC-053 /
// AC-054 / AC-055 / AC-060 (results payload, read policy, immutability,
// creation only inside the authoritative fenced terminal close), AC-061 (the
// multi-path `newData` semantics those rules rely on, proven rather than
// assumed), AC-048 / AC-052 (the real SessionWriter.close publishes results in
// its one atomic commit, and none for End Without Result).
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Database } from "firebase/database";
import { FirebaseRoomBackend } from "./firebaseBackend";
import { SessionWriter } from "./writer";
import { readPublishedResult, terminalPublication } from "./terminalResults";
import { revokePlayerMembership } from "./lobby";
import { makeSTPlayer } from "@/test/fixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

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
beforeEach(async () => { await env.clearDatabase(); });

const code = "TENH2345";
const st = "uid-storyteller";
const alice = "uid-alice";
const bob = "uid-bob";
const carol = "uid-carol"; // a waiting join request, never seated
const mallory = "uid-mallory"; // unrelated authenticated user
const SESSION = "session-10h";
const TOKEN_A = "AAAAAAAAAAAAAAAAAAAAAA";
const TOKEN_B = "BBBBBBBBBBBBBBBBBBBBBB";
const path = (suffix: string) => `lobbies/${code}/${suffix}`;
const db = (uid: string) => env.authenticatedContext(uid).database();
const ref = (uid: string, suffix: string) => db(uid).ref(path(suffix));
const raw = (uid: string) => new FirebaseRoomBackend(db(uid) as unknown as Database);
/** Server truth with rules disabled. (withSecurityRulesDisabled resolves to
 * void, so the value is captured explicitly.) */
async function val(suffix: string): Promise<unknown> {
  let value: unknown;
  await env.withSecurityRulesDisabled(async (ctx) => { value = (await ctx.database().ref(path(suffix)).once("value")).val(); });
  return value;
}
const resultPayload = (over: Record<string, unknown> = {}) => ({
  version: 1, sessionId: SESSION, winner: "good", declaredAt: { phase: "day", day: 3 }, ...over,
});

let revision = 0;
async function seed(extra: Record<string, unknown> = {}) {
  revision = 0;
  await env.withSecurityRulesDisabled(async (ctx) => {
    await ctx.database().ref(`lobbies/${code}`).set({
      storytellerUid: st,
      session: { version: 2, id: SESSION, state: "active" },
      writer: { token: "fixture-writer", expiresAt: Date.now() + 30_000 },
      writeGuard: { token: "fixture-writer", revision: 0 },
      roster: { [alice]: "p-alice", [bob]: "p-bob" },
      rosterParticipants: {
        [alice]: { playerId: "p-alice", participantId: "pt-alice", name: "Alice" },
        [bob]: { playerId: "p-bob", participantId: "pt-bob", name: "Bob" },
      },
      joinRequests: { [carol]: "Carol" },
      public: { code, scriptId: "tb", phase: "day", day: 3 },
      player: { "p-alice": { shownRole: "chef", shownAlignment: "good" } },
      ...extra,
    });
  });
}
/** A Storyteller multi-path update carrying the fixture writer's next guard. */
const fenced = (updates: Record<string, unknown>, token = "fixture-writer") =>
  db(st).ref().update({ ...updates, [path("writeGuard")]: { token, revision: ++revision } });
const endSession = { [path("session")]: { version: 2, id: SESSION, state: "ended" }, [path("public/status")]: "ended" };

const finalGame = (): StorytellerLobbyRecord => ({
  players: {
    "p-alice": makeSTPlayer({ id: "p-alice", name: "Alice", seat: 0, participantId: "pt-alice" }),
    "p-bob": makeSTPlayer({ id: "p-bob", name: "Bob", seat: 1, participantId: "pt-bob" }),
  },
} as unknown as StorytellerLobbyRecord);

describe("10H-AC-035 / AC-059: revealAcks/{uid} authorization (enforced rules)", () => {
  test("a seated (roster-bound) player writes ONLY their own bounded token in an active session", async () => {
    await seed();
    await assertSucceeds(ref(alice, `revealAcks/${alice}`).set(TOKEN_A));
    expect(await val(`revealAcks/${alice}`)).toBe(TOKEN_A);
    // Re-acknowledging a new token later is the same own-uid write.
    await assertSucceeds(ref(alice, `revealAcks/${alice}`).set(TOKEN_B));
    // Never another uid's acknowledgement -- not even another seated player's.
    await assertFails(ref(alice, `revealAcks/${bob}`).set(TOKEN_A));
    await assertFails(ref(mallory, `revealAcks/${alice}`).set(TOKEN_A));
  });

  test("not roster-bound: a waiting join request or an unrelated user cannot acknowledge", async () => {
    await seed();
    await assertFails(ref(carol, `revealAcks/${carol}`).set(TOKEN_A));
    await assertFails(ref(mallory, `revealAcks/${mallory}`).set(TOKEN_A));
  });

  test("only an active session: an ended session refuses every acknowledgement", async () => {
    await seed({ session: { version: 2, id: SESSION, state: "ended" } });
    await assertFails(ref(alice, `revealAcks/${alice}`).set(TOKEN_A));
  });

  test("a revoked participation (binding removed) can no longer acknowledge", async () => {
    await seed();
    await assertSucceeds(ref(alice, `revealAcks/${alice}`).set(TOKEN_A));
    await revokePlayerMembership(fencedBackend(), code, "p-alice");
    expect(await val(`revealAcks/${alice}`)).toBeNull(); // cleared by the revocation (hygiene)
    await assertFails(ref(alice, `revealAcks/${alice}`).set(TOKEN_B));
  });

  test("bounded string only: wrong type, too short, too long, illegal characters and deletion are refused", async () => {
    await seed();
    for (const bad of [42, true, { token: TOKEN_A }, "short", "x".repeat(65), "AAAAAAAAAAAAAAAAAAAA/A", "AAAAAAAAAAAAAAAAAAAA A"]) {
      await assertFails(ref(alice, `revealAcks/${alice}`).set(bad));
    }
    await assertSucceeds(ref(alice, `revealAcks/${alice}`).set("x".repeat(64)));
    await assertSucceeds(ref(alice, `revealAcks/${alice}`).set("y".repeat(16)));
    // The player cannot delete it (a stale/absent ack is simply not viewed).
    await assertFails(ref(alice, `revealAcks/${alice}`).remove());
  });

  test("read: the Storyteller reads every acknowledgement; a player only their own; nobody else", async () => {
    await seed({ revealAcks: { [alice]: TOKEN_A, [bob]: TOKEN_B } });
    await assertSucceeds(ref(st, "revealAcks").once("value"));
    await assertSucceeds(ref(alice, `revealAcks/${alice}`).once("value"));
    await assertFails(ref(alice, `revealAcks/${bob}`).once("value"));
    await assertFails(ref(alice, "revealAcks").once("value"));
    await assertFails(ref(mallory, `revealAcks/${alice}`).once("value"));
  });

  test("Storyteller cleanup: fenced deletes only -- never an unfenced write, never forging an acknowledgement", async () => {
    await seed({ revealAcks: { [alice]: TOKEN_A, [bob]: TOKEN_B } });
    // A stale/foreign writer token is fenced out.
    await assertFails(fenced({ [path(`revealAcks/${alice}`)]: null }, "foreign-writer"));
    // The Storyteller can never write an acknowledgement value.
    await assertFails(fenced({ [path(`revealAcks/${alice}`)]: TOKEN_B }));
    await assertFails(fenced({ [path("revealAcks")]: { [alice]: TOKEN_B } }));
    // Fenced deletion of one entry, then of the whole node.
    await assertSucceeds(fenced({ [path(`revealAcks/${alice}`)]: null }));
    expect(await val("revealAcks")).toEqual({ [bob]: TOKEN_B });
    await assertSucceeds(fenced({ [path("revealAcks")]: null }));
    expect(await val("revealAcks")).toBeNull();
  });
});

/** A RoomBackend whose updates carry the fixture writer's next guard. */
function fencedBackend() {
  const base = raw(st);
  return Object.assign(Object.create(base) as FirebaseRoomBackend, {
    update: (updates: Record<string, unknown>) => base.update({ ...updates, [path("writeGuard")]: { token: "fixture-writer", revision: ++revision } } as never),
    set: (target: string, value: unknown) => base.update({ [target]: value, [path("writeGuard")]: { token: "fixture-writer", revision: ++revision } } as never),
  });
}

describe("10H-AC-053 / AC-060 / AC-061: results/{uid} only inside the authoritative fenced terminal close", () => {
  test("AC-061 multi-path: a result written in the SAME fenced update that ends the session is accepted", async () => {
    await seed();
    await assertSucceeds(fenced({ ...endSession, [path(`results/${alice}`)]: resultPayload(), [path(`results/${bob}`)]: resultPayload() }));
    expect(await val(`results/${alice}`)).toEqual(resultPayload());
    expect(await val("session/state")).toBe("ended");
  });

  test("AC-061 multi-path: a result in a fenced update that does NOT end the session is refused (the whole update)", async () => {
    await seed();
    await assertFails(fenced({ [path(`results/${alice}`)]: resultPayload() }));
    await assertFails(fenced({ [path("public/status")]: "ended", [path(`results/${alice}`)]: resultPayload() }));
    expect(await val("results")).toBeNull();
    expect(await val("session/state")).toBe("active");
  });

  test("the existing writer fence applies: a stale/foreign guard or an expired lease refuses session end AND result together", async () => {
    await seed();
    await assertFails(fenced({ ...endSession, [path(`results/${alice}`)]: resultPayload() }, "foreign-writer"));
    expect(await val("session/state")).toBe("active");
    expect(await val("results")).toBeNull();
    await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref(path("writer/expiresAt")).set(Date.now() - 1); });
    await assertFails(fenced({ ...endSession, [path(`results/${alice}`)]: resultPayload() }));
    expect(await val("session/state")).toBe("active");
    expect(await val("results")).toBeNull();
  });

  test("Storyteller-authoritative only: no player and no unrelated user can create a result", async () => {
    await seed();
    await assertFails(db(alice).ref().update({ ...endSession, [path(`results/${alice}`)]: resultPayload(), [path("writeGuard")]: { token: "fixture-writer", revision: 1 } }));
    await assertFails(ref(alice, `results/${alice}`).set(resultPayload()));
    await assertFails(ref(mallory, `results/${mallory}`).set(resultPayload()));
    expect(await val("results")).toBeNull();
  });

  test("AC-053 exact allowlist: sessionId must match; extra keys, bad winner, bad phase, bad day are refused atomically", async () => {
    const bad: unknown[] = [
      resultPayload({ sessionId: "another-session" }),
      resultPayload({ version: 2 }),
      resultPayload({ winner: "draw" }),
      resultPayload({ winner: "storyteller" }),
      resultPayload({ declaredAt: { phase: "setup", day: 3 } }),
      resultPayload({ declaredAt: { phase: "day", day: 0 } }),
      resultPayload({ declaredAt: { phase: "day", day: 1.5 } }),
      resultPayload({ declaredAt: { phase: "day", day: "3" } }),
      resultPayload({ declaredAt: { phase: "night" } }),
      resultPayload({ declaredAt: { phase: "day", day: 3, reason: "x" } }),
      resultPayload({ actualRole: "imp" }),
      resultPayload({ participantId: "pt-alice" }),
      resultPayload({ youWon: true }),
      { version: 1, sessionId: SESSION, winner: "good" },
      "good",
    ];
    for (const payload of bad) {
      await seed();
      await assertFails(fenced({ ...endSession, [path(`results/${alice}`)]: payload, [path(`results/${bob}`)]: resultPayload() }));
      // Atomic: the session did not end and no valid sibling result landed.
      expect(await val("session/state")).toBe("active");
      expect(await val("results")).toBeNull();
    }
    await seed();
    await assertSucceeds(fenced({ ...endSession, [path(`results/${alice}`)]: resultPayload({ winner: "evil", declaredAt: { phase: "night", day: 1 } }) }));
  });

  test("AC-054: after teardown a uid reads ONLY its own result; the Storyteller reads the collection", async () => {
    await seed();
    await assertSucceeds(fenced({ ...endSession, [path(`results/${alice}`)]: resultPayload(), [path(`results/${bob}`)]: resultPayload() }));
    await assertSucceeds(ref(alice, `results/${alice}`).once("value"));
    expect((await ref(alice, `results/${alice}`).once("value")).val()).toEqual(resultPayload());
    await assertFails(ref(alice, `results/${bob}`).once("value"));
    await assertFails(ref(alice, "results").once("value"));
    await assertFails(ref(mallory, `results/${alice}`).once("value"));
    await assertSucceeds(ref(st, "results").once("value"));
    // A uid with no result (End Without Result / not a participant) reads an absent node, not a denial.
    expect((await ref(carol, `results/${carol}`).once("value")).exists()).toBe(false);
  });

  test("AC-054: no player result read while the session is still active", async () => {
    await seed();
    await assertFails(ref(alice, `results/${alice}`).once("value"));
  });

  test("AC-055 immutable: after terminalization nobody can overwrite, add or delete a result", async () => {
    await seed();
    await assertSucceeds(fenced({ ...endSession, [path(`results/${alice}`)]: resultPayload() }));
    await assertFails(fenced({ [path(`results/${alice}`)]: resultPayload({ winner: "evil" }) }));
    await assertFails(fenced({ [path(`results/${alice}`)]: null }));
    await assertFails(fenced({ [path(`results/${bob}`)]: resultPayload() }));
    await assertFails(fenced({ [path("results")]: null }));
    await assertFails(ref(alice, `results/${alice}`).remove());
    await assertFails(ref(alice, `results/${alice}`).set(resultPayload({ winner: "evil" })));
    expect(await val("results")).toEqual({ [alice]: resultPayload() });
  });

  test("a result can never be created twice: a replay of the terminal update is refused (the session ends once)", async () => {
    await seed();
    const update = { ...endSession, [path(`results/${alice}`)]: resultPayload() };
    await assertSucceeds(fenced(update));
    await assertFails(fenced(update));
    expect(await val(`results/${alice}`)).toEqual(resultPayload());
  });
});

describe("10H-AC-048 / AC-052: the real SessionWriter.close publishes in its one fenced atomic commit", () => {
  async function closeWith(result: Parameters<typeof terminalPublication>[2], acks = true) {
    await seed({
      ...(acks ? { revealAcks: { [alice]: TOKEN_A, [bob]: TOKEN_B } } : {}),
      writer: { token: "fixture-writer", expiresAt: 0 },
    });
    const backend = raw(st);
    const writer = new SessionWriter(backend, code, SESSION);
    try {
      await writer.start();
      await writer.close(["p-alice", "p-bob"], terminalPublication(code, SESSION, result, finalGame()));
    } finally { await writer.dispose(); }
  }

  test("Declare Evil: results for every coherent seated participant, the session ends, acknowledgements are cleared", async () => {
    await closeWith({ winner: "evil", declaredAt: { phase: "night", day: 2 } });
    const expected = { version: 1, sessionId: SESSION, winner: "evil", declaredAt: { phase: "night", day: 2 } };
    expect(await val("session/state")).toBe("ended");
    // ASTRA-10H-004: plus the Storyteller's durable receipt (identical payload).
    expect(await val("results")).toEqual({ [alice]: expected, [bob]: expected, [st]: expected });
    expect(await val("revealAcks")).toBeNull();
    expect(await val("roster")).toBeNull();
    expect(await val("player")).toBeNull();
    // The waiting join request (never seated) receives no result.
    expect(await val(`results/${carol}`)).toBeNull();
    expect((await ref(alice, `results/${alice}`).once("value")).val()).toEqual(expected);
  });

  test("AC-052 End Without Result: the same close publishes NO result for anyone", async () => {
    await closeWith(null);
    expect(await val("session/state")).toBe("ended");
    expect(await val("results")).toBeNull();
    expect(await val("revealAcks")).toBeNull();
  });

  test("an incoherent binding (record names another participation) receives no result; the rest do", async () => {
    await seed({
      writer: { token: "fixture-writer", expiresAt: 0 },
      rosterParticipants: {
        [alice]: { playerId: "p-alice", participantId: "pt-old-alice", name: "Alice" },
        [bob]: { playerId: "p-bob", participantId: "pt-bob", name: "Bob" },
      },
    });
    const writer = new SessionWriter(raw(st), code, SESSION);
    try {
      await writer.start();
      await writer.close([], terminalPublication(code, SESSION, { winner: "good", declaredAt: { phase: "day", day: 4 } }, finalGame()));
    } finally { await writer.dispose(); }
    expect(Object.keys((await val("results")) ?? {}).sort()).toEqual([bob, st].sort()); // + the Storyteller receipt
  });

  test("AC-049: a close whose fence is lost publishes nothing and leaves the session active (retryable)", async () => {
    await seed({ writer: { token: "fixture-writer", expiresAt: 0 } });
    const writer = new SessionWriter(raw(st), code, SESSION);
    try {
      await writer.start();
      // Another writer takes the lease before the terminal commit.
      await env.withSecurityRulesDisabled(async (ctx) => {
        await ctx.database().ref(path("writer")).set({ token: "usurper", expiresAt: Date.now() + 30_000 });
      });
      await expect(writer.close([], terminalPublication(code, SESSION, { winner: "good", declaredAt: { phase: "day", day: 3 } }, finalGame()))).rejects.toBeTruthy();
    } finally { await writer.dispose().catch(() => {}); }
    expect(await val("session/state")).toBe("active");
    expect(await val("results")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ASTRA-10H-004 (Sol amendment): the durable Storyteller result receipt lives
// at results/{storytellerUid} under the SAME results Rules -- no Rules change,
// no new path. These prove, against the enforced rules and the real writer,
// that it exists with zero phone recipients, is player-safe and private to the
// Storyteller, is fenced/create-only/session-bound, and that the recovery read
// distinguishes a declared result from a CONFIRMED absence and fails closed.
describe("ASTRA-10H-004: the durable Storyteller result receipt (enforced rules + real SessionWriter.close)", () => {
  async function closeWithRoster(result: Parameters<typeof terminalPublication>[2], extra: Record<string, unknown> = {}) {
    await seed({ writer: { token: "fixture-writer", expiresAt: 0 }, ...extra });
    const writer = new SessionWriter(raw(st), code, SESSION);
    try {
      await writer.start();
      await writer.close([], terminalPublication(code, SESSION, result, finalGame()));
    } finally { await writer.dispose(); }
  }
  const good = { winner: "good" as const, declaredAt: { phase: "day" as const, day: 3 } };

  test("B. a declared Good close with ZERO roster-bound phones still persists exactly one receipt in the same commit", async () => {
    await closeWithRoster(good, { roster: null, rosterParticipants: null });
    expect(await val("session/state")).toBe("ended");
    expect(await val("results")).toEqual({ [st]: resultPayload() });
    expect(Object.keys((await val(`results/${st}`)) as object).sort()).toEqual(["declaredAt", "sessionId", "version", "winner"]);
    // The recovery read finds it: a CONFIRMED declared result.
    expect(await readPublishedResult(raw(st), code, SESSION)).toEqual(good);
  });

  test("A. End Without Result writes no receipt -- the recovery read is a CONFIRMED absence (null), not an error", async () => {
    await closeWithRoster(null);
    expect(await val("results")).toBeNull();
    expect(await readPublishedResult(raw(st), code, SESSION)).toBeNull();
  });

  test("the receipt is Storyteller-private: no player and no unrelated user can read it", async () => {
    await closeWithRoster(good);
    await assertSucceeds(ref(st, `results/${st}`).once("value"));
    await assertFails(ref(alice, `results/${st}`).once("value"));
    await assertFails(ref(mallory, `results/${st}`).once("value"));
    await assertFails(ref(alice, "results").once("value"));
  });

  test("E. a stale or foreign writer can neither create the receipt in a terminal commit nor alter it afterwards", async () => {
    await seed();
    await assertFails(fenced({ ...endSession, [path(`results/${st}`)]: resultPayload() }, "foreign-writer"));
    expect(await val("session/state")).toBe("active");
    expect(await val("results")).toBeNull();
    await assertSucceeds(fenced({ ...endSession, [path(`results/${st}`)]: resultPayload() }));
    await assertFails(fenced({ [path(`results/${st}`)]: resultPayload({ winner: "evil" }) }));
    await assertFails(fenced({ [path(`results/${st}`)]: resultPayload({ winner: "evil" }) }, "foreign-writer"));
    await assertFails(fenced({ [path(`results/${st}`)]: null }));
    await assertFails(ref(st, `results/${st}`).set(resultPayload({ winner: "evil" })));
    expect(await val(`results/${st}`)).toEqual(resultPayload());
  });

  test("F. a receipt naming another session is refused by the rules, and a mismatched record makes the recovery read fail closed", async () => {
    await seed();
    await assertFails(fenced({ ...endSession, [path(`results/${st}`)]: resultPayload({ sessionId: "another-session" }) }));
    expect(await val("session/state")).toBe("active");
    expect(await val("results")).toBeNull();
    // Even if such a record existed (rules bypassed), recovery refuses it rather than skip it.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await ctx.database().ref(path("session/state")).set("ended");
      await ctx.database().ref(path(`results/${st}`)).set(resultPayload({ sessionId: "another-session" }));
    });
    await expect(readPublishedResult(raw(st), code, SESSION)).rejects.toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// PR-10H-001 (Sol R3): a declared-result close completes ALL terminal
// publication reads and validation (storytellerUid, roster, rosterParticipants)
// BEFORE the irreversible public/status = "ended" signal. Against the enforced
// rules and the real SessionWriter: a preflight failure writes nothing
// terminal, the same writer keeps writing under the unchanged fence, and a
// repaired retry closes exactly once.
describe("PR-10H-001: terminal preflight before the irreversible public signal (enforced rules + real SessionWriter.close)", () => {
  type Op = { kind: "get" | "update"; paths: string[] };
  /** The Storyteller's real backend, logging every get/update in issue order,
   * with an optional injected read failure for one path. */
  function recordingBackend(failPath: { current: string | null }) {
    const base = raw(st);
    const ops: Op[] = [];
    const backend = Object.assign(Object.create(base) as FirebaseRoomBackend, {
      get: async (target: string) => {
        ops.push({ kind: "get", paths: [target] });
        if (failPath.current === target) throw Object.assign(new Error("PERMISSION_DENIED: injected read failure"), { code: "PERMISSION_DENIED" });
        return base.get(target);
      },
      update: async (updates: Record<string, unknown>) => {
        ops.push({ kind: "update", paths: Object.keys(updates) });
        return base.update(updates as never);
      },
    });
    return { backend, ops };
  }
  const good = { winner: "good" as const, declaredAt: { phase: "day" as const, day: 3 } };
  const seededRoster = { [alice]: "p-alice", [bob]: "p-bob" };
  const seededParticipants = {
    [alice]: { playerId: "p-alice", participantId: "pt-alice", name: "Alice" },
    [bob]: { playerId: "p-bob", participantId: "pt-bob", name: "Bob" },
  };
  async function expectNothingTerminal() {
    expect(await val("session")).toEqual({ version: 2, id: SESSION, state: "active" });
    expect(await val("public/status")).not.toBe("ended");
    expect(await val("results")).toBeNull();
    expect(await val("player")).not.toBeNull();
    expect(await val(`joinRequests/${carol}`)).toBe("Carol");
    expect(await val("revealAcks")).toEqual({ [alice]: TOKEN_A, [bob]: TOKEN_B });
  }

  const CASES: { name: string; seed: Record<string, unknown>; fail: string | null; repair: Record<string, unknown> }[] = [
    { name: "storytellerUid read fails", seed: {}, fail: path("storytellerUid"), repair: {} },
    { name: "roster decodes invalid (real server data)", seed: { roster: { [alice]: 7 } }, fail: null, repair: { roster: seededRoster } },
    { name: "roster read fails", seed: {}, fail: path("roster"), repair: {} },
    { name: "rosterParticipants decodes invalid (real server data)", seed: { rosterParticipants: { [alice]: { playerId: 3 } } }, fail: null, repair: { rosterParticipants: seededParticipants } },
    { name: "rosterParticipants read fails", seed: {}, fail: path("rosterParticipants"), repair: {} },
  ];

  test.each(CASES)("$name: no ended signal, session active, no results, no teardown; the writer stays fenced and live; a repaired retry closes once", async ({ seed: extra, fail, repair }) => {
    await seed({ writer: { token: "fixture-writer", expiresAt: 0 }, revealAcks: { [alice]: TOKEN_A, [bob]: TOKEN_B }, ...extra });
    const failPath = { current: fail };
    const { backend, ops } = recordingBackend(failPath);
    const writer = new SessionWriter(backend, code, SESSION);
    try {
      await writer.start();
      const start = ops.length;
      await expect(writer.close([], terminalPublication(code, SESSION, good, finalGame()))).rejects.toBeTruthy();
      // Not one write left the failed close.
      expect(ops.slice(start).filter(op => op.kind === "update")).toEqual([]);
      await expectNothingTerminal();
      expect(writer.isClosing()).toBe(false);
      expect(writer.isStopped()).toBe(false);
      // The same writer still writes, under the unchanged lease/guard/revision fence.
      await writer.update({ [path("public/phase")]: "night" });
      expect(await val("public/phase")).toBe("night");
      expect((await val("writeGuard")) as { token: string }).toMatchObject({ token: writer.token });
      expect(await val("public/status")).not.toBe("ended");
      // Repair the failure, retry: the declared result closes exactly once.
      failPath.current = null;
      if (Object.keys(repair).length) {
        await env.withSecurityRulesDisabled(async (ctx) => {
          for (const [key, value] of Object.entries(repair)) await ctx.database().ref(path(key)).set(value);
        });
      }
      await writer.close([], terminalPublication(code, SESSION, good, finalGame()));
    } finally { await writer.dispose().catch(() => {}); }
    expect(await val("session")).toEqual({ version: 2, id: SESSION, state: "ended" });
    expect(await val("public/status")).toBe("ended");
    expect(await val("results")).toEqual({ [alice]: resultPayload(), [bob]: resultPayload(), [st]: resultPayload() });
    for (const torn of ["roster", "rosterParticipants", "joinRequests", "player", "storyteller", "checkpoint", "revealAcks"]) {
      expect(await val(torn)).toBeNull();
    }
    expect(ops.filter(op => op.kind === "update" && op.paths.includes(path("session")))).toHaveLength(1);
    expect(ops.filter(op => op.kind === "update" && op.paths.length === 2 && op.paths.includes(path("public/status")))).toHaveLength(1);
  });

  test("ordering on the real server: every builder read precedes the signal, which is followed directly by the one final commit", async () => {
    await seed({ writer: { token: "fixture-writer", expiresAt: 0 } });
    const { backend, ops } = recordingBackend({ current: null });
    const writer = new SessionWriter(backend, code, SESSION);
    try {
      await writer.start();
      const start = ops.length;
      await writer.close([], terminalPublication(code, SESSION, good, finalGame()));
      const log = ops.slice(start);
      const lastRead = Math.max(...["storytellerUid", "roster", "rosterParticipants"].map(suffix => log.findIndex(op => op.kind === "get" && op.paths[0] === path(suffix))));
      const signal = log.findIndex(op => op.kind === "update" && op.paths.length === 2 && op.paths.includes(path("public/status")));
      const final = log.findIndex(op => op.kind === "update" && op.paths.includes(path("session")));
      expect(lastRead).toBeGreaterThanOrEqual(0);
      expect(signal).toBeGreaterThan(lastRead);
      expect(final).toBeGreaterThan(signal);
      expect(log.slice(signal + 1, final)).toEqual([{ kind: "get", paths: [path("writeGuard")] }]);
    } finally { await writer.dispose().catch(() => {}); }
    expect(await val("session/state")).toBe("ended");
  });

  test("counterfactual (previous ordering): an ended signal before a failed preflight strands the active session -- the Rules refuse every later projection that lacks the ended mark", async () => {
    await seed();
    // The old close published this first, then its terminal builder failed.
    await assertSucceeds(fenced({ [path("public/status")]: "ended" }));
    expect(await val("session/state")).toBe("active");
    // The still-active game can no longer project its ordinary public state.
    await assertFails(fenced({ [path("public")]: { code, scriptId: "tb", phase: "night", day: 3 } }));
    await assertFails(fenced({ [path("public/status")]: "day" }));
    expect(await val("public/status")).toBe("ended");
  });

  test("no delayed projection can overwrite the terminal state (older or newer revision, writer's own token)", async () => {
    await seed({ writer: { token: "fixture-writer", expiresAt: 0 } });
    const writer = new SessionWriter(raw(st), code, SESSION);
    try {
      await writer.start();
      await writer.close([], terminalPublication(code, SESSION, good, finalGame()));
    } finally { await writer.dispose().catch(() => {}); }
    const guard = (await val("writeGuard")) as { token: string; revision: number };
    expect(guard.token).toBe(writer.token);
    for (const revision of [1, guard.revision - 1, guard.revision + 1]) {
      await assertFails(db(st).ref().update({
        [path("public")]: { code, scriptId: "tb", phase: "night", day: 4 },
        [path("player/p-alice")]: { shownRole: "imp", shownAlignment: "evil" },
        [path("writeGuard")]: { token: writer.token, revision },
      }));
      await assertFails(db(st).ref().update({ [path("public/status")]: "ended", [path("writeGuard")]: { token: writer.token, revision } }));
    }
    expect(await val("session/state")).toBe("ended");
    expect(await val("public/status")).toBe("ended");
    expect(await val("player")).toBeNull();
    expect(await val("results")).toEqual({ [alice]: resultPayload(), [bob]: resultPayload(), [st]: resultPayload() });
  });
});

// ---------------------------------------------------------------------------
// R3-CLOSURE-001 (Sol R3.2): the irreversible-boundary knowledge is
// writer-lifetime. Against the enforced rules and the real SessionWriter: a
// first close whose signal landed but whose final commit the SERVER rejected,
// then a retry that fails in its preflight, keeps the writer fail-closed -- no
// ordinary projection is attempted (and the rules would refuse one that drops
// the ended mark), public stays ended, the session stays active -- and a later
// repaired retry completes. Delayed/replayed terminal writes stay fenced.
describe("R3-CLOSURE-001: multi-attempt irreversible boundary (enforced rules + real SessionWriter)", () => {
  type Op = { kind: "get" | "update"; paths: string[] };
  function backendWith(control: { failRead: string | null; loseSignalResponse: boolean }) {
    const base = raw(st);
    const ops: Op[] = [];
    const backend = Object.assign(Object.create(base) as FirebaseRoomBackend, {
      get: async (target: string) => {
        ops.push({ kind: "get", paths: [target] });
        if (control.failRead === target) throw Object.assign(new Error("PERMISSION_DENIED: injected read failure"), { code: "PERMISSION_DENIED" });
        return base.get(target);
      },
      update: async (updates: Record<string, unknown>) => {
        ops.push({ kind: "update", paths: Object.keys(updates) });
        await base.update(updates as never);
        const keys = Object.keys(updates);
        if (control.loseSignalResponse && keys.length === 2 && keys.includes(path("public/status"))) {
          control.loseSignalResponse = false;
          throw new Error("unexpected response failure");
        }
      },
    });
    return { backend, ops };
  }
  const good = { winner: "good" as const, declaredAt: { phase: "day" as const, day: 3 } };
  const close = (writer: SessionWriter) => writer.close([], terminalPublication(code, SESSION, good, finalGame()));
  async function expectFailClosed(writer: SessionWriter, ops: Op[], start: number) {
    expect(writer.isClosing()).toBe(true);
    expect(ops.slice(start).filter(op => op.kind === "update")).toEqual([]);
    await expect(writer.update({ [path("public/phase")]: "night" })).rejects.toThrow(/closing/);
    // Even if something did attempt an ordinary projection over public, the
    // enforced rules would refuse dropping the ended mark.
    const guard = (await val("writeGuard")) as { revision: number };
    await assertFails(db(st).ref().update({
      [path("public")]: { code, scriptId: "tb", phase: "night", day: 3 },
      [path("writeGuard")]: { token: writer.token, revision: guard.revision + 100 },
    }));
    expect(await val("public/status")).toBe("ended");
    expect(await val("session/state")).toBe("active");
    expect(await val("results")).toBeNull();
    expect(await val("roster")).toEqual({ [alice]: "p-alice", [bob]: "p-bob" });
  }
  async function expectRecovered(writer: SessionWriter, ops: Op[]) {
    expect(await val("session")).toEqual({ version: 2, id: SESSION, state: "ended" });
    expect(await val("public/status")).toBe("ended");
    expect(await val("results")).toEqual({ [alice]: resultPayload(), [bob]: resultPayload(), [st]: resultPayload() });
    for (const torn of ["roster", "rosterParticipants", "joinRequests", "player", "revealAcks"]) expect(await val(torn)).toBeNull();
    // Delayed / replayed terminal writes stay fenced.
    const guard = (await val("writeGuard")) as { revision: number };
    for (const revision of [1, guard.revision - 1, guard.revision + 1]) {
      await assertFails(db(st).ref().update({ [path("public/status")]: "ended", [path("writeGuard")]: { token: writer.token, revision } }));
      await assertFails(db(st).ref().update({ ...endSession, [path(`results/${alice}`)]: resultPayload({ winner: "evil" }), [path("writeGuard")]: { token: writer.token, revision } }));
    }
    expect(await val("results")).toEqual({ [alice]: resultPayload(), [bob]: resultPayload(), [st]: resultPayload() });
    expect(ops.filter(op => op.kind === "update" && op.paths.length === 2 && op.paths.includes(path("public/status"))).length).toBeGreaterThanOrEqual(2);
  }

  test.each(["storytellerUid", "roster", "rosterParticipants"])("Sequence A: signal landed, final commit REJECTED by the rules, retry fails on the %s read -> still fail-closed; repaired retry completes", async (read) => {
    // A stray result makes the rules refuse the whole atomic final commit (create-only).
    await seed({ writer: { token: "fixture-writer", expiresAt: 0 }, revealAcks: { [alice]: TOKEN_A }, results: { [alice]: resultPayload() } });
    const control = { failRead: null as string | null, loseSignalResponse: false };
    const { backend, ops } = backendWith(control);
    const writer = new SessionWriter(backend, code, SESSION);
    try {
      await writer.start();
      await expect(close(writer)).rejects.toBeTruthy();
      expect(await val("public/status")).toBe("ended"); // the signal landed
      expect(await val("session/state")).toBe("active"); // the server refused the final commit
      expect(writer.isClosing()).toBe(true);
      await env.withSecurityRulesDisabled(async (ctx) => { await ctx.database().ref(path("results")).remove(); });
      control.failRead = path(read);
      const start = ops.length;
      await expect(close(writer)).rejects.toBeTruthy();
      await expectFailClosed(writer, ops, start);
      control.failRead = null;
      await close(writer);
      await expectRecovered(writer, ops);
    } finally { await writer.dispose().catch(() => {}); }
  });

  test("Sequence B: the signal reached the server but its response was lost; the retry fails in preflight -> still fail-closed; a later retry completes", async () => {
    await seed({ writer: { token: "fixture-writer", expiresAt: 0 } });
    const control = { failRead: null as string | null, loseSignalResponse: true };
    const { backend, ops } = backendWith(control);
    const writer = new SessionWriter(backend, code, SESSION);
    try {
      await writer.start();
      await expect(close(writer)).rejects.toThrow("unexpected response failure");
      expect(await val("public/status")).toBe("ended");
      expect(await val("session/state")).toBe("active");
      control.failRead = path("rosterParticipants");
      const start = ops.length;
      await expect(close(writer)).rejects.toBeTruthy();
      await expectFailClosed(writer, ops, start);
      control.failRead = null;
      await close(writer);
      await expectRecovered(writer, ops);
    } finally { await writer.dispose().catch(() => {}); }
  });
});
