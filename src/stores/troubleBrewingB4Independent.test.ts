import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { bind, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofRegistry, request, reseat } from "@/test/proofFixtures";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { usePrivacyStore } from "./privacyStore";
import { startStorytellerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { withoutRevealTokens } from "@/test/revealTokens";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { SessionWriter } from "@/firebase/writer";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import type { StorytellerLobbyRecord } from "./types";

// Independent adversarial acceptance cases. Rules oracle: official wiki pages
// Scarlet_Woman (pre-death threshold), Imp (self-pass and no repeat attack),
// Slayer (impaired use spent; dead targets cannot die again).
const base = () => proofGame(["slayer", "imp", "scarletwoman", "poisoner", "monk"], "day", 2);
const shot = (g: StorytellerLobbyRecord) => request(g, "p0", "slayer", { target: pick(g, "p1") });
const writers: SessionWriter[] = [];
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(async () => { vi.restoreAllMocks(); for (const writer of writers.splice(0)) await writer.dispose(); });

describe("independent B4 adverse death and succession sequences", () => {
  it.each(["poisoned", "drunk", "abilityLost"])("an impaired %s SW can still receive the Imp's self-pass below five", effect => {
    const g = impair(proofGame(["imp", "scarletwoman", "chef", "monk"]), "p1", effect);
    const next = planned(plan(g, request(g, "p0", "imp", { target: pick(g, "p0") })));
    expect(next.players.p0!.alive).toBe(false);
    expect(next.players.p1!.actualRole).toBe("imp");
    expect(next.players.p1!.effects.some(e => e.type === effect)).toBe(true);
    expect(plan(next, request(next, "p1", "imp", { target: pick(next, "p2") }))).toMatchObject({ ok: false, code: "notApplicable" });
  });

  it("healthy mandatory SW overrides an explicit choice of another Minion without partial death", () => {
    const g = proofGame(["imp", "scarletwoman", "poisoner", "chef", "monk"]);
    const req = request(g, "p0", "imp", { target: pick(g, "p0"), successor: pick(g, "p2") });
    expect(plan(g, req)).toMatchObject({ ok: false });
    expect(g.players.p0!.alive).toBe(true);
    expect(g.players.p1!.actualRole).toBe("scarletwoman");
  });

  it("Poisoner self-pass cleans its real poison without retroactively promoting the now healthy SW", () => {
    const start = proofGame(["imp", "scarletwoman", "poisoner", "chef", "monk"]);
    const poisoned = planned(plan(start, request(start, "p2", "poisoner", { target: pick(start, "p1") })));
    expect(poisoned.players.p1!.effects.some(e => e.type === "poisoned")).toBe(true);
    openInStore(poisoned);
    expect(store.getState().resolveAbility(request(poisoned, "p0", "imp", {
      target: pick(poisoned, "p0"), successor: pick(poisoned, "p2"),
    }, { withStep: true, completeStep: true }))).toMatchObject({ ok: true });
    const next = store.getState().game!;
    expect(next.players.p0!.alive).toBe(false);
    expect(next.players.p2!.actualRole).toBe("imp");
    expect(next.players.p1!.actualRole).toBe("scarletwoman");
    expect(next.players.p1!.effects).toEqual([]);
    expect(next.lifeEventWindow.events).toHaveLength(1);
    expect(store.getState().undoStack).toHaveLength(1);
    store.getState().undo();
    expect(withoutRevealTokens(store.getState().game!)).toEqual(withoutRevealTokens(poisoned));
  });

  it.each(["recluse", "spy"])("unresolved %s registration cannot create a guessed automatic heir", role => {
    const g = proofGame(["imp", role, "chef", "monk"]);
    openInStore(g); const before = store.getState();
    expect(before.resolveAbility(request(g, "p0", "imp", { target: pick(g, "p0") }))).toMatchObject({ ok: false });
    expect(store.getState()).toBe(before);
  });

  it("dead Imp target consumes the Slayer use without producing death or succession", () => {
    const g = patchPlayer(base(), "p1", { alive: false }); openInStore(g);
    expect(store.getState().resolveAbility(shot(g))).toMatchObject({ ok: true });
    const next = store.getState().game!;
    expect(next.players.p0!.abilityUsed).toBe(true);
    expect(next.players.p2!.actualRole).toBe("scarletwoman");
    expect(next.lifeEventWindow.events).toEqual([]);
    expect(store.getState().resolveReminders({ intents: [{ kind: "place", target: bind(next, "p0"), reminder: { label: "No Ability", sourceCharacter: "slayer" } }] })).toMatchObject({ ok: true });
    const reminder = store.getState().game!.players.p0!.reminders.find(r => r.label === "No Ability")!;
    expect(store.getState().removeReminder("p0", reminder.id)).toMatchObject({ ok: true });
    const afterRemoval = store.getState().game!;
    expect(afterRemoval.players.p0!.abilityUsed).toBe(true);
    expect(store.getState().resolveAbility(shot(afterRemoval))).toMatchObject({ ok: false });
  });

  it.each(["poisoned", "drunk", "cannotDie"])("%s prevents an Imp self-kill even with a healthy mandatory SW", effect => {
    const g = impair(proofGame(["imp", "scarletwoman", "poisoner", "chef", "monk"]), "p0", effect);
    const result = plan(g, request(g, "p0", "imp", { target: pick(g, "p0") }, { withStep: true, completeStep: true }));
    const next = planned(result);
    expect(next.players.p0!.alive).toBe(true); expect(next.players.p1!.actualRole).toBe("scarletwoman");
    expect(next.lifeEventWindow.events).toEqual([]);
    expect(Object.values(next.nightProgress).filter(s => s.status === "skipped")).toEqual([]);
  });

  it("at five, private succession is durable before its only publication; reload and Undo preserve the full operation", async () => {
    const g = patchPlayer(base(), "p2", { actualAlignment: "good", shownAlignment: "undisclosed" }); openInStore(g);
    const publicBefore = projectLobbyToPublic(g, {});
    const selfBefore = projectLobbyToSelfMap(g, proofRegistry);
    const writes = vi.spyOn(Storage.prototype, "setItem"); let publications = 0;
    const stop = store.subscribe(s => {
      publications++;
      expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(s.game);
      expect(s.game!.players.p1!.alive).toBe(false);
      expect(s.game!.players.p2!.actualRole).toBe("imp");
      expect(s.game!.players.p0!.abilityUsed).toBe(true);
    });
    try { expect(store.getState().resolveAbility(shot(g))).toMatchObject({ ok: true }); } finally { stop(); }
    const next = store.getState().game!;
    expect(publications).toBe(1); expect(writes).toHaveBeenCalledTimes(1);
    expect(projectLobbyToPublic(next, {}).players.p2).toEqual(publicBefore.players.p2);
    const selfAfter = projectLobbyToSelfMap(next, proofRegistry);
    expect(selfAfter.p2).toEqual({ shownRole: "imp" });
    for (const id of ["p0", "p1", "p3", "p4"]) expect(selfAfter[id]).toEqual(selfBefore[id]);
    expect(next.players.p2!.actualAlignment).toBe("good");
    expect(JSON.stringify(projectLobbyToPublic(next, {}))).not.toMatch(/actualRole|scarletwoman|imp|resolutionId|participantId/);
    expect(store.getState().undoStack).toHaveLength(1);
    const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(store.getState().game).toEqual(next);
    store.getState().undo();
    expect(withoutRevealTokens(store.getState().game!)).toEqual(withoutRevealTokens(g));
    expect(store.getState().game!.players.p2!.revealToken).not.toBe(next.players.p2!.revealToken);
  });

  it.each(["privacy", "stale-seat", "recovery", "storage"])("%s rejects the entire recorded execution before any publication", variant => {
    const g = base(); openInStore(g); const captured = captureCharacterActionContext();
    if (variant === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (variant === "stale-seat") store.setState({ game: reseat(g, "p1") });
    if (variant === "recovery") store.setState({ terminalClose: { status: "failed", message: "Recovery pending", intent: { kind: "declare", winner: "good" }, recoveryPending: true } });
    const before = store.getState(); const saved = localStorage.getItem("new-blood-st"); let publications = 0;
    const stop = store.subscribe(() => publications++);
    if (variant === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk unavailable"); });
    try {
      expect(before.recordExecution("p1", "died", undefined, undefined, captured)).toMatchObject({ ok: false });
      expect(store.getState()).toBe(before); expect(publications).toBe(0);
      expect(localStorage.getItem("new-blood-st")).toBe(saved);
    } finally { stop(); }
  });

  it("execution survives then a status correction cannot manufacture historical succession", () => {
    openInStore(base());
    expect(store.getState().recordExecution("p1", "survived")).toMatchObject({ ok: true });
    expect(store.getState().game!.players.p2!.actualRole).toBe("scarletwoman");
    expect(store.getState().correctLifeStatus("p1", { alive: false, ghostVote: true })).toMatchObject({ ok: true });
    const next = store.getState().game!;
    expect(next.players.p2!.actualRole).toBe("scarletwoman");
    expect(next.lifeEventWindow.events.map(e => e.kind)).toEqual(["execution"]);
    expect(next.result).toBeUndefined();
  });

  it("real same-session writer takeover invalidates a retained B4 compound action", async () => {
    const backend = new MemoryRoomBackend(); const code = "B4AUDIT1";
    await createLobby(backend, "host", { codeGenerator: () => code }); const session = await requireActiveSession(backend, code);
    const first = new SessionWriter(backend, code, session.id); writers.push(first); await first.start();
    const g = { ...base(), code, storytellerUid: "host" }; openInStore(g);
    store.setState({ lobby: { code, uid: "host", sessionId: session.id, status: "live" } });
    useSessionRuntime.setState({ backend: first, status: "live" }); const old = captureCharacterActionContext();
    await first.dispose(); const second = new SessionWriter(backend, code, session.id); writers.push(second); await second.start();
    useSessionRuntime.setState({ backend: second, status: "live" }); const before = store.getState();
    expect(before.resolveAbility(shot(g), undefined, old)).toMatchObject({ ok: false }); expect(store.getState()).toBe(before);
    second.stop();
    expect(store.getState().recordDeath("p1", undefined, captureCharacterActionContext())).toMatchObject({ ok: false });
    expect(store.getState()).toBe(before);
  });

  it("a fresh host restores the exact death, consumed use and successor from the remote checkpoint", async () => {
    const backend = new MemoryRoomBackend(); const code = "B4RECV12";
    await createLobby(backend, "host", { codeGenerator: () => code }); const session = await requireActiveSession(backend, code);
    const g = { ...base(), code, storytellerUid: "host" }; openInStore(g);
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.getState().setLobby(lobby);
    const first = new SessionWriter(backend, code, session.id); writers.push(first);
    const manager = await startStorytellerSession(backend, lobby, first);
    try {
      await waitFor(() => expect(store.getState().sync?.ackedGameSeq).toBe(store.getState().localSeq));
      const live = store.getState().game!;
      expect(store.getState().resolveAbility(shot(live), undefined, captureCharacterActionContext())).toMatchObject({ ok: true });
      await waitFor(() => expect(store.getState().sync?.ackedGameSeq).toBe(store.getState().localSeq));
      const compound = structuredClone(store.getState().game!);
      const checkpoint = JSON.parse(await backend.get(`lobbies/${code}/checkpoint`) as string);
      expect(checkpoint.game).toEqual(compound);
      expect(JSON.stringify(await backend.get(`lobbies/${code}/public`))).not.toMatch(/actualRole|scarletwoman|imp|resolutionId/);
      manager.stop(); await first.dispose();
      store.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
      const second = new SessionWriter(backend, code, session.id); writers.push(second);
      const recovered = await startStorytellerSession(backend, lobby, second);
      try {
        expect(recovered.outcome).toBe("live");
        expect(store.getState().game).toEqual(compound);
        expect(store.getState().game!.players.p0!.abilityUsed).toBe(true);
        expect(store.getState().game!.players.p1!.alive).toBe(false);
        expect(store.getState().game!.players.p2!.actualRole).toBe("imp");
        expect(store.getState().game!.lifeEventWindow.events).toHaveLength(1);
        expect(store.getState().game!.result).toBeUndefined();
      } finally { recovered.stop(); }
    } finally { manager.stop(); }
  });
});
