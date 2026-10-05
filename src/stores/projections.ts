import { deriveAlignment, type RoleRegistry } from "@/data/roleRegistry";
import { PlayerSelfRecordSchema } from "./schemas";
import { isInitialRevealComplete } from "./identity";
import { publicTravelerRole } from "./travelers";
import { publicLifeOf, publicLifeWithheld } from "./lifeState";
import type {
  Alignment,
  PlayerId,
  PlayerPublicRecord,
  PlayerSelfEnvelope,
  PlayerSelfLife,
  PlayerSelfRecord,
  PublicLobbyRecord,
  STPlayerRecord,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10D: whether a participant's explicit perception can be projected
 * safely. `ok`: nothing to check (or a usable identity); `unsafe`: a Shown Role
 * is set but cannot be projected -- it does not resolve on this script/registry,
 * is a Fabled or Loric, or is a Traveler character on a participant who is not
 * a Traveler. An unsafe perception fails CLOSED per participant: it yields no
 * self identity (never a fallback to the Actual Role or Alignment) and never
 * throws, so one bad record cannot block the table's checkpoint or anyone
 * else's public/self projection. It is a Storyteller-private "Needs check"
 * (see identityNeedsCheck).
 */
type IdentityState =
  | { kind: "none" }
  | { kind: "unsafe" }
  | { kind: "traveler"; shownRole: string }
  | { kind: "ordinary"; shownRole: string; derived: Alignment };

function identityState(p: STPlayerRecord, registry: RoleRegistry): IdentityState {
  // No identity, alignment, or private packet is delivered until perception
  // has been established explicitly. Never consult actualRole here.
  if (p.isEmpty || !p.shownRole) return { kind: "none" };
  const role = registry.get(p.shownRole);
  if (!role) return { kind: "unsafe" };
  if (role.type === "fabled" || role.type === "loric") return { kind: "unsafe" };
  // SOL-10E-A2 (ASTRA-10E-002): a Traveler's only projectable identity is
  // their OWN current Traveler character. Any other Shown Role on a Traveler
  // (an ordinary character, another Traveler) fails closed -- never
  // reinterpreted as an ordinary identity with a derived alignment, never a
  // fallback to the Actual Role, and never repaired here.
  if (p.isTraveler) {
    return role.type === "traveler" && p.shownRole === p.actualRole ? { kind: "traveler", shownRole: p.shownRole } : { kind: "unsafe" };
  }
  if (role.type === "traveler") {
    // A Traveler character is a public character of a TRAVELER only. Shown
    // to anyone else it would carry that participant's Actual Alignment
    // through the Traveler branch below -- never delivered.
    return p.isTraveler ? { kind: "traveler", shownRole: p.shownRole } : { kind: "unsafe" };
  }
  return { kind: "ordinary", shownRole: p.shownRole, derived: deriveAlignment(role) };
}

/** Storyteller-private: true when a Shown Role is set but unsafe to project
 * ("Needs check"). Never rendered for players. */
export function identityNeedsCheck(p: STPlayerRecord, registry: RoleRegistry): boolean {
  return identityState(p, registry).kind === "unsafe";
}

export function projectIdentity(
  p: STPlayerRecord,
  registry: RoleRegistry
): PlayerSelfRecord | null {
  const state = identityState(p, registry);
  if (state.kind === "none" || state.kind === "unsafe") return null;
  // Phase 10E (v23): player-facing alignment perception. `undisclosed` shows
  // the (valid) character and OMITS the alignment -- for an ordinary
  // participant and a Traveler alike. The sentinel itself never reaches the
  // player, and it never makes an unsafe Shown Role projectable (handled
  // above, fail-closed).
  if (p.shownAlignment === "undisclosed") return { shownRole: state.shownRole };
  if (state.kind === "traveler") {
    // Normal (null): a Traveler is automatically told their CURRENT Actual
    // Alignment (omitted while unresolved). An explicit good/evil -- a
    // deliberate perception choice made through the perception seam -- is
    // honored instead. (Phase 10D's "Traveler shownAlignment is inert" is
    // amended by Phase 10E; v22 leftovers are normalized to null by the
    // v22 -> v23 migration.)
    const alignment = p.shownAlignment ?? p.actualAlignment;
    return alignment ? { shownRole: state.shownRole, shownAlignment: alignment } : { shownRole: state.shownRole };
  }
  // Ordinary: explicit good/evil, else derived from the Shown Role. Never the
  // Actual Alignment.
  return { shownRole: state.shownRole, shownAlignment: p.shownAlignment ?? state.derived };
}

export function projectToSelf(p: STPlayerRecord, registry: RoleRegistry): PlayerSelfRecord | null {
  const identity = projectIdentity(p, registry);
  if (!identity) return null;
  const packet = p.publishedPacket?.payload;
  if (!packet || packet.shownRole !== identity.shownRole || packet.shownAlignment !== identity.shownAlignment) return identity;
  // Reuse the same allowlist as preview. Neither drafts nor ST metadata cross.
  // A malformed published packet falls back to the plain identity, never a throw.
  const allowed = PlayerSelfRecordSchema.safeParse(packet);
  return allowed.success ? allowed.data : identity;
}

export function projectToPublic(
  p: STPlayerRecord,
  online: boolean,
  phase?: PublicLobbyRecord["phase"],
): PlayerPublicRecord {
  // Phase 10A: public life goes through the one public-life seam
  // (lifeState.ts) -- dead/alive, vote token and exile-death are public
  // table information; Life Events, ParticipantIds and anomalies never are.
  //
  // Phase 10F (v24, Section 10): during Night a guided ability can change
  // Life mid-Night, so public/player-town projection reveals NO Life State
  // while the phase is Night -- the fields are ABSENT for every player alike
  // (never `false`, never a reconstructed pre-Night truth). Day resumes the
  // normal projection from Current State. projectLobbyToPublic always passes
  // the game's phase; it is the only production caller.
  const life = publicLifeWithheld(phase) ? null : publicLifeOf(p);
  const out: PlayerPublicRecord = {
    id: p.id,
    name: p.name,
    seat: p.seat,
    ...(life ? { alive: life.alive, ghostVote: life.ghostVote } : {}),
    ...(life?.exiled ? { exiled: true as const } : {}),
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
    players[id] = projectToPublic(p, !!online[id], st.phase);
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
  //
  // Phase 9 Setup finalization (B2): Deal establishes Storyteller truth;
  // Reveal is the separate, explicit act of publishing it. A complete
  // ordinary identity set is necessary but no longer sufficient — the
  // Storyteller must also have explicitly revealed roles (or this is a
  // legacy/running game past its initial Setup; see isInitialRevealComplete).
  if (st.phase === "setup") {
    const ordinary = Object.values(st.players).filter(p => !p.isEmpty && !p.isTraveler);
    const complete = ordinary.every(p => !!p.actualRole && !!out[p.id]);
    if (!complete || !isInitialRevealComplete(st)) {
      for (const p of ordinary) delete out[p.id];
    }
  }
  return out;
}

/**
 * Phase 10H (contract §11.7, F7): the player's OWN current Life State for their
 * private self envelope -- the same normalization the public Day projection
 * uses (publicLifeOf: one Life grammar, anomalies normalized away), but NOT
 * withheld at Night. Only ever attached to the player's own record; never a
 * Life Event, never anyone else's Life. Public Night withholding
 * (projectToPublic / publicLifeWithheld) is unchanged.
 */
export function ownLifeOf(p: STPlayerRecord): PlayerSelfLife {
  const life = publicLifeOf(p);
  return { alive: life.alive!, ghostVote: life.ghostVote!, ...(life.exiled ? { exiled: true as const } : {}) };
}

/**
 * Phase 10H: the record written at player/{id} -- the allowlisted self record
 * (identity or matching published packet, exactly as projectToSelf returns
 * it) plus envelope fields that are never part of a packet: this
 * participation's current reveal token and the player's own Life. Packet
 * delivery comparison keeps using the bare self record.
 */
export function selfEnvelopeOf(p: STPlayerRecord, self: PlayerSelfRecord): PlayerSelfEnvelope {
  return {
    ...self,
    ...(p.revealToken ? { revealToken: p.revealToken } : {}),
    life: ownLifeOf(p),
  };
}

/** Phase 10H: projectLobbyToSelfMap (unchanged gating, including the Setup
 * all-or-none barrier) with each delivered record wrapped in its envelope.
 * A withheld identity carries no envelope either. */
export function projectLobbyToSelfEnvelopeMap(
  st: StorytellerLobbyRecord,
  registry: RoleRegistry
): Record<PlayerId, PlayerSelfEnvelope> {
  const selfMap = projectLobbyToSelfMap(st, registry);
  return Object.fromEntries(Object.entries(selfMap).map(([id, self]) => [id, selfEnvelopeOf(st.players[id]!, self)]));
}
