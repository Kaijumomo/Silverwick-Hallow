import { isDeathEvent, momentLabel } from "@/stores/lifeEvents";
import { lifeStatusOf, type LifeState } from "@/stores/lifeState";
import type { LifeStatusTarget } from "@/stores/lifeResolution";
import type { LifeEvent, StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

/** Storyteller-facing wording for one Life Event (without the subject). */
export function lifeEventAction(event: LifeEvent): string {
  switch (event.kind) {
    case "death": return "died";
    case "resurrection": return "resurrected";
    case "execution":
      return event.outcome === "died" ? "executed — died"
        : event.outcome === "survived" ? "executed — survived" : "executed — already dead";
    case "exile":
      return event.outcome === "died" ? "exiled — died" : "exiled — survived";
  }
}

/** "Alice — executed — died (Day 2)". The name is the one recorded at the
 * time (ParticipantRef.nameAtTime), never re-read from the current seat. */
export function describeLifeEvent(event: LifeEvent, withMoment = true): string {
  return `${event.subject.nameAtTime || "Unnamed player"} — ${lifeEventAction(event)}${withMoment ? ` (${momentLabel(event.moment)})` : ""}`;
}

/** The current occupant of an event's seat, only if it is still the SAME
 * participation instance (never a later occupant of that PlayerId). */
export function currentSubjectOf(game: StorytellerLobbyRecord, event: LifeEvent): STPlayerRecord | undefined {
  const player = Object.prototype.hasOwnProperty.call(game.players, event.subject.playerId)
    ? game.players[event.subject.playerId] : undefined;
  return player && !player.isEmpty && player.participantId === event.subject.participantId ? player : undefined;
}

/** A note when Current State now differs from what a recent event implies
 * (e.g. a later status correction). Informational only -- never an error. */
export function eventStateNote(game: StorytellerLobbyRecord, event: LifeEvent): string | null {
  const subject = currentSubjectOf(game, event);
  if (!subject) return "No longer seated.";
  if (isDeathEvent(event) && subject.alive) return "Currently alive.";
  if (event.kind === "resurrection" && !subject.alive) return "Currently dead.";
  return null;
}

export type StatusChoice = "keep" | LifeState;

/** Status choices for a correction. Exile-death only for a Traveler. */
export function statusChoicesFor(player: Pick<STPlayerRecord, "isTraveler">): { value: StatusChoice; label: string }[] {
  return [
    { value: "keep", label: "Leave status as it is" },
    { value: "alive", label: "Alive" },
    { value: "deadVote", label: "Dead — vote available" },
    { value: "deadVoteUsed", label: "Dead — vote used" },
    ...(player.isTraveler ? [
      { value: "exiledVote" as const, label: "Exiled — vote available" },
      { value: "exiledVoteUsed" as const, label: "Exiled — vote used" },
    ] : []),
  ];
}

export function statusTargetOf(choice: LifeState): LifeStatusTarget {
  switch (choice) {
    case "alive": return { alive: true };
    case "deadVote": return { alive: false, ghostVote: true };
    case "deadVoteUsed": return { alive: false, ghostVote: false };
    case "exiledVote": return { alive: false, ghostVote: true, exiled: true };
    case "exiledVoteUsed": return { alive: false, ghostVote: false, exiled: true };
  }
}

/** The status a correction would most naturally restore after RETRACTING
 * `event` -- a suggestion the Storyteller sees and may change, never
 * applied implicitly. */
export function suggestedStatusAfterRetract(game: StorytellerLobbyRecord, event: LifeEvent): StatusChoice {
  const subject = currentSubjectOf(game, event);
  if (!subject) return "keep";
  if (isDeathEvent(event) && !subject.alive) return "alive";
  if (event.kind === "resurrection" && subject.alive) return "deadVote";
  return "keep";
}

/** The status an event would naturally imply for its (seated) subject --
 * used to pre-fill the explicit repair of an amendment or late record. */
export function suggestedStatusForEvent(
  subject: STPlayerRecord | undefined,
  kind: LifeEvent["kind"],
  outcome: string | undefined,
): StatusChoice {
  if (!subject) return "keep";
  const current = lifeStatusOf(subject).state;
  const dies = kind === "death" || outcome === "died";
  if (dies) {
    const target: LifeState = kind === "exile" ? "exiledVote" : "deadVote";
    return current === target || (!subject.alive && kind !== "exile") ? "keep" : target;
  }
  if (kind === "resurrection") return subject.alive ? "keep" : "alive";
  if (outcome === "survived") return subject.alive ? "keep" : "alive";
  return "keep";
}
