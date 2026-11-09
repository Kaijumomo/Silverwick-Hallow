import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { bind, homebrewEnv, impair, openInStore, patchPlayer, pick, plan, planned, proofGame, proofRegistry, request, reseat, yes } from "@/test/proofFixtures";
import { registersAsDemonJudgment } from "./slayer";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "@/stores/projections";
import { endGameEligibility } from "@/stores/endGameEligibility";
import { proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";

const game = () => proofGame(["slayer", "recluse", "imp", "scarletwoman", "monk", "chef"], "day", 1);
const shot = (g: StorytellerLobbyRecord, demon: boolean) => request(g, "p0", "slayer", {
  target: pick(g, "p1"), [registersAsDemonJudgment(bind(g, "p1").participantId)]: yes(demon),
});
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, terminalClose: null });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])("Recluse registration %s is one durable shot, with exact recovery and Undo", async demon => {
  const g = game(); openInStore(g);
  const write = vi.spyOn(Storage.prototype, "setItem");
  expect(store.getState().resolveAbility(shot(g, demon))).toMatchObject({ ok: true, changed: true });
  expect(write).toHaveBeenCalledTimes(1);
  const next = store.getState().game!;
  expect(next.players.p0!.abilityUsed).toBe(true);
  expect(next.players.p1).toMatchObject({ alive: !demon, actualRole: "recluse", shownRole: "recluse", actualAlignment: "good", effects: [] });
  expect(next.players.p2).toMatchObject({ alive: true, actualRole: "imp" });
  expect(next.players.p3!.actualRole).toBe("scarletwoman");
  expect(next.gameRuleFacts).toEqual([]);
  expect(next.phase).toBe("day"); expect(next.result).toBeUndefined();
  expect(endGameEligibility(next, { registry: proofRegistry, script: proofScript })).toEqual({ kind: "none" });
  expect(next.lifeEventWindow.events.filter(e => e.kind === "death")).toHaveLength(demon ? 1 : 0);
  expect(next.history.length).toBeGreaterThan(g.history.length);
  expect(store.getState().resolveAbility(shot(next, !demon))).toMatchObject({ ok: false });
  expect(store.getState().undoStack).toHaveLength(1);
  const projected = JSON.stringify([projectLobbyToPublic(next, {}), projectLobbyToSelfMap(next, proofRegistry)]);
  expect(projected).not.toMatch(/registersAsDemon|actualRole|actualAlignment|reminders|effects/);
  const saved = localStorage.getItem("new-blood-st")!;
  store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved);
  await store.persist.rehydrate(); expect(store.getState().game).toEqual(next);
  store.getState().undo(); expect(store.getState().game).toEqual(g);
});

it.each(["poisoned", "drunk", "abilityLost"])("%s Recluse cannot opt into Demon registration", effect => {
  const g = impair(game(), "p1", effect);
  const next = planned(plan(g, shot(g, true)));
  expect(next.players.p0!.abilityUsed).toBe(true); expect(next.players.p1!.alive).toBe(true);
});

it.each(["soberHealthy", "registersFalsely", "protected"])("unknown %s never becomes an automated lethal ruling", effect => {
  const g = impair(game(), "p1", effect);
  expect(plan(g, shot(g, true))).toMatchObject({ ok: false, code: "unsupported" });
  expect(g.players.p0!.abilityUsed).toBe(false);
});

it("cannotDie preserves the target and spends the shot without needing registration", () => {
  const g = impair(game(), "p1", "cannotDie");
  const next = planned(plan(g, request(g, "p0", "slayer", { target: pick(g, "p1") })));
  expect(next.players.p0!.abilityUsed).toBe(true); expect(next.players.p1!.alive).toBe(true);
});

it("registration choice cannot survive seat reuse, target changes, or a homebrew Recluse", () => {
  const g = game(); const held = shot(g, true);
  expect(plan(reseat(g, "p1"), held)).toMatchObject({ ok: false, code: "stale" });
  expect(plan(g, held, homebrewEnv("recluse"))).toMatchObject({ ok: false, code: "unsupported" });
  const two = patchPlayer(g, "p5", { actualRole: "recluse", shownRole: "recluse" });
  expect(plan(two, request(two, "p0", "slayer", { target: pick(two, "p5"),
    [registersAsDemonJudgment(bind(two, "p1").participantId)]: yes(true) }))).toMatchObject({ ok: false, code: "needsInput" });
});

it.each(["privacy", "recovery", "stale-context", "no-writer", "storage"])("Recluse choice retains %s authority without partial consumption", mode => {
  const g = game(); openInStore(g); const context = captureCharacterActionContext();
  if (mode === "privacy") usePrivacyStore.getState().setEnabled(true);
  if (mode === "recovery") store.setState({ terminalClose: { intent: { kind: "declare", winner: "good" }, status: "failed", message: "Retry", recoveryPending: true } });
  if (mode === "stale-context") store.getState().setNotes("p1", "Changed");
  if (mode === "no-writer") store.setState({ lobby: { code: "R3TEST01", uid: "host", sessionId: "session", status: "live" }, game: { ...g, code: "R3TEST01", storytellerUid: "host" } });
  if (mode === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
  const before = store.getState().game;
  expect(store.getState().resolveAbility(shot(g, true), undefined, context)).toMatchObject({ ok: false });
  expect(store.getState().game).toBe(before);
  expect(before!.players.p0!.abilityUsed).toBe(false); expect(before!.players.p1!.alive).toBe(true);
});
