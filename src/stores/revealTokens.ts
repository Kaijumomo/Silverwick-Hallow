import type { RoleRegistry } from "@/data/roleRegistry";
import { projectIdentity } from "./projections";
import type { PlayerId, STPlayerRecord, StorytellerLobbyRecord } from "./types";

/**
 * Phase 10H (10H-IMPLEMENTATION-CONTRACT-v1.0 §12): the reveal-token lifecycle.
 *
 * A reveal token is an opaque random string naming one participation's
 * CURRENTLY PROJECTED VISIBLE IDENTITY -- the projected Shown Role and the
 * player-facing Shown Alignment, exactly what projectIdentity() delivers. It
 * exists so a player's "I've seen my role" acknowledgement (revealAcks/{uid},
 * advisory runtime state only) can be compared with what they are being shown
 * now: Viewed is `ack === currentRevealToken`, nothing else.
 *
 * withRevealTokens() is applied by the store's one central game-commit seam
 * (the `set` wrapper in storytellerStore.ts), so every command and Undo is
 * covered without per-command bookkeeping:
 *
 *  - an empty seat never carries a token;
 *  - a NEW participation instance (a different ParticipantId at the seat, or a
 *    seat that was empty/absent before) always receives a freshly minted token
 *    -- seat reuse never inherits one;
 *  - the SAME participation keeps its current token while its projected
 *    visible identity is unchanged (hidden Actual Role/Alignment changes,
 *    Effects, Reminders, Life, notes, packets... never rotate it);
 *  - the same participation gets a freshly minted token whenever its projected
 *    visible identity changes -- every transition, so A -> B -> A ends on a
 *    third token and an acknowledgement of the first A can never become valid
 *    again. Undo is a transition like any other: it never restores an older
 *    token.
 *
 * The token is never derived from the ParticipantId (or any other identity);
 * it carries no information beyond "this is the identity being shown now".
 */

/** 128 random bits as 22 base64url characters (REVEAL_TOKEN_PATTERN). */
export function newRevealToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * The player-visible identity this participation is projected with right now,
 * as a comparable key; null when nothing is projected (no Shown Role, or an
 * unsafe one that fails closed). Without a registry (the game's script cannot
 * be resolved) it falls back to the raw perception inputs projectIdentity
 * reads -- a superset of the visible identity, so it can only rotate MORE
 * often, never miss a visible change.
 */
export function visibleIdentityKey(p: STPlayerRecord, registry: RoleRegistry | null): string | null {
  if (p.isEmpty) return null;
  if (!registry) {
    return JSON.stringify(["raw", p.shownRole, p.shownAlignment, p.isTraveler,
      p.isTraveler ? p.actualRole : null, p.isTraveler ? p.actualAlignment ?? null : null]);
  }
  const identity = projectIdentity(p, registry);
  return identity ? JSON.stringify([identity.shownRole, identity.shownAlignment ?? null]) : null;
}

const ownPlayer = (game: StorytellerLobbyRecord, id: PlayerId): STPlayerRecord | undefined =>
  Object.prototype.hasOwnProperty.call(game.players, id) ? game.players[id] : undefined;

function withoutToken(player: STPlayerRecord): STPlayerRecord {
  if (player.revealToken === undefined) return player;
  const next = { ...player };
  delete next.revealToken;
  return next;
}

function withToken(player: STPlayerRecord, token: string | undefined): STPlayerRecord {
  if (token === undefined) return withoutToken(player);
  return player.revealToken === token ? player : { ...player, revealToken: token };
}

/**
 * Applies the reveal-token lifecycle to `next`, the game about to become
 * Current State, relative to `prev`, the Current State it replaces. Returns
 * `next` itself when no player record needs a change (so a commit's reference
 * equality is preserved), otherwise a copy with only the affected player
 * records replaced. Pure apart from token minting.
 */
export function withRevealTokens(
  prev: StorytellerLobbyRecord | null,
  next: StorytellerLobbyRecord,
  registry: RoleRegistry | null,
): StorytellerLobbyRecord {
  let players: Record<PlayerId, STPlayerRecord> | null = null;
  for (const id of Object.keys(next.players)) {
    const current = next.players[id]!;
    let resolved: STPlayerRecord;
    if (current.isEmpty) {
      resolved = withoutToken(current);
    } else {
      const before = prev ? ownPlayer(prev, id) : undefined;
      const sameParticipation = !!before && !before.isEmpty && !!before.participantId
        && before.participantId === current.participantId;
      if (!sameParticipation) {
        resolved = withToken(current, newRevealToken());
      } else if (visibleIdentityKey(before!, registry) !== visibleIdentityKey(current, registry)) {
        resolved = withToken(current, newRevealToken());
      } else {
        // Unchanged visible identity: the CURRENT token carries forward (never
        // whatever an older snapshot, e.g. an Undo entry, held).
        resolved = withToken(current, before!.revealToken);
      }
    }
    if (resolved !== current) {
      players ??= { ...next.players };
      players[id] = resolved;
    }
  }
  return players ? { ...next, players } : next;
}

/**
 * Storyteller-side derivation (contract §12.3): a participation's reveal is
 * Viewed exactly when the acknowledgement stored for the uid bound to its seat
 * equals its CURRENT token. A missing token (a pre-v26 participation), a
 * missing/stale/wrong acknowledgement, or a seat with no phone binding is
 * simply not Viewed -- advisory, never a gate.
 */
export function revealViewed(player: STPlayerRecord | undefined, acknowledgement: string | undefined): boolean {
  return !!player && !player.isEmpty && typeof player.revealToken === "string"
    && typeof acknowledgement === "string" && acknowledgement === player.revealToken;
}
