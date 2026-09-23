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
export const joinRequestsPath = (code: string) => `lobbies/${code}/joinRequests`;
export const joinRequestPath = (code: string, uid: string) =>
  `lobbies/${code}/joinRequests/${uid}`;
export const publicPath = (code: string) => `lobbies/${code}/public`;
export const playerPath = (code: string, playerId: PlayerId) =>
  `lobbies/${code}/player/${playerId}`;
export const storytellerPath = (code: string) =>
  `lobbies/${code}/storyteller`;
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
