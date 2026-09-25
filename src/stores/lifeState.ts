import type { PlayerPublicRecord, STPlayerRecord } from "./types";

/**
 * Phase 10A: the ONE place a player's life fields (`alive`, `ghostVote`,
 * `exiled`) are interpreted. Grimoire tokens, the player drawer, the public
 * display, player town lists and accessible labels all derive from here
 * instead of re-reading the booleans themselves.
 *
 * Life State is public table information: who is dead, who still holds
 * their vote token, and whether a death was an exile. Privacy Mode never
 * hides it. Anomalies ("Needs check") are Storyteller-only.
 */

/** The visual life grammar's five public states. */
export type LifeState =
  | "alive"
  | "deadVote"
  | "deadVoteUsed"
  | "exiledVote"
  | "exiledVoteUsed";

/** Suspicious persisted combinations the current commands never create but
 * legacy/recovered state may carry. Never a reason to reject state; the
 * Storyteller sees "Needs check" and can correct it. */
export type LifeAnomaly =
  | "aliveButExiled"
  | "aliveWithoutVote"
  | "exiledNonTraveler"
  | "emptySeatLifeState";

export type LifeStatus = {
  /** Best-effort display state -- never hides a death or a spent vote. */
  state: LifeState;
  anomalies: LifeAnomaly[];
};

type LifeFields = Pick<STPlayerRecord, "alive" | "ghostVote" | "exiled" | "isTraveler" | "isEmpty">;

/** Storyteller derivation: display state plus anomalies. */
export function lifeStatusOf(player: LifeFields): LifeStatus {
  const anomalies: LifeAnomaly[] = [];
  const exiled = player.exiled === true;
  if (player.isEmpty) {
    if (!player.alive || exiled || !player.ghostVote) anomalies.push("emptySeatLifeState");
    return { state: "alive", anomalies };
  }
  if (player.alive) {
    if (exiled) anomalies.push("aliveButExiled");
    if (!player.ghostVote) anomalies.push("aliveWithoutVote");
    if (exiled && !player.isTraveler) anomalies.push("exiledNonTraveler");
    return { state: "alive", anomalies };
  }
  if (exiled && !player.isTraveler) anomalies.push("exiledNonTraveler");
  const exileDeath = exiled && player.isTraveler;
  const state: LifeState = exileDeath
    ? (player.ghostVote ? "exiledVote" : "exiledVoteUsed")
    : (player.ghostVote ? "deadVote" : "deadVoteUsed");
  return { state, anomalies };
}

/** The public-safe life representation (Phase 10A Section 22). Anomalies are
 * normalized away rather than exposed: a living player publicly holds their
 * vote, and only a Traveler's exile-death is published as an exile.
 *
 * Future public-registration mechanics (e.g. a Zombuul that registers as
 * dead while alive) belong to the future ability engine and would be applied
 * HERE, once, rather than in every consumer. Phase 10A implements none. */
export function publicLifeOf(player: LifeFields): Pick<PlayerPublicRecord, "alive" | "ghostVote" | "exiled"> {
  const { state } = lifeStatusOf(player);
  switch (state) {
    case "alive": return { alive: true, ghostVote: true };
    case "deadVote": return { alive: false, ghostVote: true };
    case "deadVoteUsed": return { alive: false, ghostVote: false };
    case "exiledVote": return { alive: false, ghostVote: true, exiled: true };
    case "exiledVoteUsed": return { alive: false, ghostVote: false, exiled: true };
  }
}

/** Display state of an already-projected public record. */
export function publicLifeStateOf(record: Pick<PlayerPublicRecord, "alive" | "ghostVote" | "exiled">): LifeState {
  if (record.alive) return "alive";
  if (record.exiled === true) return record.ghostVote ? "exiledVote" : "exiledVoteUsed";
  return record.ghostVote ? "deadVote" : "deadVoteUsed";
}

export const isDeadState = (state: LifeState): boolean => state !== "alive";
export const isExiledState = (state: LifeState): boolean => state === "exiledVote" || state === "exiledVoteUsed";
export const hasVoteAvailable = (state: LifeState): boolean => state === "deadVote" || state === "exiledVote";

/** Text for every state -- life state is never communicated by color,
 * opacity or an unlabeled icon alone. Deliberately never "voted": a spent
 * token is "vote used". */
export const LIFE_STATE_LABEL: Record<LifeState, string> = {
  alive: "alive",
  deadVote: "dead, vote available",
  deadVoteUsed: "dead, vote used",
  exiledVote: "exiled, vote available",
  exiledVoteUsed: "exiled, vote used",
};

/** Short headline ("Alive" / "Dead" / "Exiled"). */
export function lifeHeadline(state: LifeState): string {
  if (state === "alive") return "Alive";
  return isExiledState(state) ? "Exiled" : "Dead";
}

/** Vote-token wording for a dead player, or null while alive. */
export function voteTokenLabel(state: LifeState): string | null {
  if (state === "alive") return null;
  return hasVoteAvailable(state) ? "vote available" : "vote used";
}

export const LIFE_ANOMALY_LABEL: Record<LifeAnomaly, string> = {
  aliveButExiled: "Alive but marked exiled",
  aliveWithoutVote: "Alive without a vote token",
  exiledNonTraveler: "Exile recorded on a non-Traveler",
  emptySeatLifeState: "Empty seat carries a life state",
};

/** Accessible name for a seat: "Alice, seat 3, dead, vote available". The
 * Storyteller-only `needsCheck` suffix is added only when asked for. */
export function lifeAccessibleLabel(name: string, seatNumber: number, state: LifeState, needsCheck = false): string {
  return `${name || "Unnamed player"}, seat ${seatNumber}, ${LIFE_STATE_LABEL[state]}${needsCheck ? ", needs check" : ""}`;
}
