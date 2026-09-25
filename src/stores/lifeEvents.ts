import type {
  GameMoment,
  LifeEvent,
  LifeEventWindow,
  LiveGameMoment,
  ParticipantId,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10A: the Life Event Window read layer and rollover.
 *
 * The Life Event Window (StorytellerLobbyRecord.lifeEventWindow) is
 * authoritative TEMPORARY gameplay state: the Life Events of the current
 * phase and the immediately previous one. It is never History, never
 * reconstructed from History, and never used to reconstruct Current State.
 * Everything here is pure.
 *
 * Game progression is Night 1 -> Day 1 -> Night 2 -> Day 2 -> ... A Life
 * Event query always names the Game Moment it asks about, and answers
 * "unknown" -- never an empty "none" -- whenever absence cannot be trusted:
 *
 *  - notCovered: the moment is before `coverageFrom` (e.g. a game migrated
 *    from v18 mid-game, whose recent phases were never observed under the
 *    v19 event model);
 *  - expired: the moment is older than the retained current/previous pair,
 *    so its events have been pruned;
 *  - future: the moment has not happened yet.
 */

/** Position of a moment on the Night 1, Day 1, Night 2, ... timeline.
 * Setup (and anything before Night 1) is 0; Night N is 2N-1; Day N is 2N. */
export function momentOrdinal(moment: Pick<GameMoment, "phase" | "day">): number {
  if (moment.phase === "night") return 2 * moment.day - 1;
  if (moment.phase === "day") return 2 * moment.day;
  return 0;
}

/** The live moment at a timeline ordinal (>= 1). */
export function momentAtOrdinal(ordinal: number): LiveGameMoment {
  return ordinal % 2 === 1
    ? { phase: "night", day: (ordinal + 1) / 2 }
    : { phase: "day", day: ordinal / 2 };
}

export function sameMoment(a: Pick<GameMoment, "phase" | "day">, b: Pick<GameMoment, "phase" | "day">): boolean {
  return a.phase === b.phase && a.day === b.day;
}

/** The game's current live moment, or null outside Live Play (Setup, or an
 * ended game -- which has no current phase). */
export function currentLiveMoment(game: Pick<StorytellerLobbyRecord, "phase" | "day">): LiveGameMoment | null {
  if (game.phase !== "night" && game.phase !== "day") return null;
  if (!Number.isSafeInteger(game.day) || game.day < 1) return null;
  return { phase: game.phase, day: game.day };
}

/** The live phase immediately before `moment`, or null before Night 1. */
export function previousLiveMoment(moment: LiveGameMoment): LiveGameMoment | null {
  const ordinal = momentOrdinal(moment);
  return ordinal > 1 ? momentAtOrdinal(ordinal - 1) : null;
}

/** The first moment a fresh game observes: Night 1. */
export const FIRST_LIVE_MOMENT: LiveGameMoment = { phase: "night", day: 1 };

/** A brand-new game's window: complete coverage from its first live phase. */
export function freshLifeEventWindow(): LifeEventWindow {
  return { coverageFrom: { ...FIRST_LIVE_MOMENT }, events: [] };
}

/**
 * Phase 10A Section 6: the coverage a v18 game receives when migrated. Its
 * current (and previous) phase were NOT observed under the v19 event model,
 * so complete recording only becomes trustworthy from the NEXT phase:
 *
 *   Setup    -> Night 1
 *   Night N  -> Day N
 *   Day N    -> Night N+1
 *   Ended    -> Night (day+1): a moment an ended game never reaches, so the
 *               window is inert -- no live phase is ever covered.
 *
 * `coverageFrom` may therefore lie in the future. That is not an error: it is
 * the point from which absence of an event becomes meaningful. Returns null
 * for an unusable phase/day, which the caller leaves for schema validation.
 */
export function migratedLifeEventCoverage(phase: unknown, day: unknown): LiveGameMoment | null {
  if (phase === "setup") return { ...FIRST_LIVE_MOMENT };
  if (typeof day !== "number" || !Number.isSafeInteger(day) || day < 0) return null;
  if (phase === "night") return day >= 1 ? { phase: "day", day } : null;
  if (phase === "day") return day >= 1 ? { phase: "night", day: day + 1 } : null;
  if (phase === "ended") return { phase: "night", day: day + 1 };
  return null;
}

/**
 * Phase 10A Section 7: rollover. Keeps exactly the events whose moment is
 * the new current phase or the one immediately before it, in acceptance
 * order; everything else (older -- or, after an unusual backwards phase set,
 * "future" -- events) expires. Returns the SAME window object when nothing
 * expires, so a caller can detect a no-op. Leaving Live Play (an ended game)
 * freezes the window: it is returned unchanged. Setup retains nothing.
 */
export function pruneLifeEventWindow(
  window: LifeEventWindow,
  phase: StorytellerLobbyRecord["phase"],
  day: number,
): LifeEventWindow {
  if (phase === "ended") return window;
  const current = momentOrdinal({ phase, day });
  const events = window.events.filter((event) => {
    const ordinal = momentOrdinal(event.moment);
    return ordinal === current || ordinal === current - 1;
  });
  return events.length === window.events.length ? window : { ...window, events };
}

export type LifeEventUnknownReason = "notCovered" | "expired" | "future";

export type LifeEventCoverage =
  | { status: "covered" }
  | { status: "unknown"; reason: LifeEventUnknownReason };

/**
 * Whether ABSENCE of an event at `moment` is trustworthy in this game right
 * now. `moment` must be a live moment; the game's current phase decides what
 * is retained (an ended game keeps the window it had when it ended, judged
 * against the moment it ended at).
 */
export function lifeEventCoverageAt(
  game: Pick<StorytellerLobbyRecord, "phase" | "day" | "lifeEventWindow">,
  moment: LiveGameMoment,
): LifeEventCoverage {
  const ordinal = momentOrdinal(moment);
  if (ordinal < momentOrdinal(game.lifeEventWindow.coverageFrom)) return { status: "unknown", reason: "notCovered" };
  const current = currentLiveMoment(game);
  if (!current) {
    // Setup has had no live phase yet; an ended game's final phase is not
    // recorded, so nothing it retained can be trusted as complete.
    return game.phase === "setup"
      ? { status: "unknown", reason: "future" }
      : { status: "unknown", reason: "expired" };
  }
  const currentOrdinal = momentOrdinal(current);
  if (ordinal > currentOrdinal) return { status: "unknown", reason: "future" };
  if (ordinal < currentOrdinal - 1) return { status: "unknown", reason: "expired" };
  return { status: "covered" };
}

/**
 * The result of every Life Event query. `known` means the list is complete
 * for that moment (possibly empty: "none occurred"). `unknown` never claims
 * completeness; `recorded` lists whatever matching events ARE present (e.g.
 * a late record into an uncovered phase), for display only.
 */
export type LifeEventQueryResult =
  | { status: "known"; events: LifeEvent[] }
  | { status: "unknown"; reason: LifeEventUnknownReason; recorded: LifeEvent[] };

/** The single generic query: events at exactly `moment` matching `test`, in
 * acceptance order, with coverage honestly reported. */
export function lifeEventsAt(
  game: Pick<StorytellerLobbyRecord, "phase" | "day" | "lifeEventWindow">,
  moment: LiveGameMoment,
  test: (event: LifeEvent) => boolean = () => true,
): LifeEventQueryResult {
  const events = game.lifeEventWindow.events.filter((event) => sameMoment(event.moment, moment) && test(event));
  const coverage = lifeEventCoverageAt(game, moment);
  return coverage.status === "covered"
    ? { status: "known", events }
    : { status: "unknown", reason: coverage.reason, recorded: events };
}

/** A death, however caused: an explicit death event, or an execution/exile
 * whose outcome was "died" (one semantic action = one event). */
export const isDeathEvent = (event: LifeEvent): boolean =>
  event.kind === "death" || ("outcome" in event && event.outcome === "died");

export const deathsAt = (game: Parameters<typeof lifeEventsAt>[0], moment: LiveGameMoment) =>
  lifeEventsAt(game, moment, isDeathEvent);
export const executionsAt = (game: Parameters<typeof lifeEventsAt>[0], moment: LiveGameMoment) =>
  lifeEventsAt(game, moment, (event) => event.kind === "execution");
export const executionDeathsAt = (game: Parameters<typeof lifeEventsAt>[0], moment: LiveGameMoment) =>
  lifeEventsAt(game, moment, (event) => event.kind === "execution" && event.outcome === "died");
export const exilesAt = (game: Parameters<typeof lifeEventsAt>[0], moment: LiveGameMoment) =>
  lifeEventsAt(game, moment, (event) => event.kind === "exile");
export const resurrectionsAt = (game: Parameters<typeof lifeEventsAt>[0], moment: LiveGameMoment) =>
  lifeEventsAt(game, moment, (event) => event.kind === "resurrection");

/** Events about one participation instance at `moment`. Identity is the
 * durable ParticipantId -- never the PlayerId, which a later occupant of the
 * same seat may reuse. */
export const lifeEventsForParticipantAt = (
  game: Parameters<typeof lifeEventsAt>[0],
  participantId: ParticipantId,
  moment: LiveGameMoment,
) => lifeEventsAt(game, moment, (event) => event.subject.participantId === participantId);

/** Every retained event about one participation instance, any moment, in
 * acceptance order. A plain read of the window -- no completeness claim. */
export function retainedLifeEventsFor(
  game: Pick<StorytellerLobbyRecord, "lifeEventWindow">,
  participantId: ParticipantId,
): LifeEvent[] {
  return game.lifeEventWindow.events.filter((event) => event.subject.participantId === participantId);
}

export function findLifeEvent(
  game: Pick<StorytellerLobbyRecord, "lifeEventWindow">,
  eventId: string,
): LifeEvent | undefined {
  return game.lifeEventWindow.events.find((event) => event.id === eventId);
}

/** Short Storyteller-facing description of a moment: "Night 2", "Day 3". */
export function momentLabel(moment: Pick<GameMoment, "phase" | "day">): string {
  if (moment.phase === "setup") return "Setup";
  return `${moment.phase === "night" ? "Night" : "Day"} ${moment.day}`;
}
