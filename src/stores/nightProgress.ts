import type { ParticipantId, RoleId, STPlayerRecord } from "./types";

/**
 * Phase 10F (v24): participation-scoped Night-progress identity.
 *
 * `nightProgress` keys are `${day}:${stepKey}`. Up to v23 every step that was
 * ABOUT one player was addressed by the reusable seat (`p:{playerId}:...`), so a
 * completion marker silently transferred to whoever later occupied that seat.
 * From v24 every participant-scoped step is addressed by the occupant's
 * immutable ParticipantId instead -- seat reuse can never redirect a marker to
 * a replacement participant (10F-AC-09).
 *
 * This module is the ONE place these step keys are built and recognised, so the
 * Night Order, the Role seam's Traveler-arrival coupling, the store's step
 * commands and v23 -> v24 migration can never drift apart.
 */

/** The participant-scoped step families (`{prefix}:{participantId}[:...]`). */
export const PARTICIPANT_STEP_PREFIXES = [
  "p", "travelerArrival", "lunaticInfo", "lunaticTargets", "admin", "missingOrder", "invalid", "orderConflict",
] as const;
export type ParticipantStepPrefix = typeof PARTICIPANT_STEP_PREFIXES[number];

/** A guided participant wake: `p:{participantId}:{wakeRole}`. `wakeRole` is the
 * Role whose procedure is performed (the Shown Role for a simulated wake). */
export const participantStepKey = (participantId: ParticipantId, wakeRole: RoleId): string =>
  `p:${participantId}:${wakeRole}`;

/** A late Traveler's arrival procedure: `travelerArrival:{participantId}:{roleId}`. */
export const travelerArrivalStepKey = (participantId: ParticipantId, roleId: RoleId): string =>
  `travelerArrival:${participantId}:${roleId}`;

/** Any other participant-scoped step (`lunaticInfo:{participantId}`,
 * `admin:{participantId}:{roleId}`, ...). */
export const participantScopedStepKey = (prefix: ParticipantStepPrefix, participantId: ParticipantId, ...rest: string[]): string =>
  [prefix, participantId, ...rest].join(":");

/** The occupied participant's id, or null for an empty seat / no identity. */
export const stepParticipantOf = (player: Pick<STPlayerRecord, "isEmpty" | "participantId">): ParticipantId | null =>
  !player.isEmpty && typeof player.participantId === "string" && player.participantId ? player.participantId : null;

/** True when `stepKey` is one of the participant-scoped families (whatever id
 * it carries). Global steps (`minionInfo`, `modifier:*`, `manual:*`...) are not. */
export function isParticipantScopedStepKey(stepKey: string): boolean {
  const prefix = stepKey.slice(0, stepKey.indexOf(":"));
  return stepKey.includes(":") && (PARTICIPANT_STEP_PREFIXES as readonly string[]).includes(prefix);
}

/** True when the full `nightProgress` key (`${day}:${stepKey}`) belongs to
 * `participantId` in the Traveler-arrival or guided-wake families -- the steps a
 * Role transition / arrival restart clears for that participation instance. */
export function isParticipantRoleStepEntry(key: string, day: number, participantId: ParticipantId): boolean {
  return key.startsWith(`${day}:${travelerArrivalStepKey(participantId, "")}`) ||
    key.startsWith(`${day}:${participantStepKey(participantId, "")}`);
}

/**
 * v23 -> v24 Night-progress migration (Phase 10F Section 9). A v23
 * participant-scoped key names a REUSABLE seat, and nothing authoritative proves
 * which participation instance completed it (History is never consulted). Such
 * progress is therefore DROPPED rather than guessed onto whoever occupies that
 * seat now -- a one-night bookkeeping reset is safer than transferring a
 * completion to a replacement participant. Global steps and Storyteller-defined
 * custom steps (`manual:*`) carry no participant and are preserved exactly.
 *
 * Returns the SAME object when nothing is dropped. Never invents a key.
 */
export function migrateNightProgressV23ToV24<T>(nightProgress: Record<string, T>): Record<string, T> {
  let dropped = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(nightProgress)) {
    const separator = key.indexOf(":");
    const stepKey = separator >= 0 ? key.slice(separator + 1) : key;
    if (isParticipantScopedStepKey(stepKey)) { dropped = true; continue; }
    next[key] = value;
  }
  return dropped ? next : nightProgress;
}
