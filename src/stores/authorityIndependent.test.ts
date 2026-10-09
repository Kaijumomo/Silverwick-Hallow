import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, openInStore, pick, plan, planned, proofGame, request } from "@/test/proofFixtures";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";

beforeEach(() => { usePrivacyStore.getState().reset(); store.setState({ terminalClose: null, lobby: null }); });
afterEach(() => vi.restoreAllMocks());

function poisonedSoldier() {
  const game = proofGame(["imp", "poisoner", "soldier", "chef"]);
  return planned(plan(game, request(game, "p1", "poisoner", { target: pick(game, "p2") })));
}

describe("Independent review: character authority composition", () => {
  it("Imp source-death cleanup, history and Night completion publish exactly the saved snapshot", () => {
    const game = poisonedSoldier(); openInStore(game);
    const writes = vi.spyOn(Storage.prototype, "setItem");
    let published = 0;
    const unsubscribe = store.subscribe(next => {
      expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(next.game);
      published++;
    });
    try {
      const result = store.getState().resolveAbility(request(game, "p0", "imp", { target: pick(game, "p1") }, { withStep: true, completeStep: true }), undefined, captureCharacterActionContext());
      expect(result).toMatchObject({ ok: true, changed: true });
    } finally { unsubscribe(); }
    expect(published).toBe(1);
    expect(writes).toHaveBeenCalledTimes(1);
    const state = store.getState();
    expect(state.game!.players.p1!.alive).toBe(false);
    expect(state.game!.players.p2!.effects).toEqual([]);
    expect(Object.values(state.game!.nightProgress).map(step => step.status)).toEqual(["done"]);
    expect(state.game!.history.some(item => item.category === "effect" && item.effectOperation === "remove")).toBe(true);
    expect(state.undoStack).toHaveLength(1);
    state.undo();
    expect(store.getState().game!.players.p2!.effects).toEqual(game.players.p2!.effects);
  });

  it("failed save preserves death target, sourced poison, history and Night together", () => {
    const game = poisonedSoldier(); openInStore(game);
    const before = store.getState();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
    expect(before.resolveAbility(request(game, "p0", "imp", { target: pick(game, "p1") }, { withStep: true, completeStep: true }), undefined, captureCharacterActionContext())).toMatchObject({ ok: false });
    expect(store.getState().game).toBe(game);
    expect(store.getState().undoStack).toBe(before.undoStack);
    expect(store.getState().localSeq).toBe(before.localSeq);
  });

  it("a retained manual Next cannot cross source seat reuse and marks no replacement step", () => {
    const game = proofGame(["vortox", "chef", "empath"]); openInStore(game);
    const context = captureCharacterActionContext();
    const old = bind(game, "p0");
    store.setState({ game: { ...game, players: { ...game.players, p0: { ...game.players.p0!, participantId: "replacement" } } } });
    const before = store.getState();
    expect(before.setNightStepStatus(2, `p:${old.participantId}:vortox`, "done", context)).toMatchObject({ ok: false });
    expect(store.getState().game).toBe(before.game);
    expect(store.getState().game!.nightProgress).toEqual({});
  });
});
