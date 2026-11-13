import { isCanonicalRole } from "@/data/canonical";
import { causeBypassesEffectProtection, isNeighbourPoisoner, lifeRuleReadsSeating, observerRegistrationDecision, passiveProtection, passiveInformationModifiers, passiveRegistrationOptions, survivesFirstDeath, type LifeRuleCause } from "@/abilities/characters/passiveRules";
import { isInnkeeperSelfEffect, isPoisonerSelfEffect } from "@/abilities/characters/poisonerRules";
import type { RoleRegistry } from "@/data/roleRegistry";
import { activeModifiers, gateEvaluation, type HookScope, type ModifierDefinition, type ModifierGate } from "@/abilities/modifiers";
import { resolveAbilitySemantics, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { currentLiveMoment, lifeEventsAt, type LifeEventQueryResult } from "./lifeEvents";
import { gameRuleFactActive, gameRuleFactDefinition } from "./gameRuleFacts";
import type { ParticipantBinding } from "./abilityResolution";
import type { Alignment, EffectRecord, LifeEvent, LiveGameMoment, RoleDef, RoleId, RoleType, STPlayerRecord, Script, StorytellerLobbyRecord } from "./types";

/**
 * Phase 10F: the Rules Query layer (PHASE10F Section 3.2) -- pure, DERIVED
 * answers ability evaluators need. Nothing computed here is ever persisted:
 * Effect `state` stays lifecycle state, never cached applicability
 * (10F-AC-13). Every answer is either KNOWN (one mechanically correct answer
 * from authoritative Current State) or UNKNOWN with a reason -- an unknown,
 * custom, cyclic or unmodeled interaction is never resolved by invention; the
 * evaluator turns it into an explicit Storyteller judgment.
 *
 * Reminders are never read (architecture-guarded): they are notation, not
 * truth. History is never read: Current State and the Life Event Window are
 * the only mechanical sources. Phase 10G: game-scoped Rule Facts are read from
 * Current State (`gameRuleFacts`) the same way -- never from History, Reminders
 * or the Activity presentation.
 */

export type QueryAnswer<T> =
  | { known: true; value: T }
  | { known: false; reason: string };

const known = <T,>(value: T): QueryAnswer<T> => ({ known: true, value });
const unknown = <T,>(reason: string): QueryAnswer<T> => ({ known: false, reason });

/**
 * The APPROVED semantic interpretation of known Effect types -- the one place
 * a stored Effect type acquires mechanical meaning. Kept apart from the
 * presentation registry (which never decides mechanics). An unlisted / custom
 * type acquires NO rule by name: it is always "unknown".
 *
 *  - impairment: the bearer has no functioning ability (Drunk/Poisoned:
 *    "has no ability but believes they do").
 *  - noAbility: the bearer's ability is lost.
 *  - demonProtection / deathImmunity: distinct protection semantics (Safe
 *    from the Demon vs Cannot die) -- never conflated (10F-AC-14).
 *  - genericProtection: the generic manual "Protected" marker. It NEVER means
 *    "cannot die" automatically; any death question needs a Storyteller
 *    decision.
 *  - judgment: an interaction that always needs a Storyteller decision.
 *  - storytellerFact: Phase 10F Slice 7 -- Storyteller-private authoritative
 *    state recorded as an Effect (e.g. the Fortune Teller's Red Herring,
 *    matrix Section 7). It applies exactly while active, with NO dependence on
 *    any source functioning; only the evaluator that owns the fact decides
 *    when it matters. It is never a Reminder.
 */
export type DeathOutcomeAnswer = { kind: "dies" } | { kind: "survives"; spends: boolean };
export type EffectSemantics = "impairment" | "noAbility" | "demonProtection" | "deathImmunity" | "genericProtection" | "judgment" | "storytellerFact" | "curse" | "retainedAbility";
export const APPROVED_EFFECT_SEMANTICS: Readonly<Record<string, EffectSemantics>> = {
  drunk: "impairment",
  poisoned: "impairment",
  abilityLost: "noAbility",
  safeFromDemon: "demonProtection",
  cannotDie: "deathImmunity",
  protected: "genericProtection",
  soberHealthy: "judgment",
  registersFalsely: "judgment",
  fortuneTellerRedHerring: "storytellerFact",
  /** The Witch's curse: applies while its source functions; the Day nomination prompt reads it. */
  witchCurse: "curse",
  /** The Moonchild's public Day choice (a good player): the dead Moonchild has no functioning source, so it applies as recorded
   * and the Night wake reads it through factHolders. Whether the Moonchild still has the ability tonight is decided by the wake. */
  moonchildChoice: "storytellerFact",
  /** The Moonchild's public choice of an EVIL player (nothing happens): a recorded Storyteller fact with no token. */
  moonchildUnaffected: "storytellerFact",
  /** A Minion the Vigormortis killed keeps its ability (the official HAS ABILITY token): applies while that Vigormortis functions
   * and the holder is still a Minion. Holds the dead Minion's ability for the dead-actor rule and its sourced Effects. */
  retainsAbility: "retainedAbility",
  /** The Shabaloth's two chosen players (official DEAD token) and a regurgitated player (official ALIVE token): Storyteller facts that
   * record last night's choice; the Dusk regurgitation reads them through factHolders. They move or end only when the Shabaloth acts. */
  shabalothChosen: "storytellerFact",
  shabalothAlive: "storytellerFact",
  /** LS-2b: the Storyteller's setup decision of how a Spy or Recluse registers for the Tea Lady's ability (no source, no token).
   * Read only by registrationAnswers for that observer; never a Reminder. */
  registersGoodToTeaLady: "storytellerFact",
  registersEvilToTeaLady: "storytellerFact",
};
export const effectSemanticsOf = (type: string): EffectSemantics | undefined =>
  Object.prototype.hasOwnProperty.call(APPROVED_EFFECT_SEMANTICS, type) ? APPROVED_EFFECT_SEMANTICS[type] : undefined;

/**
 * Canonical characters whose (pinned canonical) ability text can make SOME
 * participant register as something other than their Actual Role / Actual
 * Alignment. STRUCTURAL ONLY: it never computes a false registration; it only
 * makes the registration answer UNKNOWN (a Storyteller judgment) where such
 * an ability could apply. `self`: the bearer may misregister; `anyGood`: any
 * good participant may; `observerGood`: a good participant may, as seen by the
 * bearer.
 */
export const REGISTRATION_ALTERING: Readonly<Record<RoleId, "self" | "anyGood" | "observerGood">> = {
  recluse: "self",
  spy: "self",
  zombuul: "self",
  legion: "self",
  lycanthrope: "anyGood",
  // Phase 10F Slice 7: the Fortune Teller's "a good player registers as a
  // Demon to you" is no longer a blanket registration judgment -- it is the
  // authoritative `fortuneTellerRedHerring` fact (matrix Section 7), read by the
  // Fortune Teller evaluator through factHolders().
};

export type RulesQueryEnvironment = {
  registry: RoleRegistry;
  script: Pick<Script, "characters"> | null;
  semantics?: AbilitySemanticsRegistry;
  /** Precomputed active modifiers (defaults to activeModifiers(game, registry)). */
  modifiers?: readonly ModifierDefinition[];
};

export type RegistrationAnswer = {
  character: QueryAnswer<RoleId>;
  alignment: QueryAnswer<Alignment>;
};

export type RulesQuery = {
  game: StorytellerLobbyRecord;
  /** The current live Game Moment, or null outside Night/Day. */
  moment: () => LiveGameMoment | null;
  /** The occupied record bound to EXACTLY this participation instance, or null
   * (empty seat, another occupant -- stale). */
  participant: (binding: ParticipantBinding) => STPlayerRecord | null;
  isAlive: (binding: ParticipantBinding) => QueryAnswer<boolean>;
  /** Whether a stored Effect currently applies MECHANICALLY (derived). */
  effectApplies: (holder: ParticipantBinding, effect: EffectRecord) => QueryAnswer<boolean>;
  /** Whether a (dead) Minion still has its ability because a living, functioning Vigormortis killed it (derived, never stored). */
  retainsAbility: (binding: ParticipantBinding) => QueryAnswer<boolean>;
  /** Drunk/Poisoned impairment (derived from applicable Effects). */
  impaired: (binding: ParticipantBinding) => QueryAnswer<boolean>;
  /** Whether the participant's ability functions: not impaired and not lost.
   * Death is reported separately (isAlive); whether an ability works while
   * dead is character semantics. */
  abilityFunctions: (binding: ParticipantBinding) => QueryAnswer<boolean>;
  /** Whether a living, functioning No Dashii poisons this player through its passive (derived, never stored). */
  noDashiiPoisoned: (binding: ParticipantBinding) => QueryAnswer<boolean>;
  /** Protection against a death of `cause`. `generic` Protected never answers
   * "protected" automatically. LS-2a causes: "demon", "execution", "assassin"
   * (goes around every prevention, Effects included) and "any" (any other death). */
  protectedFrom: (binding: ParticipantBinding, cause: LifeRuleCause) => QueryAnswer<boolean>;
  /** LS-1: what a death attempt of `cause` does to this player, INCLUDING a character that survives its first death at a cost
   * (the Fool). Other protection is checked first and spends nothing. `spends` says the survival uses up the player's own
   * ability; the caller records that use. Unknown stays a Storyteller judgment, exactly as for `protectedFrom`. */
  deathOutcome: (binding: ParticipantBinding, cause: LifeRuleCause) => QueryAnswer<DeathOutcomeAnswer>;
  /** SOL-10F-C2: a deterministic, EXACT (never hashed) stamp of every piece of
   * authoritative Current State this query can consult when answering
   * `protectedFrom(binding, cause)` -- under THIS query's state, hypothetical
   * `assumingAlive` overlays included. Equal stamps mean the protection
   * question is being asked of the same state; any change that can alter
   * protection applicability changes it. A conservative superset: it may also
   * change after an unrelated mechanical change, never miss a relevant one.
   * Transient workflow identity only; never persisted. */
  protectionDependencyStamp: (binding: ParticipantBinding, cause: LifeRuleCause) => string;
  /** What the participant registers as, to an `observer` character. */
  registration: (binding: ParticipantBinding, observer?: RoleId) => RegistrationAnswer;
  /** Whether every possible registration gives the same answer to THIS type
   * question. Optional registration is never selected or stored here. */
  registersAsType: (binding: ParticipantBinding, type: RoleType, observer?: RoleId) => QueryAnswer<boolean>;
  /** The nearest living participants on each side (skipping empty seats and
   * the dead), or null when there is none. */
  aliveNeighbours: (binding: ParticipantBinding) => QueryAnswer<{ left: ParticipantBinding | null; right: ParticipantBinding | null }>;
  /** The nearest Townsfolk each way round the table (dead included; Outsiders,
   * Minions, Travellers and empty seats skipped), or UNKNOWN where a registration
   * could change who counts. A null side means there is no Townsfolk. */
  nearestTownsfolk: (binding: ParticipantBinding) => QueryAnswer<{ clockwise: ParticipantBinding | null; counterclockwise: ParticipantBinding | null }>;
  /** Phase 10F Slice 7: the ACTIVE registry's definition of `roleId` (its
   * character type, canonical ownership...), or undefined. Definitions only --
   * never ability prose interpretation. */
  roleOf: (roleId: RoleId) => RoleDef | undefined;
  /** Occupied participants whose ACTUAL Role is `roleId`. */
  inPlay: (roleId: RoleId) => ParticipantBinding[];
  /** Phase 10F Slice 7: every current participant holding an ACTIVE Effect of
   * an approved `storytellerFact` type, with the Effect id (authoritative
   * Current State only -- never a Reminder). Unknown for any other type: a
   * custom Effect name is never treated as a fact. */
  factHolders: (type: string) => QueryAnswer<{ holder: ParticipantBinding; effectId: string }[]>;
  /** Life Events at `moment` (with honest coverage). */
  lifeEvents: (moment: LiveGameMoment, test?: (event: LifeEvent) => boolean) => LifeEventQueryResult;
  /** Phase 10G (PHASE10G Section 7): whether a REGISTERED game-scoped Rule
   * Fact currently applies, from this query's Current State (inside an ability
   * composition, the evolving working snapshot the query was built on). An
   * unregistered / custom type is UNKNOWN -- it never acquires a rule by name. */
  gameRuleFact: (type: string) => QueryAnswer<boolean>;
  /** The modifier gate for an evaluation of `roleId` touching `scopes`. */
  modifierGate: (roleId: RoleId, scopes: readonly HookScope[]) => ModifierGate;
  /** Phase 10F Slice 7: the same derived queries over a HYPOTHETICAL Life
   * state in which this participant is alive / dead -- the evolving working
   * state inside ONE resolution (e.g. a protection whose source died earlier
   * in the same ordered resolution). Pure; never persisted; a stale binding
   * returns this query unchanged. */
  assumingAlive: (binding: ParticipantBinding, alive: boolean) => RulesQuery;
};

export const bindingOf = (player: Pick<STPlayerRecord, "id" | "participantId">): ParticipantBinding =>
  ({ playerId: player.id, participantId: player.participantId ?? "" });

/** The occupied record at `binding.playerId`, only while it is still the
 * bound participation instance. Own-property safe. */
export function boundParticipant(game: StorytellerLobbyRecord, binding: ParticipantBinding | null | undefined): STPlayerRecord | null {
  if (!binding || typeof binding !== "object" || typeof binding.playerId !== "string" || typeof binding.participantId !== "string" || !binding.participantId) return null;
  if (!Object.prototype.hasOwnProperty.call(game.players, binding.playerId)) return null;
  const player = game.players[binding.playerId]!;
  return !player.isEmpty && player.participantId === binding.participantId ? player : null;
}

export function createRulesQuery(game: StorytellerLobbyRecord, environment: RulesQueryEnvironment): RulesQuery {
  const modifiers = environment.modifiers ?? activeModifiers(game, environment.registry);
  const participant = (binding: ParticipantBinding) => boundParticipant(game, binding);
  const seated = () => game.seatOrder.map((id) => game.players[id]).filter((p): p is STPlayerRecord => !!p && !p.isEmpty && !!p.participantId);

  /** Applicability with cycle detection: a revisited Effect is UNKNOWN. */
  const retained = (player: STPlayerRecord, visiting: Set<string>): QueryAnswer<boolean> => {
    let undetermined: string | null = null;
    for (const effect of player.effects) {
      if (effectSemanticsOf(effect.type) !== "retainedAbility") continue;
      const answer = applies(player, effect, visiting);
      if (!answer.known) undetermined ??= answer.reason;
      else if (answer.value) return known(true);
    }
    return undetermined ? unknown(undetermined) : known(false);
  };

  const applies = (holder: STPlayerRecord, effect: EffectRecord, visiting: Set<string>): QueryAnswer<boolean> => {
    if (effect.state !== "active") return known(false); // a lifecycle DECISION, not derived
    const semantics = effectSemanticsOf(effect.type);
    if (!semantics) return unknown(`"${effect.type}" is a custom Effect: Silverwick applies no rule to it by name.`);
    if (semantics === "storytellerFact") return known(true); // as recorded; no source dependence
    // Vigormortis: the retained ability stops if the holder is no longer a Minion (derived, nothing is rewritten).
    if (semantics === "retainedAbility" && environment.registry.get(holder.actualRole)?.type !== "minion") return known(false);
    const key = `${holder.participantId}:${effect.id}`;
    if (visiting.has(key)) return unknown("These Effects depend on each other: the Storyteller decides.");
    // A Storyteller's manual Effect (no origin participant) applies as recorded.
    const source = effect.sourceParticipant;
    if (!source) return known(true);
    if (source.kind !== "participant") return unknown("The Effect's origin predates participant identity.");
    // Whether a sourced Effect persists when its source stops functioning is
    // the SOURCE character's semantics; without a verified declaration it is
    // unknown -- never assumed either way.
    const sourceCharacter = effect.sourceCharacter;
    const descriptor = sourceCharacter ? resolveAbilitySemantics(sourceCharacter, environment.registry, environment.semantics) : null;
    const declared = descriptor?.kind === "supported"
      ? descriptor.descriptor.sourcedEffects?.find((entry) => entry.type === effect.type)?.persistence
      : undefined;
    if (declared === "independent") return known(true);
    if (declared !== "whileSourceFunctions") return unknown(`Whether this ${effect.type} Effect still applies depends on its source: the Storyteller decides.`);
    const sourcePlayer = boundParticipant(game, { playerId: source.playerId, participantId: source.participantId });
    if (!sourcePlayer) return unknown("The Effect's source is no longer in play: the Storyteller decides.");
    // Matrix Section 1 / 4: a persistent ability effect ends when its source
    // changes character -- the source no longer HAS that ability (derived; the
    // stored Effect is never rewritten).
    if (sourceCharacter && sourcePlayer.actualRole !== sourceCharacter) return known(false);
    // SOL-10F-A5: a KNOWN dead source no longer has its ability -- decisive
    // before any impairment / functioning uncertainty is even consulted. (A
    // departed / unseated source stays unknown, above.)
    const next = new Set(visiting).add(key);
    if (!sourcePlayer.alive) {
      // A dead Minion the Vigormortis killed keeps its ability, so what it sourced still applies.
      const kept = retained(sourcePlayer, next);
      if (!kept.known || !kept.value) return kept.known ? known(false) : kept;
    }
    // The Vigormortis poison lasts only while the Minion it is attached to keeps its ability.
    const attached = effect.type === "poisoned" ? effect.parameters?.minion : undefined;
    if (attached && attached.kind === "participant" && attached.participants[0]) {
      const minion = boundParticipant(game, attached.participants[0]);
      const kept = minion ? retained(minion, next) : known(false);
      if (!kept.known || !kept.value) return kept.known ? known(false) : kept;
    }
    // The character-domain self-effect exception is only a query overlay;
    // it never rewrites stored applicability or solves other source cycles.
    const sourceRole = sourceCharacter ? environment.registry.get(sourceCharacter) : undefined;
    const selfPoison = isPoisonerSelfEffect(holder, effect, sourceRole) || isInnkeeperSelfEffect(holder, effect, sourceRole);
    const functioning = functions(selfPoison
      ? { ...sourcePlayer, effects: sourcePlayer.effects.filter(candidate => candidate.id !== effect.id) }
      : sourcePlayer, next);
    if (!functioning.known) return functioning;
    return known(functioning.value);
  };

  /**
   * Treacherous 30th: the nearest Townsfolk to `origin` in one seating direction,
   * dead players included and non-Townsfolk / Travellers / empty seats skipped
   * (https://wiki.bloodontheclocktower.com/No_Dashii). A skipped seat that could
   * register as Townsfolk (optional Spy registration), or a counted Townsfolk that
   * could register as something else, makes the answer UNKNOWN -- never guessed.
   */
  const nearestTownsfolk = (origin: STPlayerRecord, step: 1 | -1): QueryAnswer<STPlayerRecord | null> => {
    const order = game.seatOrder;
    const start = order.indexOf(origin.id);
    if (start < 0) return unknown("The seat is not in the seating order.");
    for (let offset = 1; offset < order.length; offset++) {
      const other = game.players[order[(start + step * offset + order.length * order.length) % order.length]!];
      if (!other || other.isEmpty || !other.participantId || other.isTraveler) continue;
      const role = environment.registry.get(other.actualRole);
      if (!role) return unknown("A seat holds a character the rules do not know: the Storyteller decides.");
      const optional = isCanonicalRole(role) ? passiveRegistrationOptions(other.actualRole) : undefined;
      if (role.type === "townsfolk") {
        if (optional && optional.types.some((type) => type !== "townsfolk")) return unknown(`The ${role.name} may register as another type: the Storyteller decides.`);
        return known(other);
      }
      if (optional?.types.includes("townsfolk")) return unknown(`The ${role.name} may register as a Townsfolk: the Storyteller decides.`);
    }
    return known(null);
  };

  /** The No Dashii's passive: its two nearest Townsfolk neighbours are poisoned
   * while it is alive and its ability functions. Derived from the seating and
   * actual characters on every query, so it follows Pit-Hag / seat changes
   * immediately and is never stored. */
  const noDashiiPoison = (holder: STPlayerRecord, visiting: Set<string>): QueryAnswer<boolean> => {
    let undetermined: string | null = null;
    for (const source of seated()) {
      if (!isNeighbourPoisoner(source.actualRole) || !source.alive || source.id === holder.id) continue;
      const role = environment.registry.get(source.actualRole);
      if (!role || !isCanonicalRole(role)) continue;
      const key = `nodashii:${source.participantId}:${holder.participantId}`;
      if (visiting.has(key)) { undetermined ??= "These Effects depend on each other: the Storyteller decides."; continue; }
      const functioning = functions(source, new Set(visiting).add(key));
      if (!functioning.known) { undetermined ??= functioning.reason; continue; }
      if (!functioning.value) continue;
      for (const step of [1, -1] as const) {
        const neighbour = nearestTownsfolk(source, step);
        if (!neighbour.known) { undetermined ??= neighbour.reason; continue; }
        if (neighbour.value?.participantId === holder.participantId) return known(true);
      }
    }
    return undetermined ? unknown(undetermined) : known(false);
  };

  /** Impairment of `player`: any applicable impairment Effect -> impaired;
   * any unknown one -> unknown; none -> not impaired. */
  const impairedOf = (player: STPlayerRecord, visiting: Set<string>, kinds: readonly EffectSemantics[]): QueryAnswer<boolean> => {
    let undetermined: string | null = null;
    if (kinds.includes("impairment") && player.participantId) {
      const derived = noDashiiPoison(player, visiting);
      if (!derived.known) undetermined = derived.reason;
      else if (derived.value) return known(true);
    }
    for (const effect of player.effects) {
      const semantics = effectSemanticsOf(effect.type);
      if (!semantics || !kinds.includes(semantics)) continue;
      const answer = applies(player, effect, visiting);
      if (!answer.known) undetermined ??= answer.reason;
      else if (answer.value) return known(true);
    }
    return undetermined ? unknown(undetermined) : known(false);
  };

  const functions = (player: STPlayerRecord, visiting: Set<string>): QueryAnswer<boolean> => {
    if (player.effects.some((effect) => effect.state === "active" && effectSemanticsOf(effect.type) === "judgment" && effect.type === "soberHealthy")) {
      return unknown("A Sober & healthy Effect interacts with impairment: the Storyteller decides.");
    }
    const lost = impairedOf(player, visiting, ["noAbility"]);
    if (lost.known && lost.value) return known(false);
    const impaired = impairedOf(player, visiting, ["impairment"]);
    if (impaired.known && impaired.value) return known(false);
    if (!lost.known) return lost;
    if (!impaired.known) return impaired;
    return known(true);
  };

  /**
   * SOL-10F-C2: the protection-dependency snapshot of this query's state --
   * computed once per query (each `assumingAlive` overlay is its own query).
   * protectedFrom can reach, through Effect sources and their functioning, ANY
   * occupied participant, so the snapshot covers every one of them, ordered by
   * PlayerId: PlayerId, ParticipantId (replacement / departure), alive AS SEEN
   * BY THIS QUERY (hypothetical overlays included), Actual Role, and every
   * Effect record in order (id, type, lifecycle state, source character, source
   * participant's MECHANICAL identity -- SOL-10F-D2: kind, PlayerId and
   * ParticipantId, never the `nameAtTime` display snapshot -- expiry,
   * parameters) together with the source character's
   * persistence declaration as this query's environment resolves it.
   * Authoritative Current State only: never History, Reminders or prose
   * (names and notes are excluded). Exact JSON, so no collision handling is
   * needed.
   */
  let dependencySnapshot: string | undefined;
  const sortedKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortedKeys);
    if (!value || typeof value !== "object") return value ?? null;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys((value as Record<string, unknown>)[key])]));
  };
  /** SOL-10F-D2: an Effect source ParticipantRef's mechanical identity only
   * (the stored ref is never rewritten). */
  const sourceIdentity = (ref: EffectRecord["sourceParticipant"]): unknown => {
    if (!ref) return null;
    if (ref.kind === "participant") return [ref.kind, ref.playerId, ref.participantId];
    if (ref.kind === "legacy") return [ref.kind, ref.playerId];
    return sortedKeys(ref); // unreachable for schema-valid state; conservative
  };
  const declarationOf = (effect: EffectRecord): unknown => {
    if (!effect.sourceCharacter) return null;
    const resolved = resolveAbilitySemantics(effect.sourceCharacter, environment.registry, environment.semantics);
    return [resolved.kind, resolved.kind === "supported" ? resolved.descriptor.sourcedEffects?.find((entry) => entry.type === effect.type)?.persistence ?? null : null];
  };
  const protectionDependencies = (): string => dependencySnapshot ??= JSON.stringify(["protection-dependency-v1",
    // The No Dashii's poison follows the seating, so a seating change is a relevant change.
    Object.values(game.players).some((p) => !p.isEmpty && (isNeighbourPoisoner(p.actualRole) || lifeRuleReadsSeating(p.actualRole))) ? game.seatOrder : null,
    Object.keys(game.players).sort().flatMap((playerId) => {
      const player = game.players[playerId];
      if (!player || player.isEmpty || !player.participantId) return [];
      return [[playerId, player.participantId, player.alive, player.abilityUsed, player.actualRole, (player.effects ?? []).map((effect) => [
        effect.id, effect.type, effect.state, effect.sourceCharacter ?? null, sourceIdentity(effect.sourceParticipant),
        sortedKeys(effect.expiry), sortedKeys(effect.parameters), declarationOf(effect)])]];
    }),
    // LS-2b: a row that protects neighbours reads every alignment too (a neighbour turning evil changes the answer). Appended only
    // while such a holder is seated, so every other game's stamp is byte-identical to before.
    ...(Object.values(game.players).some((p) => !p.isEmpty && lifeRuleReadsSeating(p.actualRole))
      ? [Object.keys(game.players).sort().flatMap((playerId) => {
        const player = game.players[playerId];
        return player && !player.isEmpty && player.participantId ? [[playerId, player.actualAlignment ?? null]] : [];
      })] : []),
  ]);

  const require = <T,>(binding: ParticipantBinding, run: (player: STPlayerRecord) => QueryAnswer<T>): QueryAnswer<T> => {
    const player = participant(binding);
    return player ? run(player) : unknown("That participant is no longer in this seat.");
  };

  // Spy/Recluse registration is optional per interaction, including while
  // dead (official almanacs). Known impairment removes that ability. Possible
  // types are internal derived bounds, not a selected identity or saved state.
  const registrationAnswers = (binding: ParticipantBinding, observer?: RoleId): RegistrationAnswer & { types: QueryAnswer<readonly RoleType[]> } => {
    const judgment = (reason: string) => ({ character: unknown<RoleId>(reason), alignment: unknown<Alignment>(reason), types: unknown<readonly RoleType[]>(reason) });
    const player = participant(binding);
    if (!player) return judgment("That participant is no longer in this seat.");
    const role = environment.registry.get(player.actualRole);
    if (!role || !isCanonicalRole(role)) return judgment("Registration of a non-canonical character is the Storyteller's decision.");
    if (player.effects.some(effect => effect.state === "active" && effect.type === "registersFalsely")) {
      return judgment("A Registers falsely Effect applies: the Storyteller decides.");
    }
    const good = player.actualAlignment === "good";
    for (const other of seated()) {
      const scope = REGISTRATION_ALTERING[other.actualRole];
      if (scope === "anyGood" && good) return judgment(`The ${environment.registry.get(other.actualRole)?.name ?? other.actualRole} may make a good player register falsely: the Storyteller decides.`);
      if (scope === "observerGood" && good && observer === other.actualRole) return judgment("A good player may register falsely to this character: the Storyteller decides.");
    }
    const gate = gateEvaluation(modifiers, observer ?? player.actualRole, ["registration"], game);
    if (gate.kind !== "clear") return judgment("A modifier may change registration: the Storyteller decides.");
    const actual = { character: known(player.actualRole), alignment: player.actualAlignment ? known(player.actualAlignment) : unknown<Alignment>("The Actual Alignment is unresolved."), types: known<readonly RoleType[]>([role.type]) };
    const optional = passiveRegistrationOptions(player.actualRole);
    if (optional && (player.alive || optional.whileDead)) {
      const functioning = functions(player, new Set());
      if (functioning.known && !functioning.value) return actual;
      const reason = functioning.known ? `The ${role.name} may register falsely: the Storyteller decides.` : functioning.reason;
      // LS-2b: a registration decision the Storyteller stored for THIS observer (the Tea Lady's setup step) settles the alignment
      // for that observer only. Unknown sobriety keeps it known only where the impaired answer (the actual alignment) agrees.
      const decided = observerRegistrationDecision(observer, player.effects);
      return {
        character: unknown(reason),
        alignment: decided === "good" || decided === "evil"
          ? (functioning.known || player.actualAlignment === decided ? known(decided) : unknown(reason))
          : decided === "conflict" ? unknown("Both registration decisions are stored: the Storyteller decides.")
          : player.actualAlignment === optional.alignment ? known(optional.alignment) : unknown(reason),
        types: known([role.type, ...optional.types]),
      };
    }
    if (REGISTRATION_ALTERING[player.actualRole] === "self") return judgment(`The ${role.name} may register falsely: the Storyteller decides.`);
    return actual;
  };

  const protection = (binding: ParticipantBinding, cause: LifeRuleCause, spendHandled: boolean): QueryAnswer<boolean> => require(binding, (player) => {
      const passive = passiveProtection(self, binding, cause, spendHandled);
      if (!passive.known || passive.value) return passive;
      // LS-2a: a cause that goes around every prevention (the Assassin) is not stopped by any Effect either.
      if (causeBypassesEffectProtection(cause)) return known(false);
      let undetermined: string | null = null;
      for (const effect of player.effects) {
        const semantics = effectSemanticsOf(effect.type);
        if (semantics !== "deathImmunity" && semantics !== "demonProtection" && semantics !== "genericProtection") continue;
        if (semantics === "demonProtection" && cause !== "demon") continue;
        const answer = applies(player, effect, new Set());
        if (!answer.known) { undetermined ??= answer.reason; continue; }
        if (!answer.value) continue;
        if (semantics === "genericProtection") {
          undetermined ??= "A generic Protected marker never decides death automatically: the Storyteller decides.";
          continue;
        }
        return known(true);
      }
      return undetermined ? unknown(undetermined) : known(false);
    });

  const self: RulesQuery = {
    game,
    moment: () => currentLiveMoment(game),
    participant,
    isAlive: (binding) => require(binding, (player) => known(player.alive)),
    nearestTownsfolk: (binding) => require(binding, (player) => {
      const sides = ([1, -1] as const).map((step) => nearestTownsfolk(player, step));
      const unsure = sides.find((side) => !side.known);
      if (unsure && !unsure.known) return unknown(unsure.reason);
      const [clockwise, counterclockwise] = sides.map((side) => side.known && side.value ? bindingOf(side.value) : null);
      return known({ clockwise: clockwise ?? null, counterclockwise: counterclockwise ?? null });
    }),
    effectApplies: (holder, effect) => require(holder, (player) => applies(player, effect, new Set())),
    impaired: (binding) => require(binding, (player) => impairedOf(player, new Set(), ["impairment"])),
    retainsAbility: (binding) => require(binding, (player) => retained(player, new Set())),
    abilityFunctions: (binding) => require(binding, (player) => functions(player, new Set())),
    noDashiiPoisoned: (binding) => require(binding, (player) => noDashiiPoison(player, new Set())),
    protectedFrom: (binding, cause) => protection(binding, cause, false),
    deathOutcome: (binding, cause) => {
      const survives = survivesFirstDeath(self, binding, cause);
      if (!survives.known) return survives;
      const other = protection(binding, cause, true);
      if (!other.known) return other;
      return known<DeathOutcomeAnswer>(other.value ? { kind: "survives", spends: false } : survives.value ? { kind: "survives", spends: true } : { kind: "dies" });
    },
    protectionDependencyStamp: () => protectionDependencies(),
    registration: (binding, observer) => {
      const { character, alignment } = registrationAnswers(binding, observer);
      return { character, alignment };
    },
    registersAsType: (binding, type, observer) => {
      const answers = registrationAnswers(binding, observer);
      if (!answers.types.known) return answers.types;
      if (answers.types.value.every(value => value === type)) return known(true);
      if (answers.types.value.every(value => value !== type)) return known(false);
      return unknown(answers.character.known ? "The Storyteller decides this registration." : answers.character.reason);
    },
    aliveNeighbours: (binding) => require(binding, (player) => {
      const ring = seated();
      const index = ring.findIndex((p) => p.id === player.id);
      if (index < 0) return unknown("That participant is not in the seat order.");
      const find = (step: 1 | -1): ParticipantBinding | null => {
        for (let offset = 1; offset < ring.length; offset++) {
          const candidate = ring[(((index + step * offset) % ring.length) + ring.length) % ring.length]!;
          if (candidate.id !== player.id && candidate.alive) return bindingOf(candidate);
        }
        return null;
      };
      return known({ left: find(-1), right: find(1) });
    }),
    roleOf: (roleId) => (typeof roleId === "string" && roleId ? environment.registry.get(roleId) : undefined),
    inPlay: (roleId) => seated().filter((p) => p.actualRole === roleId).map(bindingOf),
    factHolders: (type) => effectSemanticsOf(type) !== "storytellerFact"
      ? unknown(`"${type}" is not an approved Storyteller fact.`)
      : known(seated().flatMap((p) => p.effects.filter((e) => e.type === type && e.state === "active").map((e) => ({ holder: bindingOf(p), effectId: e.id })))),
    lifeEvents: (moment, test) => lifeEventsAt(game, moment, test),
    gameRuleFact: (type) => gameRuleFactDefinition(type)
      ? known(gameRuleFactActive(game, type))
      : unknown(`"${typeof type === "string" ? type : "?"}" is not a registered Rule Fact: Silverwick applies no rule to it.`),
    modifierGate: (roleId, scopes) => gateEvaluation([...modifiers, ...passiveInformationModifiers(self, roleId)], roleId, scopes, game),
    assumingAlive: (binding, alive) => {
      const player = participant(binding);
      if (!player) return self;
      return createRulesQuery({ ...game, players: { ...game.players, [player.id]: { ...player, alive } } }, { ...environment, modifiers });
    },
  };
  return self;
}
