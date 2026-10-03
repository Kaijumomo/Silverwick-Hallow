// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, setLogLevel } from "firebase/app";
import { getDatabase, goOffline, ref, update } from "firebase/database";
import { validateFirebaseWritableValue } from "./firebaseWriteCompatibility";
import {
  encodeNightProgressComponent,
  nightTriggerStepKey,
  participantScopedStepKey,
  participantStepKey,
  travelerArrivalStepKey,
} from "@/stores/nightProgress";
import { bind, pick, plan, planned, proofEnv, proofGame, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

// Phase 10F -- SOL-10F-B6 (PHASE10F Section 35): every participant-scoped
// Night-progress key must be a key the REAL installed Firebase SDK accepts.
// Same offline oracle as firebaseWriteCompatibility.sdk.test.ts: an offline
// database (goOffline, unroutable URL), driven through the same modular
// update(ref(db), { "<destination>": value }) call FirebaseRoomBackend.update()
// makes, so every verdict is the SDK's SYNCHRONOUS client-side key/path
// validation -- never a network response.

setLogLevel("silent");
const app = initializeApp({ databaseURL: "http://127.0.0.1:1?ns=silverwick-night-progress-keys" }, "night-progress-keys");
const db = getDatabase(app);
goOffline(db);
afterAll(async () => { await deleteApp(app); });

const code = "KEYS2345";
const destination = ["lobbies", code, "storyteller"];

/** The installed SDK's own verdict: does update() throw synchronously? */
function sdkAccepts(value: unknown): boolean {
  try {
    void update(ref(db), { [destination.join("/")]: value }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
const progressWith = (key: string) => ({ nightProgress: { [key]: { status: "done", notes: "" } } });
const accepted = (key: string) => {
  expect(sdkAccepts(progressWith(key)), key).toBe(true);
  expect(validateFirebaseWritableValue(progressWith(key), destination).ok, key).toBe(true);
};

describe("SOL-10F-B6 -- Night-progress keys are accepted by the installed Firebase SDK", () => {
  it("the oracle is real: Astra's raw dotted trigger key is rejected by the SDK (and by Silverwick's gate)", () => {
    const raw = "2:trigger:pt-1:ravenkeeper:ideath.v1"; // the pre-fix shape (encodeURIComponent keeps '.')
    expect(sdkAccepts(progressWith(raw))).toBe(false);
    expect(validateFirebaseWritableValue(progressWith(raw), destination).ok).toBe(false);
    expect(encodeURIComponent("death.v1")).toBe("death.v1"); // why bare encodeURIComponent is not enough
  });

  it("Astra's reproduction: the trigger key for LifeEvent id 'death.v1' is now a writable key", () => {
    const key = `2:${nightTriggerStepKey("pt-1", "ravenkeeper", "death.v1")}`;
    expect(key).toBe("2:trigger:pt-1:ravenkeeper:ideath%002Ev1");
    accepted(key);
  });

  const hostile = [".", "#", "$", "[", "]", "/", "%", ":", "a.b#c$d[e]f/g%h:i", "ünï·çødé", "😀", "\uD800", "%002E", "death.v1", "..", "a/b/c"];
  it.each(hostile)("every builder yields an SDK-accepted key for components containing %j", (hostileValue) => {
    for (const key of [
      participantStepKey(hostileValue, hostileValue),
      travelerArrivalStepKey(hostileValue, hostileValue),
      participantScopedStepKey("admin", hostileValue, hostileValue),
      participantScopedStepKey("lunaticInfo", hostileValue),
      nightTriggerStepKey(hostileValue, hostileValue, hostileValue),
      nightTriggerStepKey(hostileValue, hostileValue, null),
    ]) accepted(`2:${key}`);
    expect(encodeNightProgressComponent(hostileValue)).toMatch(/^[A-Za-z0-9_%-]*$/);
  });

  it("end to end: an Imp kill recorded as LifeEvent 'death.v1' -> the Ravenkeeper trigger's consumed game is SDK-writable", () => {
    const g = proofGame(["ravenkeeper", "imp", "chef", "monk", "empath", "saint", "washerwoman"]);
    const killed = planned(plan(g, request(g, "p1", "imp", { target: pick(g, "p0") }),
      proofEnv({ ids: { ...proofEnv().ids, life: { eventId: () => "death.v1", historyId: () => "hl-death.v1" } } })));
    expect(killed.lifeEventWindow.events.map((event) => event.id)).toEqual(["death.v1"]);
    const resolved: StorytellerLobbyRecord = planned(plan(killed, request(killed, "p0", "ravenkeeper", { target: pick(killed, "p2") }, { invocationPath: "nightTrigger" })));
    const consumed = `2:${nightTriggerStepKey(bind(killed, "p0").participantId, "ravenkeeper", "death.v1")}`;
    expect(resolved.nightProgress[consumed]).toEqual({ status: "done", notes: "" });
    expect(sdkAccepts(resolved)).toBe(true);
    expect(validateFirebaseWritableValue(resolved, destination).ok).toBe(true);
  });
});
