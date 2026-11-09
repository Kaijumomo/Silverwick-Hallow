import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, impair, num, openInStore, patchPlayer, pick, proofGame, proofRegistry, request, reseat, yes } from "@/test/proofFixtures";
import { withRedHerring } from "@/test/redHerringFixture";
import { useStorytellerStore as store, captureCharacterActionContext } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { subjectId } from "./shared";
import type { AbilityInputs } from "@/abilities/semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = (role: string) => {
  const g = proofGame([role, "imp", "poisoner", "monk", "saint"], "night", 1);
  return role === "fortuneteller" ? withRedHerring(g, "p3", "p0") : g;
};
const inputs = (g: StorytellerLobbyRecord, role: string): AbilityInputs => role === "fortuneteller" ? { targets: pick(g, "p1", "p2") } : {};
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("B5a authoritative calculated-information commands", () => {
  it.each(["chef", "empath", "fortuneteller"])("%s commits one private delivery and completed Night step, survives save, and undoes together", role => {
    const g = game(role);
    openInStore(g);
    const req = request(g, "p0", role, inputs(g, role), { withStep: true, completeStep: true });
    const changes: StorytellerLobbyRecord[] = [];
    const stop = store.subscribe(s => { if (s.game) changes.push(s.game); });
    try {
      expect(store.getState().resolveAbility(req, undefined, captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
      expect(changes).toHaveLength(1);
      expect(store.getState().undoStack).toHaveLength(1);
      const next = store.getState().game!;
      expect(next.informationDeliveries).toHaveLength(1);
      expect(next.players).toEqual(g.players);
      expect(next.nightProgress).not.toEqual(g.nightProgress);
      const persisted = JSON.parse(localStorage.getItem("new-blood-st")!).state.game;
      expect(persisted.informationDeliveries).toEqual(next.informationDeliveries);
      expect(persisted.nightProgress).toEqual(next.nightProgress);
      expect(projectLobbyToPublic(next, {})).toEqual(projectLobbyToPublic(g, {}));
      expect(projectLobbyToSelfMap(next, proofRegistry)).toEqual(projectLobbyToSelfMap(g, proofRegistry));
      const undoCount = store.getState().undoStack.length;
      expect(store.getState().resolveAbility(req).ok).toBe(false);
      expect(store.getState().undoStack).toHaveLength(undoCount);
      store.getState().undo();
      expect(store.getState().game!.informationDeliveries).toEqual([]);
      expect(store.getState().game!.nightProgress).toEqual(g.nightProgress);
    } finally { stop(); }
  });

  it.each(["chef", "empath", "fortuneteller"])("%s impaired choices retain communicated information separately from authoritative state", role => {
    for (const impairment of ["poisoned", "drunk"]) for (const value of [0, 1]) {
      const g = impair(game(role), "p0", impairment);
      openInStore(g);
      const chosen = role === "fortuneteller" ? { [subjectId("communicated", bind(g, "p1"), bind(g, "p2"))]: yes(!!value) } : { communicated: num(value) };
      expect(store.getState().resolveAbility(request(g, "p0", role, { ...inputs(g, role), ...chosen }, { withStep: true })).ok).toBe(true);
      const next = store.getState().game!;
      expect(next.players).toEqual(g.players);
      expect(next.informationDeliveries[0]!.values!.at(-1)).toMatchObject({ value: role === "fortuneteller" ? !!value : value });
    }
  });

  it.each(["chef", "empath", "fortuneteller"])("%s ability lost is not an impaired information picker", role => {
    const g = impair(game(role), "p0", "abilityLost");
    openInStore(g);
    const chosen = role === "fortuneteller" ? { [subjectId("communicated", bind(g, "p1"), bind(g, "p2"))]: yes() } : { communicated: num(1) };
    expect(store.getState().resolveAbility(request(g, "p0", role, { ...inputs(g, role), ...chosen }))).toMatchObject({ ok: false, code: "notApplicable" });
    expect(store.getState().game).toBe(g);
    expect(store.getState().undoStack).toEqual([]);
  });

  it("Empath follows current living neighbours, alignment and character changes", () => {
    let g = game("empath");
    g = patchPlayer(g, "p1", { alive: false });
    g = patchPlayer(g, "p2", { actualRole: "soldier", actualAlignment: "good" });
    g = patchPlayer(g, "p4", { actualAlignment: "evil" });
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "empath")).ok).toBe(true);
    expect(store.getState().game!.informationDeliveries[0]!.values![0]).toMatchObject({ value: 1 });
  });

  it("Fortune Teller sees a real B4 successor while preserving the historical Red Herring", () => {
    const g = withRedHerring(proofGame(["fortuneteller", "imp", "scarletwoman", "slayer", "monk"], "day", 1), "p4", "p0");
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p3", "slayer", { target: pick(g, "p1") })).ok).toBe(true);
    expect(store.getState().game!.players.p2!.actualRole).toBe("imp");
    store.setState({ game: { ...store.getState().game!, phase: "night", day: 2 } });
    const night = store.getState().game!;
    expect(store.getState().resolveAbility(request(night, "p0", "fortuneteller", { targets: pick(night, "p2", "p3") })).ok).toBe(true);
    expect(store.getState().game!.informationDeliveries.at(-1)!.values!.at(-1)).toMatchObject({ value: true });
    expect(store.getState().game!.players.p4!.effects).toEqual(g.players.p4!.effects);
  });

  it("Fortune Teller rejects duplicate targets but permits self and dead targets", () => {
    let g = game("fortuneteller");
    g = patchPlayer(g, "p1", { alive: false });
    openInStore(g);
    expect(store.getState().resolveAbility(request(g, "p0", "fortuneteller", { targets: pick(g, "p1", "p1") }))).toMatchObject({ ok: false, code: "illegal" });
    expect(store.getState().game).toBe(g);
    expect(store.getState().resolveAbility(request(g, "p0", "fortuneteller", { targets: pick(g, "p0", "p1") })).ok).toBe(true);
    expect(store.getState().game!.informationDeliveries[0]!.values!.at(-1)).toMatchObject({ value: true });
  });

  it.each(["actorReused", "targetReused", "privacy", "storage"])("rejects %s without publication or delivery", scenario => {
    const g = game("fortuneteller");
    openInStore(g);
    const context = captureCharacterActionContext();
    const req = request(g, "p0", "fortuneteller", inputs(g, "fortuneteller"), { withStep: true });
    if (scenario === "actorReused") store.setState({ game: reseat(g, "p0") });
    if (scenario === "targetReused") store.setState({ game: reseat(g, "p1") });
    if (scenario === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (scenario === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("full"); });
    const before = store.getState().game;
    expect(store.getState().resolveAbility(req, undefined, context).ok).toBe(false);
    expect(store.getState().game).toBe(before);
    expect(store.getState().undoStack).toEqual([]);
    expect(store.getState().game!.informationDeliveries).toEqual([]);
  });
});
