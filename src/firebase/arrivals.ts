import type { StorytellerLobbyRecord } from "@/stores/types";

/** Package 3 (A1): the minimal shape of a currently-joined player the public
 * arrivals list is derived from. Structurally a subset of `JoinedPlayer`. */
export type JoinedForArrivals = { uid: string; playerId: string | null };

/** Public arrival names, in arrival order, for the pre-game waiting lobby.
 *
 * Names only. A uid is never emitted: the public record has no way to tell
 * which arrival is which, which is why the waiting client matches its own row
 * by the name it asked to join with. A seated arrival contributes the name the
 * Storyteller gave the seat; an unseated arrival contributes the name it
 * requested. Published only while the game is in Setup -- once play begins the
 * public roster (`players`) is the table's public face and arrivals vanish.
 * Departed or expired players are absent because `joined` only holds
 * currently-present uids. */
export function computeArrivals(
  game: Pick<StorytellerLobbyRecord, "phase" | "players" | "pendingPlayers">,
  joined: readonly JoinedForArrivals[],
  requestedNames: Readonly<Record<string, string>>,
): string[] {
  if (game.phase !== "setup") return [];
  const out: string[] = [];
  for (const j of joined) {
    const seated = j.playerId ? game.players[j.playerId] : undefined;
    const name = (seated && !seated.isEmpty ? seated.name : undefined)
      ?? game.pendingPlayers[j.uid]
      ?? requestedNames[j.uid];
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed) out.push(trimmed);
  }
  return out;
}
