import { isCanonicalRole } from "@/data/canonical";
import type { RoleRegistry } from "@/data/roleRegistry";
import { activeModifiers, gateEvaluation, type HookScope, type ModifierDefinition, type ModifierGate } from "@/abilities/modifiers";
import { resolveAbilitySemantics, type AbilitySemanticsRegistry } from "@/abilities/semantics";
import { currentLiveMoment, lifeEventsAt, type LifeEventQueryResult } from "./lifeEvents";
import type { ParticipantBinding } from "./abilityResolution";
import type { Alignment, EffectRecord, LifeEvent, LiveGameMoment, RoleId, STPlayerRecord, Script, StorytellerLobbyRecord } from "./types";

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
 * the only mechanical sources.
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
 */
export type EffectSemantics = "impairment" | "noAbility" | "demonProtection" | "deathImmunity" | "genericProtection" | "judgment";
export const APPROVED_EFFECT_SEMANTICS: Readonly<Record<string, EffectSemantics>> = {
  drunk: "impairment",
  poisoned: "impairment",
  abilityLost: "noAbility",
  safeFromDemon: "demonProtection",
  cannotDie: "deathImmunity",
  protected: "genericProtection",
  soberHealthy: "judgment",
  registersFalsely: "judgment",
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
  fortuneteller: "observerGood",
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
  /** Drunk/Poisoned impairment (derived from applicable Effects). */
  impaired: (binding: ParticipantBinding) => QueryAnswer<boolean>;
  /** Whether the participant's ability functions: not impaired and not lost.
   * Death is reported separately (isAlive); whether an ability works while
   * dead is character semantics. */
  abilityFunctions: (binding: ParticipantBinding) => QueryAnswer<boolean>;
  /** Protection against a death of `cause`. `generic` Protected never answers
   * "protected" automatically. */
  protectedFrom: (binding: ParticipantBinding, cause: "demon" | "any") => QueryAnswer<boolean>;
  /** What the participant registers as, to an `observer` character. */
  registration: (binding: ParticipantBinding, observer?: RoleId) => RegistrationAnswer;
  /** The nearest living participants on each side (skipping empty seats and
   * the dead), or null when there is none. */
  aliveNeighbours: (binding: ParticipantBinding) => QueryAnswer<{ left: ParticipantBinding | null; right: ParticipantBinding | null }>;
  /** Occupied participants whose ACTUAL Role is `roleId`. */
  inPlay: (roleId: RoleId) => ParticipantBinding[];
  /** Life Events at `moment` (with honest coverage). */
  lifeEvents: (moment: LiveGameMoment, test?: (event: LifeEvent) => boolean) => LifeEventQueryResult;
  /** The modifier gate for an evaluation of `roleId` touching `scopes`. */
  modifierGate: (roleId: RoleId, scopes: readonly HookScope[]) => ModifierGate;
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
  const applies = (holder: STPlayerRecord, effect: EffectRecord, visiting: Set<string>): QueryAnswer<boolean> => {
    if (effect.state !== "active") return known(false); // a lifecycle DECISION, not derived
    const semantics = effectSemanticsOf(effect.type);
    if (!semantics) return unknown(`"${effect.type}" is a custom Effect: Silverwick applies no rule to it by name.`);
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
    const next = new Set(visiting).add(key);
    const functioning = functions(sourcePlayer, next);
    if (!functioning.known) return functioning;
    return known(functioning.value && sourcePlayer.alive);
  };

  /** Impairment of `player`: any applicable impairment Effect -> impaired;
   * any unknown one -> unknown; none -> not impaired. */
  const impairedOf = (player: STPlayerRecord, visiting: Set<string>, kinds: readonly EffectSemantics[]): QueryAnswer<boolean> => {
    let undetermined: string | null = null;
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

  const require = <T,>(binding: ParticipantBinding, run: (player: STPlayerRecord) => QueryAnswer<T>): QueryAnswer<T> => {
    const player = participant(binding);
    return player ? run(player) : unknown("That participant is no longer in this seat.");
  };

  return {
    game,
    moment: () => currentLiveMoment(game),
    participant,
    isAlive: (binding) => require(binding, (player) => known(player.alive)),
    effectApplies: (holder, effect) => require(holder, (player) => applies(player, effect, new Set())),
    impaired: (binding) => require(binding, (player) => impairedOf(player, new Set(), ["impairment"])),
    abilityFunctions: (binding) => require(binding, (player) => functions(player, new Set())),
    protectedFrom: (binding, cause) => require(binding, (player) => {
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
    }),
    registration: (binding, observer) => {
      const player = participant(binding);
      if (!player) {
        const stale = unknown<never>("That participant is no longer in this seat.");
        return { character: stale, alignment: stale };
      }
      const judgment = (reason: string): RegistrationAnswer => ({ character: unknown(reason), alignment: unknown(reason) });
      const role = environment.registry.get(player.actualRole);
      if (!role || !isCanonicalRole(role)) return judgment("Registration of a non-canonical character is the Storyteller's decision.");
      if (player.effects.some((effect) => effect.state === "active" && effect.type === "registersFalsely")) {
        return judgment("A Registers falsely Effect applies: the Storyteller decides.");
      }
      if (REGISTRATION_ALTERING[player.actualRole] === "self") return judgment(`The ${role.name} may register falsely: the Storyteller decides.`);
      const good = player.actualAlignment === "good";
      for (const other of seated()) {
        const scope = REGISTRATION_ALTERING[other.actualRole];
        if (!scope || scope === "self") continue;
        if (scope === "anyGood" && good) return judgment(`The ${environment.registry.get(other.actualRole)?.name ?? other.actualRole} may make a good player register falsely: the Storyteller decides.`);
        if (scope === "observerGood" && good && observer === other.actualRole) return judgment("A good player may register falsely to this character: the Storyteller decides.");
      }
      const gate = gateEvaluation(modifiers, observer ?? player.actualRole, ["registration"], game);
      if (gate.kind !== "clear") return judgment("A modifier may change registration: the Storyteller decides.");
      return {
        character: known(player.actualRole),
        alignment: player.actualAlignment ? known(player.actualAlignment) : unknown("The Actual Alignment is unresolved."),
      };
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
    inPlay: (roleId) => seated().filter((p) => p.actualRole === roleId).map(bindingOf),
    lifeEvents: (moment, test) => lifeEventsAt(game, moment, test),
    modifierGate: (roleId, scopes) => gateEvaluation(modifiers, roleId, scopes, game),
  };
}
