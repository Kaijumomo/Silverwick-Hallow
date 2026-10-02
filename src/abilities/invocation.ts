import type { AbilityDescriptor, AbilityInvocation, AbilityTiming } from "./semantics";
import type { StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10F (SOL-10F-L3-R1, PHASE10F Section 23): the ONE rules-neutral
 * invocation-eligibility contract, shared by every generic guided entry point
 * (the ordinary Night Order and the Day entry) AND enforced by the coordinator
 * (planAbilityResolution). UI visibility is never authority.
 *
 * Eligibility needs BOTH halves of the descriptor: WHEN the ability acts
 * (`timing`) and HOW it may be invoked (`invocation`). Timing alone never makes
 * an ability actionable:
 *
 *  - Day entry: phase Day, explicit `"day"` timing, invocation `"publicClaim"`
 *    or `"procedure"`.
 *  - Ordinary Night Order: phase Night, explicit `"firstNight"` timing on Night
 *    1 or `"otherNight"` timing on a later Night, invocation `"wake"` or
 *    `"procedure"`.
 *  - `"triggered"` / `"passive"` timing has NO generic invocation path: a
 *    trigger is never inferred from timing. It stays Manual / reference-only
 *    until a verified semantic contract supplies an explicit path.
 *  - `"setup"` timing stays Setup-owned; invocation `"none"` is never directly
 *    actionable.
 *
 * Pure: no store, no clock, no character knowledge.
 */
export type InvocationPath = "nightOrder" | "dayEntry";

export const INVOCATION_PATHS: readonly InvocationPath[] = ["nightOrder", "dayEntry"];

export const isInvocationPath = (value: unknown): value is InvocationPath =>
  typeof value === "string" && (INVOCATION_PATHS as readonly string[]).includes(value);

export type GameMoment = Pick<StorytellerLobbyRecord, "phase" | "day">;

export type InvocationEligibility = { eligible: true } | { eligible: false; reason: string };

/** The invocations each generic path may perform. */
const PATH_INVOCATIONS: Readonly<Record<InvocationPath, readonly AbilityInvocation[]>> = {
  dayEntry: ["publicClaim", "procedure"],
  nightOrder: ["wake", "procedure"],
};

/** The single explicit timing a path serves at this Game Moment, or null when
 * the path does not act in this phase. */
function pathTiming(path: InvocationPath, moment: GameMoment): AbilityTiming | null {
  if (path === "dayEntry") return moment.phase === "day" ? "day" : null;
  return moment.phase === "night" ? (moment.day === 1 ? "firstNight" : "otherNight") : null;
}

export function invocationEligibility(
  descriptor: Pick<AbilityDescriptor, "timing" | "invocation">,
  path: InvocationPath,
  moment: GameMoment,
): InvocationEligibility {
  const timing = pathTiming(path, moment);
  if (!timing) {
    return { eligible: false, reason: path === "dayEntry"
      ? "The Day entry acts only during the Day; Night abilities are resolved from the Night Order."
      : "The Night Order acts only during the Night." };
  }
  if (descriptor.invocation === "none") {
    return { eligible: false, reason: "This ability is never directly invoked -- resolve its consequences manually." };
  }
  if (!descriptor.timing.includes(timing)) {
    const untriggered = descriptor.timing.some((t) => t === "triggered" || t === "passive");
    return { eligible: false, reason: untriggered
      ? "Triggered and passive abilities have no verified invocation path yet -- resolve manually."
      : path === "dayEntry" ? "This ability does not act during the Day." : "This ability does not act on this Night." };
  }
  if (!PATH_INVOCATIONS[path].includes(descriptor.invocation)) {
    return { eligible: false, reason: path === "dayEntry"
      ? "This ability is not a Day claim or procedure -- it cannot be used from the Day entry."
      : "This ability is not a Night wake or procedure -- it cannot be resolved from the Night Order." };
  }
  return { eligible: true };
}
