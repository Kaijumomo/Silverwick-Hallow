import type { AbilityDescriptor, AbilityInvocation, AbilityTiming, NightTriggerKind } from "./semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import { isDeathEvent } from "@/stores/lifeEvents";
import { PIT_HAG_ARBITRARY_DEATHS } from "@/stores/gameRuleFactRegistry";
import { encodeNightProgressComponent, nightTriggerStepKey } from "@/stores/nightProgress";
import type { LifeEvent, StorytellerLobbyRecord } from "@/stores/types";

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
      ? "This ability acts when something triggers it (such as the Ravenkeeper dying tonight), so it has no place of its own in the Night order. Run it from its trigger, or resolve it by hand."
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
 * bound to the trigger event it is about (SOL-10F-A1 / A10). The event id uses
 * the same injective, never-throwing component encoding as the trigger's
 * Night-progress key (SOL-10F-B5). */
export const nightTriggerJudgmentId = (trigger: NightTriggerKind, eventId: string | null) =>
  `trigger:${trigger}:${eventId === null ? "n" : `i${encodeNightProgressComponent(eventId)}`}`;

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
 * actorKilledByDemonTonight (SV-1a): the same, passing over a death whose
 * recorded cause is a character that is not a Demon (recordedDeathCause). An
 * unrecorded cause, or any death on a night a Pit-Hag made deaths arbitrary,
 * still opens the step: the ability then asks the Storyteller first.
 * An event with no Role evidence is UNKNOWN (judgment). For a simulated wake
 * (a Drunk or Marionette currently shown this character) an event recorded
 * under the actor's unchanged Actual Role is TRIGGERED: the Storyteller shows
 * whatever they choose, exactly as for a poisoned holder. Any other shown
 * character leaves it UNKNOWN -- never assumed. A death under another character never
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
  /** The first open death of this participant tonight that `counts` for the trigger (actorDiedTonight counts every one). */
  const diedTonight = (counts: (event: LifeEvent) => boolean, skipped: string): NightTriggerStatus => {
    const deaths = query.lifeEvents(moment, (event) => isDeathEvent(event) && event.subject.participantId === actor.participantId);
    const events = deaths.status === "known" ? deaths.events : deaths.recorded;
    if (deaths.status === "unknown") {
      const event = events.find(candidate => !consumed(candidate.id));
      if (!event && (consumed(null) || events.length > 0)) return { kind: "notTriggered", reason: "This trigger was already resolved tonight." };
      return { kind: "unknown", eventId: event?.id ?? null, reason: "Silverwick cannot confirm who died tonight. Check whether this player died, then resolve it by hand." };
    }
    const holder = query.participant(actor);
    const current = holder?.actualRole;
    let resolved = false, passed = false;
    for (const event of events) {
      if (consumed(event.id)) { resolved = true; continue; }
      const evidence = event.actualRoleAtEvent;
      if (!evidence) return { kind: "unknown", eventId: event.id, reason: "This death has no recorded character evidence: the Storyteller decides whether it triggered this ability." };
      if (evidence === descriptor.roleId) {
        if (!counts(event)) { passed = true; continue; }
        return { kind: "triggered", eventId: event.id };
      }
      if (current !== descriptor.roleId && evidence === current) {
        // A simulated wake (a Drunk or Marionette shown this character, like a poisoned holder) is triggered by the
        // death of that exact participant tonight. What it shows is the Storyteller's choice, so it needs no recorded evidence.
        if (holder?.shownRole === descriptor.roleId) {
          if (!counts(event)) { passed = true; continue; }
          return { kind: "triggered", eventId: event.id };
        }
        return { kind: "unknown", eventId: event.id, reason: "A simulated wake: what this player was shown when they died is not recorded -- the Storyteller decides." };
      }
    }
    return { kind: "notTriggered", reason: resolved ? "This trigger was already resolved tonight."
      : passed ? skipped : events.length ? "This player did not die tonight as this character." : "This player has not died tonight." };
  };
  switch (descriptor.nightTrigger) {
    case "actorDiedTonight":
      return diedTonight(() => true, "");
    case "actorKilledByDemonTonight": {
      return diedTonight((event) => recordedDeathCause(query, event).kind !== "other", "This player was not killed by the Demon tonight.");
    }
  }
  return { kind: "unknown", eventId: null, reason: "Unknown trigger: the Storyteller decides." };
}

/** SV-1a: what a recorded death says about its cause. A guided resolution records the character whose ability caused the death
 * (and that player) on the death's existing provenance; a death entered by hand records none. */
export type RecordedDeathCause =
  /** A Demon's ability. `killer` is the player recorded as its source, or null if none was recorded. */
  | { kind: "demon"; killer: ParticipantBinding | null }
  /** Another character's ability (an execution is a Day event and never a night death). */
  | { kind: "other" }
  /** Nothing recorded (a death entered by hand, or a manual resolution), or `arbitrary`: a Pit-Hag made deaths arbitrary
   * tonight, so no recorded cause is trusted ("Because the Sage died due to the Pit-Hag, not the Demon, the Sage does not
   * wake"). Either way the Storyteller knows. */
  | { kind: "unrecorded"; arbitrary: boolean };

export function recordedDeathCause(query: Pick<RulesQuery, "roleOf" | "gameRuleFact">, event: LifeEvent): RecordedDeathCause {
  const arbitrary = query.gameRuleFact(PIT_HAG_ARBITRARY_DEATHS);
  if (arbitrary.known && arbitrary.value) return { kind: "unrecorded", arbitrary: true };
  const provenance = event.provenance;
  const character = provenance?.sourceCharacter;
  if (!provenance || !character || provenance.reason === "manual") return { kind: "unrecorded", arbitrary: false };
  const role = query.roleOf(character);
  if (!role) return { kind: "unrecorded", arbitrary: false };
  if (role.type !== "demon") return { kind: "other" };
  const source = provenance.sourceParticipant;
  return { kind: "demon", killer: source?.kind === "participant" ? { playerId: source.playerId, participantId: source.participantId } : null };
}
