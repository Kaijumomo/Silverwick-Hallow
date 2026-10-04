import { cloneOwned, durableProvenance, historyId, isLiveGamePhase, type MutationContext } from "./history";
import { currentLiveMoment, momentOrdinal } from "./lifeEvents";
import { GAME_RULE_FACT_TYPE, MutationContextInputSchema, ProvenanceSchema } from "./schemas";
import { gameRuleFactDefinition, registeredGameRuleFactExpiry, TOYMAKER_DEMON_SKIP_OCCURRED } from "./gameRuleFactRegistry";
import type {
  GameRuleFactHistoryRecord,
  GameRuleFactRecord,
  GameRuleFactType,
  LiveGameMoment,
  Provenance,
  StorytellerLobbyRecord,
} from "./types";

/**
 * Phase 10G: Game Rule Facts (PHASE10G Section 4) -- the ONE authoritative
 * home for mechanical state that applies to the game/table rather than to a
 * participant. Narrow on purpose: no rules DSL, no parameters, no free text.
 *
 *  - The registry below is the ONLY place a fact type acquires meaning. An
 *    unknown / custom type stored in a game never acquires a rule: queries
 *    report it unregistered, and the planner never creates one.
 *  - The v25 types are SINGLETONS: applying a fact that is already current is
 *    a true no-op; no duplicate record of a type can coexist (schema-enforced).
 *  - One pure planner + pure application seam; the store's resolveGameRuleFacts
 *    commits a changed plan once (after the persistence preflight), and an
 *    ability resolution composes the same planner inside planAbilityResolution.
 *  - Deterministic expiry happens ONLY inside the phase rollover replacement
 *    (planGameRuleFactExpiry, called from advancePhase).
 *
 * Mechanics read facts from Current State only (gameRuleFactActive / the Rules
 * Query) -- never from History, Reminders or the Activity presentation.
 */

// The registry itself (types, definitions, the intrinsic lifetime) lives in
// gameRuleFactRegistry.ts so the persisted-game schema validates stored facts
// against the SAME definitions the planner applies (ASTRA-10G-004).
export {
  GAME_RULE_FACT_REGISTRY,
  PIT_HAG_ARBITRARY_DEATHS,
  TOYMAKER_DEMON_SKIP_OCCURRED,
  gameRuleFactDefinition,
  registeredGameRuleFactExpiry,
  type GameRuleFactDefinition,
  type GameRuleFactExpiryRule,
} from "./gameRuleFactRegistry";

// ---------------------------------------------------------------------------
// Pure queries (Current State only)
// ---------------------------------------------------------------------------

/** The stored record of `type`, registered or not (inspection only). */
export function storedGameRuleFact(game: Pick<StorytellerLobbyRecord, "gameRuleFacts">, type: GameRuleFactType): GameRuleFactRecord | undefined {
  return (Array.isArray(game.gameRuleFacts) ? game.gameRuleFacts : []).find((fact) => fact.type === type);
}

/**
 * Whether a REGISTERED fact currently applies: stored and not past its exact
 * expiry boundary at the game's own moment (an ended game is frozen -- its
 * final facts stand). An unregistered type is never active: it carries no
 * mechanics, whatever is stored.
 */
export function gameRuleFactActive(game: Pick<StorytellerLobbyRecord, "gameRuleFacts" | "phase" | "day">, type: GameRuleFactType): boolean {
  if (!gameRuleFactDefinition(type)) return false;
  const fact = storedGameRuleFact(game, type);
  if (!fact) return false;
  if (!fact.expiresAt || game.phase === "ended") return true;
  const now = currentLiveMoment(game);
  return !!now && momentOrdinal(now) < momentOrdinal(fact.expiresAt);
}

/** Phase 10G Section 11: the Toymaker requirement, DERIVED from Current State --
 * Toymaker in play (authoritative `game.fabled`) plus the positive skip fact.
 * Inactive Toymaker creates no requirement (the stored fact stays valid game
 * bookkeeping for a later Toymaker). */
export type ToymakerSkipStatus = "inactive" | "required" | "satisfied";
export function toymakerSkipStatus(game: Pick<StorytellerLobbyRecord, "gameRuleFacts" | "phase" | "day" | "fabled">): ToymakerSkipStatus {
  if (!(game.fabled ?? []).includes("toymaker")) return "inactive";
  return gameRuleFactActive(game, TOYMAKER_DEMON_SKIP_OCCURRED) ? "satisfied" : "required";
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

export type GameRuleFactIntent =
  | { kind: "apply"; type: GameRuleFactType }
  | { kind: "remove"; type: GameRuleFactType };

export type GameRuleFactTransaction = {
  /** Ordered; each is planned against the evolving working collection. */
  intents: readonly GameRuleFactIntent[];
  /** A Storyteller correction of wrongly recorded state (History marks it). */
  correction?: boolean;
  context?: MutationContext;
  resolutionId?: string;
};

export type GameRuleFactRefusalCode = "invalid" | "notLive" | "ended" | "unregistered" | "phase" | "notSeated";
export type GameRuleFactRefusal = { ok: false; code: GameRuleFactRefusalCode; message: string; intentIndex?: number };

export type GameRuleFactPlan = {
  /** The complete resulting collection. */
  facts: GameRuleFactRecord[];
  history: GameRuleFactHistoryRecord[];
};

export type GameRuleFactPlanResult =
  | { ok: true; changed: false }
  | { ok: true; changed: true; plan: GameRuleFactPlan }
  | GameRuleFactRefusal;

export type GameRuleFactIdSource = { historyId: () => string };
const DEFAULT_IDS: GameRuleFactIdSource = { historyId };

export const MAX_GAME_RULE_FACT_INTENTS = 8;
export const GAME_RULE_FACT_EXPIRY_PROVENANCE: Provenance = { reason: "expired" };

const refuse = (code: GameRuleFactRefusalCode, message: string, intentIndex?: number): GameRuleFactRefusal =>
  ({ ok: false, code, message, ...(intentIndex !== undefined ? { intentIndex } : {}) });

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const INTENT_KEYS = new Set(["kind", "type"]);

/**
 * Plans one Game Rule Fact transaction against Current State. Pure, never
 * throws, never writes. Returns a structured refusal (nothing changes), a true
 * no-op (every intent already current), or the complete resulting collection
 * plus one explanatory gameRuleFact History Record per real change -- none of
 * which carries a participant.
 */
export function planGameRuleFactTransaction(
  game: StorytellerLobbyRecord,
  transaction: GameRuleFactTransaction,
  ids: GameRuleFactIdSource = DEFAULT_IDS,
): GameRuleFactPlanResult {
  try {
    return plan(game, transaction, ids);
  } catch {
    return refuse("invalid", "Malformed Rule Fact request.");
  }
}

function plan(game: StorytellerLobbyRecord, transaction: GameRuleFactTransaction, ids: GameRuleFactIdSource): GameRuleFactPlanResult {
  if (game.phase === "ended") return refuse("ended", "This game has ended: its Rule Facts are final.");
  if (!isLiveGamePhase(game.phase)) return refuse("notLive", "Rule Facts are recorded only during Night or Day.");
  const now = currentLiveMoment(game);
  if (!now) return refuse("notLive", "Rule Facts are recorded only during Night or Day.");
  if (!isPlainObject(transaction) || !Array.isArray(transaction.intents)) return refuse("invalid", "Malformed Rule Fact request.");
  const { intents, resolutionId, correction } = transaction;
  if (intents.length === 0 || intents.length > MAX_GAME_RULE_FACT_INTENTS) return refuse("invalid", `Give 1-${MAX_GAME_RULE_FACT_INTENTS} Rule Fact changes.`);
  if (correction !== undefined && typeof correction !== "boolean") return refuse("invalid", "Malformed Rule Fact request.");
  if (resolutionId !== undefined && (typeof resolutionId !== "string" || !resolutionId || resolutionId.length > 200)) {
    return refuse("invalid", "Invalid resolution id.");
  }
  let contextInput: MutationContext | undefined;
  if (transaction.context !== undefined) {
    const parsed = MutationContextInputSchema.safeParse(cloneOwned(transaction.context));
    if (!parsed.success) return refuse("invalid", "Invalid Mutation Context -- provenance takes only a source player, source character, reason and note.");
    contextInput = parsed.data;
  }
  const provenance = durableProvenance(game, contextInput?.provenance);
  if (provenance === null) return refuse("notSeated", "The Provenance source Player is not seated.");
  if (provenance !== undefined && !ProvenanceSchema.strict().safeParse(provenance).success) {
    return refuse("invalid", "Invalid Mutation Context provenance.");
  }

  let facts: GameRuleFactRecord[] = Array.isArray(game.gameRuleFacts) ? game.gameRuleFacts : [];
  const history: GameRuleFactHistoryRecord[] = [];
  const record = (operation: "apply" | "remove", item: GameRuleFactRecord) => history.push(cloneOwned({
    id: ids.historyId(),
    category: "gameRuleFact" as const,
    moment: { ...now },
    ruleFactType: item.type,
    ruleFactOperation: operation,
    change: operation === "apply" ? { kind: "added" as const, item } : { kind: "removed" as const, item },
    ...(provenance ? { provenance } : {}),
    ...(resolutionId ? { resolutionId } : {}),
    ...(correction ? { correction: true as const } : {}),
  }));

  for (const [index, intent] of intents.entries()) {
    if (!isPlainObject(intent) || Object.keys(intent).some((key) => !INTENT_KEYS.has(key)) ||
      (intent.kind !== "apply" && intent.kind !== "remove") ||
      typeof intent.type !== "string" || !GAME_RULE_FACT_TYPE.test(intent.type)) {
      return refuse("invalid", "Malformed Rule Fact change.", index);
    }
    const type = intent.type;
    const existing = facts.find((fact) => fact.type === type);
    if (intent.kind === "apply") {
      const definition = gameRuleFactDefinition(type);
      // Only a registered type can ever be created (Section 4.2).
      if (!definition) return refuse("unregistered", `"${type}" is not a Rule Fact Silverwick knows -- nothing was recorded.`, index);
      if (!definition.applicablePhases.includes(now.phase)) {
        return refuse("phase", `${definition.label} can be recorded only during ${definition.applicablePhases.join(" or ")}.`, index);
      }
      if (existing) continue; // singleton already current: a true no-op
      const expiresAt = registeredGameRuleFactExpiry(definition, now);
      const fact: GameRuleFactRecord = cloneOwned({
        type,
        recordedAt: { ...now },
        ...(expiresAt ? { expiresAt } : {}),
        ...(provenance ? { provenance } : {}),
        ...(resolutionId ? { resolutionId } : {}),
      });
      facts = [...facts, fact];
      record("apply", fact);
    } else {
      // Removal / correction may clear any stored type, registered or not
      // (removing state is never a mechanic). Absent: already current.
      if (!existing) continue;
      facts = facts.filter((fact) => fact.type !== type);
      record("remove", existing);
    }
  }
  if (!history.length) return { ok: true, changed: false };
  return { ok: true, changed: true, plan: { facts, history } };
}

/** Pure application of one accepted plan (expiry plans included). */
export function applyGameRuleFactPlan(game: StorytellerLobbyRecord, plan: GameRuleFactPlan): StorytellerLobbyRecord {
  return { ...game, gameRuleFacts: plan.facts, history: [...game.history, ...plan.history] };
}

/**
 * Phase 10G Section 6: the deterministic expiry of every fact whose exact
 * boundary is `destination` (or earlier) -- planned for the SAME advancePhase
 * replacement that rolls the Life Event Window and expires Effects. One
 * explanatory `expire` History Record per fact at the destination moment.
 * Null when nothing expires. Never a correction; never a second commit.
 */
export function planGameRuleFactExpiry(
  game: StorytellerLobbyRecord,
  destination: LiveGameMoment,
  ids: GameRuleFactIdSource = DEFAULT_IDS,
): GameRuleFactPlan | null {
  const facts = Array.isArray(game.gameRuleFacts) ? game.gameRuleFacts : [];
  const expired = facts.filter((fact) => fact.expiresAt && momentOrdinal(fact.expiresAt) <= momentOrdinal(destination));
  if (!expired.length) return null;
  return {
    facts: facts.filter((fact) => !expired.includes(fact)),
    history: expired.map((fact) => cloneOwned({
      id: ids.historyId(),
      category: "gameRuleFact" as const,
      moment: { ...destination },
      ruleFactType: fact.type,
      ruleFactOperation: "expire" as const,
      change: { kind: "removed" as const, item: fact },
      provenance: { ...GAME_RULE_FACT_EXPIRY_PROVENANCE },
    })),
  };
}
