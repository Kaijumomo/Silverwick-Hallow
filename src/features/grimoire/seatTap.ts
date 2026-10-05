import { pickSeatIfPicking } from "@/features/abilities/abilityUi";
import { useShellStore, type LitActor } from "@/stores/shellStore";
import { useStorytellerStore } from "@/stores/storytellerStore";
import type { PlayerId, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10H (§§6.4, 8.1; V3, I2): the lit seat is the current Night step's
 * actor -- Night only, never under Privacy Mode, and only while that
 * participation instance still occupies the seat.
 */
export function litActorIdOf(game: StorytellerLobbyRecord, privacyMode: boolean, litActor: LitActor | null): PlayerId | null {
  if (game.phase !== "night" || privacyMode || !litActor) return null;
  return game.players[litActor.playerId]?.participantId === litActor.participantId ? litActor.playerId : null;
}

/**
 * ONE seat-tap semantics shared by the Table and the Roster (10H-AC-017): a
 * target pick while a picker is active (refused when ineligible); the acting
 * seat opens or resumes the current Night action; otherwise inspection.
 * Inspecting never changes the actor (10H-AC-015).
 */
export function tapSeat(game: StorytellerLobbyRecord, id: PlayerId, litActorId: PlayerId | null): void {
  if (pickSeatIfPicking(game, id)) return;
  if (id === litActorId) { useShellStore.getState().requestAction(); return; }
  useStorytellerStore.getState().selectPlayer(id);
}
