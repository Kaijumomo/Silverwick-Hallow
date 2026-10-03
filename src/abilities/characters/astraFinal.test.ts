// Phase 10F -- SOL-10F-D2 (PHASE10F Section 42): the C2 protection-dependency
// stamp carries an Effect source ParticipantRef's MECHANICAL identity only
// (kind, PlayerId, ParticipantId), never the `nameAtTime` display snapshot.
// (D1's installed-SDK proof lives in src/firebase/leafSizeCompatibility.sdk.test.ts.)
import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { bind, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, protectionId, request, requirementIds } from "@/test/proofFixtures";
import type { AbilityInputValue } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

type Fx = StorytellerLobbyRecord["players"][string]["effects"][number];
type Ref = NonNullable<Fx["sourceParticipant"]>;
const fx = (id: string, type: string, extra: Partial<Fx> = {}): Fx =>
  ({ id, type, lifetime: { kind: "manual" }, state: "active", expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 }, ...extra } as Fx);
const N = { kind: "boolean", value: false } as const;
const ROLES = ["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]; // p1 Chef, p2 Monk, p3 Empath

/** The Chef holds a generic Protected + the Monk's Safe from the Demon (with
 * `ref` as its source); the Monk is alive and Sober & healthy -> UNKNOWN. */
function base(ref?: (g: StorytellerLobbyRecord) => Ref): StorytellerLobbyRecord {
  let g = patchPlayer(proofGame(ROLES), "p2", { effects: [fx("sh", "soberHealthy")] });
  const source = ref ? ref(g) : { kind: "participant", participantId: g.players.p2!.participantId!, playerId: "p2", nameAtTime: g.players.p2!.name } as Ref;
  g = patchPlayer(g, "p1", { effects: [fx("gp", "protected"), fx("safe", "safeFromDemon", { sourceCharacter: "monk", lifetime: { kind: "untilDawn" }, sourceParticipant: source })] });
  return g;
}
const kill = (opened: StorytellerLobbyRecord, now = opened, judgments: Record<string, AbilityInputValue> = {}) =>
  plan(now, request(opened, "p0", "imp", { target: pick(opened, "p1") }, { judgments }));
const onlyAsked = (result: ReturnType<typeof plan>): string => {
  const asked = requirementIds(result);
  expect(asked).toHaveLength(1);
  return asked[0]!;
};
const stamp = (g: StorytellerLobbyRecord) => proofQuery(g).protectionDependencyStamp(bind(g, "p1"), "demon");
const safeRef = (g: StorytellerLobbyRecord) => g.players.p1!.effects.find((effect) => effect.id === "safe")!.sourceParticipant!;
const amendSafe = (amendment: Record<string, unknown>) => store.getState().resolveEffects({ intents: [{ kind: "correctAmend", target: bind(store.getState().game!, "p1"), effectId: "safe", amendment }] });

describe("SOL-10F-D2 -- protection dependency identity excludes display-only ParticipantRef prose", () => {
  beforeEach(() => store.setState({ game: null, undoStack: [], localSeq: 0 }));

  it("Astra's reproduction: refreshing ONLY the source's nameAtTime through the real Effect correction seam keeps the judgment id", () => {
    const g = base();
    openInStore(g);
    const before = onlyAsked(kill(g));
    expect(before).toBe(protectionId(g, "demon", "p1"));
    store.getState().renamePlayer("p2", "Brother Bob");
    expect(amendSafe({ source: bind(g, "p2") })).toMatchObject({ ok: true, changed: true }); // re-binds the source -> fresh snapshot
    const now = store.getState().game!;
    const [oldRef, newRef] = [safeRef(g), safeRef(now)] as [Extract<Ref, { kind: "participant" }>, Extract<Ref, { kind: "participant" }>];
    // Only the display snapshot changed; the stored ref itself keeps the refreshed prose (never rewritten).
    expect(newRef).toEqual({ ...oldRef, nameAtTime: "Brother Bob" });
    expect(newRef.nameAtTime).not.toBe(oldRef.nameAtTime);
    const { sourceParticipant: _a, ...oldRest } = g.players.p1!.effects[1]!;
    const { sourceParticipant: _b, ...newRest } = now.players.p1!.effects[1]!;
    expect(newRest).toEqual(oldRest);
    expect(onlyAsked(kill(g, now))).toBe(before);
    expect(planned(kill(g, now, { [before]: N })).players.p1!.alive).toBe(false); // the earlier answer still settles it
  });

  it("the stamp normalizes a ref to its mechanical identity: nameAtTime never matters, kind / PlayerId / ParticipantId always do", () => {
    const participant = (playerId: string, participantId: string, nameAtTime: string) => () => ({ kind: "participant", playerId, participantId, nameAtTime }) as Ref;
    const g = base();
    const pid = g.players.p2!.participantId!;
    const s0 = stamp(base(participant("p2", pid, "Player 2")));
    expect(stamp(base(participant("p2", pid, "Someone else entirely")))).toBe(s0);
    expect(stamp(base(participant("p2", pid, "")))).toBe(s0);
    expect(stamp(base(participant("p2", `${pid}-other`, "Player 2")))).not.toBe(s0);
    expect(stamp(base(participant("p3", pid, "Player 2")))).not.toBe(s0);
    const legacy = (playerId: string) => () => ({ kind: "legacy", playerId }) as Ref;
    expect(stamp(base(legacy("p2")))).not.toBe(s0);
    expect(stamp(base(legacy("p2")))).toBe(stamp(base(legacy("p2"))));
    expect(stamp(base(legacy("p3")))).not.toBe(stamp(base(legacy("p2"))));
  });

  describe("mechanical changes STILL invalidate the judgment", () => {
    /** `mutate` must change the stamp and the asked id; the old answer settles nothing. */
    const invalidates = (label: string, mutate: () => void, game = base()) => {
      openInStore(game);
      const before = onlyAsked(kill(game));
      mutate();
      const now = store.getState().game!;
      expect(stamp(now), label).not.toBe(stamp(game));
      const after = kill(game, now, { [before]: N });
      expect(after, label).toMatchObject({ ok: false, code: "needsInput" });
      expect(onlyAsked(after), label).not.toBe(before);
    };

    it("source replacement through the correction seam (another participant) and ParticipantId change (seat reuse)", () => {
      invalidates("rebound to the Empath", () => expect(amendSafe({ source: bind(store.getState().game!, "p3") })).toMatchObject({ ok: true, changed: true }));
      invalidates("seat reuse", () => {
        const g = store.getState().game!;
        store.setState({ game: patchPlayer(g, "p2", { participantId: `${g.players.p2!.participantId}-replacement`, name: "Replacement" }) });
      });
    });

    it("source departure, death and resurrection", () => {
      invalidates("departure", () => { const g = store.getState().game!; store.setState({ game: patchPlayer(g, "p2", { isEmpty: true }) }); });
      invalidates("death", () => expect(store.getState().recordDeath("p2")).toMatchObject({ ok: true, changed: true }));
      const dead = patchPlayer(base(), "p2", { alive: false });
      invalidates("resurrection", () => expect(store.getState().resurrect("p2")).toMatchObject({ ok: true, changed: true }), dead);
    });

    it("source Actual Role change, relevant Effect state change and impairment change", () => {
      invalidates("role", () => expect(store.getState().assignRole("p2", "empath")).toMatchObject({ ok: true, changed: true }));
      invalidates("suppress", () => expect(store.getState().resolveEffects({ intents: [{ kind: "suppress", target: bind(store.getState().game!, "p1"), effectId: "gp" }] })).toMatchObject({ ok: true, changed: true }));
      invalidates("impairment", () => expect(store.getState().resolveEffects({ intents: [{ kind: "apply", target: bind(store.getState().game!, "p2"),
        effect: { type: "poisoned", lifetime: { kind: "manual" } } }] })).toMatchObject({ ok: true, changed: true }));
    });

    it("source-character / persistence change through the correction seam", () => {
      invalidates("source character", () => expect(amendSafe({ sourceCharacter: "poisoner" })).toMatchObject({ ok: true, changed: true }));
    });
  });

  it("prose does NOT invalidate: source nameAtTime, current display name, notes, Reminders and History-only changes", () => {
    const g = base();
    openInStore(g);
    const before = onlyAsked(kill(g));
    store.getState().renamePlayer("p2", "Brother Bob");
    store.getState().renamePlayer("p1", "Chef Anna");
    expect(amendSafe({ source: bind(g, "p2") })).toMatchObject({ ok: true, changed: true });
    expect(store.getState().resolveReminders({ intents: [{ kind: "place", target: bind(g, "p2"), reminder: { label: "Is the Monk" } }] })).toMatchObject({ ok: true, changed: true });
    const current = store.getState().game!;
    const now: StorytellerLobbyRecord = { ...current, notes: "The Monk may be lying", history: [...current.history, { ...current.history[current.history.length - 1]!, id: "extra-history" }] };
    expect(now.players.p2!.reminders.length).toBeGreaterThan(0);
    expect(stamp(now)).toBe(stamp(g));
    expect(onlyAsked(kill(g, now))).toBe(before);
    expect(planned(kill(g, now, { [before]: N })).players.p1!.alive).toBe(false);
  });
});
