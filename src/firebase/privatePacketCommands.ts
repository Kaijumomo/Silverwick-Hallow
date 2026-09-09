import { useStorytellerStore, selectScriptById } from "@/stores/storytellerStore";
import { previewPrivatePacket } from "@/stores/privatePackets";
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
      const registry = buildRegistry(script);
      const current = previewPrivatePacket(player, game, registry);
      if (current.fingerprint !== preview.fingerprint) {
        throw new Error("The information changed after preview. Review it again.");
      }
      const roster = await readRosterBindings(inner, lobby.code);
      if (!Object.values(roster).includes(playerId)) throw new Error("Seat this player in the online lobby before sending.");
      // Validate again after the network read, before submitting the snapshot.
      const latest = useStorytellerStore.getState();
      const latestPlayer = latest.game?.players[playerId];
      if (latest.game !== game || !latestPlayer || latest.lobby?.sessionId !== lobby.sessionId) {
        throw new Error("The game changed while preparing delivery. Review and send again.");
      }
      const publishedPacket = { id: crypto.randomUUID(), payload: current.payload, forDay: game.day, forPhase: game.phase };
      const arrivalPatch = current.payload.demon ? { travelerArrival: {
        ...(player.travelerArrival ?? newTravelerArrival()), demonInfoComplete: true,
      } } : {};
      const snapshot = { ...game, players: { ...game.players, [playerId]: { ...player, ...arrivalPatch, publishedPacket } } };
      await writeProjections({ backend: inner, code: lobby.code, stState: snapshot, registry,
        online: useSessionRuntime.getState().online, membership: roster });
      // Preserve draft edits made while the network was in flight. Never restore
      // an old occupant or identity. The next normal flush reconciles any change.
      const after = useStorytellerStore.getState();
      const remaining = after.game?.players[playerId];
      if (after.lobby?.sessionId !== lobby.sessionId || !remaining || remaining.isEmpty
        || remaining.packetEpoch !== player.packetEpoch) {
        throw new Error("Identity changed during delivery. Reconnect to verify the latest information.");
      }
      useStorytellerStore.setState({
        game: { ...after.game!, players: { ...after.game!.players, [playerId]: { ...remaining, publishedPacket,
          ...(current.payload.demon ? { travelerArrival: { ...(remaining.travelerArrival ?? newTravelerArrival()), demonInfoComplete: true } } : {}),
        } } },
        // An undo snapshot must not roll back publication metadata.
        undoStack: [],
      });
    });
  } finally {
    usePacketDeliveryState.setState(s => ({ queued: { ...s.queued, [key]: false } }));
  }
}
