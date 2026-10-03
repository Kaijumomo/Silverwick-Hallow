import type { AbilityDescriptor, AbilityInvocation, AbilityTiming, NightTriggerKind } from "./semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { isDeathEvent } from "@/stores/lifeEvents";
import { nightTriggerStepKey } from "@/stores/nightProgress";
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
export type InvocationPath = "nightOrder" | "dayEntry" | "nightTrigger";

export const INVOCATION_PATHS: readonly InvocationPath[] = ["nightOrder", "dayEntry", "nightTrigger"];

export const isInvocationPath = (value: unknown): value is InvocationPath =>
  typeof value === "string" && (INVOCATION_PATHS as readonly string[]).includes(value);

export type GameMoment = Pick<StorytellerLobbyRecord, "phase" | "day">;

export type InvocationEligibility = { eligible: true } | { eligible: false; reason: string };

/** The invocations each generic path may perform. */
const PATH_INVOCATIONS: Readonly<Record<InvocationPath, readonly AbilityInvocation[]>> = {
  dayEntry: ["publicClaim", "procedure"],
  nightOrder: ["wake", "procedure"],
  nightTrigger: ["wake"],
};

/** The single explicit timing a path serves at this Game Moment, or null when
 * the path does not act in this phase. */
function pathTiming(path: InvocationPath, moment: GameMoment): AbilityTiming | null {
  if (path === "dayEntry") return moment.phase === "day" ? "day" : null;
  if (path === "nightTrigger") return moment.phase === "night" ? "triggered" : null;
  return moment.phase === "night" ? (moment.day === 1 ? "firstNight" : "otherNight") : null;
}

export function invocationEligibility(
  descriptor: Pick<AbilityDescriptor, "timing" | "invocation" | "nightTrigger">,
  path: InvocationPath,
  moment: GameMoment,
): InvocationEligibility {
  const timing = pathTiming(path, moment);
  if (!timing) {
    return { eligible: false, reason: path === "dayEntry"
      ? "The Day entry acts only during the Day; Night abilities are resolved from the Night Order."
      : path === "nightTrigger" ? "A Night trigger resolves only during the Night." : "The Night Order acts only during the Night." };
  }
  // Slice 7: the explicit Night-trigger path exists ONLY for a descriptor that
  // declares a verified trigger -- never for "triggered" timing alone.
  if (path === "nightTrigger" && !descriptor.nightTrigger) {
    return { eligible: false, reason: "This ability has no verified Night trigger -- resolve manually." };
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

export type NightTriggerStatus =
  /** SOL-10F-A10: fired by this exact authoritative LifeEvent. */
  | { kind: "triggered"; eventId: string }
  | { kind: "notTriggered"; reason: string }
  /** Authoritative state cannot establish it either way (the Life Event Window
   * does not cover tonight, or the event carries no Role evidence): a
   * Storyteller judgment, NEVER "no". `eventId` is the event concerned, or
   * null when there is none to point at. */
  | { kind: "unknown"; reason: string; eventId: string | null };

/** The judgment id asked when a verified trigger cannot be established --
 * bound to the trigger event it is about (SOL-10F-A1 / A10). */
export const nightTriggerJudgmentId = (trigger: NightTriggerKind, eventId: string | null) =>
  `trigger:${trigger}:${eventId === null ? "n" : `i${encodeURIComponent(eventId)}`}`;

/** The consumption step of a trigger at the current Night (exact key). */
export const nightTriggerProgressKey = (day: number, actor: ParticipantBinding, roleId: string, eventId: string | null) =>
  `${day}:${nightTriggerStepKey(actor.participantId, roleId, eventId)}`;

/**
 * Slice 7 / SOL-10F-A9 / A10: evaluates a descriptor's VERIFIED Night trigger
 * for one exact participation instance, from authoritative Current State only
 * -- the Life Event Window with its honest coverage, each event's recorded
 * Role evidence, and the event-specific consumption steps. Pure; never
 * History, never Reminders, never the CURRENT Role as evidence of a past one.
 *
 * actorDiedTonight: the first not-yet-consumed death event of this
 * participant tonight whose `actualRoleAtEvent` is this ability's character.
 * An event with no Role evidence is UNKNOWN (judgment). For a simulated wake
 * (e.g. a Drunk shown this character) an event recorded under the actor's
 * unchanged Actual Role is UNKNOWN too -- what they were shown at that moment
 * is not recorded -- never assumed. A death under another character never
 * fires it.
 */
export function nightTriggerStatus(
  descriptor: Pick<AbilityDescriptor, "nightTrigger" | "roleId">,
  actor: ParticipantBinding,
  query: RulesQuery,
): NightTriggerStatus {
  if (!descriptor.nightTrigger) return { kind: "notTriggered", reason: "This ability has no verified Night trigger." };
  const moment = query.moment();
  if (!moment || moment.phase !== "night") return { kind: "notTriggered", reason: "A Night trigger exists only during the Night." };
  const consumed = (eventId: string | null) => {
    const status = query.game.nightProgress[nightTriggerProgressKey(moment.day, actor, descriptor.roleId, eventId)]?.status;
    return status === "done" || status === "skipped";
  };
  switch (descriptor.nightTrigger) {
    case "actorDiedTonight": {
      const deaths = query.lifeEvents(moment, (event) => isDeathEvent(event) && event.subject.participantId === actor.participantId);
      const events = deaths.status === "known" ? deaths.events : deaths.recorded;
      const current = query.participant(actor)?.actualRole;
      let resolved = false;
      for (const event of events) {
        if (consumed(event.id)) { resolved = true; continue; }
        const evidence = event.actualRoleAtEvent;
        if (!evidence) return { kind: "unknown", eventId: event.id, reason: "This death has no recorded character evidence: the Storyteller decides whether it triggered this ability." };
        if (evidence === descriptor.roleId) return { kind: "triggered", eventId: event.id };
        if (current !== descriptor.roleId && evidence === current) {
          return { kind: "unknown", eventId: event.id, reason: "A simulated wake: what this player was shown when they died is not recorded -- the Storyteller decides." };
        }
      }
      if (deaths.status === "unknown") {
        if (consumed(null)) return { kind: "notTriggered", reason: "This trigger was already resolved tonight." };
        return { kind: "unknown", eventId: null, reason: "Silverwick cannot tell whether this player died tonight (the Life Event record does not cover tonight): the Storyteller decides." };
      }
      return { kind: "notTriggered", reason: resolved ? "This trigger was already resolved tonight."
        : events.length ? "This player did not die tonight as this character." : "This player has not died tonight." };
    }
  }
  return { kind: "unknown", eventId: null, reason: "Unknown trigger: the Storyteller decides." };
}
