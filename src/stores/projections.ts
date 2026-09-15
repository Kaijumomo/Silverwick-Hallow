import type { RoleRegistry } from "@/data/roleRegistry";
import { PlayerSelfRecordSchema } from "./schemas";
import { publicTravelerRole } from "./travelers";
import type {
  PlayerId,
  PlayerPublicRecord,
  PlayerSelfRecord,
  PublicLobbyRecord,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

export function projectIdentity(
  p: STPlayerRecord,
  registry: RoleRegistry
): PlayerSelfRecord | null {
  // No identity, alignment, or private packet is delivered until perception
  // has been established explicitly. Never consult actualRole here.
  if (p.isEmpty || !p.shownRole) return null;
  const shownRole = p.shownRole;
  if (registry.get(shownRole)?.type === "traveler" && !p.shownAlignment) return { shownRole };
  const shownAlignment = p.shownAlignment ?? registry.alignmentOf(shownRole);
  return { shownRole, shownAlignment };
}

export function projectToSelf(p: STPlayerRecord, registry: RoleRegistry): PlayerSelfRecord | null {
  const identity = projectIdentity(p, registry);
  if (!identity) return null;
  const packet = p.publishedPacket?.payload;
  if (!packet || packet.shownRole !== identity.shownRole || packet.shownAlignment !== identity.shownAlignment) return identity;
  // Reuse the same allowlist as preview. Neither drafts nor ST metadata cross.
  return PlayerSelfRecordSchema.parse(packet);
}

export function projectToPublic(
  p: STPlayerRecord,
  online: boolean
): PlayerPublicRecord {
  const out: PlayerPublicRecord = {
    id: p.id,
    name: p.name,
    seat: p.seat,
    alive: p.alive,
    ghostVote: p.ghostVote,
    online,
    joinedAt: p.joinedAt,
    isTraveler: p.isTraveler,
  };
  const traveler = publicTravelerRole(p);
  if (p.isTraveler) {
    if (traveler) out.publicDisplayRole = traveler.id;
  } else if (p.publicDisplayRole) out.publicDisplayRole = p.publicDisplayRole;
  return out;
}

export type OnlineMap = Record<PlayerId, boolean>;

export function projectLobbyToPublic(
  st: StorytellerLobbyRecord,
  online: OnlineMap
): PublicLobbyRecord {
  const players: Record<PlayerId, PlayerPublicRecord> = {};
  for (const id of Object.keys(st.players)) {
    const p = st.players[id]!;
    if (p.isEmpty) continue; // don't expose unoccupied seats to players
    players[id] = projectToPublic(p, !!online[id]);
  }
  const out: PublicLobbyRecord = {
    code: st.code,
    scriptId: st.scriptId,
    phase: st.phase,
    day: st.day,
    seatOrder: st.seatOrder.filter((id) => !st.players[id]?.isEmpty),
    players,
    fabled: [...st.fabled],
    lorics: [...(st.lorics ?? [])],
  };
  return out;
}

export function projectLobbyToSelfMap(
  st: StorytellerLobbyRecord,
  registry: RoleRegistry
): Record<PlayerId, PlayerSelfRecord> {
  const out: Record<PlayerId, PlayerSelfRecord> = {};
  for (const id of Object.keys(st.players)) {
    const p = st.players[id]!;
    const self = projectToSelf(p, registry);
    if (self) out[id] = self;
  }
  // Phase 9C.4 (OPUS-004): while a game is in Setup, ordinary private
  // identity publication is all-or-none — derived from this same projection
  // result, never restated from shownRole/shownAlignment/concealed-role
  // rules. A concealed player (Drunk, Marionette, Lunatic, ...) has no
  // shownRole until the Storyteller configures one, so publishing seat by
  // seat would let an ordinary player notice "everyone else got a role card
  // but I didn't" — a first-person negative-space leak. Traveler entries are
  // untouched: Traveler identity publication remains independent.
  if (st.phase === "setup") {
    const ordinary = Object.values(st.players).filter(p => !p.isEmpty && !p.isTraveler);
    const complete = ordinary.every(p => !!p.actualRole && !!out[p.id]);
    if (!complete) {
      for (const p of ordinary) delete out[p.id];
    }
  }
  return out;
}
