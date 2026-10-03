// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, setLogLevel } from "firebase/app";
import { getDatabase, goOffline, ref, update } from "firebase/database";
import { validateFirebaseWritableValue } from "./firebaseWriteCompatibility";
import { storytellerPath, storytellerPathSegments } from "./paths";
import { canonicalJoin, generateCode } from "./lobby";
import { MAX_ROOM_CODE_SHAPE, ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./roomCode";
import { CANONICAL_ABILITY_SEMANTICS, type AbilityDescriptor, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { nightTriggerStepKey, participantStepKey } from "@/stores/nightProgress";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import type { AbilityResolutionRequest } from "@/stores/abilityResolution";
import { bind, openInStore, patchPlayer, pick, plan, planned, proofEnv, proofGame, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Phase 10F -- SOL-10F-C3 (PHASE10F Section 39): an accepted ability plan is
// committed only if the production writer can project the resulting
// Storyteller game. The store's resolveAbility runs the EXISTING
// firebaseWriteCompatibility check against the real Storyteller destination
// (the live lobby's, or the canonical maximum room-code shape before a room
// exists) BEFORE set(). Verdicts are compared with the INSTALLED Firebase SDK:
// the same offline oracle as nightProgressKeys.sdk.test.ts (goOffline,
// unroutable URL, the modular update(ref(db), { "<destination>": value }) call
// FirebaseRoomBackend.update() makes), so every verdict is the SDK's
// synchronous client-side validation -- never a network write.

setLogLevel("silent");
const app = initializeApp({ databaseURL: "http://127.0.0.1:1?ns=silverwick-ability-commit" }, "ability-commit-compatibility");
const db = getDatabase(app);
goOffline(db);
afterAll(async () => { await deleteApp(app); });

/** The installed SDK's own verdict for `value` written to `code`'s Storyteller destination. */
function sdkAccepts(code: string, value: unknown): boolean {
  try {
    void update(ref(db), { [storytellerPath(code)]: value }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
const helperAccepts = (code: string, value: unknown) => validateFirebaseWritableValue(value, storytellerPathSegments(code)).ok;

const ROLES = ["ravenkeeper", "imp", "chef", "monk", "empath", "saint", "washerwoman"]; // p0 Ravenkeeper, p1 Imp
/** The Imp kills the Ravenkeeper; the death is recorded as LifeEvent `eventId`. */
function killedBy(eventId: string, ravenkeeperParticipantId?: string): StorytellerLobbyRecord {
  let g = proofGame(ROLES);
  if (ravenkeeperParticipantId) g = patchPlayer(g, "p0", { participantId: ravenkeeperParticipantId });
  const killed = planned(plan(g, request(g, "p1", "imp", { target: pick(g, "p0") }),
    proofEnv({ ids: { ...proofEnv().ids, life: { eventId: () => eventId, historyId: () => `hl-${Math.random()}` } } })));
  expect(killed.lifeEventWindow.events.map((event) => event.id)).toEqual([eventId]);
  return killed;
}
const trigger = (g: StorytellerLobbyRecord): AbilityResolutionRequest =>
  request(g, "p0", "ravenkeeper", { target: pick(g, "p2") }, { invocationPath: "nightTrigger" });
const triggerKey = (g: StorytellerLobbyRecord, eventId: string) => `${g.day}:${nightTriggerStepKey(bind(g, "p0").participantId, "ravenkeeper", eventId)}`;
const live = (code: string) => store.setState({ lobby: { code, uid: "st-uid", status: "live" } });
const snapshot = () => {
  const s = store.getState();
  return { game: s.game, undo: s.undoStack.length, localSeq: s.localSeq };
};

beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0 }));

describe("SOL-10F-C3 -- the store refuses an accepted plan the production writer could not project", () => {
  it("the maximum room-code shape is the repository's own supported contract", () => {
    expect(MAX_ROOM_CODE_SHAPE).toHaveLength(ROOM_CODE_LENGTH);
    expect([...MAX_ROOM_CODE_SHAPE].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
    expect(canonicalJoin(MAX_ROOM_CODE_SHAPE, "Anna").code).toBe(MAX_ROOM_CODE_SHAPE); // a code players can actually join
    for (let i = 0; i < 20; i++) expect(generateCode()).toHaveLength(MAX_ROOM_CODE_SHAPE.length);
    expect(storytellerPath(MAX_ROOM_CODE_SHAPE)).toBe(`lobbies/${MAX_ROOM_CODE_SHAPE}/storyteller`);
  });

  it("Astra's reproduction: a Ravenkeeper killed by LifeEvent '.'.repeat(160) -- refused BEFORE commit; nothing changes", () => {
    const eventId = ".".repeat(160);
    const killed = killedBy(eventId);
    // The PURE coordinator stays storage-agnostic: it accepts the plan ...
    const accepted = planned(plan(killed, trigger(killed)));
    expect(accepted.nightProgress[triggerKey(killed, eventId)]).toEqual({ status: "done", notes: "" });
    // ... which neither the shared helper nor the installed SDK would write.
    const verdict = validateFirebaseWritableValue(accepted, storytellerPathSegments(MAX_ROOM_CODE_SHAPE));
    expect(verdict).toEqual({ ok: false, message: expect.stringMatching(/longer than 768 bytes/) });
    expect(sdkAccepts(MAX_ROOM_CODE_SHAPE, accepted)).toBe(false);

    openInStore(killed);
    const before = snapshot();
    const result = store.getState().resolveAbility(trigger(killed));
    expect(result).toEqual({ ok: false, code: "invalidComposition", message: expect.stringContaining("nothing was recorded") });
    // The exact same helper explains the refusal.
    expect(!result.ok && result.message).toContain((verdict as { message: string }).message.replace(/\.$/, ""));
    const after = snapshot();
    expect(after).toEqual(before);
    expect(store.getState().game).toBe(killed); // same reference: no replacement
    expect(store.getState().undoStack).toEqual([]);
    expect(Object.keys(store.getState().game!.nightProgress)).toEqual([]); // no trigger progress
    expect(store.getState().game!.history).toBe(killed.history);
    expect(store.getState().game!.informationDeliveries).toBe(killed.informationDeliveries);
    expect(sdkAccepts(MAX_ROOM_CODE_SHAPE, store.getState().game)).toBe(true); // Current State stays writable
  });

  it("the same refusal in a live room (actual lobby code destination)", () => {
    const killed = killedBy(".".repeat(160));
    openInStore(killed);
    const code = generateCode();
    live(code);
    const before = snapshot();
    expect(store.getState().resolveAbility(trigger(killed))).toMatchObject({ ok: false, code: "invalidComposition" });
    expect(snapshot()).toEqual(before);
    expect(sdkAccepts(code, planned(plan(killed, trigger(killed))))).toBe(false);
  });

  it.each([
    ["a normal UUID LifeEvent id", "6f1c2a9e-3b7d-4c41-9d0e-2f5a8b7c6d10", undefined],
    ["LifeEvent id 'death.v1' (encoded key)", "death.v1", undefined],
    ["short Firebase-forbidden characters", "a.b#c$d[e]f/g%h:i", undefined],
    ["an unusual short ParticipantId", "e-1", "rk.#$[]/:%"],
  ])("positive: %s commits; the committed game is SDK-writable; Undo restores it", (_label, eventId, participantId) => {
    const killed = killedBy(eventId, participantId);
    openInStore(killed);
    const code = generateCode();
    expect(store.getState().resolveAbility(trigger(killed))).toMatchObject({ ok: true, changed: true });
    const committed = store.getState().game!;
    expect(committed.nightProgress[triggerKey(killed, eventId)]).toEqual({ status: "done", notes: "" });
    expect(Object.keys(committed.nightProgress).every((key) => /^[A-Za-z0-9_%:-]+$/.test(key))).toBe(true);
    for (const destination of [MAX_ROOM_CODE_SHAPE, code]) {
      expect(sdkAccepts(destination, committed)).toBe(true);
      expect(helperAccepts(destination, committed)).toBe(true);
    }
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().localSeq).toBe(6);
    store.getState().undo();
    expect(store.getState().game).toEqual(killed);
  });

  it("C3 x B5/B6 x A10: a hostile encoded event-specific trigger is consumed once, Undo reopens it, and it resolves again", () => {
    const eventId = "x.y#z";
    const killed = killedBy(eventId, "pt:rk/1");
    openInStore(killed);
    expect(store.getState().resolveAbility(trigger(killed))).toMatchObject({ ok: true, changed: true });
    const consumed = store.getState().game!;
    expect(consumed.nightProgress[triggerKey(killed, eventId)]?.status).toBe("done");
    expect(store.getState().resolveAbility(trigger(killed))).toMatchObject({ ok: false }); // consumed: never twice
    store.getState().undo();
    expect(store.getState().game).toEqual(killed);
    expect(store.getState().resolveAbility(trigger(killed))).toMatchObject({ ok: true, changed: true });
    expect(sdkAccepts(MAX_ROOM_CODE_SHAPE, store.getState().game)).toBe(true);
  });

  it("C3 x A10: an incompatible trigger is refused before commit and stays OPEN (never consumed, never half-recorded)", () => {
    const killed = killedBy("#".repeat(200));
    openInStore(killed);
    expect(store.getState().resolveAbility(trigger(killed))).toMatchObject({ ok: false, code: "invalidComposition" });
    expect(store.getState().resolveAbility(trigger(killed))).toMatchObject({ ok: false, code: "invalidComposition" }); // same answer: still open
    expect(plan(killed, trigger(killed))).toMatchObject({ ok: true, changed: true });
  });

  it("ordinary ability resolution is unaffected (local and live)", () => {
    const g = proofGame(["monk", "chef", "imp", "empath", "saint", "poisoner", "washerwoman"]);
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "monk", { target: pick(g, "p1") }))).toMatchObject({ ok: true, changed: true });
    live(generateCode());
    store.getState().undo();
    expect(store.getState().resolveAbility(request(g, "p0", "monk", { target: pick(g, "p1") }))).toMatchObject({ ok: true, changed: true });
    expect(sdkAccepts(store.getState().lobby!.code, store.getState().game)).toBe(true);
  });
});

describe("SOL-10F-C3 -- the preflight matches the installed SDK at the exact 768-byte boundary", () => {
  // `a` needs no encoding, so each extra character adds exactly one byte to the trigger key.
  const resultFor = (length: number, code: string | null) => {
    store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0 });
    const killed = killedBy("a".repeat(length));
    openInStore(killed);
    if (code !== null) live(code);
    return { killed, result: store.getState().resolveAbility(trigger(killed)) };
  };
  /** The first id length whose planned game the shared helper refuses at `code`. */
  function boundary(code: string): number {
    for (let length = 600; length < 800; length++) {
      const killed = killedBy("a".repeat(length));
      if (!helperAccepts(code, planned(plan(killed, trigger(killed))))) return length;
    }
    throw new Error("no boundary");
  }

  it("live room with a maximum-length real room code: store, helper and SDK agree on both sides of the boundary", () => {
    const code = generateCode();
    const first = boundary(code);
    for (const [length, ok] of [[first - 1, true], [first, false]] as const) {
      const { killed, result } = resultFor(length, code);
      const accepted = planned(plan(killed, trigger(killed)));
      expect(sdkAccepts(code, accepted), `${length}`).toBe(ok);
      expect(helperAccepts(code, accepted), `${length}`).toBe(ok);
      expect(result.ok, `${length}`).toBe(ok);
      if (!ok) expect(store.getState().game).toBe(killed);
    }
  });

  it("before a room exists the store uses the maximum code shape: the SAME boundary as any real room -- never a shorter placeholder's", () => {
    const first = boundary(generateCode());
    expect(resultFor(first - 1, null).result.ok).toBe(true);
    const { killed, result } = resultFor(first, null);
    expect(result).toMatchObject({ ok: false, code: "invalidComposition" });
    expect(store.getState().game).toBe(killed);
    // Why: with an empty / short placeholder the same game would have looked writable.
    const accepted = planned(plan(killed, trigger(killed)));
    expect(helperAccepts("", accepted)).toBe(true);
    expect(sdkAccepts("ABC", accepted)).toBe(true);
    expect(sdkAccepts(MAX_ROOM_CODE_SHAPE, accepted)).toBe(false);
  });
});

describe("SOL-10F-C3 -- the preflight is generic (not Ravenkeeper-specific)", () => {
  const manual = (stepKey: string): AbilityResolutionRequest => ({ mode: "manual", reason: "Storyteller bookkeeping",
    outcome: { operations: [{ domain: "nightStep", day: 2, stepKey, status: "done" }] } });

  it.each([
    ["an over-long Night step key", "x".repeat(800)],
    ["a Firebase-forbidden Night step key", "bad.key"],
  ])("a Manual outcome with %s: accepted by the pure coordinator, refused by the store, nothing recorded", (_label, stepKey) => {
    const g = proofGame(ROLES);
    expect(plan(g, manual(stepKey))).toMatchObject({ ok: true, changed: true });
    openInStore(g);
    const before = snapshot();
    expect(store.getState().resolveAbility(manual(stepKey))).toMatchObject({ ok: false, code: "invalidComposition" });
    expect(snapshot()).toEqual(before);
  });

  it("a short, encoded Manual Night step for unusual ParticipantId / RoleId still commits", () => {
    const g = proofGame(ROLES);
    openInStore(g);
    const stepKey = participantStepKey("pt.x/1", "weird.role#");
    expect(store.getState().resolveAbility(manual(stepKey))).toMatchObject({ ok: true, changed: true });
    expect(sdkAccepts(MAX_ROOM_CODE_SHAPE, store.getState().game)).toBe(true);
  });

  it("a synthetic GUIDED result (rules-neutral descriptor) that would be unwritable is refused the same way", () => {
    // RULES-NEUTRAL: keyed to a canonical RoleId only to pass ownership; encodes no BOTC ruling.
    const SYNTHETIC: AbilityDescriptor = {
      roleId: "monk", timing: ["otherNight"], invocation: "wake", usage: { kind: "unlimited" },
      inputs: [{ id: "key", kind: "text", source: "storyteller", label: "a step key" }],
      hooks: ["targeting"], presentation: { complexity: "simple", action: "Record" },
      evaluator: ({ inputs }) => ({ kind: "outcome", outcome: { operations: [
        { domain: "nightStep", day: 2, stepKey: (inputs.key as { value: string }).value, status: "done" }] } }),
    };
    const semantics: AbilitySemanticsRegistry = new Map([...CANONICAL_ABILITY_SEMANTICS, ["monk", SYNTHETIC]]);
    const g = proofGame(["monk", "chef", "imp", "empath", "saint", "poisoner", "washerwoman"]);
    openInStore(g);
    const before = snapshot();
    const bad = request(g, "p0", "monk", { key: { kind: "text", value: "y".repeat(800) } });
    expect(plan(g, bad, proofEnv({ semantics }))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().resolveAbility(bad, semantics)).toMatchObject({ ok: false, code: "invalidComposition" });
    expect(snapshot()).toEqual(before);
    expect(store.getState().resolveAbility(request(g, "p0", "monk", { key: { kind: "text", value: "fine" } }), semantics)).toMatchObject({ ok: true, changed: true });
  });
});
