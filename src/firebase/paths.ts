import type { PlayerId } from "@/stores/types";

export const lobbyPath = (code: string) => `lobbies/${code}`;
export const storytellerUidPath = (code: string) =>
  `lobbies/${code}/storytellerUid`;
export const rosterPath = (code: string) => `lobbies/${code}/roster`;
export const rosterEntryPath = (code: string, uid: string) =>
  `lobbies/${code}/roster/${uid}`;
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
// Stored inside public/ so it uses the existing deployed public rule:
// ST can write, roster members can read. No new Firebase rules needed.
export const lobbyStatusPath = (code: string) => `lobbies/${code}/public/status`;
