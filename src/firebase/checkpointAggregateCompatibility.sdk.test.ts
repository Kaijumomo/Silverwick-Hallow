// @vitest-environment jsdom
// @vitest-environment-options {"storageQuota":100000000}
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, setLogLevel } from "firebase/app";
import { getDatabase, goOffline, ref, update } from "firebase/database";
import type { Json, RoomBackend } from "./backend";
import { serializeCheckpoint, serializeCheckpointEnvelope, supportedRosterEnvelope, validateCheckpointEnvelope, worstCaseUid } from "./checkpoint";
import { MAX_AUTH_UID_LENGTH } from "./authUid";
import { validateFirebaseWritableValue } from "./firebaseWriteCompatibility";
import { LifecycleError } from "./lifecycle";
import { checkpointPath, checkpointPathSegments } from "./paths";
import { MAX_ROOM_CODE_SHAPE } from "./roomCode";
import { writeProjections } from "./sync";
import { MAX_TOTAL_PLAYERS } from "@/data/setupCounts";
import { buildRegistry } from "@/data/roleRegistry";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { captureFingerprint, type ManualAbilityRequest } from "@/stores/abilityResolution";
import { participantStepKey } from "@/stores/nightProgress";
import { bind, openInStore, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { RoleDef, Script, StorytellerLobbyRecord } from "@/stores/types";
import { registerVotingAuthorityReader } from "./votingAuthority";

// Phase 10F -- SOL-10F-E1 (PHASE10F Section 44): the production writer also
// writes `lobbies/{code}/checkpoint` = JSON.stringify({ game, roster }) as ONE
// string leaf. Individually valid game leaves (D1) can add up to a checkpoint
// Firebase's 10 MiB leaf limit refuses. One shared serializer; the writer
// validates its EXACT checkpoint before any write; resolveAbility refuses,
// before commit, a result whose checkpoint could not fit with the
// conservative supported-roster envelope. Same offline SDK oracle as the D1
// suite: synchronous client-side validation only, never a network write.

setLogLevel("silent");
const app = initializeApp({ databaseURL: "http://127.0.0.1:1?ns=silverwick-checkpoint-aggregate" }, "checkpoint-aggregate-compatibility");
const db = getDatabase(app);
goOffline(db);
afterAll(async () => { await deleteApp(app); });

const LIMIT = 10 * 1024 * 1024; // 10,485,760
const code = MAX_ROOM_CODE_SHAPE;
/** Firebase bytes of a well-formed string. JSON.stringify output never holds
 * a lone surrogate, and for well-formed UTF-16 the SDK's util.stringLength
 * equals the UTF-8 byte length. */
const bytes = (value: string) => Buffer.byteLength(value, "utf8");
function sdkAccepts(updates: Record<string, unknown>): boolean {
  try {
    void update(ref(db), updates).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
/** The writer's own verdict path: the shared validator at the real destination. */
const helperAccepts = (checkpoint: string, at = code) => validateFirebaseWritableValue(checkpoint, checkpointPathSegments(at)).ok;

/** A RoomBackend whose update() is the installed SDK's own update(). */
function sdkBackend() {
  const calls: Record<string, Json>[] = [];
  const backend = {
    update: async (updates: Record<string, Json>) => {
      calls.push(updates);
      void update(ref(db), updates).catch(() => undefined); // throws synchronously when the SDK refuses
    },
  } as unknown as RoomBackend;
  return { backend, calls };
}
async function project(game: StorytellerLobbyRecord, membership: Record<string, string> | undefined, at = code) {
  const { backend, calls } = sdkBackend();
  let error: unknown = null;
  try {
    await writeProjections({ backend, code: at, stState: game, registry: buildRegistry(script), online: {}, membership });
  } catch (caught) { error = caught; }
  return { calls, error };
}

/** A custom-script role whose OWN Information Action takes free text. */
const CHRONICLER: RoleDef = { ...proofScript.characters.find((role) => role.id === "empath")!, id: "chronicler", name: "Chronicler",
  provenance: { status: "homebrew" },
  informationActions: [{ id: "chronicler-message", timing: { kind: "manual" }, requirements: [{ id: "message", kind: "text", label: "The message" }] }] } as RoleDef;
const script: Script = { ...proofScript, characters: [...proofScript.characters, CHRONICLER] };
const ROLES = ["empath", "imp", "chef", "monk", "saint", "poisoner", "washerwoman"];
const ST_UID = "StorytellerAnonUid0123456789"; // the shape Firebase anonymous auth mints: 28 alphanumerics
const liveGame = (over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord =>
  patchPlayer(proofGame(ROLES, "night", 2, { code, storytellerUid: ST_UID, ...over }), "p0", { actualRole: "chronicler" });
/** A real anonymous-auth roster: every seat bound, 28-character UIDs. */
const anonRoster = (game: StorytellerLobbyRecord) =>
  Object.fromEntries(game.seatOrder.map((id, i) => [`anonUid${String(i).padStart(2, "0")}`.padEnd(28, "x"), id]));
const manualText = (g: StorytellerLobbyRecord, text: string): ManualAbilityRequest => ({ mode: "manual", reason: "Told the Chronicler a message",
  outcome: { operations: [{ domain: "information", recipient: bind(g, "p0"), informationActionId: "chronicler-message",
    values: [{ requirementId: "message", kind: "text", value: text }] }] } });

describe("SOL-10F-E1 -- one shared checkpoint serializer, used byte-for-byte by the writer", () => {
  it("serializeCheckpoint is exactly JSON.stringify({ game, roster })", () => {
    const game = liveGame({ notes: "quote \" backslash \\ newline \n emoji 😀 lone \uD800" });
    const roster = anonRoster(game);
    expect(serializeCheckpoint(game, roster)).toBe(JSON.stringify({ game, roster }));
    expect(serializeCheckpoint(game, {})).toBe(JSON.stringify({ game, roster: {} }));
  });

  it("the value writeProjections places at lobbies/{code}/checkpoint IS serializeCheckpoint(game, actualRoster)", async () => {
    const game = liveGame({ notes: "Beware the second chair. €😀" });
    for (const membership of [anonRoster(game), {}, undefined]) {
      const { calls, error } = await project(game, membership);
      expect(error).toBeNull();
      expect(calls).toHaveLength(1);
      expect(checkpointPath(code)).toBe(`lobbies/${code}/checkpoint`);
      expect(calls[0]![checkpointPath(code)]).toBe(serializeCheckpoint(game, membership ?? {}));
    }
  });

  it("no production module serializes a checkpoint itself (the writer and the store use checkpoint.ts)", () => {
    const root = resolve(__dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) files.push(path);
      }
    };
    walk(root);
    const serializers = files.filter((file) => /JSON\.stringify\(\{\s*game\b/.test(readFileSync(file, "utf8")));
    expect(serializers.map((file) => relative(root, file).split(sep).join("/"))).toEqual(["firebase/checkpoint.ts"]);
    const sync = readFileSync(resolve(__dirname, "sync.ts"), "utf8");
    expect(sync).toMatch(/serializeCheckpoint\(stState, ctx\.membership \?\? \{\}\)/);
    const updateAt = sync.indexOf("await backend.update(updates)");
    const validateAt = sync.indexOf("validateFirebaseWritableValue(checkpoint, checkpointPathSegments(code))");
    expect(validateAt).toBeGreaterThan(0);
    expect(validateAt).toBeLessThan(updateAt);
    const storeCode = readFileSync(resolve(__dirname, "../stores/storytellerStore.ts"), "utf8");
    const start = storeCode.search(/^ {6}resolveAbility: \(/m);
    const body = storeCode.slice(start, storeCode.indexOf("\n      assignRole:", start));
    expect(body).toContain("commitAuthoritativeState(result.plan.game, state, authority)");
    const commitStart = storeCode.indexOf("const commitAuthoritativeState =");
    const commit = storeCode.slice(commitStart, storeCode.indexOf("\n      return {", commitStart));
    expect(commit.indexOf("persistencePreflight(prepared, current, state.lobby)")).toBeGreaterThan(0);
    expect(commit.indexOf("persistencePreflight(prepared, current, state.lobby)")).toBeLessThan(commit.indexOf("localStorage.setItem"));
    expect(storeCode).toContain("validateCheckpointEnvelope(planned, current)");
  });
});

describe("SOL-10F-E1 -- the supported-roster envelope can never underestimate a real roster", () => {
  /** UIDs of at most MAX_AUTH_UID_LENGTH characters chosen to maximize JSON
   * escaping / Firebase bytes under every reading of "character" (UTF-16
   * unit, code point), plus the real anonymous-auth shape. */
  const adversarialUids = (salt: number): string[] => {
    const n = MAX_AUTH_UID_LENGTH;
    const tag = String.fromCharCode(0x4e00 + salt); // keeps keys distinct
    return [
      `anonUid${salt}`.padEnd(28, "x"),
      tag + "\"".repeat(n - 1),
      tag + "\\".repeat(n - 1),
      tag + "\u0001".repeat(n - 1),
      tag + "\n".repeat(n - 1),
      tag + "€".repeat(n - 1),
      tag + "߿".repeat(n - 1),
      tag + "😀".repeat((n - 1) >> 1),
      tag + "😀".repeat(n - 1), // 128 code points = 255 UTF-16 units
      tag + "\uD800".repeat(n - 1),
      tag + "\uDC00".repeat(n - 1),
      tag + "\uDBFF\uDBFF\"".repeat(Math.floor((n - 1) / 3)),
    ];
  };

  it("worstCaseUid: MAX_AUTH_UID_LENGTH units, pure-ASCII serialization of exactly 2 + 6 x 128 bytes, distinct per index", () => {
    expect(MAX_AUTH_UID_LENGTH).toBe(128);
    const seen = new Set<string>();
    for (const index of [0, 1, 2, 19, 20, 1023, 1024, 1025, 4096, 1_000_000]) {
      const uid = worstCaseUid(index);
      expect(uid).toHaveLength(MAX_AUTH_UID_LENGTH);
      const json = JSON.stringify(uid);
      expect(json).toMatch(/^[\x20-\x7e]*$/);
      expect(bytes(json)).toBe(2 + 6 * MAX_AUTH_UID_LENGTH);
      seen.add(uid);
    }
    expect(seen.size).toBe(10);
  });

  it("no supported UID serializes longer than a worstCaseUid key", () => {
    const worst = bytes(JSON.stringify(worstCaseUid(0)));
    for (const uid of adversarialUids(1)) {
      expect([...uid].length).toBeLessThanOrEqual(MAX_AUTH_UID_LENGTH);
      expect(bytes(JSON.stringify(uid)), JSON.stringify(uid).slice(0, 24)).toBeLessThanOrEqual(worst);
    }
  });

  it("one entry per PlayerId record of every game given (the union), never fewer than the seats; a supported game has at most MAX_TOTAL_PLAYERS", () => {
    const game = liveGame();
    const grown = { ...game, players: { ...game.players, extra: { ...game.players.p1!, id: "extra" } } };
    expect(Object.values(supportedRosterEnvelope(game)).sort()).toEqual(Object.keys(game.players).sort());
    expect(Object.values(supportedRosterEnvelope(game, grown)).sort()).toEqual([...Object.keys(game.players), "extra"].sort());
    const full = proofGame(Array.from({ length: MAX_TOTAL_PLAYERS }, (_, i) => ROLES[i % ROLES.length]!));
    expect(Object.keys(supportedRosterEnvelope(full))).toHaveLength(MAX_TOTAL_PLAYERS);
  });

  it("property: for 400 random injective rosters over the game's seats, with adversarial UIDs, under any lobby, real checkpoint bytes <= envelope bytes", () => {
    let seed = 0x5eed;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const base = proofGame(Array.from({ length: MAX_TOTAL_PLAYERS }, (_, i) => ROLES[i % ROLES.length]!), "night", 2, { notes: "n".repeat(500) });
    const envelope = bytes(serializeCheckpointEnvelope(base));
    let tightest = Infinity;
    for (let trial = 0; trial < 400; trial++) {
      const seats = [...base.seatOrder].filter(() => rand(4) > 0);
      const roster: Record<string, string> = {};
      seats.forEach((playerId, i) => { const pool = adversarialUids(i); roster[pool[rand(pool.length)]!] = playerId; });
      const storytellerUid = adversarialUids(99)[rand(12)]!;
      const real = bytes(serializeCheckpoint({ ...base, code: MAX_ROOM_CODE_SHAPE, storytellerUid }, roster));
      expect(real).toBeLessThanOrEqual(envelope);
      tightest = Math.min(tightest, envelope - real);
    }
    // the absolute worst real case (every seat bound, every UID maximal) meets the envelope exactly
    const maximal = Object.fromEntries(base.seatOrder.map((playerId, i) => [worstCaseUid(i + 7), playerId]));
    expect(bytes(serializeCheckpoint({ ...base, code: MAX_ROOM_CODE_SHAPE, storytellerUid: worstCaseUid(3) }, maximal))).toBe(envelope);
    expect(tightest).toBeGreaterThanOrEqual(0);
  });

  it("a game with no room yet (code \"\", storytellerUid \"local\") is measured as it will be once a room stamps it", () => {
    const local = liveGame({ code: "", storytellerUid: "local" });
    const stamped = { ...local, code: MAX_ROOM_CODE_SHAPE, storytellerUid: worstCaseUid(0) };
    expect(serializeCheckpointEnvelope(local)).toBe(serializeCheckpoint(stamped, supportedRosterEnvelope(local)));
    expect(bytes(serializeCheckpointEnvelope(local))).toBeGreaterThan(bytes(serializeCheckpoint(local, {})) + 6 * MAX_AUTH_UID_LENGTH);
  });
});

describe("SOL-10F-E1 -- exact real rosters: shared helper and installed SDK agree at the 10 MiB checkpoint boundary", () => {
  /** A game padded (notes) so its checkpoint with `roster` is exactly `target` Firebase bytes. */
  function sized(roster: Record<string, string>, target: number, unit = "a"): StorytellerLobbyRecord {
    const game = liveGame();
    const room = target - bytes(serializeCheckpoint(game, roster));
    const unitBytes = bytes(unit);
    const whole = Math.floor(room / unitBytes);
    const padded = { ...game, notes: unit.repeat(whole) + "a".repeat(room - whole * unitBytes) };
    expect(bytes(serializeCheckpoint(padded, roster))).toBe(target);
    return padded;
  }
  const rosters: [string, (g: StorytellerLobbyRecord) => Record<string, string>][] = [
    ["an empty roster", () => ({})],
    ["every seat bound to an anonymous-auth UID", anonRoster],
    ["every seat bound to a 128-character 3-byte UID", (g) => Object.fromEntries(g.seatOrder.map((id, i) => [String.fromCharCode(0x4e00 + i) + "€".repeat(127), id]))],
  ];

  it.each(rosters)("%s: exactly 10,485,760 bytes is written; 10,485,761 is refused by the writer before update() and rejected by the SDK", async (_label, rosterOf) => {
    const roster = rosterOf(liveGame());
    for (const unit of ["a", "€"]) {
      const atLimit = sized(roster, LIMIT, unit);
      const atCheckpoint = serializeCheckpoint(atLimit, roster);
      expect(helperAccepts(atCheckpoint)).toBe(true);
      expect(sdkAccepts({ [checkpointPath(code)]: atCheckpoint })).toBe(true);
      const ok = await project(atLimit, roster);
      expect(ok.error).toBeNull();
      expect(ok.calls).toHaveLength(1); // the SDK accepted the writer's exact update

      const over = sized(roster, LIMIT + 1, unit);
      const overCheckpoint = serializeCheckpoint(over, roster);
      expect(helperAccepts(overCheckpoint)).toBe(false);
      expect(sdkAccepts({ [checkpointPath(code)]: overCheckpoint })).toBe(false);
      const refused = await project(over, roster);
      expect(refused.error).toBeInstanceOf(LifecycleError);
      expect((refused.error as LifecycleError).kind).toBe("invalid");
      expect((refused.error as Error).message).toContain(`greater than ${LIMIT} utf8 bytes`);
      expect(refused.calls).toHaveLength(0); // no public, player or Storyteller path was projected
    }
  });

  it("writer defense in depth: a game that reached the store by another path is never partially projected", async () => {
    const game = liveGame({ notes: "a".repeat(6_000_000), history: [{ id: "h", note: "b".repeat(6_000_000) } as never] });
    expect(validateFirebaseWritableValue(game, ["lobbies", code, "storyteller"]).ok).toBe(true); // every leaf is fine (D1)
    const { calls, error } = await project(game, anonRoster(game));
    expect(error).toBeInstanceOf(LifecycleError);
    expect(calls).toHaveLength(0);
    // the installed SDK would have refused the very update the writer withheld
    expect(sdkAccepts({ [checkpointPath(code)]: serializeCheckpoint(game, anonRoster(game)) })).toBe(false);
  });
});

describe("SOL-10F-E1 -- resolveAbility proves checkpoint compatibility before its authoritative commit", () => {
  beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0 }));

  function open(lobby: boolean): StorytellerLobbyRecord {
    const g = lobby ? liveGame() : liveGame({ code: "", storytellerUid: "local" });
    openInStore(g);
    store.setState({ customScripts: { [script.id]: script } });
    if (lobby) {
      // This test isolates the SDK envelope; real writer ownership has its
      // own command tests and enforced-emulator contract proof.
      registerVotingAuthorityReader(() => "sdk-checkpoint-writer");
      store.setState({ lobby: { code, uid: ST_UID, sessionId: "session", status: "live" } });
    }
    return store.getState().game!;
  }
  const snapshot = () => ({ game: store.getState().game, undo: store.getState().undoStack.length, localSeq: store.getState().localSeq });
  function inert(run: () => unknown) {
    const before = snapshot();
    const g = before.game!;
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications++; });
    const result = run();
    unsubscribe();
    expect(result).toMatchObject({ ok: false, code: "invalidComposition",
      message: expect.stringMatching(/cannot be safely stored online \(the game's recovery checkpoint contains a string greater than 10485760 utf8 bytes\) -- nothing was recorded/) });
    expect(snapshot()).toEqual(before);
    expect(store.getState().game).toBe(g);
    expect(store.getState().game!.history).toBe(g.history);
    expect(store.getState().game!.informationDeliveries).toBe(g.informationDeliveries);
    expect(store.getState().game!.nightProgress).toBe(g.nightProgress);
    expect(store.getState().game!.players).toBe(g.players);
    expect(notifications).toBe(0);
  }

  it("the established reproduction: the first ~6 MB delivery commits; the second, which would cross the checkpoint limit, is refused atomically", async () => {
    const g0 = open(true);
    expect(store.getState().resolveAbility(manualText(g0, "a".repeat(6_000_000)))).toMatchObject({ ok: true, changed: true });
    const first = store.getState().game!;
    expect(first.informationDeliveries).toHaveLength(1);
    expect(store.getState().undoStack).toHaveLength(1);
    const seq = store.getState().localSeq;

    inert(() => store.getState().resolveAbility(manualText(first, "b".repeat(6_000_000))));
    expect(store.getState().game).toBe(first); // the first game stays authoritative
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().localSeq).toBe(seq);
    expect(store.getState().game!.informationDeliveries).toHaveLength(1);

    // ... and the writer persists the surviving game with its real roster (the SDK accepts)
    const { calls, error } = await project(first, anonRoster(first));
    expect(error).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("... also with the second delivery's Night step requested (no Night progress)", () => {
    const g0 = open(true);
    expect(store.getState().resolveAbility(manualText(g0, "a".repeat(6_000_000)))).toMatchObject({ ok: true, changed: true });
    const first = store.getState().game!;
    const step = { day: first.day, stepKey: participantStepKey(bind(first, "p0").participantId, "chronicler") };
    const request: ManualAbilityRequest = { ...manualText(first, "b".repeat(6_000_000)), fingerprint: captureFingerprint(first, "p0", step)!, completeStep: true };
    inert(() => store.getState().resolveAbility(request));
    expect(store.getState().game!.nightProgress[`${first.day}:${step.stepKey}`]).toBeUndefined();
  });

  it.each([["with a live room", true], ["before a room exists", false]])("boundary %s: an envelope of exactly 10,485,760 bytes commits; one byte more is refused before commit (and the SDK rejects that envelope)", (_label, lobby) => {
    const opened = open(lobby);
    // Probe the size of this exact resolution shape, then undo it.
    expect(store.getState().resolveAbility(manualText(opened, "x"))).toMatchObject({ ok: true, changed: true });
    const probe = bytes(serializeCheckpointEnvelope(store.getState().game!, opened));
    store.getState().undo();
    const g0 = store.getState().game!;
    expect(g0).toEqual(opened);
    const text = (extra: number) => "x".repeat(1 + LIMIT - probe + extra);

    expect(store.getState().resolveAbility(manualText(g0, text(0)))).toMatchObject({ ok: true, changed: true });
    const accepted = store.getState().game!;
    const envelope = serializeCheckpointEnvelope(accepted, g0);
    expect(bytes(envelope)).toBe(LIMIT);
    expect(sdkAccepts({ [checkpointPath(code)]: envelope })).toBe(true);
    // the largest supported real roster for it is written by the writer and accepted by the SDK
    const lobbyGame = { ...accepted, code, storytellerUid: worstCaseUid(5) };
    const maximal = Object.fromEntries(accepted.seatOrder.map((id, i) => [String.fromCharCode(0x4e00 + i) + "€".repeat(127), id]));
    expect(bytes(serializeCheckpoint(lobbyGame, maximal))).toBeLessThanOrEqual(LIMIT);
    store.getState().undo();
    expect(store.getState().game).toEqual(g0);

    inert(() => store.getState().resolveAbility(manualText(g0, text(1))));
    // the refused plan's envelope is exactly one byte over, and the installed SDK rejects it
    const overGame = { ...accepted, informationDeliveries: accepted.informationDeliveries.map((d) => ({ ...d,
      values: d.values!.map((v) => ({ ...v, value: (v as { value: string }).value + "x" })) })) } as StorytellerLobbyRecord;
    const overEnvelope = serializeCheckpointEnvelope(overGame, g0);
    expect(bytes(overEnvelope)).toBe(LIMIT + 1);
    expect(validateCheckpointEnvelope(overGame, g0).ok).toBe(false);
    expect(sdkAccepts({ [checkpointPath(code)]: overEnvelope })).toBe(false);
  });

  it("ordinary ability results are unchanged: they commit and the writer persists them", async () => {
    const g0 = open(true);
    expect(store.getState().resolveAbility(manualText(g0, "Beware the second chair. ".repeat(4000)))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(1);
    const { calls, error } = await project(store.getState().game!, anonRoster(store.getState().game!));
    expect(error).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
