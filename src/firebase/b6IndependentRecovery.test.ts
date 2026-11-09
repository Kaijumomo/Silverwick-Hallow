import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { bind, openInStore, proofGame } from "@/test/proofFixtures";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { captureCharacterActionContext, useStorytellerStore as store } from "@/stores/storytellerStore";
import { preparedInformationContext } from "@/stores/preparedInformation";
import { usePrivacyStore } from "@/stores/privacyStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { LEASE_MS, SessionWriter } from "./writer";
import { resolveReconnectConflict, startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { writeProjections } from "./sync";
import { buildRegistry } from "@/data/roleRegistry";
import { SnapshotValidationError } from "./snapshots";

const code = "B6RV2345";
const path = `lobbies/${code}`;
const game = () => store.getState().game!;
const disposals: (() => void | Promise<void>)[] = [];
beforeEach(() => {
  localStorage.clear(); store.setState({ game: null, lobby: null, undoStack: [], localSeq: 0, sync: null, customScripts: {}, terminalClose: null, finishedGameUndo: null, canUndoFinishedGame: false });
  usePlayerStore.getState().reset(); usePrivacyStore.getState().reset();
  useSessionRuntime.setState({ backend: null, errors: {}, error: null, presence: "unknown", online: {}, pending: 0, reconnect: { status: "live" } });
});
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function host(b: MemoryRoomBackend) {
  await createLobby(b, "host", { codeGenerator: () => code }); const session = await requireActiveSession(b, code);
  const g = proofGame(["washerwoman", "chef", "empath", "imp", "poisoner"], "night", 1, { phase: "setup", day: 0, scriptId: troubleBrewing.id });
  openInStore({ ...g, players: Object.fromEntries(Object.entries(g.players).map(([id, player]) => [id, { ...player, packetEpoch: "epoch-" + id }])) });
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const }; store.getState().setLobby(lobby);
  const writer = new SessionWriter(b, code, session.id); const manager = await startStorytellerSession(b, lobby, writer);
  disposals.push(async () => { manager.stop(); await writer.dispose(); });
  await waitFor(() => expect(store.getState().sync?.ackedGameSeq).toBe(store.getState().localSeq));
  expect(store.getState().prepareInformation({ character: "washerwoman", source: bind(game(), "p0"), expected: preparedInformationContext(game(), troubleBrewing),
    clue: { kind: "pair", candidates: [bind(game(), "p1"), bind(game(), "p2")], shownCharacter: "chef", qualifyingParticipantId: game().players.p1!.participantId! },
  }, captureCharacterActionContext())).toMatchObject({ ok: true });
  await waitFor(() => expect(store.getState().sync?.ackedGameSeq).toBe(store.getState().localSeq));
  return { lobby, session, writer, manager };
}

describe("B6 independent checkpoint and writer recovery", () => {
  it("acknowledged pending preparation recovers exactly without becoming delivered or leaking to players", async () => {
    const b = new MemoryRoomBackend(); const { lobby, session, manager, writer } = await host(b); const acknowledged = structuredClone(game());
    const checkpoint = JSON.parse(await b.get(`${path}/checkpoint`) as string);
    expect(checkpoint.game.preparedInformation).toEqual(acknowledged.preparedInformation);
    expect(JSON.stringify([await b.get(`${path}/public`), await b.get(`${path}/player`)])).not.toMatch(/preparedInformation|qualifyingParticipantId|sourceIdentityEpoch/);
    manager.stop(); await writer.dispose(); store.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
    const recoveredWriter = new SessionWriter(b, code, session.id); disposals.push(() => recoveredWriter.dispose());
    const recovery = await startStorytellerSession(b, lobby, recoveredWriter); disposals.push(() => recovery.stop());
    expect(recovery.outcome).toBe("live"); expect(game()).toEqual(acknowledged); expect(game().informationDeliveries).toEqual([]);
    store.setState({ game: { ...game(), phase: "night", day: 1 } });
    expect(store.getState().deliverPreparedInformation({ preparationId: game().preparedInformation[0]!.id, source: bind(game(), "p0"), expected: preparedInformationContext(game(), troubleBrewing) }, captureCharacterActionContext())).toMatchObject({ ok: true });
    expect(game().informationDeliveries).toHaveLength(1);
  });

  it("malformed v28 checkpoint refuses recovery without adopting any prepared state", async () => {
    const b = new MemoryRoomBackend(); const { lobby, session, manager, writer } = await host(b);
    const checkpoint = JSON.parse(await b.get(`${path}/checkpoint`) as string); checkpoint.game.players.p1.reminders = [];
    manager.stop(); await writer.dispose(); await b.set(`${path}/checkpoint`, JSON.stringify(checkpoint));
    store.setState({ game: null, undoStack: [], localSeq: 7, sync: null }); const before = b.writeLog.length;
    const recoveryWriter = new SessionWriter(b, code, session.id); disposals.push(() => recoveryWriter.dispose());
    await expect(startStorytellerSession(b, lobby, recoveryWriter)).rejects.toThrow(SnapshotValidationError);
    expect(store.getState().game).toBeNull(); expect(store.getState().localSeq).toBe(7);
    expect(b.writeLog.slice(before).filter(entry => /\/(checkpoint|storyteller|public|player)(\/|$)/.test(entry.path))).toEqual([]);
  });

  it("writer takeover retains pending intent; the old writer cannot publish a fabricated delivery", async () => {
    const b = new MemoryRoomBackend(); const { lobby, session, manager, writer } = await host(b); const acknowledged = structuredClone(game()); manager.stop();
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + LEASE_MS + 1); store.setState({ game: null, undoStack: [], localSeq: 0, sync: null });
    const nextWriter = new SessionWriter(b, code, session.id); disposals.push(() => nextWriter.dispose());
    const recovery = await startStorytellerSession(b, lobby, nextWriter); disposals.push(() => recovery.stop());
    expect(recovery.outcome).toBe("live"); expect(game()).toEqual(acknowledged);
    await waitFor(() => expect(store.getState().sync?.ackedGameSeq).toBe(store.getState().localSeq)); const saved = await b.get(`${path}/checkpoint`);
    await expect(writeProjections({ backend: writer, code, stState: { ...acknowledged, preparedInformation: [] }, registry: buildRegistry(troubleBrewing), online: {} })).rejects.toThrow();
    expect(await b.get(`${path}/checkpoint`)).toBe(saved); expect(game().preparedInformation).toHaveLength(1);
  });

  it.each(["keepLocal", "useRemote"] as const)("dirty local versus changed remote preserves both until explicit %s", async choice => {
    const b = new MemoryRoomBackend(); const { lobby, session, manager, writer } = await host(b);
    manager.stop(); await writer.dispose(); store.setState({ lobby: null });
    expect(store.getState().prepareInformation({ character: "washerwoman", source: bind(game(), "p0"), expected: preparedInformationContext(game(), troubleBrewing),
      clue: { kind: "pair", candidates: [bind(game(), "p1"), bind(game(), "p3")], shownCharacter: "chef", qualifyingParticipantId: game().players.p1!.participantId! },
    }, captureCharacterActionContext())).toMatchObject({ ok: true });
    const local = { game: structuredClone(game()), localSeq: store.getState().localSeq, sync: structuredClone(store.getState().sync), undoStack: structuredClone(store.getState().undoStack) };
    store.setState({ game: null, undoStack: [], localSeq: 0, sync: null, lobby });
    const remoteWriter = new SessionWriter(b, code, session.id); disposals.push(() => remoteWriter.dispose());
    const remote = await startStorytellerSession(b, lobby, remoteWriter); disposals.push(() => remote.stop());
    expect(store.getState().prepareInformation({ character: "washerwoman", source: bind(game(), "p0"), expected: preparedInformationContext(game(), troubleBrewing),
      clue: { kind: "pair", candidates: [bind(game(), "p2"), bind(game(), "p4")], shownCharacter: "empath", qualifyingParticipantId: game().players.p2!.participantId! },
    }, captureCharacterActionContext())).toMatchObject({ ok: true });
    await waitFor(() => expect(store.getState().sync?.ackedGameSeq).toBe(store.getState().localSeq)); const remoteGame = structuredClone(game());
    remote.stop(); await remoteWriter.dispose(); store.setState({ ...local, lobby });
    const saved = await b.get(`${path}/checkpoint`); const reconcileWriter = new SessionWriter(b, code, session.id); disposals.push(() => reconcileWriter.dispose());
    const conflict = await startStorytellerSession(b, lobby, reconcileWriter); disposals.push(() => conflict.stop());
    expect(conflict.outcome).toBe("conflict"); expect(game()).toEqual(local.game); expect(await b.get(`${path}/checkpoint`)).toBe(saved);
    expect(await resolveReconnectConflict(choice)).toBe("applied");
    expect(game().preparedInformation).toEqual((choice === "keepLocal" ? local.game : remoteGame).preparedInformation);
    expect(game().informationDeliveries).toEqual([]);
  });
});
