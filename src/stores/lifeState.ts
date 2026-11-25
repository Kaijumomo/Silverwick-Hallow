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
 *
 * Phase 10D (ASTRA-10D-C01): interpretation reads ONLY the Life fields.
 * `exiled` means the participant's CURRENT death was caused by an exile -- Life
 * Current State, independent of their current Role or Traveler status (only a
 * Traveler can undergo a gameplay exile, but a later Role change never touches
 * the exile-death it caused). The one Life invariant is `exiled => dead`.
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
  | "emptySeatLifeState";

export type LifeStatus = {
  /** Best-effort display state -- never hides a death or a spent vote. */
  state: LifeState;
  anomalies: LifeAnomaly[];
};

type LifeFields = Pick<STPlayerRecord, "alive" | "ghostVote" | "exiled" | "isEmpty">;

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
    return { state: "alive", anomalies };
  }
  const state: LifeState = exiled
    ? (player.ghostVote ? "exiledVote" : "exiledVoteUsed")
    : (player.ghostVote ? "deadVote" : "deadVoteUsed");
  return { state, anomalies };
}

/** The public-safe life representation (Phase 10A Section 22). Anomalies are
 * normalized away rather than exposed: a living player publicly holds their
 * vote. A dead participant whose death was an exile is published as Exiled
 * whatever their current Role (Phase 10D, ASTRA-10D-C01).
 *
 * BM-2: the Zombuul's "register as dead" needs nothing here: its stored life
 * IS the registered (dead) life, and its hidden truth is a Storyteller-only
 * Effect this function never reads (HIDDEN_LIFE below). */
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

/**
 * BM-2 (Zombuul, model B1 approved 2026-11-12): "The 1st time you die, you live but register as dead." The stored Life fields above
 * stay THE TABLE'S life (what votes, counts, phones and the Public Display read); the truth for a player who registers as dead while
 * still alive is one Storyteller-only Effect of this type on the PLAYER (not the character: it survives a character change, PO ruling
 * 2026-11-12 17:51Z). It is never projected (Effects never are) and `publicLifeOf` never reads it. Only the reviewed truth readers ask
 * `isTrulyAlive`: the ending, the night wake, kill targets, succession and the Storyteller's own seat look.
 * https://wiki.bloodontheclocktower.com/Zombuul
 */
export const HIDDEN_LIFE = "livesOn";

/** Whether this player registers as dead but is secretly alive (an active hidden-life Effect while the stored life is dead). */
export const hasHiddenLife = (player: Pick<STPlayerRecord, "alive" | "effects">): boolean =>
  !player.alive && (player.effects ?? []).some((effect) => effect.type === HIDDEN_LIFE && effect.state === "active");

/** The TRUE life: alive at the table, or registered dead with a hidden life. Storyteller-side rules only, never a projection. */
export const isTrulyAlive = (player: Pick<STPlayerRecord, "alive" | "effects">): boolean => player.alive || hasHiddenLife(player);

/**
 * Phase 10F (v24, Section 10): whether public/player-town projection withholds
 * Life State in `phase`. True exactly during Night -- a guided Night ability
 * may change Life mid-Night, and the table learns of it at Day. Never
 * reconstructs a pre-Night state; the Storyteller's own views are unaffected.
 */
export const publicLifeWithheld = (phase: string | undefined): boolean => phase === "night";

/** Display state of an already-projected public record, or `null` when its Life
 * State is withheld (Phase 10F: a Night projection carries no `alive`). Callers
 * render a withheld record neutrally -- no dead/alive text, label, class,
 * shroud or vote token -- so nothing about Life is implied. */
export function publicLifeStateOf(record: Pick<PlayerPublicRecord, "alive" | "ghostVote" | "exiled">): LifeState | null {
  if (typeof record.alive !== "boolean") return null;
  if (record.alive) return "alive";
  if (record.exiled === true) return record.ghostVote ? "exiledVote" : "exiledVoteUsed";
  return record.ghostVote ? "deadVote" : "deadVoteUsed";
}

/** Accessible-name suffix for a withheld public Life State -- identical for
 * every player, so it reveals nothing. */
export const LIFE_WITHHELD_LABEL = "life not shown during the night";

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

/** Accessible name for a seat: "Alice, seat 3, dead, vote available". The
 * Storyteller-only `needsCheck` suffix is added only when asked for. */
export function lifeAccessibleLabel(name: string, seatNumber: number, state: LifeState | null, needsCheck = false): string {
  return `${name || "Unnamed player"}, seat ${seatNumber}, ${state ? LIFE_STATE_LABEL[state] : LIFE_WITHHELD_LABEL}${needsCheck ? ", needs check" : ""}`;
}
