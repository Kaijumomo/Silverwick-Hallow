import type { LitActor } from "@/stores/shellStore";
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
