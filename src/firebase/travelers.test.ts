import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby, knockOnLobby, seatPlayer } from "./lobby";
import { SessionWriter } from "./writer";
import { requireActiveSession } from "./lifecycle";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { startPlayerHandshake } from "./playerSync";
import { previewPrivatePacket } from "@/stores/privatePackets";
import { buildRegistry } from "@/data/roleRegistry";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { publishPrivatePacket } from "./privatePacketCommands";
import { usePacketDeliveryState } from "./packetDeliveryState";
import { revokePlayerAndCommit } from "./membershipCommands";
import { StorytellerGamePersistedSchema } from "@/stores/schemas";

const code = "BCDF2345", root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [] });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, online: {}, error: null });
  usePacketDeliveryState.setState({ receipts: {}, queued: {} });
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });
async function setup() {
  const b = new MemoryRoomBackend();
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  store.getState().newGame("tb"); store.getState().addPlayer("Traveler"); store.getState().addPlayer("Demon");
  const [id, other] = store.getState().game!.seatOrder as [string, string];
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  store.getState().setLobby(lobby);
  store.getState().setIsTraveler(id, true); store.getState().assignRole(id, "thief");
  store.getState().setTravelerAlignment(id, "evil"); store.getState().assignRole(other, "imp");
  const writer = new SessionWriter(b, code, session.id);
  const manager = await startStorytellerSession(b, lobby, writer);
  disposals.push(async () => { manager.stop(); await writer.dispose(); });
  useSessionRuntime.setState({ backend: writer });
  await knockOnLobby(b, code, "alice", "Traveler"); await seatPlayer(writer, code, "alice", id, null);
  const p = () => store.getState().game!.players[id]!;
  const review = () => previewPrivatePacket(p(), store.getState().game!, buildRegistry(troubleBrewing));
  store.getState().prepareTravelerDemon(id);
  return { b, id, other, writer, manager, lobby, p, review };
}
describe("Phase 9B membership and private delivery", () => {
  it("an existing ordinary player reconnects during play without becoming a Traveler", async () => {
    const { b, other, writer } = await setup();
    store.getState().showAssignedRole(other);
    store.setState({ game: { ...store.getState().game!, phase: "night", day: 4 } });
    await knockOnLobby(b, code, "bob", "Demon"); await seatPlayer(writer, code, "bob", other, null);
    const before = store.getState().game!.players[other]!;
    usePlayerStore.getState().setSession({ code, uid: "bob", requestedName: "Demon" });
    disposals.push(startPlayerHandshake(b, code, "bob"));
    await waitFor(() => expect(usePlayerStore.getState().self?.shownRole).toBe("imp"));
    expect(store.getState().game!.players[other]).toEqual(before);
    expect(before.isTraveler).toBe(false); expect(before.travelerArrival).toBeUndefined();
    expect(await b.get(`${root}/roster/bob`)).toBe(other);
  });
  it("writer takeover restores acknowledged Traveler truth and completion over stale local state", async () => {
    const { b, id, writer, manager, lobby, review } = await setup();
    await publishPrivatePacket(id, review(), writer);
    manager.stop(); await writer.dispose();
    store.getState().setTravelerAlignment(id, "good");
    const nextWriter = new SessionWriter(b, code, lobby.sessionId);
    const nextManager = await startStorytellerSession(b, lobby, nextWriter);
    disposals.push(async () => { nextManager.stop(); await nextWriter.dispose(); });
    const restored = store.getState().game!.players[id]!;
    expect(restored.actualAlignment).toBe("evil");
    expect(restored.travelerArrival!.demonInfoComplete).toBe(true);
    expect(restored.publishedPacket!.payload.demon).toBeDefined();
    expect(await b.get(`${root}/public/players/${id}/publicDisplayRole`)).toBe("thief");
  });
  it("delivers only to the Traveler and persists ACK completion in the private checkpoint", async () => {
    const { b, id, other, writer, p, review } = await setup();
    await publishPrivatePacket(id, review(), writer);
    expect(await b.get(`${root}/player/${id}`)).toEqual({ shownRole: "thief", demon: { id: other, name: "Demon", seat: 1 } });
    expect(await b.get(`${root}/player/${other}`)).toBeUndefined();
    expect(p().travelerArrival!.demonInfoComplete).toBe(true);
    const checkpoint = JSON.parse(await b.get(`${root}/checkpoint`) as string);
    expect(StorytellerGamePersistedSchema.parse(checkpoint.game).players[id]!.actualAlignment).toBe("evil");
    const pub = await b.get(`${root}/public`);
    expect(JSON.stringify(pub)).not.toMatch(/actualAlignment|travelerArrival|demonInfoComplete/);
  });
  it("retries a lost response with one packet identity", async () => {
    const { b, id, writer, p, review } = await setup();
    const update = b.update.bind(b); const packetIds = new Set<string>(); let failed = false;
    b.update = async values => {
      const raw = values[`${root}/checkpoint`];
      if (typeof raw === "string") {
        const packet = JSON.parse(raw).game.players[id]?.publishedPacket;
        if (packet) packetIds.add(packet.id);
      }
      await update(values);
      if (packetIds.size && !failed) { failed = true; throw Object.assign(new Error("lost response"), { code: "NETWORK_ERROR" }); }
    };
    await publishPrivatePacket(id, review(), writer);
    expect(packetIds.size).toBe(1); expect(p().travelerArrival!.demonInfoComplete).toBe(true);
  });
  it("rejects a queued preview after actual alignment changes", async () => {
    const { id, writer, review, p } = await setup(); const before = review();
    store.getState().setTravelerAlignment(id, "good");
    await expect(publishPrivatePacket(id, before, writer)).rejects.toThrow();
    expect(p().publishedPacket).toBeUndefined();
  });
  it.each(["dead", "exiled"])("%s Traveler keeps membership and reconnects to the same private view", async action => {
    const { b, id, writer, p, review } = await setup(); await publishPrivatePacket(id, review(), writer);
    if (action === "dead") store.getState().setAlive(id, false); else store.getState().exileTraveler(id);
    usePlayerStore.getState().setSession({ code, uid: "alice", requestedName: "Traveler" });
    const reconnect = startPlayerHandshake(b, code, "alice"); disposals.push(reconnect);
    await waitFor(() => expect(usePlayerStore.getState().self?.demon).toBeDefined());
    expect(await b.get(`${root}/roster/alice`)).toBe(id);
    expect(p().isTraveler).toBe(true); expect(p().actualAlignment).toBe("evil");
    expect(usePlayerStore.getState().self).not.toHaveProperty("actualAlignment");
    await waitFor(() => expect(usePlayerStore.getState().publicLobby?.players[id]?.publicDisplayRole).toBe("thief"));
  });
  it("temporary presence loss leaves Traveler truth and population unchanged", async () => {
    const { b, p, id } = await setup(); const before = JSON.stringify(p()); const target = store.getState().game!.plannedPlayerCount;
    await b.set(`${root}/presence/alice`, { online: false, lastSeen: Date.now() });
    await b.set(`${root}/presence/alice`, { online: true, lastSeen: Date.now() });
    expect(JSON.stringify(p())).toBe(before); expect(store.getState().game!.plannedPlayerCount).toBe(target);
    expect(await b.get(`${root}/roster/alice`)).toBe(id);
  });
  it("true departure revokes access and cannot silently restore old membership", async () => {
    const { b, id, writer, review } = await setup(); await publishPrivatePacket(id, review(), writer);
    await revokePlayerAndCommit(writer, code, id, () => store.getState().removePlayer(id));
    expect(await b.get(`${root}/roster/alice`)).toBeUndefined();
    expect(await b.get(`${root}/player/${id}`)).toBeUndefined();
    usePlayerStore.getState().setSession({ code, uid: "alice", requestedName: "Traveler" });
    const reconnect = startPlayerHandshake(b, code, "alice"); disposals.push(reconnect);
    await waitFor(() => expect(usePlayerStore.getState().status).toBe("revoked"));
    expect(store.getState().game!.players[id]).toBeUndefined();
    await waitFor(async () => expect(await b.get(`${root}/public/players/${id}`)).toBeUndefined());
  });
});
