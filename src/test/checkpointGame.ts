import type { StorytellerLobbyRecord } from "@/stores/types";

type Source = ((path: string) => Promise<unknown>) | { get(path: string): Promise<unknown> };

/**
 * The Storyteller's game as the server holds it: the game inside the recovery
 * checkpoint (`lobbies/{code}/checkpoint`, one JSON string leaf). Since WP 4-4
 * the writer no longer projects a second, structured copy to
 * `lobbies/{code}/storyteller`, so tests read the remote game from here — the
 * same copy reconnect and takeover restore from.
 *
 * `at` optionally walks into the game ("players/p1/actualRole"). Returns
 * undefined when there is no checkpoint or the path does not exist.
 */
export async function checkpointGame(source: Source, code: string, at?: string): Promise<unknown> {
  const raw = await (typeof source === "function" ? source(`lobbies/${code}/checkpoint`) : source.get(`lobbies/${code}/checkpoint`));
  if (typeof raw !== "string") return undefined;
  let value: unknown = (JSON.parse(raw) as { game?: unknown }).game;
  for (const key of at ? at.split("/") : []) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** checkpointGame without a sub-path, typed as the game record. */
export const remoteGame = async (source: Source, code: string) =>
  await checkpointGame(source, code) as StorytellerLobbyRecord;
