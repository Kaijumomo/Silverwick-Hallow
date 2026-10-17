import { computeArrivals } from "./arrivals";
import { useStorytellerStore, selectScriptById, checkPlannedGame } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { appendPlayerInfoEntry, contentOfPayload, isDuplicateDelivery, newPlayerInfoEntry } from "@/stores/playerInfoLog";
import { decodeRosterParticipant } from "./snapshots";
import { rosterParticipantPath } from "./paths";
import { previewPrivatePacket } from "@/stores/privatePackets";
import { projectLobbyToSelfMap } from "@/stores/projections";
import { buildRegistry } from "@/data/roleRegistry";
import { readRosterBindings } from "./lobby";
import { writeProjections } from "./sync";
import { useSessionRuntime } from "./storytellerSync";
import { packetKey, usePacketDeliveryState } from "./packetDeliveryState";
import type { SessionWriter } from "./writer";
import { newTravelerArrival } from "@/stores/travelers";

/** An explicit, serialized publication. ACK precedes the local publication mark. */
export async function publishPrivatePacket(playerId: string, preview: ReturnType<typeof previewPrivatePacket>, writer: SessionWriter | null = useSessionRuntime.getState().backend) {
  const initial = useStorytellerStore.getState();
  const lobby = initial.lobby;
  if (!lobby || !writer || writer.code !== lobby.code || writer.sessionId !== lobby.sessionId) {
    throw new Error("Connect to the active lobby before sending.");
  }
  const key = packetKey(lobby.code, playerId);
  if (usePacketDeliveryState.getState().queued[key]) throw new Error("This information is already queued.");
  usePacketDeliveryState.setState(s => ({ queued: { ...s.queued, [key]: true } }));
  try {
    await writer.runExclusive(async inner => {
      const state = useStorytellerStore.getState();
      const game = state.game;
      const player = game?.players[playerId];
      const script = game && selectScriptById(state, game.scriptId);
      if (!game || !player || !script || state.lobby?.sessionId !== lobby.sessionId || state.lobby?.code !== lobby.code) {
        throw new Error("The session or player changed. Review the information again.");
      }
      // Package 3 (C10): delivered information is part of the record, so it is
      // never sent once the game has ended, while an ending is in flight, or
      // while the Storyteller has the screen in Privacy Mode.
      const closing = state.terminalClose?.status === "closing" || state.terminalClose?.confirmedRecovery || state.terminalClose?.recoveryPending;
      if (game.phase === "ended" || closing) throw new Error("This game is ending. Information can no longer be sent.");
      if (usePrivacyStore.getState().enabled) throw new Error("Leave Privacy Mode to send information.");
      const registry = buildRegistry(script);
      const current = previewPrivatePacket(player, game, registry);
      if (current.fingerprint !== preview.fingerprint) {
        throw new Error("The information changed after preview. Review it again.");
      }
      const content = contentOfPayload(current.payload);
      if (isDuplicateDelivery(game, player, content)) throw new Error("This exact information was already sent.");
      const roster = await readRosterBindings(inner, lobby.code);
      const rosterUid = Object.entries(roster).find(([, boundPlayerId]) => boundPlayerId === playerId)?.[0];
      if (!rosterUid) throw new Error("Seat this player in the online lobby before sending.");
      // The history belongs to a participation, not a seat: prove that the
      // seated uid is the participation this game records at the seat.
      const membership = decodeRosterParticipant(await inner.get(rosterParticipantPath(lobby.code, rosterUid)));
      if (membership.status !== "ready" || membership.data.playerId !== playerId || membership.data.participantId !== player.participantId) {
        throw new Error("This seat's membership does not match the game. Reconnect, then send again.");
      }
      // Validate again after the network read, before submitting the snapshot.
      const latest = useStorytellerStore.getState();
      const latestPlayer = latest.game?.players[playerId];
      if (latest.game !== game || !latestPlayer || latest.lobby?.sessionId !== lobby.sessionId) {
        throw new Error("The game changed while preparing delivery. Review and send again.");
      }
      const publishedPacket = { id: crypto.randomUUID(), payload: current.payload, forDay: game.day, forPhase: game.phase };
      const arrivalPatch = current.payload.demon && player.isTraveler ? { travelerArrival: {
        ...(player.travelerArrival ?? newTravelerArrival()), demonInfoComplete: true,
      } } : {};
      const entry = newPlayerInfoEntry(game, playerId, publishedPacket.id, current.payload, crypto.randomUUID());
      if (!entry) throw new Error("This seat has no participant to send to. Review the seat and try again.");
      const withPacket = { ...game, players: { ...game.players, [playerId]: { ...player, ...arrivalPatch, publishedPacket } } };
      const appended = appendPlayerInfoEntry(withPacket, entry);
      if (!appended.ok) throw new Error(appended.message);
      const snapshot = appended.game;
      // Validate and size-check the exact game before any network write.
      const unsafe = checkPlannedGame(snapshot, game, state.lobby);
      if (unsafe) throw new Error(unsafe);
      // Phase 9C.4 (OPUS-004): reuse the exact projection that governs
      // publication. If the 9C.4 setup barrier is withholding this target
      // (an occupied ordinary seat while another ordinary seat's perception
      // remains unconfigured), writeProjections would silently write no
      // private record for them — this must never resolve as a delivered
      // packet.
      if (!projectLobbyToSelfMap(snapshot, registry)[playerId]) {
        throw new Error("Set the identity every player will see before sending information.");
      }
      await writeProjections({ backend: inner, code: lobby.code, stState: snapshot, registry,
        online: useSessionRuntime.getState().online,
        // Package 3 (A1): keep the waiting list on the public node this write replaces.
        arrivals: computeArrivals(snapshot, useSessionRuntime.getState().joined, {}), membership: roster });
      // Preserve draft edits made while the network was in flight. Never restore
      // an old occupant or identity. The next normal flush reconciles any change.
      const after = useStorytellerStore.getState();
      const remaining = after.game?.players[playerId];
      const afterClosing = after.terminalClose?.status === "closing" || after.terminalClose?.confirmedRecovery || after.terminalClose?.recoveryPending;
      if (after.lobby?.sessionId !== lobby.sessionId || !after.game || after.game.phase === "ended" || afterClosing || !remaining || remaining.isEmpty
        || remaining.packetEpoch !== player.packetEpoch || remaining.participantId !== player.participantId) {
        throw new Error("Identity changed during delivery. Reconnect to verify the latest information.");
      }
      // The entry joins the LATEST local game, so a correction made while the
      // write was in flight is never overwritten.
      const committed = appendPlayerInfoEntry({ ...after.game, players: { ...after.game.players, [playerId]: { ...remaining, publishedPacket,
        ...(current.payload.demon && remaining.isTraveler ? { travelerArrival: { ...(remaining.travelerArrival ?? newTravelerArrival()), demonInfoComplete: true } } : {}),
      } } }, entry);
      if (!committed.ok) throw new Error(committed.message);
      useStorytellerStore.setState({
        game: committed.game,
        // An undo snapshot must not roll back publication metadata.
        undoStack: [],
      });
    });
  } finally {
    usePacketDeliveryState.setState(s => ({ queued: { ...s.queued, [key]: false } }));
  }
}
