import { PlayerResultRecordSchema } from "@/stores/schemas";
import type { GameResult, PlayerId, StorytellerLobbyRecord } from "@/stores/types";
import type { Json, RoomBackend } from "./backend";
import { resultPath, resultsPath, rosterParticipantsPath, rosterPath } from "./paths";
import { decodeRoster, decodeRosterParticipants, SnapshotValidationError, type RosterParticipantRecord } from "./snapshots";
import type { TerminalPublicationBuilder } from "./writer";

/**
 * Phase 10H (10H-IMPLEMENTATION-CONTRACT-v1.0 §§15-16): the player-safe
 * terminal result and who receives it.
 *
 * results/{uid} carries EXACTLY { version: 1, sessionId, winner, declaredAt }:
 * no Role, Alignment, ParticipantId, Effect, Reminder, History, delivery,
 * Storyteller notes, and no "you won/lost" derivation. It is published only
 * inside the one fenced atomic terminal close, and only for a declared Good or
 * Evil victory -- End Without Result publishes nothing.
 */
export type PlayerResultPayload = {
  version: 1;
  sessionId: string;
  winner: GameResult["winner"];
  declaredAt: GameResult["declaredAt"];
};

export function playerResultPayload(sessionId: string, result: GameResult): PlayerResultPayload {
  return PlayerResultRecordSchema.parse({
    version: 1,
    sessionId,
    winner: result.winner,
    declaredAt: { phase: result.declaredAt.phase, day: result.declaredAt.day },
  }) as PlayerResultPayload;
}

const ownPlayer = (game: StorytellerLobbyRecord, id: PlayerId) =>
  Object.prototype.hasOwnProperty.call(game.players, id) ? game.players[id] : undefined;

/**
 * The uids that receive the result: every live roster binding whose seat is
 * occupied in the final game, and -- when the binding's Storyteller-only
 * participant record exists -- whose record names exactly that seat and that
 * occupant's participation instance. A binding to an empty/absent seat, or one
 * whose record contradicts the occupant, is not coherent and receives nothing
 * (the payload names no participant, so this only decides who may read it).
 */
export function coherentResultRecipients(
  game: StorytellerLobbyRecord,
  roster: Record<string, string>,
  participants: Record<string, RosterParticipantRecord>,
): string[] {
  const recipients: string[] = [];
  for (const [uid, playerId] of Object.entries(roster)) {
    const occupant = ownPlayer(game, playerId);
    if (!occupant || occupant.isEmpty || !occupant.participantId) continue;
    const record = Object.prototype.hasOwnProperty.call(participants, uid) ? participants[uid] : undefined;
    if (record && (record.playerId !== playerId || record.participantId !== occupant.participantId)) continue;
    recipients.push(uid);
  }
  return recipients.sort();
}

/**
 * The close-time builder for SessionWriter.close: freshly reads the roster and
 * its participant records under the held lease and returns the results/{uid}
 * updates. `result` null (End Without Result) publishes nothing and reads
 * nothing. An unreadable/invalid roster aborts the close (retryable), never a
 * partial publication.
 */
export function terminalPublication(
  code: string,
  sessionId: string,
  result: GameResult | null,
  game: StorytellerLobbyRecord,
): TerminalPublicationBuilder | undefined {
  if (!result) return undefined;
  const payload = playerResultPayload(sessionId, result);
  return async (raw: RoomBackend) => {
    const roster = decodeRoster(await raw.get(rosterPath(code)));
    if (roster.status !== "ready") throw new SnapshotValidationError();
    const participants = decodeRosterParticipants(await raw.get(rosterParticipantsPath(code)));
    if (participants.status !== "ready") throw new SnapshotValidationError();
    const updates: Record<string, Json> = {};
    for (const uid of coherentResultRecipients(game, roster.data, participants.data)) {
      updates[resultPath(code, uid)] = { ...payload, declaredAt: { ...payload.declaredAt } } as unknown as Json;
    }
    return updates;
  };
}

/**
 * Recovery (10H-AC-050): the result an already-completed terminal close of
 * THIS session published, read back from the Storyteller-readable results
 * collection -- null when it published none. Every record is validated
 * exactly; records of another session are ignored; records of this session
 * that disagree (impossible through the one atomic commit) are refused as
 * invalid rather than guessed between.
 */
export async function readPublishedResult(backend: RoomBackend, code: string, sessionId: string): Promise<GameResult | null> {
  const raw = await backend.get(resultsPath(code));
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new SnapshotValidationError();
  let found: GameResult | null = null;
  for (const value of Object.values(raw as Record<string, unknown>)) {
    const parsed = PlayerResultRecordSchema.safeParse(value);
    if (!parsed.success) throw new SnapshotValidationError();
    if (parsed.data.sessionId !== sessionId) continue;
    const next: GameResult = { winner: parsed.data.winner, declaredAt: { ...parsed.data.declaredAt } };
    if (found && (found.winner !== next.winner || found.declaredAt.phase !== next.declaredAt.phase || found.declaredAt.day !== next.declaredAt.day)) {
      throw new SnapshotValidationError();
    }
    found = next;
  }
  return found;
}
