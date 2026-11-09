import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofQuery, request } from "@/test/proofFixtures";
import { scarletWomanSuccession } from "./scarletWoman";
import { useStorytellerStore as store, captureCharacterActionContext } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "@/stores/nightProgress";
import type { StorytellerLobbyRecord } from "@/stores/types";

const base = () => proofGame(["slayer", "imp", "scarletwoman", "chef", "monk"], "day", 2);
const shot = (g: StorytellerLobbyRecord) => request(g, "p0", "slayer", { target: pick(g, "p1") });
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

describe("B4 Scarlet Woman death consequences", () => {
  it("Slayer kills Imp at exactly five: one publication, one Undo, spent use and privately changed identity", () => {
    const g = patchPlayer(base(), "p2", { actualAlignment: "good", shownAlignment: "good" });
    openInStore(g);
    const observed: StorytellerLobbyRecord[] = [];
    const unsubscribe = store.subscribe(state => { if (state.game) observed.push(state.game); });
    try {
      expect(store.getState().resolveAbility(shot(g), undefined, captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
      const next = store.getState().game!;
      expect(observed).toHaveLength(1);
      expect(next.players.p0!.abilityUsed).toBe(true);
      expect(next.players.p1!.alive).toBe(false);
      expect(next.players.p2).toMatchObject({ actualRole: "imp", shownRole: "imp", actualAlignment: "good", shownAlignment: "good", alive: true });
      expect(next.players.p2!.packetEpoch).not.toBe(g.players.p2!.packetEpoch);
      expect(next.lifeEventWindow.events).toHaveLength(1);
      expect(next.lifeEventWindow.events[0]).toMatchObject({ kind: "death", actualRoleAtEvent: "imp" });
      expect(next.nightProgress).toEqual({});
      expect(next.result).toBeUndefined();
      expect(next.phase).toBe("day");
      expect(store.getState().undoStack).toHaveLength(1);
      const persisted = JSON.parse(localStorage.getItem("new-blood-st")!);
      expect(persisted.state.game.players.p2.actualRole).toBe("imp");
      store.getState().undo();
      expect(store.getState().game!.players.p0!.abilityUsed).toBe(false);
      expect(store.getState().game!.players.p1!.alive).toBe(true);
      expect(store.getState().game!.players.p2!.actualRole).toBe("scarletwoman");
    } finally { unsubscribe(); }
  });

  it.each(["four", "dead", "poisoned", "drunk", "abilityLost", "changed"])("does not transform an ineligible Scarlet Woman: %s", variant => {
    let g = base();
    if (variant === "four") g = patchPlayer(g, "p4", { alive: false });
    else if (variant === "dead") g = patchPlayer(proofGame(["slayer", "imp", "scarletwoman", "chef", "monk", "empath"], "day", 2), "p2", { alive: false });
    else if (variant === "changed") g = patchPlayer(g, "p2", { actualRole: "baron", shownRole: "baron" });
    else g = impair(g, "p2", variant);
    const next = planned(plan(g, shot(g)));
    expect(next.players.p1!.alive).toBe(false);
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(next.players.p2!.actualRole).toBe(g.players.p2!.actualRole);
    expect(next.result).toBeUndefined();
  });

  it("counts living non-Travellers before death, never after", () => {
    const g = base();
    expect(scarletWomanSuccession(proofQuery(g), bind(g, "p1"))).toMatchObject({ kind: "successor", target: bind(g, "p2") });
    expect(scarletWomanSuccession(proofQuery(patchPlayer(g, "p4", { isTraveler: true })), bind(g, "p1"))).toEqual({ kind: "none" });
    expect(scarletWomanSuccession(proofQuery(patchPlayer(g, "p1", { alive: false })), bind(g, "p1"))).toEqual({ kind: "none" });
  });

  it.each(["duplicate", "hidden", "uncertain", "custom"])("refuses the complete shot with unresolved succession: %s", variant => {
    let g = base();
    if (variant === "duplicate") g = proofGame(["slayer", "imp", "scarletwoman", "scarletwoman", "monk"], "day", 2);
    if (variant === "hidden") g = patchPlayer(g, "p2", { shownRole: "chef" });
    if (variant === "uncertain") g = impair(g, "p2", "soberHealthy");
    if (variant === "custom") g = impair(g, "p4", "custom-effect");
    const snapshot = JSON.stringify(g);
    expect(plan(g, shot(g))).toMatchObject({ ok: false, code: "unsupported" });
    expect(JSON.stringify(g)).toBe(snapshot);
    expect(g.players.p0!.abilityUsed).toBe(false);
  });

  it("uses pre-death impairment even when Demon death clears an old Poisoner source", () => {
    let g = base();
    g = patchPlayer(g, "p2", { effects: [{ id: "old-source-poison", type: "poisoned", state: "active",
      lifetime: { kind: "manual" }, expiry: { kind: "none" }, appliedAt: { phase: "day", day: 2 },
      sourceCharacter: "poisoner", sourceParticipant: { kind: "participant", ...bind(g, "p1"), nameAtTime: "Old Poisoner" } }] });
    // A changed Poisoner's stale effect is already mechanically inactive;
    // the pre-death query, not presence/artwork, decides the succession.
    expect(proofQuery(g).abilityFunctions(bind(g, "p2"))).toEqual({ known: true, value: true });
    const next = planned(plan(g, shot(g)));
    expect(next.players.p2!.actualRole).toBe("imp");
    expect(next.players.p2!.effects).toEqual([]);
  });

  it("self-pass to Poisoner removes sourced poison, retains source-free herring and blocks a second attack", () => {
    let g = proofGame(["imp", "poisoner", "chef", "monk", "fortuneteller"]);
    g = patchPlayer(g, "p2", { effects: [
      { id: "poison", type: "poisoned", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" }, appliedAt: { phase: "night", day: 2 },
        sourceCharacter: "poisoner", sourceParticipant: { kind: "participant", ...bind(g, "p1"), nameAtTime: "Poisoner" } },
      { id: "herring", type: "fortuneTellerRedHerring", state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" }, appliedAt: { phase: "setup", day: 0 } },
    ] });
    const next = planned(plan(g, request(g, "p0", "imp", { target: pick(g, "p0") }, { withStep: true, completeStep: true })));
    expect(next.players.p1!.actualRole).toBe("imp");
    expect(next.players.p2!.effects.map(e => e.id)).toEqual(["herring"]);
    expect(next.nightProgress[`2:${participantStepKey(g.players.p1!.participantId!, "imp")}`]?.status).toBe("skipped");
    expect(plan(next, request(next, "p1", "imp", { target: pick(next, "p3") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("storage failure cannot consume Slayer, kill Imp or transform Scarlet Woman", () => {
    const g = base(); openInStore(g);
    const before = store.getState();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    expect(store.getState().resolveAbility(shot(g), undefined, captureCharacterActionContext())).toMatchObject({ ok: false });
    expect(store.getState()).toBe(before);
  });
});
