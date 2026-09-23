import type {
  InformationValue,
  ParticipantId,
  ParticipantRef,
  PlayerId,
  RecordedInformationValue,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 9R.2: historical participant identity.
 *
 * PlayerId       = live seat/slot addressing (may be reused by another person)
 * ParticipantId  = one person's immutable participation instance in this game
 * ParticipantRef = a historical snapshot of that participant
 *
 * This module is the ONE place a ParticipantRef is ever built. Commands
 * accept live PlayerIds (the Storyteller selects CURRENT players) and
 * convert them here, at the moment of acceptance, into owned snapshots
 * that never consult the roster again.
 */

/** A fresh participation-instance identity for a real person entering a
 * seat. Random at runtime -- never derived from the seat, name, uid, or
 * joinedAt, so two different people who occupy the same PlayerId can never
 * share one. Migration never calls this (see legacyCurrentParticipantId). */
export const newParticipantId = (): ParticipantId =>
  "pt-" + (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/**
 * v16 -> v17 migration only: the deterministic ParticipantId given to a
 * player who is CURRENTLY occupying a seat in a migrated v16 snapshot.
 * Deterministic (never random) so independent migrations of the same
 * Current State, its Undo snapshots, and a remote checkpoint of the same
 * lineage all agree. Within one v16 Undo lineage a PlayerId can only ever
 * have held one occupant, because every occupancy-ending command
 * (unseatPlayer/removePlayer) clears Undo.
 *
 * This identity describes only that CURRENT participation instance going
 * forward. Migration never attaches any pre-v17 historical record to it --
 * those become explicitly unresolved legacy refs (legacyParticipantRef).
 */
export const legacyCurrentParticipantId = (playerId: PlayerId): ParticipantId =>
  `legacy-current:${playerId}`;

/** A pre-v17 PlayerId-only historical reference whose original participant
 * cannot be proven. Never carries a participantId or name. */
export const legacyParticipantRef = (playerId: PlayerId): ParticipantRef => ({ kind: "legacy", playerId });

/**
 * The central snapshot helper. Returns a fresh, caller-owned snapshot of
 * the participant CURRENTLY occupying `playerId`, or null when there is no
 * such participant: a nonexistent PlayerId (own-property check, so an
 * inherited Object.prototype name like "toString" never resolves), an
 * empty seat, a non-string id, or an occupied seat missing its
 * ParticipantId (never papered over with an invented one).
 */
export function participantRefOf(
  game: Pick<StorytellerLobbyRecord, "players">,
  playerId: unknown
): ParticipantRef | null {
  if (typeof playerId !== "string" || !Object.prototype.hasOwnProperty.call(game.players, playerId)) return null;
  const player = game.players[playerId];
  if (!player || player.isEmpty) return null;
  if (typeof player.participantId !== "string" || !player.participantId) return null;
  return { kind: "participant", participantId: player.participantId, playerId, nameAtTime: player.name };
}

/**
 * Phase 9R.2 (Astra R1): true when `participantId` already appears ANYWHERE
 * in this authoritative game -- a current occupant or any stored historical
 * snapshot. A deliberately conservative over-approximation (a quoted-string
 * search of the whole game rather than a list of known ParticipantRef
 * locations that could fall out of date): a caller-supplied identity for a
 * NEW participation instance must never collide with one this game has
 * already used, since a historical participant identity may never be reused.
 * Freshly minted ids never collide, so a false positive can only ever refuse
 * a caller-supplied id -- never admit one.
 */
export function participantIdAppearsIn(game: StorytellerLobbyRecord, participantId: ParticipantId): boolean {
  return JSON.stringify(game).includes(JSON.stringify(participantId));
}

/** True when `ref` refers to exactly this ParticipantId. A legacy ref never
 * matches any participant -- its original participant is unknowable. */
export function refersToParticipant(ref: ParticipantRef | undefined, participantId: ParticipantId): boolean {
  return ref?.kind === "participant" && ref.participantId === participantId;
}

/**
 * Converts already-validated live Information Values (every Player-valued
 * reference already confirmed to be a current participant) into their
 * stored form. Returns null if any Player reference no longer resolves --
 * the caller must then refuse the delivery rather than store a partial or
 * fabricated one.
 */
export function recordedInformationValues(
  game: Pick<StorytellerLobbyRecord, "players">,
  values: InformationValue[]
): RecordedInformationValue[] | null {
  const out: RecordedInformationValue[] = [];
  for (const value of values) {
    if (value.kind !== "player") {
      out.push(value);
      continue;
    }
    const participants: ParticipantRef[] = [];
    for (const playerId of value.playerIds) {
      const ref = participantRefOf(game, playerId);
      if (!ref) return null;
      participants.push(ref);
    }
    out.push({ requirementId: value.requirementId, kind: "player", participants });
  }
  return out;
}
