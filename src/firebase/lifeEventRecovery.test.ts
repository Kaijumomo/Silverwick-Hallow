// Phase 10A: the Life Event Window through persistence, reconnect, remote
// restore, writer takeover and a stale writer -- Current State, the window
// and History must always stay coherent with each other.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { buildRichPhase9Game } from "@/test/phase9RichState";
import { isDeathEvent } from "@/stores/lifeEvents";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter, LEASE_MS } from "./writer";
import { writeProjections } from "./sync";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";

const code = "LREC2345";
const root = `lobbies/${code}`;
const STORAGE_KEY = "new-blood-st";
const disposals: (() => void | Promise<void>)[] = [];
const store = () => useStorytellerStore.getState();

beforeEach(() => {
  useStorytellerStore.setState({
    game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null, customScripts: {},
  });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
  localStorage.clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

/** Every event is mirrored by exactly one "life" History record that added
 * it, and a death-like event's seated subject is dead unless a LATER event
 * or correction explains otherwise -- the coherence the life boundary
 * guarantees by committing all three together. */
function expectCoherent(game: StorytellerLobbyRecord) {
  for (const event of game.lifeEventWindow.events) {
    const mirrors = game.history.filter((h) => h.lifeEvent?.operations.some((o) => o.kind === "added" && o.event.id === event.id));
    expect(mirrors, event.id).toHaveLength(1);
    expect(mirrors[0]!.lifeEvent!.operations.find((o) => o.event.id === event.id)).toEqual({ kind: "added", event });
    const subject = game.players[event.subject.playerId];
    if (isDeathEvent(event) && subject?.participantId === event.subject.participantId) {
      const laterFix = game.history.some((h) => h.participant.kind === "participant" &&
        h.participant.participantId === event.subject.participantId && game.history.indexOf(h) > game.history.indexOf(mirrors[0]!) &&
        (h.correction || !!h.lifeEvent?.operations.some((o) => o.kind === "added" && o.event.kind === "resurrection")));
      if (!laterFix) expect(subject.alive, event.id).toBe(false);
    }
  }
}

async function hostRich(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  const handles = buildRichPhase9Game();
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  store().setLobby(lobby);
  const writer = new SessionWriter(b, code, session.id);
  const manager = await startStorytellerSession(b, lobby, writer);
  disposals.push(async () => { manager.stop(); await writer.dispose(); });
  await waitFor(() => expect(store().sync?.ackedGameSeq).toBe(store().localSeq));
  return { handles, session, lobby, writer, manager };
}

describe("Phase 10A recovery: persistence", () => {
  it("a local reload restores the window, Current State and History exactly and coherently", async () => {
    buildRichPhase9Game();
    const before = structuredClone(store().game!);
    expectCoherent(before);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const raw = localStorage.getItem(STORAGE_KEY)!;
    useStorytellerStore.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
    localStorage.setItem(STORAGE_KEY, raw);
    await useStorytellerStore.persist.rehydrate();
    expect(store().game).toEqual(before);
    expect(store().undoStack.every((entry) => Array.isArray(entry.lifeEventWindow.events))).toBe(true);
    expectCoherent(store().game!);
  });
});

describe("Phase 10A recovery: reconnect, remote restore, takeover, stale writer", () => {
  it("the live checkpoint carries the window; a fresh device restores it coherently", async () => {
    const b = new MemoryRoomBackend();
    const { handles, session, lobby, writer, manager } = await hostRich(b);
    // A further life change after the first flush, also flushed.
    const pending = store().recordExecution(handles.chefId, "died");
    const token = !pending.ok && pending.code === "needsConfirmation" ? pending.confirmation : undefined;
    expect(token?.kind).toBe("additionalExecution");
    expect(store().recordExecution(handles.chefId, "died", { confirmations: [token!] }).ok).toBe(true);
    await waitFor(() => expect(store().sync?.ackedGameSeq).toBe(store().localSeq));
    const local = structuredClone(store().game!);
    const checkpoint = JSON.parse((await b.get(`${root}/checkpoint`)) as string);
    expect(checkpoint.game.lifeEventWindow).toEqual(local.lifeEventWindow);
    // The RTDB public projection never carries the window.
    expect(JSON.stringify(await b.get(`${root}/public`))).not.toContain("lifeEventWindow");

    manager.stop(); await writer.dispose(); // device A leaves cleanly
    useStorytellerStore.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
    const fresh = new SessionWriter(b, code, session.id);
    disposals.push(() => fresh.dispose());
    const recovered = await startStorytellerSession(b, lobby, fresh);
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(store().game).toEqual(local);
    expectCoherent(store().game!);
  });

  it("after a takeover, the stale writer's later life change never reaches the server; the new writer's view stays coherent", async () => {
    const b = new MemoryRoomBackend();
    const { handles, session, lobby, writer, manager } = await hostRich(b);
    manager.stop();
    const acknowledged = structuredClone(store().game!);

    // Device B legitimately takes over once A's lease has lapsed.
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + LEASE_MS + 1);
    useStorytellerStore.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
    const takeover = new SessionWriter(b, code, session.id);
    disposals.push(() => takeover.dispose());
    const recovered = await startStorytellerSession(b, lobby, takeover);
    disposals.push(() => recovered.stop());
    expect(recovered.outcome).toBe("live");
    expect(store().game).toEqual(acknowledged);
    expectCoherent(store().game!);
    await waitFor(() => expect(store().sync?.ackedGameSeq).toBe(store().localSeq));
    const checkpointBefore = await b.get(`${root}/checkpoint`);
    expect(JSON.parse(checkpointBefore as string).game).toEqual(acknowledged);

    // Stale writer A now tries to project a game with an extra death.
    const staleGame: StorytellerLobbyRecord = {
      ...acknowledged,
      players: { ...acknowledged.players, [handles.washerwomanId]: { ...acknowledged.players[handles.washerwomanId]!, alive: false } },
    };
    await expect(writeProjections({ backend: writer, code, stState: staleGame, registry: buildRegistry(troubleBrewing), online: {} }))
      .rejects.toThrow();
    expect(await b.get(`${root}/checkpoint`)).toBe(checkpointBefore);
    expect(store().game!.players[handles.washerwomanId]!.alive).toBe(true);
  });
});
