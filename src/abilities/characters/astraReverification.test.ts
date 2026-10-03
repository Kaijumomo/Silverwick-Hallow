// Phase 10F -- SOL-10F-B1..B6 (PHASE10F Section 35): permanent regressions for
// Astra's re-verification counterexamples and their cross-seam cases. Each
// `describe` names its finding; Astra's reproduction is the first case where
// one exists. (B1's UI half lives in src/features/abilities/
// astraReverificationUi.test.tsx; B6's installed-SDK proof in
// src/firebase/nightProgressKeys.sdk.test.ts.)
import { beforeEach, describe, expect, it } from "vitest";
import {
  encodeNightProgressComponent,
  nightTriggerStepKey,
  participantRoleStepEntries,
  participantScopedStepKey,
  participantStepKey,
  travelerArrivalStepKey,
} from "@/stores/nightProgress";
import { applyRolePlan, correctRoleIntent, defaultRoleIds, planRoleTransaction } from "@/stores/roleResolution";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { bind, homebrewScript, openInStore, patchPlayer, pick, plan, planned, proofGame, proofScript, request } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const done = { status: "done" as const, notes: "" };

/** A test-local decoder: proves the component encoding is reversible
 * (therefore injective) on every case below. */
const decode = (encoded: string): string => encoded.replace(/%([0-9A-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));

describe("SOL-10F-B5 -- every participant Night-progress component is encoded collision-free", () => {
  it("Astra's reproduction: ('alpha', 'beta:gunslinger') and ('alpha:beta', 'gunslinger') no longer share a key", () => {
    expect(participantStepKey("alpha", "beta:gunslinger")).not.toBe(participantStepKey("alpha:beta", "gunslinger"));
    expect(travelerArrivalStepKey("alpha", "beta:gunslinger")).not.toBe(travelerArrivalStepKey("alpha:beta", "gunslinger"));
    expect(participantScopedStepKey("admin", "alpha", "beta:gunslinger")).not.toBe(participantScopedStepKey("admin", "alpha:beta", "gunslinger"));
    expect(nightTriggerStepKey("alpha", "beta:gunslinger", "e")).not.toBe(nightTriggerStepKey("alpha:beta", "gunslinger", "e"));
    expect(nightTriggerStepKey("a", "b", "c:d")).not.toBe(nightTriggerStepKey("a", "b:ic", "d"));
  });

  const samples = ["alpha", "alpha:beta", "beta:gunslinger", "gunslinger", "%", "%25", "%0025", "%003A", ":", "::", "a%3Ab", "a:b",
    "ünï", "😀", "\uD83D", "\uDE00", "death.v1", "death%002Ev1", "pt-0b6c1f4e-1", "legacy-current:p1", "", "-", "_"];

  it("the component encoding is reversible, never contains ':' and keeps ordinary ids readable", () => {
    for (const value of samples) {
      const encoded = encodeNightProgressComponent(value);
      expect(decode(encoded), JSON.stringify(value)).toBe(value);
      expect(encoded).not.toContain(":");
    }
    expect(new Set(samples.map(encodeNightProgressComponent)).size).toBe(samples.length);
    expect(encodeNightProgressComponent("pt-0b6c1f4e-1")).toBe("pt-0b6c1f4e-1");
    expect(participantStepKey("pt-1", "imp")).toBe("p:pt-1:imp"); // static prefix + readable ids
    expect(encodeNightProgressComponent("%")).toBe("%0025");
    expect(encodeNightProgressComponent(":")).toBe("%003A");
  });

  it("distinct (participant, role) pairs never share a key -- %, colon, Unicode and encoded-looking strings included", () => {
    const keys = new Map<string, string>();
    for (const participant of samples.filter(Boolean)) {
      for (const role of samples.filter(Boolean)) {
        const pair = JSON.stringify([participant, role]);
        for (const key of [participantStepKey(participant, role), travelerArrivalStepKey(participant, role), nightTriggerStepKey(participant, role, null)]) {
          expect(keys.get(key) ?? pair, key).toBe(pair);
          keys.set(key, pair);
        }
      }
    }
  });

  // p1 = participant "alpha" holding the homebrew character "beta:gunslinger";
  // p2 = participant "alpha:beta" holding the Gunslinger -- Astra's pair.
  const hostileScript = { ...homebrewScript("chef"), characters: [...proofScript.characters,
    { ...proofScript.characters.find((c) => c.id === "chef")!, id: "beta:gunslinger", name: "Beta Gunslinger", provenance: { status: "homebrew" as const } }] };
  function pair(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
    let g = proofGame(["imp", "chef", "gunslinger", "monk", "empath", "saint", "washerwoman"], "night", 2, over);
    g = patchPlayer(g, "p1", { participantId: "alpha", actualRole: "beta:gunslinger", shownRole: "beta:gunslinger" });
    g = patchPlayer(g, "p2", { participantId: "alpha:beta", isTraveler: true, actualAlignment: "good",
      travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 2 } });
    return { ...g, nightProgress: {
      [`${g.day}:${participantStepKey("alpha", "beta:gunslinger")}`]: done,
      [`${g.day}:${participantStepKey("alpha:beta", "gunslinger")}`]: done,
      [`${g.day}:${travelerArrivalStepKey("alpha:beta", "gunslinger")}`]: done,
    } };
  }
  const bKeys = (g: StorytellerLobbyRecord) => [participantStepKey("alpha:beta", "gunslinger"), travelerArrivalStepKey("alpha:beta", "gunslinger")].map((k) => `${g.day}:${k}`);

  it("Role-seam cleanup of 'alpha' (beta:gunslinger -> the Beggar, a Traveler transition) clears ONLY alpha's own step, never 'alpha:beta''s", () => {
    const g = pair();
    const result = planRoleTransaction(g, { intents: [{ kind: "changeActualRole", target: bind(g, "p1"), expectedActualRole: "beta:gunslinger", expectedIsTraveler: false, actualRole: "beggar" }] },
      { script: hostileScript, ids: defaultRoleIds });
    expect(result).toMatchObject({ ok: true, changed: true });
    const after = result.ok && result.changed ? applyRolePlan(g, result.plan).nightProgress : {};
    expect(Object.keys(after).sort()).toEqual(bKeys(g).sort());
  });

  it("a Traveler-arrival restart of 'alpha:beta' clears its own keys only (alpha's step remains)", () => {
    const g = pair();
    const result = planRoleTransaction(g, { intents: [correctRoleIntent(g.players.p2!, "gunslinger", "restart")] }, { script: hostileScript, ids: defaultRoleIds });
    expect(result).toMatchObject({ ok: true, changed: true });
    const after = result.ok && result.changed ? applyRolePlan(g, result.plan).nightProgress : {};
    expect(Object.keys(after)).toEqual([`${g.day}:${participantStepKey("alpha", "beta:gunslinger")}`]);
  });

  it("the exact-entry builder for 'alpha' with Role 'beta:gunslinger' does not contain 'alpha:beta''s Gunslinger keys", () => {
    const entries = participantRoleStepEntries(2, "alpha", ["beta:gunslinger"]);
    for (const key of bKeys(pair())) expect(entries.has(key)).toBe(false);
  });

  describe("Setup Traveler designation (store)", () => {
    beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));
    it("designating 'alpha' a Traveler resets alpha's steps only", () => {
      const g = pair({ phase: "setup", day: 0, setupRolesRevealed: false });
      openInStore(g);
      expect(store.getState().setIsTraveler("p1", true)).toEqual({ ok: true });
      expect(Object.keys(store.getState().game!.nightProgress).sort()).toEqual(bKeys(g).sort());
    });
  });
});

describe("SOL-10F-B5/B6 cross-seam -- Imp star-pass skip and duplicate-step protection use the encoded keys", () => {
  // p0 imp (self-kill), p1 scarlet woman... star-pass successors are participant-addressed.
  it("an Imp star-pass marks the successor's own Imp step skipped under the encoded key; a hostile id still round-trips", () => {
    let g = proofGame(["imp", "poisoner", "chef", "monk", "empath", "saint", "washerwoman"]);
    g = patchPlayer(g, "p1", { participantId: "minion.a:b/c" });
    const first = plan(g, request(g, "p0", "imp", { target: pick(g, "p0") }));
    // The coordinator asks for (or chooses) the successor; once it names p1, the step key it skips is p1's encoded Imp key.
    const successorId = !first.ok && first.code === "needsInput" ? first.requirements?.[0]?.id : undefined;
    const next = successorId
      ? planned(plan(g, request(g, "p0", "imp", { target: pick(g, "p0"), [successorId]: pick(g, "p1") })))
      : planned(first);
    const key = `2:${participantStepKey("minion.a:b/c", "imp")}`;
    expect(key).toBe("2:p:minion%002Ea%003Ab%002Fc:imp");
    expect(next.nightProgress[key]?.status).toBe("skipped");
    // The successor's ordinary Night-Order Imp step is refused as already skipped tonight.
    const successor = { ...next, players: next.players };
    expect(plan(successor, request(successor, "p1", "imp", { target: pick(successor, "p2") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("a completed ordinary step (encoded key) refuses a duplicate ordinary resolution", () => {
    let g = proofGame(["poisoner", "chef", "imp", "monk", "empath", "saint", "washerwoman"]);
    g = patchPlayer(g, "p0", { participantId: "pois#$[]" });
    const first = planned(plan(g, request(g, "p0", "poisoner", { target: pick(g, "p1") }, { withStep: true, completeStep: true })));
    expect(first.nightProgress[`2:${participantStepKey("pois#$[]", "poisoner")}`]?.status).toBe("done");
    expect(Object.keys(first.nightProgress)).toEqual(["2:p:pois%0023%0024%005B%005D:poisoner"]);
    expect(plan(first, request(first, "p0", "poisoner", { target: pick(first, "p2") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });
});
