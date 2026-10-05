import type { PlayerId } from "@/stores/types";

export const lobbyPath = (code: string) => `lobbies/${code}`;
export const storytellerUidPath = (code: string) =>
  `lobbies/${code}/storytellerUid`;
export const rosterPath = (code: string) => `lobbies/${code}/roster`;
export const rosterEntryPath = (code: string, uid: string) =>
  `lobbies/${code}/roster/${uid}`;
// Phase 9R.2 (Astra R1): Storyteller-only companion to each roster binding,
// naming the participation instance that binding seats. Written and deleted
// only in the same multi-path update as roster/{uid}. Never player-readable.
export const rosterParticipantsPath = (code: string) => `lobbies/${code}/rosterParticipants`;
export const rosterParticipantPath = (code: string, uid: string) =>
  `lobbies/${code}/rosterParticipants/${uid}`;
// Phase 9R.6: Storyteller-only durable receipt of a committed membership
// revocation that still owes a local occupancy completion (unseat/remove),
// naming the exact participation instance revoked. Written only in the same
// multi-path update as the revocation itself. Never player-readable.
export const membershipRevocationsPath = (code: string) => `lobbies/${code}/membershipRevocations`;
export const membershipRevocationPath = (code: string, uid: string) =>
  `lobbies/${code}/membershipRevocations/${uid}`;
export const joinRequestsPath = (code: string) => `lobbies/${code}/joinRequests`;
export const joinRequestPath = (code: string, uid: string) =>
  `lobbies/${code}/joinRequests/${uid}`;
export const publicPath = (code: string) => `lobbies/${code}/public`;
export const playerPath = (code: string, playerId: PlayerId) =>
  `lobbies/${code}/player/${playerId}`;
/** The Storyteller-private game projection's destination, as path segments
 * (the shape firebaseWriteCompatibility measures a write against). */
export const storytellerPathSegments = (code: string): readonly string[] => ["lobbies", code, "storyteller"];
export const storytellerPath = (code: string) =>
  storytellerPathSegments(code).join("/");
/** SOL-10F-E1: the derived recovery checkpoint's destination (one string
 * leaf, see checkpoint.ts), as path segments. */
export const checkpointPathSegments = (code: string): readonly string[] => ["lobbies", code, "checkpoint"];
export const checkpointPath = (code: string) =>
  checkpointPathSegments(code).join("/");
export const presencePath = (code: string, uid: string) =>
  `lobbies/${code}/presence/${uid}`;
// Phase 9C.6 (OPUS-002): Storyteller-owned Public Display capability, and the
// per-UID binding a display client enrolls with that capability's token.
export const displayAccessPath = (code: string) => `lobbies/${code}/displayAccess`;
export const displayMemberPath = (code: string, uid: string) =>
  `lobbies/${code}/displayMembers/${uid}`;
// Stored inside public/ so it uses the existing deployed public rule:
// ST can write, roster members can read. No new Firebase rules needed.
export const lobbyStatusPath = (code: string) => `lobbies/${code}/public/status`;
// Phase 10H (10H-IMPLEMENTATION-CONTRACT-v1.0 §12.3): a player's advisory
// acknowledgement of the reveal token they were shown. Written by that uid
// only (bounded string); read by the Storyteller; cleared by revocation and
// by the terminal close. Never game state.
export const revealAcksPath = (code: string) => `lobbies/${code}/revealAcks`;
export const revealAckPath = (code: string, uid: string) => `lobbies/${code}/revealAcks/${uid}`;
// Phase 10H (§16): the immutable player-safe terminal result, written only in
// the authoritative atomic terminal close; readable by its own uid afterward.
export const resultsPath = (code: string) => `lobbies/${code}/results`;
export const resultPath = (code: string, uid: string) => `lobbies/${code}/results/${uid}`;
