import type { StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10H test helper: a deep copy of `game` with every participation's
 * reveal token removed. Undo restores every other field of Current State
 * exactly, but -- by contract (§12.2: A -> B -> A mints a new token each
 * transition; an old acknowledgement must never become valid again) -- an
 * Undo that reverts a visible identity is itself a visible-identity
 * transition and mints a FRESH token rather than restoring the older one.
 * "Undo restores the exact snapshot" assertions therefore compare through
 * this helper and assert the fresh token separately.
 */
export function withoutRevealTokens<T extends StorytellerLobbyRecord | null | undefined>(game: T): T {
  if (!game) return game;
  const copy = structuredClone(game) as StorytellerLobbyRecord;
  for (const player of Object.values(copy.players)) delete player.revealToken;
  return copy as T;
}

/**
 * Phase 10H test helper: the allowlisted self record inside a delivered
 * player/{id} value -- the value with exactly the envelope fields (the
 * participation's reveal token and the player's own Life) removed. Pre-10H
 * assertions about WHICH identity/packet was delivered compare through this;
 * the envelope itself is asserted separately (phase10hFoundation tests).
 */
export function withoutSelfEnvelope<T>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { revealToken: _token, life: _life, ...identity } = value as Record<string, unknown>;
  return identity as T;
}
