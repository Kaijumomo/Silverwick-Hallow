import { beforeEach, describe, expect, it } from "vitest";
import { useStorytellerStore } from "./storytellerStore";
import { buildRichPhase9Game } from "@/test/phase9RichState";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { projectLobbyToPublic, projectLobbyToSelfMap, projectToSelf } from "./projections";
import { participantRefOf, refersToParticipant } from "./participants";
import type { ParticipantRef, StorytellerLobbyRecord } from "./types";

// Phase 9D.5: Recovery & Phase 9 Integration. These are PROOFS, not new
// feature tests -- each drives one deliberately rich, realistic game
// (built entirely through real production commands in
// src/test/phase9RichState.ts) through a recovery path already approved in
// Phase 9C/9D.1-9D.4, and asserts every recorded domain -- Actual/Shown
// Role, Actual/Shown Alignment, Traveler public-character/private-
// alignment/exile, Life state, Ghost Vote, structured Effects/Reminders
// with lifetime and source, History with Provenance, Information Delivery
// with structured values, Setup/Deal/Reveal state, night progress, and
// Storyteller-private notes -- survives intact and unmixed.

const STORAGE_KEY = "new-blood-st";

/** Phase 9R.2: `ref` names the participant CURRENTLY occupying seat `id`
 * in `game` (by ParticipantId -- never merely the reusable seat id). */
const refersTo = (game: StorytellerLobbyRecord, ref: ParticipantRef | undefined, id: string) =>
  refersToParticipant(ref, game.players[id]!.participantId!);
const refOf = (game: StorytellerLobbyRecord, id: string) => participantRefOf(game, id)!;

const resetStore = () =>
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null,
    localSeq: 0, sync: null, customScripts: {},
  });

beforeEach(() => {
  resetStore();
  localStorage.clear();
});

describe("Phase 9D.5 Proof A: local persistence round-trip", () => {
  it("a rich Phase 9 game persists and rehydrates with every recorded domain intact, unmixed and unfabricated", async () => {
    const handles = buildRichPhase9Game();
    const before = useStorytellerStore.getState();
    const beforeGame = before.game!;

    // The persist middleware writes on every set() against real localStorage
    // (createJSONStorage(() => localStorage)) -- confirm it already landed
    // before simulating a fresh load, so a silent write failure fails loudly
    // here rather than surfacing as a false-negative rehydrate below.
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(20);

    // Simulate a fresh load: wipe in-memory state entirely. Zustand's
    // persist middleware wraps setState to also write-through on every
    // call, so resetting in-memory state against this same store instance
    // (there is no separate "page" to reload within one process) clobbers
    // localStorage with the just-reset (empty) state as a side effect --
    // restoring the real captured blob afterward is what makes this an
    // honest simulation of a fresh load reading disk content that was
    // already committed, rather than reading back our own reset.
    resetStore();
    expect(useStorytellerStore.getState().game).toBeNull();
    localStorage.setItem(STORAGE_KEY, raw!);
    await useStorytellerStore.persist.rehydrate();

    const after = useStorytellerStore.getState();
    const afterGame = after.game!;

    // Whole-state equality first -- catches any field silently dropped by
    // partialize/migrate/merge that a narrower spot check would miss.
    expect(afterGame).toEqual(beforeGame);
    expect(after.localSeq).toBe(before.localSeq);
    expect(after.sync).toEqual(before.sync);
    expect(after.undoStack).toEqual(before.undoStack);

    // Representative per-domain spot checks: a future regression's failure
    // names the actual missing/misattributed domain, not just "not equal".
    expect(afterGame.history).toEqual(beforeGame.history);
    expect(afterGame.history.length).toBeGreaterThan(0);
    expect(afterGame.informationDeliveries).toEqual(beforeGame.informationDeliveries);
    expect(afterGame.informationDeliveries.length).toBe(2);

    // Cross-player mixing check: each player's own Effects/Reminders never
    // migrate onto -- or get overwritten by -- another player's during the
    // round trip.
    expect(afterGame.players[handles.chefId]!.effects.map((e) => e.type)).toEqual(["poisoned"]);
    expect(afterGame.players[handles.chefId]!.reminders.map((r) => r.label)).toEqual(["Poisoned"]);
    expect(afterGame.players[handles.washerwomanId]!.effects.map((e) => e.type)).toEqual(["protected"]);
    expect(afterGame.players[handles.washerwomanId]!.reminders.map((r) => r.label)).toEqual(["Red Herring"]);
    expect(afterGame.players[handles.investigatorId]!.effects).toEqual([]);
    expect(afterGame.players[handles.investigatorId]!.reminders).toEqual([]);

    // Traveler public character vs private alignment vs exile -- three
    // materially different domains, none collapsed into another.
    expect(afterGame.players[handles.travelerId]!.isTraveler).toBe(true);
    expect(afterGame.players[handles.travelerId]!.actualRole).toBe("thief");
    expect(afterGame.players[handles.travelerId]!.actualAlignment).toBe("evil");
    expect(afterGame.players[handles.travelerId]!.exiled).toBe(true);
    expect(afterGame.players[handles.travelerId]!.alive).toBe(false); // exile also flips life state, but is its own History category, not a generic kill
    expect(afterGame.history.some((h) => refersTo(afterGame, h.participant, handles.travelerId) && h.category === "life" &&
      h.lifeEvent?.operations.some((o) => o.kind === "added" && o.event.kind === "exile" && o.event.outcome === "died") === true &&
      !!h.change && "to" in h.change && (h.change.to as { exiled?: boolean }).exiled === true)).toBe(true);

    // Ordinary Life state and Ghost Vote.
    expect(afterGame.players[handles.deadOrdinaryId]!.alive).toBe(false);
    expect(afterGame.players[handles.ghostVoteToggledId]!.ghostVote).toBe(false);

    // Storyteller-private notes never leak onto, or vanish from, their owner.
    expect(afterGame.players[handles.chefId]!.stNotes).toBe("SENTINEL-PRIVATE-CHEF-NOTE");
    expect(afterGame.players[handles.washerwomanId]!.stNotes).toBe("");

    // Phase 10A: the Life Event Window survives exactly -- the Night 1
    // death and the Day 1 execution/exile, in acceptance order.
    expect(afterGame.lifeEventWindow).toEqual(beforeGame.lifeEventWindow);
    expect(afterGame.lifeEventWindow.events.map((e) => e.kind)).toEqual(["death", "execution", "exile"]);

    // Setup/Deal/Reveal and night-progress state survives too. (Phase 10A:
    // the rich game ends on Day 1, after its Day's execution and exile.)
    expect(afterGame.phase).toBe("day");
    expect(afterGame.day).toBe(1);
    expect(afterGame.nightProgress?.["1:demonInfo"]?.status).toBe("done");
    expect(afterGame.nightProgress?.["1:demonInfo"]?.notes).toBe("Demon informed per script.");
  });
});

describe("Phase 9D.5 Proof B: Undo integrity across combined Phase 9 features", () => {
  it("undo restores the entire prior rich snapshot verbatim, never reconstructing state from History", () => {
    const handles = buildRichPhase9Game();
    const preMutationSnapshot = structuredClone(useStorytellerStore.getState().game!);
    const preMutationLocalSeq = useStorytellerStore.getState().localSeq;
    const preMutationUndoStackLength = useStorytellerStore.getState().undoStack.length;

    // One more real, distinct production mutation, touching a domain the
    // rich snapshot already exercises elsewhere (Life state) plus its own
    // History entry -- proving Undo unwinds a mutation layered on top of an
    // already-rich state, not just a lone command against a fresh game.
    useStorytellerStore.getState().setAlive(handles.washerwomanId, false, {
      provenance: { reason: "killed by the Demon, night 2" },
    });

    const postMutationGame = useStorytellerStore.getState().game!;
    expect(postMutationGame.players[handles.washerwomanId]!.alive).toBe(false);
    expect(postMutationGame.history.length).toBe(preMutationSnapshot.history.length + 1);
    const postMutationUndoStackLength = useStorytellerStore.getState().undoStack.length;

    useStorytellerStore.getState().undo();

    const restored = useStorytellerStore.getState().game!;
    // Whole-snapshot equality: Undo restores the entire prior `game` object
    // (clone(previous)), never replays/reconstructs it from History -- a
    // reconstruction bug would still get the target field right but would
    // very likely diverge somewhere else (id churn, provenance loss,
    // dropped fields); whole-object equality catches that class of bug that
    // a single-field assertion would miss.
    expect(restored).toEqual(preMutationSnapshot);
    expect(restored.players[handles.washerwomanId]!.alive).toBe(true);
    expect(restored.history.length).toBe(preMutationSnapshot.history.length);
    expect(restored.history).toEqual(preMutationSnapshot.history);
    expect(restored.informationDeliveries).toEqual(preMutationSnapshot.informationDeliveries);

    // Domains untouched by the extra mutation are still exactly as recorded
    // -- confirms Undo did not silently rebuild players it had no reason to
    // touch, mixing in stale or default field values.
    expect(restored.players[handles.chefId]!.effects).toEqual(preMutationSnapshot.players[handles.chefId]!.effects);
    expect(restored.players[handles.chefId]!.reminders).toEqual(preMutationSnapshot.players[handles.chefId]!.reminders);
    expect(restored.players[handles.chefId]!.stNotes).toBe("SENTINEL-PRIVATE-CHEF-NOTE");
    expect(restored.players[handles.washerwomanId]!.effects).toEqual(preMutationSnapshot.players[handles.washerwomanId]!.effects);
    expect(restored.players[handles.travelerId]!.actualAlignment).toBe("evil");
    expect(restored.players[handles.travelerId]!.exiled).toBe(true);
    expect(restored.players[handles.travelerId]!.actualRole).toBe("thief");

    // Undo is itself a real Current State mutation under the already-
    // approved Phase 9C reconnect watermark model -- localSeq still
    // advances, exactly like any other command (not something this phase
    // changes; confirmatory only).
    expect(useStorytellerStore.getState().localSeq).toBeGreaterThan(preMutationLocalSeq);
    // Not necessarily back to preMutationUndoStackLength: the rich build's
    // own ~25+ commands already push the stack to its capped UNDO_LIMIT
    // (confirmed here), so the extra mutation's push evicts the oldest
    // entry (FIFO) instead of growing the stack -- undo() then always
    // removes exactly one. Assert the actual pre/post-mutation relationship
    // rather than an assumed symmetry that only holds below the cap.
    expect(preMutationUndoStackLength).toBe(20);
    expect(useStorytellerStore.getState().undoStack.length).toBe(postMutationUndoStackLength - 1);
  });

  it("two sequential undos unwind two sequential mutations back through the exact intermediate snapshot to the original", () => {
    const handles = buildRichPhase9Game();
    const original = structuredClone(useStorytellerStore.getState().game!);

    // Phase 10A: a living player has no ghost vote to spend -- the first
    // mutation is a Night/Day death through the semantic life command.
    expect(useStorytellerStore.getState().recordDeath(handles.chefId).ok).toBe(true);
    const intermediate = structuredClone(useStorytellerStore.getState().game!);
    expect(intermediate).not.toEqual(original);

    useStorytellerStore.getState().addReminder(handles.investigatorId, {
      label: "Marked", lifetime: { kind: "manual" },
    });
    const latest = useStorytellerStore.getState().game!;
    expect(latest.players[handles.investigatorId]!.reminders.map((r) => r.label)).toEqual(["Marked"]);

    useStorytellerStore.getState().undo();
    expect(useStorytellerStore.getState().game!).toEqual(intermediate);

    useStorytellerStore.getState().undo();
    expect(useStorytellerStore.getState().game!).toEqual(original);
    expect(useStorytellerStore.getState().game!.players[handles.chefId]!.ghostVote).toBe(true);
  });
});

describe("Phase 9D.5 Proof F: privacy after recovery", () => {
  const registry = buildRegistry(troubleBrewing);

  it("a deceptive concealed-role case, and every player's private truth, stay concealed after a real persistence recovery cycle", async () => {
    const handles = buildRichPhase9Game();

    // Deceptive/concealed-role case: the poisoner (actually evil) is shown
    // a false good identity -- a real production command, exactly how a
    // Storyteller runs a Baron/Marionette-style deception. This player's
    // own self-view must show the LIE ("empath", good); it must never
    // reveal the truth ("poisoner") to them or to anyone else.
    const poisonerId = Object.values(useStorytellerStore.getState().game!.players)
      .find((p) => p.actualRole === "poisoner")!.id;
    useStorytellerStore.getState().setShownRole(poisonerId, "empath");

    const check = (game: NonNullable<ReturnType<typeof useStorytellerStore.getState>["game"]>, label: string) => {
      const self = projectToSelf(game.players[poisonerId]!, registry);
      expect(self?.shownRole, label).toBe("empath");
      expect(self?.shownAlignment, label).toBe("good"); // the deception is fully consistent, not half-applied
      expect(JSON.stringify(self), label).not.toContain("poisoner");

      const selfMap = projectLobbyToSelfMap(game, registry);
      const publicView = projectLobbyToPublic(game, {});
      const selfMapStr = JSON.stringify(selfMap);
      const publicViewStr = JSON.stringify(publicView);

      // The deceived player's own perception is the only role every OTHER
      // seated player's dealt role in this game guarantees is unique
      // ("poisoner" was dealt to exactly this one seat) -- if it leaked
      // anywhere in anyone's self-view or the public view, this would
      // catch it.
      expect(selfMapStr, label).not.toContain("poisoner");
      expect(publicViewStr, label).not.toContain("poisoner");

      // Storyteller-private notes never appear in any player's self-view
      // or in the public view, for any player.
      expect(selfMapStr, label).not.toContain("SENTINEL-PRIVATE-CHEF-NOTE");
      expect(publicViewStr, label).not.toContain("SENTINEL-PRIVATE-CHEF-NOTE");

      // The Traveler's PUBLIC character is legitimately public BOTC
      // knowledge (their card is announced) -- but their PRIVATE actual
      // alignment is not, and must never appear in the public view.
      expect(publicView.players[handles.travelerId]?.publicDisplayRole).toBe("thief");
      expect(publicViewStr, label).not.toContain("evil");
      expect(publicViewStr, label).not.toContain("actualAlignment");
      expect(selfMapStr, label).not.toContain("actualAlignment");

      // History and Information Delivery are Storyteller-private
      // bookkeeping (Phase 9D.2/9D.3) -- never part of any projection.
      expect(selfMapStr, label).not.toContain("history");
      expect(publicViewStr, label).not.toContain("history");
      expect(selfMapStr, label).not.toContain("informationDeliveries");
      expect(publicViewStr, label).not.toContain("informationDeliveries");

      return { selfMapStr, publicViewStr };
    };

    const before = check(useStorytellerStore.getState().game!, "before recovery");

    // Recovery: a real localStorage persist/rehydrate cycle (Proof A's
    // exact mechanism) -- privacy is Silverwick's own projection logic
    // acting on recovered Current State, so this is the sharpest test of
    // "after recovery": did recovery somehow change the underlying data in
    // a way that breaks (or, worse, un-conceals) what projection already
    // correctly hid.
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    resetStore();
    localStorage.setItem(STORAGE_KEY, raw!);
    await useStorytellerStore.persist.rehydrate();
    const after = check(useStorytellerStore.getState().game!, "after recovery");
    // Recovery changed nothing about what is concealed vs revealed.
    expect(after.selfMapStr).toBe(before.selfMapStr);
    expect(after.publicViewStr).toBe(before.publicViewStr);
  });
});

describe("Phase 9D.5 Proof H: full integrated BOTC lifecycle", () => {
  it("Setup -> Deal -> refinement -> Reveal -> Night 1 -> live mutations -> Information Delivery -> persistence, with every stage's invariants holding at each checkpoint", async () => {
    const store = () => useStorytellerStore.getState();

    // --- Setup: composition, no live History yet -------------------------
    store().newGame("tb", { plannedPlayerCount: 7, plannedTravelerCount: 0 });
    for (let i = 0; i < 7; i++) store().addPlayerToSeat("Player " + i);
    const ordinaryIds = [...store().game!.seatOrder];
    expect(store().game!.phase).toBe("setup");
    expect(ordinaryIds).toHaveLength(7);
    expect(store().game!.history).toEqual([]); // Setup construction is never Live History

    // --- Deal: randomized Storyteller truth, still Setup ------------------
    const pool = ["washerwoman", "librarian", "investigator", "chef", "empath", "poisoner", "imp"];
    store().setRolePool(pool);
    const dealResult = store().dealRolePool();
    expect(dealResult.ok).toBe(true);
    const dealtRoles = ordinaryIds.map((id) => store().game!.players[id]!.actualRole).sort();
    expect(dealtRoles).toEqual([...pool].sort()); // exactly the pool, one each -- composition-correct
    expect(store().game!.phase).toBe("setup");
    expect(store().game!.history).toEqual([]); // the Deal itself is Setup, never mistaken for Live History

    // --- Pre-Reveal refinement: composition-neutral swap ------------------
    const chefId = ordinaryIds.find((id) => store().game!.players[id]!.actualRole === "chef")!;
    const impId = ordinaryIds.find((id) => store().game!.players[id]!.actualRole === "imp")!;
    const swapResult = store().swapSetupRoles(chefId, impId);
    expect(swapResult.ok).toBe(true);
    expect(store().game!.players[chefId]!.actualRole).toBe("imp");
    expect(store().game!.players[impId]!.actualRole).toBe("chef");
    const rolesAfterSwap = ordinaryIds.map((id) => store().game!.players[id]!.actualRole).sort();
    expect(rolesAfterSwap).toEqual([...pool].sort()); // same bag -- refinement never changes composition
    expect(store().game!.history).toEqual([]); // refinement is still Setup

    // --- Reveal: locks the ordinary roster, still Setup phase -------------
    for (const id of ordinaryIds) store().showAssignedRole(id);
    for (const id of ordinaryIds) expect(store().game!.players[id]!.shownRole).toBe(store().game!.players[id]!.actualRole);
    const revealResult = store().revealRoles();
    expect(revealResult.ok).toBe(true);
    expect(store().game!.setupRolesRevealed).toBe(true);
    expect(store().game!.phase).toBe("setup"); // Reveal alone never advances phase
    expect(store().game!.history).toEqual([]); // Reveal itself is still Setup, not a Live mutation

    // --- Night 1: the real readiness-gated transition into Live Play ------
    const beginResult = store().beginNightOne();
    expect(beginResult.ok).toBe(true);
    expect(store().game!.phase).toBe("night");
    expect(store().game!.day).toBe(1);
    expect(store().game!.history).toEqual([]); // entering Night 1 is not itself a recorded mutation

    // --- Live mutations: now (and only now) do they create History -------
    const investigatorId = ordinaryIds.find((id) => store().game!.players[id]!.actualRole === "investigator")!;
    const librarianId = ordinaryIds.find((id) => store().game!.players[id]!.actualRole === "librarian")!;
    store().setAlive(librarianId, false, { provenance: { reason: "killed by the Demon" } });
    expect(store().game!.history).toHaveLength(1);
    store().setGhostVote(librarianId, false);
    expect(store().game!.history).toHaveLength(2);
    store().addEffect(investigatorId, { type: "poisoned", sourceCharacter: "poisoner", sourcePlayer: impId, lifetime: { kind: "untilDawn" } });
    expect(store().game!.history).toHaveLength(3);
    // Phase 10B (SOL-10B-R8): the Effect's ORIGIN lives in the snapshot;
    // with no Mutation Context the History records no mutation provenance.
    expect(store().game!.history[2]!.change).toMatchObject({ kind: "added", item: { sourceCharacter: "poisoner", sourceParticipant: refOf(store().game!, impId) } });
    expect(store().game!.history[2]!.provenance).toBeUndefined();
    store().addReminder(investigatorId, { label: "Poisoned", sourceCharacter: "poisoner", lifetime: { kind: "manual" } });
    // addReminder/addEffect only record History when the game is live (they
    // already are here) -- exactly one record per real command, never more.
    expect(store().game!.history).toHaveLength(4);
    expect(store().game!.players[investigatorId]!.effects.some((e) => e.type === "poisoned")).toBe(true);
    expect(store().game!.players[investigatorId]!.reminders.some((r) => r.label === "Poisoned")).toBe(true);
    expect(store().game!.players[librarianId]!.alive).toBe(false);
    expect(store().game!.players[librarianId]!.ghostVote).toBe(false);

    // --- Information Delivery: real Information Actions, correctly timed -
    const washerwomanId = ordinaryIds.find((id) => store().game!.players[id]!.actualRole === "washerwoman")!;
    const delivery = store().recordInformationDelivery(washerwomanId, "washerwoman-first-night", [
      { requirementId: "players", kind: "player", playerIds: [investigatorId, librarianId] },
      { requirementId: "role", kind: "role", roleId: "librarian" },
    ]);
    expect(delivery.ok).toBe(true);
    expect(store().game!.informationDeliveries).toHaveLength(1);
    expect(store().game!.informationDeliveries[0]!.recipient).toEqual(refOf(store().game!, washerwomanId));
    expect(store().game!.informationDeliveries[0]!.actualRole).toBe("washerwoman"); // captured Actual Role at delivery time
    // Information Delivery is its own record type -- never a History entry.
    expect(store().game!.history).toHaveLength(4);

    // --- Persistence: the full accumulated lifecycle survives a real
    // localStorage round trip, exactly like Proof A. --------------------
    const beforeGame = store().game!;
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    resetStore();
    localStorage.setItem(STORAGE_KEY, raw!);
    await useStorytellerStore.persist.rehydrate();
    const afterGame = useStorytellerStore.getState().game!;
    expect(afterGame).toEqual(beforeGame);
    expect(afterGame.history).toHaveLength(4);
    expect(afterGame.informationDeliveries).toHaveLength(1);
    expect(afterGame.setupRolesRevealed).toBe(true);
    expect(afterGame.phase).toBe("night");
    expect(afterGame.day).toBe(1);
  });
});

describe("Phase 9D.5: anti-fabrication and cross-player mixing checks", () => {
  it("Information Delivery is never misattributed across players, Provenance is never lost, and Effects/Reminders never leak onto an unrelated player -- before AND after a real persistence recovery cycle", async () => {
    const handles = buildRichPhase9Game();

    const check = (game: NonNullable<ReturnType<typeof useStorytellerStore.getState>["game"]>, label: string) => {
      // --- Information Delivery: exact per-recipient attribution ----------
      const chefDelivery = game.informationDeliveries.find((d) => refersTo(game, d.recipient, handles.chefId));
      const wwDelivery = game.informationDeliveries.find((d) => refersTo(game, d.recipient, handles.washerwomanId));
      expect(chefDelivery, label).toBeDefined();
      expect(wwDelivery, label).toBeDefined();
      expect(chefDelivery!.actualRole, label).toBe("chef");
      expect(chefDelivery!.informationActionId, label).toBe("chef-first-night");
      expect(chefDelivery!.values, label).toEqual([{ requirementId: "pairs", kind: "number", value: 1 }]);
      expect(wwDelivery!.actualRole, label).toBe("washerwoman");
      expect(wwDelivery!.informationActionId, label).toBe("washerwoman-first-night");
      expect(wwDelivery!.values, label).toEqual([
        { requirementId: "players", kind: "player", participants: [refOf(game, handles.investigatorId), refOf(game, handles.librarianId)] },
        { requirementId: "role", kind: "role", roleId: "librarian" },
      ]);
      expect(chefDelivery!.recipient, label).toEqual(refOf(game, handles.chefId));
      expect(wwDelivery!.recipient, label).toEqual(refOf(game, handles.washerwomanId));
      // Neither delivery's recipient/role bled into the other's record.
      expect(chefDelivery!.id, label).not.toBe(wwDelivery!.id);
      expect(game.informationDeliveries, label).toHaveLength(2); // exactly the two recorded -- none fabricated

      // --- Provenance survives by name, not just via bulk equality --------
      const alignmentRecord = game.history.find((h) => h.category === "alignment" && refersTo(game, h.participant, handles.travelerId));
      expect(alignmentRecord?.provenance, label).toEqual({ reason: "Storyteller selection", sourceCharacter: "thief" });
      const washerwomanReminder = game.players[handles.washerwomanId]!.reminders.find((r) => r.label === "Red Herring");
      expect(washerwomanReminder?.sourceCharacter, label).toBe("fortuneteller");
      const washerwomanEffect = game.players[handles.washerwomanId]!.effects.find((e) => e.type === "protected");
      expect(washerwomanEffect?.sourceCharacter, label).toBe("monk");
      expect(washerwomanEffect?.sourceParticipant, label).toEqual(refOf(game, handles.chefId));

      // --- Global cross-player mixing check: exactly the Effects/Reminders
      // that were added exist, attributed to exactly the players they were
      // added to -- not merely "the two known players have the right
      // count," but "no OTHER seated player picked up a stray copy." -------
      const allEffects = Object.values(game.players).flatMap((p) => p.effects.map((e) => ({ playerId: p.id, type: e.type })));
      const allReminders = Object.values(game.players).flatMap((p) => p.reminders.map((r) => ({ playerId: p.id, label: r.label })));
      expect(allEffects, label).toEqual(
        expect.arrayContaining([
          { playerId: handles.chefId, type: "poisoned" },
          { playerId: handles.washerwomanId, type: "protected" },
        ])
      );
      expect(allEffects, label).toHaveLength(2); // exactly these two, system-wide -- nothing fabricated elsewhere
      expect(allReminders, label).toEqual(
        expect.arrayContaining([
          { playerId: handles.chefId, label: "Poisoned" },
          { playerId: handles.washerwomanId, label: "Red Herring" },
        ])
      );
      expect(allReminders, label).toHaveLength(2);
    };

    check(useStorytellerStore.getState().game!, "before recovery");

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    resetStore();
    localStorage.setItem(STORAGE_KEY, raw!);
    await useStorytellerStore.persist.rehydrate();

    check(useStorytellerStore.getState().game!, "after recovery");
  });
});
