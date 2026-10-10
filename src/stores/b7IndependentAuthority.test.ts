import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { bind, openInStore, patchPlayer, proofGame, proofRegistry, proofScript } from "@/test/proofFixtures";
import { captureCharacterActionContext, useStorytellerStore as store } from "./storytellerStore";
import { butlerSelectionContext } from "./butlerSelection";
import { preparedInformationContext } from "./preparedInformation";
import { usePrivacyStore } from "./privacyStore";
import { projectLobbyToPublic, projectLobbyToSelfMap } from "./projections";
import { useSessionRuntime, startStorytellerSession } from "@/firebase/storytellerSync";
import { MemoryRoomBackend } from "@/firebase/memoryBackend";
import { SessionWriter } from "@/firebase/writer";
import { createLobby } from "@/firebase/lobby";
import { requireActiveSession } from "@/firebase/lifecycle";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";

const state = () => store.getState();
const game = () => state().game!;
const disposals: (() => void | Promise<void>)[] = [];
const base = () => {
  const g = proofGame(["butler", "washerwoman", "chef", "poisoner", "imp"], "night", 1);
  return { ...g, players: Object.fromEntries(Object.entries(g.players).map(([id, player]) => [id, { ...player, packetEpoch: "epoch-" + id }])) };
};
const request = (target = "p2") => ({ source: bind(game(), "p0"), target: bind(game(), target), expected: butlerSelectionContext(game(), game().scriptId === troubleBrewing.id ? troubleBrewing : proofScript, bind(game(), "p0")) });
const select = (target = "p2") => state().selectButlerMaster(request(target), captureCharacterActionContext());
beforeEach(() => {
  localStorage.clear(); store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false });
  usePrivacyStore.getState().reset(); useSessionRuntime.setState({ backend: null, status: "idle", reconnect: { status: "live" }, error: null, errors: {} }); openInStore(base());
});
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of disposals.splice(0).reverse()) await dispose(); });

describe("B7 independent command, privacy and recovery challenge", () => {
  it("one accepted Master change writes before publishing and Undo restores the full previous selection", () => {
    expect(select()).toMatchObject({ ok: true }); const before = game(); const undo = state().undoStack.length; const seq = state().localSeq;
    const writes = vi.spyOn(Storage.prototype, "setItem"); let publications = 0;
    const stop = store.subscribe(s => { publications++; expect(JSON.parse(localStorage.getItem("new-blood-st")!).state.game).toEqual(s.game); });
    try { expect(select("p3")).toMatchObject({ ok: true }); } finally { stop(); }
    expect(publications).toBe(1); expect(writes).toHaveBeenCalledTimes(1); expect(state().localSeq).toBe(seq + 1); expect(state().undoStack).toHaveLength(undo + 1);
    expect(game().phase).toBe("night"); expect(game().players.p2!.reminders).toEqual([]); expect(game().players.p3!.reminders).toHaveLength(1);
    state().undo(); expect(game()).toEqual(before);
  });

  it("unrelated v28 preparation survives selecting, removing and Undoing Master notation", () => {
    expect(state().prepareInformation({ character: "washerwoman", source: bind(game(), "p1"), expected: preparedInformationContext(game(), proofScript),
      clue: { kind: "pair", candidates: [bind(game(), "p2"), bind(game(), "p3")], shownCharacter: "chef", qualifyingParticipantId: game().players.p2!.participantId! },
    }, captureCharacterActionContext())).toMatchObject({ ok: true });
    const pending = game().preparedInformation; const privateBefore = projectLobbyToSelfMap(game(), proofRegistry); const publicBefore = projectLobbyToPublic(game(), {});
    expect(select()).toMatchObject({ ok: true }); expect(game().preparedInformation).toEqual(pending);
    expect(game().informationDeliveries).toEqual([]); expect(projectLobbyToPublic(game(), {})).toEqual(publicBefore); expect(projectLobbyToSelfMap(game(), proofRegistry)).toEqual(privateBefore);
    const token = game().players.p2!.reminders.find(r => r.sourceCharacter === "butler")!;
    expect(state().removeReminder("p2", token.id)).toMatchObject({ ok: true }); expect(game().preparedInformation).toEqual(pending);
    state().undo(); expect(game().preparedInformation).toEqual(pending);
  });

  it.each(["privacy", "storage", "recovery", "writer", "stale"])("%s rejects Master selection without publishing any completion or token", variant => {
    const command = request(); const captured = captureCharacterActionContext();
    if (variant === "privacy") usePrivacyStore.getState().setEnabled(true);
    if (variant === "recovery") store.setState({ terminalClose: { status: "failed", message: "Retry", recoveryPending: true, intent: { kind: "declare", winner: "good" } } });
    if (variant === "writer") store.setState({ lobby: { code: "B7AUDIT1", uid: "host", sessionId: "s", status: "live" }, game: { ...game(), code: "B7AUDIT1", storytellerUid: "host" } });
    if (variant === "stale") state().setNotes("p2", "Changed");
    if (variant === "storage") vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Disk full"); });
    const before = state(); let publications = 0; const stop = store.subscribe(() => publications++);
    try { expect(state().selectButlerMaster(command, captured)).toMatchObject({ ok: false }); } finally { stop(); }
    expect(state()).toBe(before); expect(publications).toBe(0); expect(game().nightProgress).toEqual({});
  });

  it("aggregate checkpoint limit refuses Master change before storage/publication", () => {
    const writes = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {});
    store.setState({ game: patchPlayer({ ...game(), notes: "x".repeat(5_300_000) }, "p4", { stNotes: "y".repeat(5_300_000) }) }); writes.mockClear();
    const before = state(); const result = select(); expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.message).toMatch(/checkpoint/); expect(state()).toBe(before); expect(writes).not.toHaveBeenCalled();
  });

  it("selection round-trips through local persistence with exact source identity", async () => {
    expect(select()).toMatchObject({ ok: true }); const saved = localStorage.getItem("new-blood-st")!; const expected = game();
    store.setState({ game: null, undoStack: [] }); localStorage.setItem("new-blood-st", saved); await store.persist.rehydrate(); expect(game()).toEqual(expected);
    expect(JSON.stringify([projectLobbyToPublic(game(), {}), projectLobbyToSelfMap(game(), proofRegistry)])).not.toMatch(/butler-master|Master|sourceParticipant/);
  });

  it("acknowledged Master and v28 state recover from a fresh host without player leakage", async () => {
    const backend = new MemoryRoomBackend(); const code = "B7AUDIT2"; await createLobby(backend, "host", { codeGenerator: () => code }); const session = await requireActiveSession(backend, code);
    store.setState({ game: { ...game(), scriptId: troubleBrewing.id }, customScripts: {} });
    const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const }; state().setLobby(lobby);
    const writer = new SessionWriter(backend, code, session.id); const manager = await startStorytellerSession(backend, lobby, writer); disposals.push(async () => { manager.stop(); await writer.dispose(); });
    await waitFor(() => expect(state().sync?.ackedGameSeq).toBe(state().localSeq)); expect(select()).toMatchObject({ ok: true });
    await waitFor(() => expect(state().sync?.ackedGameSeq).toBe(state().localSeq)); const acknowledged = structuredClone(game());
    expect(JSON.stringify([await backend.get(`lobbies/${code}/public`), await backend.get(`lobbies/${code}/player`)])).not.toMatch(/butler-master|Master|sourceParticipant/);
    manager.stop(); await writer.dispose(); store.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
    const restoredWriter = new SessionWriter(backend, code, session.id); disposals.push(() => restoredWriter.dispose());
    const recovery = await startStorytellerSession(backend, lobby, restoredWriter); disposals.push(() => recovery.stop());
    expect(recovery.outcome).toBe("live"); expect(game()).toEqual(acknowledged); expect(game().gameSchemaVersion).toBe(28);
  });

  it("same-session writer replacement fences a retained Master action", async () => {
    const backend = new MemoryRoomBackend(); const code = "B7AUDIT3"; await createLobby(backend, "host", { codeGenerator: () => code }); const session = await requireActiveSession(backend, code);
    const writer = new SessionWriter(backend, code, session.id); disposals.push(() => writer.dispose()); await writer.start();
    store.setState({ game: { ...game(), code, storytellerUid: "host" }, lobby: { code, uid: "host", sessionId: session.id, status: "live" } });
    useSessionRuntime.setState({ backend: writer, status: "live" }); const captured = captureCharacterActionContext(); const command = request();
    await writer.dispose(); const next = new SessionWriter(backend, code, session.id); disposals.push(() => next.dispose()); await next.start();
    useSessionRuntime.setState({ backend: next, status: "live" }); const before = state();
    expect(state().selectButlerMaster(command, captured)).toMatchObject({ ok: false }); expect(state()).toBe(before);
  });
});
