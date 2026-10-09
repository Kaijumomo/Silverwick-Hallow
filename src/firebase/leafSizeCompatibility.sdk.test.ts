// @vitest-environment jsdom
// @vitest-environment-options {"storageQuota":100000000}
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, setLogLevel } from "firebase/app";
import { getDatabase, goOffline, ref, update } from "firebase/database";
import { validateFirebaseWritableValue } from "./firebaseWriteCompatibility";
import { storytellerPath, storytellerPathSegments } from "./paths";
import { MAX_ROOM_CODE_SHAPE } from "./roomCode";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { captureFingerprint, type AbilityResolutionRequest, type ManualAbilityRequest } from "@/stores/abilityResolution";
import { participantStepKey } from "@/stores/nightProgress";
import { bind, openInStore, patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { RoleDef, Script, StorytellerLobbyRecord } from "@/stores/types";

// Phase 10F -- SOL-10F-D1 (PHASE10F Section 42): the shared Firebase
// compatibility helper mirrors the installed RTDB SDK's single-string-leaf
// limit (@firebase/database MAX_LEAF_SIZE_ = 10 * 1024 * 1024 bytes, counted
// with util.stringLength, which firebaseStringLength ports), so the C3
// pre-commit preflight in resolveAbility refuses an accepted plan whose
// Storyteller game holds an oversized string anywhere. Same offline SDK oracle
// as abilityCommitCompatibility.sdk.test.ts: synchronous client-side
// validation only, never a network write.

setLogLevel("silent");
const app = initializeApp({ databaseURL: "http://127.0.0.1:1?ns=silverwick-leaf-size" }, "leaf-size-compatibility");
const db = getDatabase(app);
goOffline(db);
afterAll(async () => { await deleteApp(app); });

const LIMIT = 10 * 1024 * 1024; // 10,485,760
const code = MAX_ROOM_CODE_SHAPE;
function sdkAccepts(value: unknown): boolean {
  try {
    void update(ref(db), { [storytellerPath(code)]: value }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
const helper = (value: unknown) => validateFirebaseWritableValue(value, storytellerPathSegments(code));
/** SDK and helper agree, and the verdict is `ok`. */
const agree = (value: unknown, ok: boolean, label: string) => {
  expect(sdkAccepts(value), `SDK ${label}`).toBe(ok);
  expect(helper(value).ok, `helper ${label}`).toBe(ok);
};

describe("SOL-10F-D1 -- the helper mirrors the installed SDK's 10 MiB string-leaf limit exactly", () => {
  it("Astra's boundary: 10,485,760 ASCII bytes accepted, 10,485,761 rejected -- by the SDK and the helper alike", () => {
    agree({ notes: "a".repeat(LIMIT) }, true, "at the limit");
    agree({ notes: "a".repeat(LIMIT + 1) }, false, "one byte over");
    expect(helper({ notes: "a".repeat(LIMIT + 1) })).toEqual({ ok: false, message: `contains a string greater than ${LIMIT} utf8 bytes.` });
  });

  it.each([
    ["2-byte characters", "é", 2],
    ["3-byte characters", "€", 3],
    ["4-byte characters (surrogate pairs)", "😀", 4],
  ])("the boundary is counted in Firebase bytes, not UTF-16 units: %s", (_label, unit, bytes) => {
    const whole = Math.floor(LIMIT / bytes);
    const atLimit = unit.repeat(whole) + "a".repeat(LIMIT - whole * bytes);
    agree({ notes: atLimit }, true, "at the limit");
    agree({ notes: atLimit + "a" }, false, "one byte over");
  });

  it("the SDK's own lone-surrogate accounting is mirrored (a lone lead surrogate costs 4 bytes and swallows the next unit)", () => {
    const quirk = "a".repeat(LIMIT - 4) + "\uD800" + "b"; // counted as LIMIT exactly by the SDK
    agree({ notes: quirk }, true, "lead surrogate swallowing 'b'");
    agree({ notes: "a".repeat(LIMIT - 3) + "\uD800" }, false, "trailing lead surrogate counted as 4");
    agree({ notes: "a".repeat(LIMIT - 3) + "\uDC00" }, true, "lone trail surrogate counted as 3");
  });

  it("applies generically to every string leaf anywhere in a Storyteller game (never a key)", () => {
    const g = proofGame(["empath", "imp", "chef", "monk", "saint", "poisoner", "washerwoman"]);
    const at = (big: string): StorytellerLobbyRecord[] => [
      { ...g, notes: big },
      patchPlayer(g, "p0", { effects: [{ id: "fx", type: "custom", sourceCharacter: big, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" } } as never] }),
      { ...g, history: [{ id: "h", note: big } as never] },
      { ...g, informationDeliveries: [{ id: "d", values: [{ requirementId: "r", kind: "text", value: big }] } as never] },
      { ...g, customScripts: { s: { id: "s", name: "S", characters: [{ id: "x", name: "X", ability: big }] } } } as unknown as StorytellerLobbyRecord,
      { ...g, bluffs: ["chef", big] },
    ];
    for (const [index, value] of at("a".repeat(LIMIT)).entries()) agree(value, true, `location ${index} at the limit`);
    for (const [index, value] of at("a".repeat(LIMIT + 1)).entries()) agree(value, false, `location ${index} one byte over`);
  });
});

describe("SOL-10F-D1 -- resolveAbility refuses an oversized result atomically (the C3 store boundary)", () => {
  beforeEach(() => store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0 }));

  /** A custom-script role whose OWN Information Action takes free text (a
   * script-defined action; the registry consults RoleDef actions first). */
  const CHRONICLER: RoleDef = { ...proofScript.characters.find((role) => role.id === "empath")!, id: "chronicler", name: "Chronicler",
    provenance: { status: "homebrew" },
    informationActions: [{ id: "chronicler-message", timing: { kind: "manual" }, requirements: [{ id: "message", kind: "text", label: "The message" }] }] } as RoleDef;
  const script: Script = { ...proofScript, characters: [...proofScript.characters, CHRONICLER] };
  function live(): StorytellerLobbyRecord {
    const g = patchPlayer(proofGame(["empath", "imp", "chef", "monk", "saint", "poisoner", "washerwoman"]), "p0", { actualRole: "chronicler" });
    openInStore(g);
    store.setState({ customScripts: { [script.id]: script } });
    return g;
  }
  const manualText = (g: StorytellerLobbyRecord, text: string): ManualAbilityRequest => ({ mode: "manual", reason: "Told the Chronicler a message",
    outcome: { operations: [{ domain: "information", recipient: bind(g, "p0"), informationActionId: "chronicler-message",
      values: [{ requirementId: "message", kind: "text", value: text }] }] } });
  const manualEffect = (g: StorytellerLobbyRecord, sourceCharacter: string): AbilityResolutionRequest => ({ mode: "manual", reason: "Unmodeled Effect",
    outcome: { operations: [{ domain: "effect", intents: [{ kind: "apply", target: bind(g, "p1"), effect: { type: "custom", sourceCharacter, lifetime: { kind: "manual" } } }] }] } });
  const inert = (g: StorytellerLobbyRecord, run: () => unknown) => {
    const before = { game: store.getState().game, undo: store.getState().undoStack.length, localSeq: store.getState().localSeq };
    let notifications = 0;
    const unsubscribe = store.subscribe(() => { notifications++; });
    const result = run();
    unsubscribe();
    expect(result).toMatchObject({ ok: false, code: "invalidComposition", message: expect.stringContaining(`greater than ${LIMIT} utf8 bytes`) });
    expect({ game: store.getState().game, undo: store.getState().undoStack.length, localSeq: store.getState().localSeq }).toEqual(before);
    expect(store.getState().game).toBe(g);
    expect(store.getState().game!.history).toBe(g.history);
    expect(store.getState().game!.informationDeliveries).toBe(g.informationDeliveries);
    expect(store.getState().game!.nightProgress).toBe(g.nightProgress);
    expect(notifications).toBe(0); // no subscriber-visible change at all
  };

  it("Astra's reproduction: a Manual text Information Delivery of 10,485,761 bytes -- refused, nothing recorded", () => {
    const g = live();
    inert(g, () => store.getState().resolveAbility({ ...manualText(g, "a".repeat(LIMIT + 1)), completeStep: false }));
  });

  it("... also with its Night step requested in the same resolution (no Night progress either)", () => {
    const g = live();
    const step = { day: g.day, stepKey: participantStepKey(bind(g, "p0").participantId, "chronicler") };
    const request: ManualAbilityRequest = { ...manualText(g, "a".repeat(LIMIT + 1)), fingerprint: captureFingerprint(g, "p0", step)!, completeStep: true };
    inert(g, () => store.getState().resolveAbility(request));
    expect(store.getState().resolveAbility({ ...request, outcome: manualText(g, "short").outcome })).toMatchObject({ ok: true, changed: true });
    expect(store.getState().game!.nightProgress[`${g.day}:${step.stepKey}`]?.status).toBe("done"); // the same request shape does record progress when writable
  });

  it("Astra's independent path: a Manual Effect whose sourceCharacter is 10,485,761 bytes -- refused, nothing recorded", () => {
    const g = live();
    inert(g, () => store.getState().resolveAbility(manualEffect(g, "x".repeat(LIMIT + 1))));
  });

  it("an ordinary-sized text delivery and Effect still commit (one Undo entry each) and stay SDK-writable", () => {
    const g = live();
    expect(store.getState().resolveAbility(manualText(g, "Beware the second chair. ".repeat(4000)))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().game!.informationDeliveries).toHaveLength(1);
    expect(store.getState().resolveAbility(manualEffect(store.getState().game!, "chronicler"))).toMatchObject({ ok: true, changed: true });
    expect(store.getState().undoStack).toHaveLength(2);
    expect(sdkAccepts(store.getState().game)).toBe(true);
  });
});
