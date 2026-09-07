import type { RoleRegistry } from "@/data/roleRegistry";
import { PlayerSelfRecordSchema } from "./schemas";
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
  if (p.publicDisplayRole) out.publicDisplayRole = p.publicDisplayRole;
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
  return out;
}
