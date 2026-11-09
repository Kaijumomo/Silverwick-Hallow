import { useStorytellerStore, type LobbyConnection } from "@/stores/storytellerStore";
import { changeAlignmentIntent } from "@/stores/alignmentResolution";
import type { MutationContext } from "@/stores/history";
import type { Alignment, EffectId, ExileOutcome, GrimoireMode, PlayerId, ReminderId, ShownAlignment, STPlayerRecord, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Test conveniences that used to be store commands no screen calls (streamlining review F-04). Each is the
 * same thin adapter it was in the store: it binds the seat's current occupant and goes through the
 * authoritative intent command (resolveLife, resolveEffects, resolveReminders, resolveAlignments,
 * setPerception), so a test exercises exactly the production path. Layout and lobby setters write the
 * local UI fields directly, as before.
 */
const s = () => useStorytellerStore.getState();

const occupant = (game: StorytellerLobbyRecord | null, id: PlayerId): STPlayerRecord | undefined => {
  const player = game && typeof id === "string" && Object.prototype.hasOwnProperty.call(game.players, id) ? game.players[id] : undefined;
  return player && !player.isEmpty && player.participantId ? player : undefined;
};
const binding = (id: PlayerId) => {
  const player = occupant(s().game, id);
  return player ? { playerId: player.id, participantId: player.participantId! } : null;
};
const notSeated = { ok: false as const, code: "notSeated" as const, message: "This player is not seated." };

export const storeCommands = {
  recordExile: (id: PlayerId, outcome: ExileOutcome, context?: MutationContext) =>
    s().resolveLife({ intents: [{ kind: "exile", playerId: id, outcome }], context }),

  setGhostVote: (id: PlayerId, ghostVote: boolean, context?: MutationContext): void => {
    if (ghostVote) s().restoreGhostVote(id, context);
    else s().spendGhostVote(id, context);
  },

  /** true -> the gameplay useAbility intent; false -> a correction; the current value is a no-op. */
  setAbilityUsed: (id: PlayerId, abilityUsed: boolean, context?: MutationContext) => {
    const game = s().game;
    const existing = game && Object.prototype.hasOwnProperty.call(game.players, id) ? game.players[id] : undefined;
    if (!game || !existing || existing.isEmpty) return { ok: false as const, code: "refused" as const, message: "That seat has no player." };
    if (existing.abilityUsed === abilityUsed) return { ok: true as const, changed: false, eventIds: [] as string[] };
    return s().resolveLife({
      intents: [abilityUsed ? { kind: "useAbility", playerId: id } : { kind: "correctAbilityUsed", playerId: id, used: false }],
      ...(context ? { context } : {}),
    });
  },

  removeEffect: (id: PlayerId, effectId: EffectId): void => {
    const target = binding(id);
    if (!target) return;
    s().resolveEffects({ intents: [{ kind: "remove", target, effectId }] });
  },

  removeReminder: (id: PlayerId, reminderId: ReminderId) => {
    const target = binding(id);
    if (!target) return notSeated;
    return s().resolveReminders({ intents: [{ kind: "remove", target, reminderId }] });
  },

  setActualAlignment: (id: PlayerId, alignment: Alignment, context?: MutationContext) => {
    const player = occupant(s().game, id);
    if (!player) return notSeated;
    return s().resolveAlignments({ intents: [changeAlignmentIntent(player, alignment)], ...(context ? { context } : {}) });
  },

  setShownAlignment: (id: PlayerId, alignment: ShownAlignment | null) => {
    const player = occupant(s().game, id);
    if (!player) return notSeated;
    return s().setPerception(id, { shownRole: player.shownRole, shownAlignment: alignment });
  },

  setGrimoireMode: (grimoireMode: GrimoireMode): void => useStorytellerStore.setState({ grimoireMode }),
  setTokenPosition: (id: PlayerId, x: number, y: number): void =>
    useStorytellerStore.setState((st) => ({ tokenPositions: { ...st.tokenPositions, [id]: { x, y } } })),
  clearTokenPositions: (): void => useStorytellerStore.setState({ tokenPositions: {} }),
  setLobbyStatus: (status: LobbyConnection["status"]): void => {
    const { lobby } = s();
    if (lobby) useStorytellerStore.setState({ lobby: { ...lobby, status } });
  },
};
