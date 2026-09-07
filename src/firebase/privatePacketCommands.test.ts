import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePlayerStore } from "@/stores/playerStore";
import { MemoryRoomBackend } from "./memoryBackend";
import { createLobby, knockOnLobby, seatPlayer } from "./lobby";
import { requireActiveSession } from "./lifecycle";
import { SessionWriter } from "./writer";
import { startStorytellerSession, useSessionRuntime } from "./storytellerSync";
import { startPlayerHandshake } from "./playerSync";
import { publishPrivatePacket } from "./privatePacketCommands";
import { packetKey, usePacketDeliveryState } from "./packetDeliveryState";
import { revokePlayerAndCommit } from "./membershipCommands";

const code = "BCDF2345";
const root = `lobbies/${code}`;
const disposals: (() => void | Promise<void>)[] = [];
beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [] });
  usePlayerStore.getState().reset();
  useSessionRuntime.setState({ backend: null, online: {}, error: null });
  usePacketDeliveryState.setState({ receipts: {}, queued: {} });
});
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose(); });

async function setup(managed = false) {
  const b = new MemoryRoomBackend();
  await createLobby(b, "host", { codeGenerator: () => code });
  const session = await requireActiveSession(b, code);
  store.getState().newGame("tb");
  store.getState().addPlayer("Alice");
  store.getState().addPlayer("Bob");
  const [id, other] = store.getState().game!.seatOrder as [string, string];
  const lobby = { code, uid: "host", sessionId: session.id, status: "live" as const };
  store.getState().setLobby(lobby);
  store.getState().assignRole(id, "lunatic");
  store.getState().setShownRole(id, "imp");
  store.getState().setFakeMinions(id, [other]);
  store.getState().setBluffs(id, ["chef", "saint", "washerwoman"]);
  store.getState().setPrivateText(id, "First information");
  const writer = new SessionWriter(b, code, session.id);
  const manager = managed ? await startStorytellerSession(b, lobby, writer) : null;
  if (!managed) await writer.start();
  disposals.push(async () => { manager?.stop(); await writer.dispose(); });
  useSessionRuntime.setState({ backend: writer });
  await knockOnLobby(b, code, "alice", "Alice");
  await seatPlayer(writer, code, "alice", id, null);
  store.getState().previewPrivateInfo(id);
  return { b, id, other, writer, manager, session, lobby, p: () => store.getState().game!.players[id]! };
}

describe("explicit publication through the session writer", () => {
  it("requires preview and authorized seating; rejects stale previews without writing", async () => {
    const { b, id, writer, p } = await setup();
    store.getState().setPrivateText(id, "Edited after preview");
    await expect(publishPrivatePacket(id, writer)).rejects.toThrow(/changed after preview/);
    expect(p().publishedPacket).toBeUndefined();
    store.getState().previewPrivateInfo(id);
    await writer.set(`${root}/roster/alice`, null);
    await expect(publishPrivatePacket(id, writer)).rejects.toThrow(/Seat this player/);
    expect(await b.get(`${root}/player/${id}`)).toBeUndefined();
  });

  it("does not mark delivered before server ACK, and preserves edits made while queued", async () => {
    const { b, id, writer, p } = await setup();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const update = b.update.bind(b);
    let waiting = false;
    b.update = async values => { waiting = true; await gate; await update(values); };
    const sending = publishPrivatePacket(id, writer);
    await waitFor(() => expect(waiting).toBe(true));
    const key = packetKey(code, id);
    expect(usePacketDeliveryState.getState().queued[key]).toBe(true);
    expect(usePacketDeliveryState.getState().receipts[key]).toBeUndefined();
    expect(p().publishedPacket).toBeUndefined();
    await expect(publishPrivatePacket(id, writer)).rejects.toThrow(/already queued/);
    store.getState().setPrivateText(id, "Next draft");
    release();
    await sending;
    expect(p().privateInfo!.extraText).toBe("Next draft");
    expect(p().publishedPacket!.payload.extraText).toBe("First information");
    expect(await b.get(`${root}/player/${id}`)).toEqual(p().publishedPacket!.payload);
    expect(usePacketDeliveryState.getState().receipts[key]).toBe(p().publishedPacket!.id);
    expect(usePacketDeliveryState.getState().queued[key]).toBe(false);
  });

  it.each(["before write", "lost response"])("retry after %s keeps one packet and one acknowledged revision", async failure => {
    const { b, id, writer, p } = await setup();
    const update = b.update.bind(b);
    const payloads: unknown[] = [];
    let calls = 0;
    b.update = async values => {
      calls++;
      payloads.push(values[`${root}/player/${id}`]);
      if (calls === 1 && failure === "before write") throw new Error("network offline");
      await update(values);
      if (calls === 1) throw new Error("network response lost");
    };
    await publishPrivatePacket(id, writer);
    expect(calls).toBe(failure === "before write" ? 2 : 1);
    for (const payload of payloads) expect(payload).toEqual(p().publishedPacket!.payload);
    expect(await b.get(`${root}/player/${id}`)).toEqual(p().publishedPacket!.payload);
    expect(usePacketDeliveryState.getState().receipts[packetKey(code, id)]).toBe(p().publishedPacket!.id);
  });

  it("failed publication never marks the local draft published", async () => {
    const { b, id, writer, p } = await setup();
    b.update = async () => { throw new Error("PERMISSION_DENIED"); };
    await expect(publishPrivatePacket(id, writer)).rejects.toThrow("PERMISSION_DENIED");
    expect(p().publishedPacket).toBeUndefined();
    expect(usePacketDeliveryState.getState().receipts[packetKey(code, id)]).toBeUndefined();
    expect(usePacketDeliveryState.getState().queued[packetKey(code, id)]).toBe(false);
  });

  it("player refresh and host takeover preserve published payload, not a newer unsent draft", async () => {
    const { b, id, writer, manager, session, lobby, p } = await setup(true);
    const listen = () => {
      usePlayerStore.getState().setSession({ code, uid: "alice", requestedName: "Alice" });
      const stop = startPlayerHandshake(b, code, "alice");
      disposals.push(stop);
      return stop;
    };
    const off = listen();
    await publishPrivatePacket(id, writer);
    const published = p().publishedPacket!;
    await waitFor(() => expect(usePlayerStore.getState().self).toEqual(published.payload));
    store.getState().setPrivateText(id, "Unpublished second packet");
    store.getState().setView("home");
    await waitFor(async () => expect(await b.get(`${root}/storyteller/players/${id}/privateInfo/extraText`)).toBe("Unpublished second packet"));
    off(); usePlayerStore.getState().reset(); listen();
    await waitFor(() => expect(usePlayerStore.getState().self).toEqual(published.payload));
    manager!.stop(); await writer.dispose();
    usePacketDeliveryState.setState({ receipts: {} });
    const replacement = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });
    expect(p().publishedPacket).toEqual(published);
    expect(p().privateInfo!.extraText).toBe("Unpublished second packet");
    expect(await b.get(`${root}/player/${id}`)).toEqual(published.payload);
    expect(usePacketDeliveryState.getState().receipts[packetKey(code, id)]).toBe(published.id);
    await revokePlayerAndCommit(replacement, code, id, () => store.getState().unseatPlayer(id));
    await waitFor(() => expect(usePlayerStore.getState().self).toBeNull());
    expect(await b.get(`${root}/player/${id}`)).toBeUndefined();
    expect(p().publishedPacket).toBeUndefined();
  });

  it("host reconnect never publishes a configured-only preview", async () => {
    const { b, id, writer, manager, session, lobby, p } = await setup(true);
    await waitFor(async () => expect(await b.get(`${root}/storyteller/players/${id}/packetPreview`)).toBeDefined());
    manager!.stop(); await writer.dispose();
    const replacement = new SessionWriter(b, code, session.id);
    const recovered = await startStorytellerSession(b, lobby, replacement);
    disposals.push(async () => { recovered.stop(); await replacement.dispose(); });
    expect(p().packetPreview).toBeDefined();
    expect(p().publishedPacket).toBeUndefined();
    expect(await b.get(`${root}/player/${id}`)).toEqual({ shownRole: "imp", shownAlignment: "evil" });
  });

  it("identity changes during delivery never restore the old packet into the new perception", async () => {
    const { b, id, writer, p } = await setup(true);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const update = b.update.bind(b);
    let waiting = false;
    b.update = async values => {
      if (values[`${root}/player/${id}`] && !waiting) { waiting = true; await gate; }
      await update(values);
    };
    const sending = publishPrivatePacket(id, writer);
    const rejected = expect(sending).rejects.toThrow(/Identity changed during publication/);
    await waitFor(() => expect(waiting).toBe(true));
    store.getState().setShownRole(id, "chef");
    release();
    await rejected;
    expect(p().shownRole).toBe("chef");
    expect(p().publishedPacket).toBeUndefined();
    await waitFor(async () => expect(await b.get(`${root}/player/${id}`)).toEqual({ shownRole: "chef", shownAlignment: "good" }));
    expect(usePacketDeliveryState.getState().receipts[packetKey(code, id)]).toBeUndefined();
  });
});
