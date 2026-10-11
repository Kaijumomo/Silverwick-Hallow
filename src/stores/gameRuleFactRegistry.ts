import type { GameRuleFactType, LiveGameMoment, GameRuleFactRecord, StorytellerLobbyRecord, LifeEvent } from "./types";

/**
 * Phase 10G: the Game Rule Fact REGISTRY (PHASE10G Section 4.2) -- the only
 * place a fact type acquires meaning. Pure data plus the one intrinsic-lifetime
 * rule, with no store/schema imports, so BOTH the planner (gameRuleFacts.ts)
 * and the persisted-game schema (schemas.ts) read the same definitions: a
 * recovered registered fact must have exactly the lifetime the planner would
 * have given it (ASTRA-10G-004). An unregistered type has no definition here
 * and so no lifetime semantics either.
 */

/** When an applied fact expires, resolved ONCE at application. */
export type GameRuleFactExpiryRule =
  /** No automatic expiry -- the Storyteller removes it. */
  | "none"
  /** Recorded on Night N: expires on entering Day N (the following Day). */
  | "followingDay"
  /** A Day qualification remains available through the immediately following Night. */
  | "nextDay"
  /** Retained exactly as long as its current/previous-phase Life Event. */
  | "lifeEventWindow";

export type GameRuleFactDefinition = {
  type: GameRuleFactType;
  /** Short Storyteller-facing name. */
  label: string;
  /** What it means, in one sentence (presentation only). */
  description: string;
  /** The live phases in which the fact may be applied. */
  applicablePhases: readonly ("night" | "day")[];
  expiry: GameRuleFactExpiryRule;
  /** Recorded only by the atomic qualifying-event planner, never generic fact apply. */
  captureOnly?: true;
};

export const PIT_HAG_ARBITRARY_DEATHS = "pitHagArbitraryDeaths";
export const TOYMAKER_DEMON_SKIP_OCCURRED = "toymakerDemonSkipOccurred";
export const SAINT_EXECUTION_GOOD_TEAM_LOST = "saintExecutionGoodTeamLost";
export const SAINT_EXECUTION_EVIL_TEAM_LOST = "saintExecutionEvilTeamLost";
export const SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED = "saintExecutionGoodTeamNotQualified";
export const SAINT_EXECUTION_EVIL_TEAM_NOT_QUALIFIED = "saintExecutionEvilTeamNotQualified";
export const MAYOR_DAY_END_GOOD_TEAM_WON = "mayorDayEndGoodTeamWon";
export const MAYOR_DAY_END_EVIL_TEAM_WON = "mayorDayEndEvilTeamWon";
export const RESOLVED_DEMON_DEATH_NO_SUCCESSOR = "resolvedDemonDeathNoSuccessor";
export const VICTORY_EVIDENCE_TYPES = [SAINT_EXECUTION_GOOD_TEAM_LOST, SAINT_EXECUTION_EVIL_TEAM_LOST, SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED, SAINT_EXECUTION_EVIL_TEAM_NOT_QUALIFIED, MAYOR_DAY_END_GOOD_TEAM_WON, MAYOR_DAY_END_EVIL_TEAM_WON, RESOLVED_DEMON_DEATH_NO_SUCCESSOR] as const;
export const isVictoryEvidenceType = (type: string): boolean => (VICTORY_EVIDENCE_TYPES as readonly string[]).includes(type);
export const isSaintNonqualifyingEvidenceType = (type: string): boolean => type === SAINT_EXECUTION_GOOD_TEAM_NOT_QUALIFIED || type === SAINT_EXECUTION_EVIL_TEAM_NOT_QUALIFIED;

/**
 * The original two Phase 10G facts plus the seven finite B8 qualifications
 * approved by the temporal-evidence extension. B8 facts are capture-only.
 *  - pitHagArbitraryDeaths: a functioning Pit-Hag made a Demon tonight, so
 *    deaths tonight are arbitrary (matrix Section 12). Night only; expires on
 *    entering the following Day.
 *  - toymakerDemonSkipOccurred: the Demon has made the Toymaker's required
 *    no-attack skip (matrix Section 16). The POSITIVE fact only -- "skip still
 *    required" is derived, never stored. No automatic expiry.
 */
export const GAME_RULE_FACT_REGISTRY: ReadonlyMap<GameRuleFactType, GameRuleFactDefinition> = new Map<GameRuleFactType, GameRuleFactDefinition>([
  [PIT_HAG_ARBITRARY_DEATHS, {
    type: PIT_HAG_ARBITRARY_DEATHS,
    label: "Arbitrary deaths tonight",
    description: "A Pit-Hag made a Demon tonight: deaths tonight are arbitrary -- the Storyteller decides each death.",
    applicablePhases: ["night"],
    expiry: "followingDay",
  }],
  [TOYMAKER_DEMON_SKIP_OCCURRED, {
    type: TOYMAKER_DEMON_SKIP_OCCURRED,
    label: "Toymaker skip made",
    description: "The Demon has chosen not to attack at least once, satisfying the Toymaker's required skip.",
    applicablePhases: ["night", "day"],
    expiry: "none",
  }],
  ...VICTORY_EVIDENCE_TYPES.filter(type => type !== RESOLVED_DEMON_DEATH_NO_SUCCESSOR).map(type => [type, {
    type, label: "Game-ending qualification", description: "Verified qualification at an authoritative event or Day-end boundary; the Storyteller declares the winner.",
    applicablePhases: ["day"] as const, expiry: "nextDay" as const, captureOnly: true as const,
  }] as const),
  [RESOLVED_DEMON_DEATH_NO_SUCCESSOR, {
    type: RESOLVED_DEMON_DEATH_NO_SUCCESSOR, label: "Demon death resolved", description: "A verified complete death resolution left no living Demon and no unresolved successor.",
    applicablePhases: ["night", "day"], expiry: "lifeEventWindow", captureOnly: true,
  }],
]);

export const gameRuleFactDefinition = (type: unknown): GameRuleFactDefinition | undefined =>
  typeof type === "string" && GAME_RULE_FACT_REGISTRY.has(type) ? GAME_RULE_FACT_REGISTRY.get(type) : undefined;

/**
 * The exact expiry boundary of a registered fact recorded at `recordedAt`
 * (resolved once, at application). Undefined means the fact never expires
 * automatically.
 */
export function registeredGameRuleFactExpiry(definition: GameRuleFactDefinition, recordedAt: LiveGameMoment): LiveGameMoment | undefined {
  if (definition.expiry === "followingDay" && recordedAt.phase === "night") return { phase: "day", day: recordedAt.day };
  if (definition.expiry === "nextDay" && recordedAt.phase === "day") return { phase: "day", day: recordedAt.day + 1 };
  if (definition.expiry === "lifeEventWindow") return { phase: recordedAt.phase, day: recordedAt.day + 1 };
  return undefined;
}

/** Current evidence is self-contained in the existing finite fact shape. Saint
 * resolutionId deliberately names the EXACT execution LifeEvent.id, not its
 * possibly shared action resolutionId. History snapshots are not current facts
 * and therefore do not need a still-retained event. No text carries mechanics. */
export function victoryEvidenceInvalidReason(game: Pick<StorytellerLobbyRecord, "players" | "phase" | "day" | "lifeEventWindow">, fact: GameRuleFactRecord): string | null {
  if (!isVictoryEvidenceType(fact.type)) return null;
  const source = fact.provenance?.sourceParticipant;
  const saint = fact.type === SAINT_EXECUTION_GOOD_TEAM_LOST || fact.type === SAINT_EXECUTION_EVIL_TEAM_LOST || isSaintNonqualifyingEvidenceType(fact.type);
  const demon = fact.type === RESOLVED_DEMON_DEATH_NO_SUCCESSOR;
  const role = demon ? "imp" : saint ? "saint" : "mayor";
  if (!source || source.kind !== "participant" || !source.participantId || fact.provenance?.sourceCharacter !== role || fact.provenance.reason !== undefined || fact.provenance.note !== undefined) return "Qualification requires its exact character and durable participant source.";
  const player = game.players[source.playerId];
  if (!player || player.isEmpty || player.participantId !== source.participantId) return "Qualification source no longer belongs to this game.";
  if ((!demon && fact.recordedAt.phase !== "day") || fact.expiresAt?.phase !== fact.recordedAt.phase || fact.expiresAt.day !== fact.recordedAt.day + 1) return "Qualification has an invalid lifetime.";
  if (demon) {
    const event = game.lifeEventWindow.events.find(event => event.id === fact.resolutionId);
    if (!event || !(event.kind === "death" || event.kind === "execution" && event.outcome === "died") || event.actualRoleAtEvent !== "imp" || event.moment.phase !== fact.recordedAt.phase || event.moment.day !== fact.recordedAt.day || event.subject.participantId !== source.participantId || event.subject.playerId !== source.playerId) return "Demon resolution must reference its exact retained Imp death.";
    if (player.actualRole !== "imp" || player.alive || Object.values(game.players).some(player => !player.isEmpty && player.alive && player.actualRole === "imp")) return "Demon resolution requires its dead Imp identity and no living Imp.";
  } else if (saint) {
    const event = game.lifeEventWindow.events.find(event => event.id === fact.resolutionId);
    if (!event || event.kind !== "execution" || event.outcome !== "died" || event.actualRoleAtEvent !== "saint" || event.moment.day !== fact.recordedAt.day || event.subject.participantId !== source.participantId || event.subject.playerId !== source.playerId) return "Saint qualification must reference its exact retained execution death.";
  } else {
    if (fact.resolutionId !== undefined) return "Mayor qualification references a Day-end boundary, not a Life Event.";
    if (game.phase !== "ended" && (game.phase !== "night" || game.day !== fact.recordedAt.day + 1)) return "Mayor qualification is valid only after its exact Day-end boundary.";
    const coverage = game.lifeEventWindow.coverageFrom;
    if (coverage.day > fact.recordedAt.day || game.lifeEventWindow.events.some(event => event.kind === "execution" && event.moment.day === fact.recordedAt.day)) return "Mayor qualification requires its covered Day with no execution.";
  }
  return null;
}

/** Only this narrow pair can coexist: a Saint did NOT qualify earlier, then
 * the last Demon died. The negative Saint evidence remains necessary so its
 * execution is never reinterpreted after impairment expires. */
export function victoryEvidenceCollectionInvalidReason(facts: readonly GameRuleFactRecord[], events?: readonly LifeEvent[]): string | null {
  const evidence = facts.filter(fact => isVictoryEvidenceType(fact.type));
  if (evidence.length <= 1) return null;
  if (evidence.length === 2) {
    const demon = evidence.find(fact => fact.type === RESOLVED_DEMON_DEATH_NO_SUCCESSOR);
    const saint = evidence.find(fact => isSaintNonqualifyingEvidenceType(fact.type));
    if (demon && saint) {
      const ordinal = (moment: LiveGameMoment) => moment.day * 2 - (moment.phase === "night" ? 1 : 0);
      if (ordinal(demon.recordedAt) < ordinal(saint.recordedAt)) return "Resolved Demon death cannot precede the retained Saint execution.";
      if (events && ordinal(demon.recordedAt) === ordinal(saint.recordedAt) && events.findIndex(event => event.id === demon.resolutionId) <= events.findIndex(event => event.id === saint.resolutionId)) return "Resolved Demon death must follow the exact retained Saint execution.";
      return null;
    }
  }
  return "Only a resolved Demon death and one nonqualifying Saint execution may coexist.";
}
