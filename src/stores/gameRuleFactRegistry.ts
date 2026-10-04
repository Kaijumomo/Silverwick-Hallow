import type { GameRuleFactType, LiveGameMoment } from "./types";

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
  | "followingDay";

export type GameRuleFactDefinition = {
  type: GameRuleFactType;
  /** Short Storyteller-facing name. */
  label: string;
  /** What it means, in one sentence (presentation only). */
  description: string;
  /** The live phases in which the fact may be applied. */
  applicablePhases: readonly ("night" | "day")[];
  expiry: GameRuleFactExpiryRule;
};

export const PIT_HAG_ARBITRARY_DEATHS = "pitHagArbitraryDeaths";
export const TOYMAKER_DEMON_SKIP_OCCURRED = "toymakerDemonSkipOccurred";

/**
 * The registered Game Rule Fact types -- exactly the two PHASE10G approves.
 *  - pitHagArbitraryDeaths: a functioning Pit-Hag made a Demon tonight, so
 *    deaths tonight are arbitrary (matrix Section 12). Night only; expires on
 *    entering the following Day.
 *  - toymakerDemonSkipOccurred: the Demon has made the Toymaker's required
 *    no-attack skip (matrix Section 16). The POSITIVE fact only -- "skip still
 *    required" is derived, never stored. No automatic expiry.
 */
export const GAME_RULE_FACT_REGISTRY: ReadonlyMap<GameRuleFactType, GameRuleFactDefinition> = new Map([
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
  return undefined;
}
