import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bind, impair, openInStore, patchPlayer, proofEnv, proofGame, proofRegistry, reseat } from "@/test/proofFixtures";
import { planRecordedLifeOutcome } from "./deathResolution";
import { captureCharacterActionContext, captureVotingContext, useStorytellerStore as store } from "./storytellerStore";
import { currentVotingState, planVoting } from "./voting";
import { usePrivacyStore } from "./privacyStore";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { SessionWriter } from "@/firebase/writer";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import type { StorytellerLobbyRecord } from "./types";

const state = () => store.getState();
const game = () => state().game!;
const fresh = () => proofGame(["imp", "scarletwoman", "slayer", "chef", "soldier"], "day", 2);
const death = { intents: [{ kind: "death" as const, playerId: "p0" }] };
const writers: SessionWriter[] = [];
beforeEach(() => {
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
  store.setState({ terminalClose: null });
  openInStore(fresh());
});
afterEach(async () => { vi.restoreAllMocks(); for (const writer of writers.splice(0)) await writer.dispose(); });

describe("B4 recorded death and execution composition", () => {
  it.each(["death", "execution"] as const)("%s uses five living before death and changes exactly one successor", kind => {
    const before = fresh(); const snapshot = JSON.stringify(before);
    const result = planRecordedLifeOutcome(before, { intents: [kind === "death" ? death.intents[0]! : { kind, playerId: "p0", outcome: "died" }] }, proofEnv());
    expect(result).toMatchObject({ ok: true, changed: true });
    if (!result.ok) throw new Error(result.message);
    expect(result.manualReason).toBeUndefined();
    expect(result.game.players.p0!.alive).toBe(false);
    expect(result.game.players.p1).toMatchObject({ actualRole: "imp", shownRole: "imp", actualAlignment: "evil" });
    expect(result.game.lifeEventWindow.events).toHaveLength(1);
    expect(result.game.lifeEventWindow.events[0]!.kind).toBe(kind);
    expect(result.game.lifeEventWindow.events[0]!.actualRoleAtEvent).toBe("imp");
    expect(result.game.history.filter(h => h.category === "role")).toHaveLength(1);
    expect(result.game.history.filter(h => h.category !== "life").every(h => h.resolutionId === result.game.lifeEventWindow.events[0]!.resolutionId)).toBe(true);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(result.game.phase).toBe("day"); expect(result.game.result).toBeUndefined();
  });
  it.each(["poisoned", "drunk", "abilityLost"])("%s Scarlet Woman does not succeed", type => {
    const result = planRecordedLifeOutcome(impair(fresh(), "p1", type), death, proofEnv());
    expect(result).toMatchObject({ ok: true, game: { players: { p0: { alive: false }, p1: { actualRole: "scarletwoman" } } } });
  });
  it("four living, dead or character-changed Scarlet Woman cannot succeed", () => {
    for (const before of [patchPlayer(fresh(), "p4", { alive: false }), patchPlayer(fresh(), "p1", { alive: false }),
      patchPlayer(fresh(), "p1", { actualRole: "poisoner", shownRole: "poisoner" })]) {
      const result = planRecordedLifeOutcome(before, death, proofEnv());
      expect(result).toMatchObject({ ok: true });
      if (result.ok) expect(result.game.players.p1!.actualRole).toBe(before.players.p1!.actualRole);
    }
  });
  it.each(["survived", "alreadyDead"] as const)("execution %s records execution alone", outcome => {
    const before = outcome === "alreadyDead" ? patchPlayer(fresh(), "p0", { alive: false }) : fresh();
    const result = planRecordedLifeOutcome(before, { intents: [{ kind: "execution", playerId: "p0", outcome }] }, proofEnv());
    expect(result).toMatchObject({ ok: true, game: { players: { p1: { actualRole: "scarletwoman" } } } });
    if (result.ok) expect(result.game.lifeEventWindow.events.map(e => e.kind)).toEqual(["execution"]);
  });
  it("preserves actual alignment and source-free herring through succession", () => {
    const before = patchPlayer(fresh(), "p1", { actualAlignment: "good", shownAlignment: "good", effects: [{ id: "herring", type: "fortuneTellerRedHerring",
      state: "active", lifetime: { kind: "manual" }, expiry: { kind: "none" }, appliedAt: { phase: "setup", day: 0 } }] });
    const result = planRecordedLifeOutcome(before, death, proofEnv());
    expect(result).toMatchObject({ ok: true, game: { players: { p1: { actualRole: "imp", actualAlignment: "good", shownAlignment: "good", effects: before.players.p1!.effects } } } });
  });
  it("unknown/multiple successors leave the confirmed outcome wholly Storyteller-owned and explain it", () => {
    const before = proofGame(["imp", "scarletwoman", "scarletwoman", "chef", "soldier"], "day", 2);
    const result = planRecordedLifeOutcome(before, death, proofEnv());
    expect(result).toMatchObject({ ok: true, manualReason: expect.stringContaining("Outcome recorded") });
    if (result.ok) {
      expect(result.game.players.p0!.alive).toBe(false);
      expect(result.game.players.p1!.actualRole).toBe("scarletwoman");
      expect(result.game.players.p2!.actualRole).toBe("scarletwoman");
    }
  });
  it("a cause-unknown recorded Night death leaves succession and Night timing wholly manual", () => {
    const before = { ...fresh(), phase: "night" as const };
    openInStore(before);
    expect(state().recordDeath("p0")).toMatchObject({ ok: true, manualReason: expect.stringContaining("cause of this Night death is not recorded") });
    expect(game().players.p0!.alive).toBe(false);
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
    expect(game().nightProgress).toEqual(before.nightProgress);
    expect(game().history.some(h => h.category === "role")).toBe(false);
    state().undo(); expect(game()).toEqual(before);
  });
  it("raw Life and each correction boundary never replays succession", () => {
    expect(state().resolveLife(death).ok).toBe(true);
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
    const event = game().lifeEventWindow.events[0]!;
    expect(state().amendLifeEvent(event.id, { kind: "execution", outcome: "died" })).toMatchObject({ ok: true });
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
    expect(state().retractLifeEvent(game().lifeEventWindow.events[0]!.id).ok).toBe(true);
    expect(state().correctLifeStatus("p0", { alive: true }).ok).toBe(true);
    expect(state().lateRecordLifeEvent({ kind: "death", playerId: "p0" }).ok).toBe(true);
    expect(game().players.p1!.actualRole).toBe("scarletwoman");
  });
});

describe("B4 authority, durability and privacy", () => {
  it.each(["death", "execution", "voting"])("%s publishes one durable compound result and one Undo; reload preserves it", async path => {
    const before = game(); let publications = 0;
    const savedAtPublish: StorytellerLobbyRecord[] = [];
    const unsubscribe = store.subscribe(next => { publications++; savedAtPublish.push(JSON.parse(localStorage.getItem("new-blood-st")!).state.game); expect(savedAtPublish.at(-1)).toEqual(next.game); });
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const result = path === "death" ? state().recordDeath("p0", undefined, captureCharacterActionContext())
      : path === "execution" ? state().recordExecution("p0", "died", undefined, undefined, captureCharacterActionContext())
      : state().resolveVoting({ kind: "execution", target: bind(game(), "p0"), outcome: "died", code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision }, captureVotingContext());
    unsubscribe();
    expect(result).toMatchObject({ ok: true, changed: true }); expect(publications).toBe(1); expect(writes).toHaveBeenCalledTimes(1);
    expect(state().undoStack).toHaveLength(1); expect(state().localSeq).toBe(6);
    expect(game().players.p1!.actualRole).toBe("imp");
    const expected = game(); const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(expected); state().undo();
    // An identity Undo deliberately rotates its reveal credential.
    const { revealToken: _rotated, ...restoredHeir } = game().players.p1!;
    expect({ ...game(), players: { ...game().players, p1: restoredHeir } }).toEqual(before);
    expect(game().players.p1!.revealToken).toBeTruthy();
  });
  it.each(["death", "execution", "voting"])("%s storage failure leaves all domains untouched", path => {
    const before = state(); const saved = localStorage.getItem("new-blood-st"); let publications = 0;
    const unsubscribe = store.subscribe(() => publications++);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    const result = path === "death" ? state().recordDeath("p0") : path === "execution" ? state().recordExecution("p0", "died")
      : state().resolveVoting({ kind: "execution", target: bind(game(), "p0"), outcome: "died", code: game().code, day: game().day, expectedRevision: 0 }, captureVotingContext());
    unsubscribe(); expect(result.ok).toBe(false); expect(publications).toBe(0);
    expect(state()).toBe(before); expect(localStorage.getItem("new-blood-st")).toBe(saved);
  });
  it("rejects a retained callback after participant replacement, Privacy Mode and terminal recovery", () => {
    const context = captureCharacterActionContext(); store.setState({ game: reseat(game(), "p0") });
    const before = game(); expect(state().recordDeath("p0", undefined, context).ok).toBe(false); expect(game()).toBe(before);
    usePrivacyStore.getState().setEnabled(true); expect(state().recordExecution("p0", "died").ok).toBe(false);
    usePrivacyStore.getState().reset(); store.setState({ terminalClose: { status: "failed", recoveryPending: true } as never });
    expect(state().recordDeath("p0").ok).toBe(false); expect(game()).toBe(before);
  });
  it("rejects stale and stopped writer after same-session takeover", async () => {
    const backend = new MemoryRoomBackend(); const code = "DETH2345";
    await createLobby(backend, "host", { codeGenerator: () => code }); const session = await requireActiveSession(backend, code);
    const first = new SessionWriter(backend, code, session.id); writers.push(first); await first.start();
    store.setState({ game: { ...game(), code, storytellerUid: "host" }, lobby: { code, uid: "host", sessionId: session.id, status: "live" } });
    useSessionRuntime.setState({ backend: first, status: "live" }); const old = captureCharacterActionContext();
    await first.dispose(); const second = new SessionWriter(backend, code, session.id); writers.push(second); await second.start();
    useSessionRuntime.setState({ backend: second, status: "live" }); const before = game();
    expect(state().recordDeath("p0", undefined, old).ok).toBe(false); expect(game()).toBe(before);
    second.stop(); expect(state().recordExecution("p0", "died").ok).toBe(false); expect(game()).toBe(before);
  });
  it("exposes successor identity only in its intentional self projection", () => {
    expect(state().recordDeath("p0").ok).toBe(true);
    const publicView = JSON.stringify(projectLobbyToPublic(game(), {}));
    expect(publicView).not.toContain('"actualRole"'); expect(publicView).not.toContain('"imp"');
    const selves = projectLobbyToSelfMap(game(), proofRegistry);
    expect(selves.p1).toMatchObject({ shownRole: "imp" });
    expect(JSON.stringify(selves.p2)).not.toContain('"imp"');
  });
  it("Voting execution cannot be repeated; finishing the Day does not execute again", () => {
    const command = () => ({ kind: "execution" as const, target: bind(game(), "p0"), outcome: "died" as const, code: game().code, day: game().day, expectedRevision: currentVotingState(game()).revision });
    expect(state().resolveVoting(command(), captureVotingContext()).ok).toBe(true);
    const before = game(); expect(state().resolveVoting(command(), captureVotingContext()).ok).toBe(false); expect(game()).toBe(before);
    expect(state().advancePhase(captureVotingContext()).ok).toBe(true);
    expect(game().lifeEventWindow.events.filter(e => e.kind === "execution")).toHaveLength(1);
    expect(game().players.p1!.actualRole).toBe("imp");
  });
  it("Voting surfaces manual consequence notice without changing any successor", () => {
    const before = proofGame(["imp", "scarletwoman", "scarletwoman", "chef", "soldier"], "day", 2);
    const result = planVoting(before, { kind: "execution", target: bind(before, "p0"), outcome: "died", code: before.code, day: before.day, expectedRevision: 0 }, proofEnv());
    expect(result).toMatchObject({ ok: true, manualReason: expect.stringContaining("Outcome recorded"), game: { players: { p1: { actualRole: "scarletwoman" } } } });
  });
});
