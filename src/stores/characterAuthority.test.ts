import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureCharacterActionContext, type CharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { usePrivacyStore } from "./privacyStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { SessionWriter } from "@/firebase/writer";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { participantStepKey } from "./nightProgress";

const state = () => store.getState();
const game = () => state().game!;
const target = () => ({ playerId: "p1", participantId: game().players.p1!.participantId! });
const actions = {
  effect: (context?: CharacterActionContext) => state().resolveEffects({ intents: [{ kind: "apply", target: target(), effect: { id: "test-effect", type: "poisoned", lifetime: { kind: "manual" } } }] }, context),
  reminder: (context?: CharacterActionContext) => state().resolveReminders({ intents: [{ kind: "place", target: target(), reminder: { id: "test-reminder", label: "Selected" } }] }, context),
  ability: (context?: CharacterActionContext) => state().resolveAbility({ mode: "manual", reason: "Storyteller correction", outcome: { operations: [{ domain: "effect", intents: [{ kind: "apply", target: target(), effect: { id: "ability-effect", type: "poisoned", lifetime: { kind: "manual" } } }] }] } }, undefined, context),
  night: (context?: CharacterActionContext) => state().setNightStepStatus(game().day, participantStepKey(game().players.p0!.participantId!, "poisoner"), "done", context),
};
const writers: SessionWriter[] = [];
beforeEach(() => {
  store.setState({ game: setupGame(["poisoner", "soldier", "empath", "monk", "imp"], { phase: "night", day: 2 }), lobby: null,
    undoStack: [], localSeq: 0, terminalClose: null, customScripts: { [setupScript.id]: setupScript } });
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});
afterEach(async () => { vi.restoreAllMocks(); for (const writer of writers.splice(0)) await writer.dispose(); });

describe("character command ownership and atomic persistence", () => {
  it.each(Object.keys(actions) as (keyof typeof actions)[])("%s refuses unavailable browser storage before publication", kind => {
    const before = state(); const saved = localStorage.getItem("new-blood-st"); let publications = 0;
    const unsubscribe = store.subscribe(() => publications++);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      expect(actions[kind]()).toMatchObject({ ok: false });
      expect(game()).toBe(before.game); expect(state().undoStack).toBe(before.undoStack); expect(state().localSeq).toBe(before.localSeq);
      expect(publications).toBe(0); expect(localStorage.getItem("new-blood-st")).toBe(saved);
    } finally { unsubscribe(); }
  });
  it.each(Object.keys(actions) as (keyof typeof actions)[])("%s rejects an online session without its active writer", kind => {
    store.setState({ lobby: { code: "ABC12345", uid: "host", sessionId: "session", status: "live" }, game: { ...game(), code: "ABC12345", storytellerUid: "host" } });
    const before = state(); expect(actions[kind]()).toMatchObject({ ok: false });
    expect(game()).toBe(before.game); expect(state().undoStack).toBe(before.undoStack); expect(state().localSeq).toBe(before.localSeq);
  });
  it.each(Object.keys(actions) as (keyof typeof actions)[])("%s saves once before publication and Undo/reload preserve its transaction", async kind => {
    const before = game(); const writes = vi.spyOn(Storage.prototype, "setItem"); let durable = false;
    const unsubscribe = store.subscribe(next => { durable = JSON.stringify(JSON.parse(localStorage.getItem("new-blood-st")!).state.game) === JSON.stringify(next.game); });
    expect(actions[kind](captureCharacterActionContext())).toMatchObject({ ok: true, changed: true });
    unsubscribe(); expect(durable).toBe(true); expect(writes).toHaveBeenCalledTimes(1);
    expect(state().undoStack).toHaveLength(1); expect(state().localSeq).toBe(1);
    const expected = game(); const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate();
    expect(game()).toEqual(expected); expect(state().undoStack).toHaveLength(1);
    state().undo(); expect(game()).toEqual(before);
  });
  it.each(Object.keys(actions) as (keyof typeof actions)[])("%s refuses stale context, Privacy Mode, terminal close and ended game atomically", kind => {
    const context = captureCharacterActionContext(); state().setNotes("p1", "Changed after opening action");
    const changed = state(); expect(actions[kind](context)).toMatchObject({ ok: false }); expect(game()).toBe(changed.game);
    usePrivacyStore.getState().setEnabled(true);
    expect(actions[kind]()).toMatchObject({ ok: false }); expect(game()).toBe(changed.game);
    usePrivacyStore.getState().reset(); store.setState({ terminalClose: { status: "closing" } as never });
    expect(actions[kind]()).toMatchObject({ ok: false }); expect(game()).toBe(changed.game);
    store.setState({ terminalClose: null, game: { ...game(), phase: "ended" } });
    const ended = state(); expect(actions[kind]()).toMatchObject({ ok: false });
    expect(game()).toBe(ended.game); expect(state().undoStack).toBe(ended.undoStack); expect(state().localSeq).toBe(ended.localSeq);
  });
  it("retained callbacks cannot cross lobby detachment even when offline actions are allowed", () => {
    const context = captureCharacterActionContext();
    store.setState({ lobby: { code: "ABC12345", uid: "host", status: "reconnecting" } });
    expect(actions.effect(context)).toMatchObject({ ok: false });
    store.setState({ lobby: null });
    const before = state(); expect(actions.effect(captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(game()).not.toBe(before.game);
  });
  it("refuses stopped writer and same-session takeover with the actual writer bridge", async () => {
    const backend = new MemoryRoomBackend(); const code = "CHAR2345";
    await createLobby(backend, "host", { codeGenerator: () => code }); const session = await requireActiveSession(backend, code);
    const first = new SessionWriter(backend, code, session.id); writers.push(first); await first.start();
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
    store.setState({ game: { ...game(), code, storytellerUid: "host" }, lobby });
    useSessionRuntime.setState({ backend: first, status: "live" });
    expect(actions.effect(captureCharacterActionContext())).toMatchObject({ ok: true });
    const old = captureCharacterActionContext();
    await first.dispose();
    const second = new SessionWriter(backend, code, session.id); writers.push(second); await second.start();
    useSessionRuntime.setState({ backend: second, status: "live" });
    const before = state(); expect(actions.reminder(old)).toMatchObject({ ok: false }); expect(game()).toBe(before.game);
    second.stop(); expect(actions.reminder(captureCharacterActionContext())).toMatchObject({ ok: false }); expect(game()).toBe(before.game);
  });
  it("a no-op retry saves nothing and stale participant binding refuses without Undo", () => {
    expect(actions.effect()).toMatchObject({ ok: true });
    const before = state(); const write = vi.spyOn(Storage.prototype, "setItem");
    expect(actions.effect()).toMatchObject({ ok: true, changed: false }); expect(write).not.toHaveBeenCalled();
    expect(state().resolveReminders({ intents: [{ kind: "place", target: { ...target(), participantId: "former-occupant" }, reminder: { label: "Selected" } }] })).toMatchObject({ ok: false, code: "stale" });
    expect(game()).toBe(before.game); expect(state().undoStack).toBe(before.undoStack); expect(state().localSeq).toBe(before.localSeq);
  });
});
