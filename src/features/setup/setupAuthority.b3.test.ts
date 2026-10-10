import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureCharacterActionContext, type CharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { SessionWriter } from "@/firebase/writer";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { projectLobbyToSelfMap } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import type { StorytellerLobbyRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const actions = {
  deal: (context?: CharacterActionContext) => state().dealRolePool(undefined, context),
  reveal: (context?: CharacterActionContext) => state().revealRoles(context),
  begin: (context?: CharacterActionContext) => state().beginNightOne(context),
};
type Kind = keyof typeof actions;
const kinds = Object.keys(actions) as Kind[];
const writers: SessionWriter[] = [];
const withoutRevealTokens = (value: StorytellerLobbyRecord) => ({ ...value, players: Object.fromEntries(
  Object.entries(value.players).map(([id, player]) => {
    const { revealToken: _token, ...rest } = player;
    return [id, rest];
  }),
) });

beforeEach(() => {
  localStorage.clear();
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
  store.setState({ game: null, lobby: null, terminalClose: null, undoStack: [], localSeq: 0, customScripts: {} });
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const writer of writers.splice(0)) await writer.dispose();
  usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, status: "idle" });
});

function prepare(kind: Kind) {
  state().newGame("tb", { plannedPlayerCount: 5, plannedRoles: ["washerwoman", "chef", "soldier", "poisoner", "imp"] });
  for (let i = 0; i < 5; i++) state().addPlayerToSeat(`Player ${i}`);
  if (kind !== "deal") expect(state().dealRolePool().ok).toBe(true);
  if (kind === "begin") expect(state().revealRoles().ok).toBe(true);
  store.setState({ undoStack: [], localSeq: 0 });
}

function refusedWithoutMutation(kind: Kind, context?: CharacterActionContext) {
  const before = state();
  const saved = localStorage.getItem("new-blood-st");
  const writes = vi.spyOn(Storage.prototype, "setItem");
  let publications = 0;
  const unsubscribe = store.subscribe(() => publications++);
  try {
    expect(actions[kind](context)).toMatchObject({ ok: false });
    expect(state()).toBe(before);
    expect(writes).not.toHaveBeenCalled();
    expect(publications).toBe(0);
    expect(localStorage.getItem("new-blood-st")).toBe(saved);
  } finally { unsubscribe(); writes.mockRestore(); }
}

describe("B3 Setup command authority and durable transaction", () => {
  it.each(kinds)("%s refuses Privacy Mode with no publication or write", kind => {
    prepare(kind);
    usePrivacyStore.getState().setEnabled(true);
    refusedWithoutMutation(kind);
  });

  it.each(kinds)("%s refuses a captured context after game replacement", kind => {
    prepare(kind);
    const context = captureCharacterActionContext();
    store.setState({ game: { ...game(), notes: "Changed since opening the setup action" } });
    refusedWithoutMutation(kind, context);
  });

  it.each(kinds)("%s refuses reconnecting session and missing online writer", kind => {
    prepare(kind);
    for (const status of ["reconnecting", "live"] as const) {
      store.setState({ lobby: { code: "SETU2345", uid: "host", sessionId: "setup-session", status },
        game: { ...game(), code: "SETU2345", storytellerUid: "host" } });
      refusedWithoutMutation(kind);
    }
  });

  it.each(kinds)("%s refuses terminal close and protected recovery without touching the journal", kind => {
    prepare(kind);
    for (const terminalClose of [{ status: "closing" }, { status: "failed", recoveryPending: true }, { status: "failed", confirmedRecovery: { kind: "endedWithoutResult" } }]) {
      store.setState({ terminalClose: terminalClose as never });
      localStorage.setItem("new-blood-st-ending", "unchanged recovery evidence");
      refusedWithoutMutation(kind);
      expect(localStorage.getItem("new-blood-st-ending")).toBe("unchanged recovery evidence");
    }
  });

  it.each(kinds)("%s handles storage failure before changing game, Undo, sequence or concealed reveal", kind => {
    prepare(kind);
    const before = state();
    const saved = localStorage.getItem("new-blood-st");
    const self = projectLobbyToSelfMap(game(), buildRegistry(troubleBrewing));
    let publications = 0;
    const unsubscribe = store.subscribe(() => publications++);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Full", "QuotaExceededError"); });
    try {
      expect(actions[kind](captureCharacterActionContext())).toMatchObject({ ok: false });
      expect(state()).toBe(before);
      expect(publications).toBe(0);
      expect(localStorage.getItem("new-blood-st")).toBe(saved);
      expect(projectLobbyToSelfMap(game(), buildRegistry(troubleBrewing))).toEqual(self);
    } finally { unsubscribe(); }
  });

  it.each(kinds)("%s saves exactly once before publication, survives reload, and has one Undo", async kind => {
    prepare(kind);
    const before = game();
    const writes = vi.spyOn(Storage.prototype, "setItem");
    let publications = 0;
    const unsubscribe = store.subscribe(next => {
      expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(next.game);
      publications++;
    });
    try { expect(actions[kind](captureCharacterActionContext())).toMatchObject({ ok: true }); }
    finally { unsubscribe(); }
    expect(publications).toBe(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(state().undoStack).toHaveLength(1);
    expect(state().localSeq).toBe(1);
    writes.mockRestore();
    const expected = game();
    const saved = localStorage.getItem("new-blood-st")!;
    store.setState({ game: null, undoStack: [] });
    localStorage.setItem("new-blood-st", saved);
    await store.persist.rehydrate();
    expect(game()).toEqual(expected);
    expect(state().undoStack).toHaveLength(1);
    state().undo();
    expect(withoutRevealTokens(game())).toEqual(withoutRevealTokens(before));
    // Undo of the deal is a fresh visible-identity transition, not replay of
    // an old player acknowledgement token.
    for (const id of before.seatOrder) {
      if (before.players[id]!.shownRole !== expected.players[id]!.shownRole) {
        expect(game().players[id]!.revealToken).not.toBe(before.players[id]!.revealToken);
        expect(game().players[id]!.revealToken).not.toBe(expected.players[id]!.revealToken);
      }
    }
  });

  it.each(kinds)("%s rejects stopped and replaced writer contexts", async kind => {
    prepare(kind);
    const backend = new MemoryRoomBackend();
    const code = "SETU2345";
    await createLobby(backend, "host", { codeGenerator: () => code });
    const session = await requireActiveSession(backend, code);
    const first = new SessionWriter(backend, code, session.id);
    writers.push(first);
    await first.start();
    store.setState({ game: { ...game(), code, storytellerUid: "host" }, lobby: { code, uid: "host", sessionId: session.id, status: "live" } });
    useSessionRuntime.setState({ backend: first, status: "live" });
    const old = captureCharacterActionContext();
    await first.dispose();
    const second = new SessionWriter(backend, code, session.id);
    writers.push(second);
    await second.start();
    useSessionRuntime.setState({ backend: second, status: "live" });
    refusedWithoutMutation(kind, old);
    second.stop();
    refusedWithoutMutation(kind, captureCharacterActionContext());
  });
});
