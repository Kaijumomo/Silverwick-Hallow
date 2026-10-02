import { isCanonicalRole } from "@/data/canonical";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { HookScope } from "./modifiers";
import type { AbilityOutcome, ParticipantBinding } from "@/stores/abilityResolution";
import type { RulesQuery } from "@/stores/rulesQuery";
import type { Alignment, InformationActionId, ParticipantId, RoleDef, RoleId, STPlayerRecord } from "@/stores/types";

/**
 * Phase 10F: the Ability Semantics contract (PHASE10F Section 3.1).
 *
 * A canonical ability definition is a HYBRID:
 *  - a declarative descriptor (timing/invocation, usage, input requirements,
 *    the hook scopes its mechanics touch, the Information Actions it delivers,
 *    and the presentation the Night Order / workspace needs);
 *  - an optional small PURE evaluator for character-specific logic.
 *
 * Nothing here parses ability prose, night prompts or Reminder text. A
 * descriptor is data written (and tested) per character in a semantics module;
 * Silverwick never derives one from a RoleDef's text.
 *
 * Semantics attach ONLY when canonical ownership is proven through the existing
 * Role Ownership Boundary (isCanonicalRole on the definition the active
 * registry resolves -- the same gate Information Actions use). A homebrew
 * character that reuses an official RoleId inherits nothing; unsupported or
 * homebrew abilities go to the Manual workspace.
 */

/** When / how an ability is invoked. Vocabulary only -- the semantics module
 * of a character decides which apply. */
export type AbilityTiming =
  | "firstNight"
  | "otherNight"
  | "day"
  | "triggered"
  | "passive"
  | "setup";

/** How the Storyteller runs it: a participant wake, a Storyteller procedure
 * performed ABOUT a participant, a public Day claim, or no invocation at all. */
export type AbilityInvocation = "wake" | "procedure" | "publicClaim" | "none";

export type AbilityUsage =
  | { kind: "unlimited" }
  /** Once per game: committing a resolution of this ability uses it through
   * the Life boundary (useAbility) in the same final snapshot. */
  | { kind: "oncePerGame" };

/** Who supplies an input value. Silverwick never fills a player choice, a
 * Storyteller choice or a Storyteller judgment on anyone's behalf. */
export type InputSource =
  | "player"
  | "storyteller"
  /** Rules grant the Storyteller discretion, the interaction is ambiguous,
   * or authoritative state is insufficient. */
  | "judgment";

export type AbilityInputKind = "participant" | "character" | "alignment" | "number" | "boolean" | "text";

/** Structural constraints the workspace and the evaluator both apply. A
 * constraint never encodes a rule ruling beyond its literal name. */
export type InputConstraint =
  | "notSelf"
  | "alive"
  | "dead"
  | "distinct";

export type AbilityInputRequirement = {
  /** Stable within the ability. */
  id: string;
  kind: AbilityInputKind;
  source: InputSource;
  /** Exactly this many values (default 1). */
  count?: number;
  constraints?: readonly InputConstraint[];
  label: string;
};

/** Phase 10F presentation metadata for the Night Order / workspace. */
export type AbilityPresentation = {
  /** `simple`: one participant, no judgment, no significant consequence --
   * the inline Target -> Resolve flow. `complex`: the progressive workspace
   * with a consequence preview and explicit confirmation. */
  complexity: "simple" | "complex";
  /** Short imperative for the Night row ("Choose a player to poison"). */
  action: string;
};

export type AbilityDescriptor = {
  roleId: RoleId;
  timing: readonly AbilityTiming[];
  invocation: AbilityInvocation;
  usage: AbilityUsage;
  inputs: readonly AbilityInputRequirement[];
  /** The hook scopes this ability's mechanics touch. A modifier/jinx gates
   * this ability only when its own scopes intersect these. */
  hooks: readonly HookScope[];
  /** Information Actions (by id, from the Role registry) this ability can
   * deliver. */
  informationActions?: readonly InformationActionId[];
  /** Effects this ability creates and whether each keeps applying when its
   * source stops functioning. Read by the Rules Query; an undeclared sourced
   * Effect's applicability is unknown (Storyteller judgment), never assumed. */
  sourcedEffects?: readonly { type: string; persistence: "independent" | "whileSourceFunctions" }[];
  presentation: AbilityPresentation;
  evaluator?: AbilityEvaluator;
};

/** One answered input, as the workspace collected it. Participant answers
 * are ALWAYS stale-safe bindings -- never a bare PlayerId. */
export type AbilityInputValue =
  | { kind: "participant"; participants: ParticipantBinding[] }
  | { kind: "character"; roleIds: RoleId[] }
  | { kind: "alignment"; alignment: Alignment }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string };

export type AbilityInputs = Readonly<Record<string, AbilityInputValue>>;

/** Explicit Storyteller judgments, keyed by the requirement / gate id the
 * evaluator or modifier gate asked for. */
export type AbilityJudgments = Readonly<Record<string, AbilityInputValue>>;

export type AbilityEvaluationContext = {
  actor: { binding: ParticipantBinding; player: STPlayerRecord };
  /** The Role whose ability is being performed (the wake identity). */
  roleId: RoleId;
  /** A simulated wake (e.g. a Drunk shown the Empath): no ability at all --
   * only bookkeeping (Information Delivery with performedRole, notation,
   * step completion) may result; the coordinator enforces it. */
  simulated: boolean;
  /** Whether the actor's ability functions (not impaired / not lost), from
   * the Rules Query or, when that is unknown, the Storyteller's explicit
   * judgment. When false the coordinator admits no functioning Current State
   * outcome (10F-AC-12) -- only the ability's use and bookkeeping. */
  functioning: boolean;
  inputs: AbilityInputs;
  judgments: AbilityJudgments;
  query: RulesQuery;
  /** Verified modifier hooks that constrain this evaluation (e.g. an
   * information modifier allowing only certain values). The coordinator
   * also ENFORCES information constraints on the delivered values. */
  constraints: readonly InformationConstraint[];
};

/**
 * SOL-10F-L5: a typed, normalized information-constraint value. Player-valued
 * information is expressed by stable ParticipantIds (never reusable PlayerIds)
 * with an explicit order rule; the list length is the exact cardinality.
 */
export type InformationConstraintValue =
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "text"; value: string }
  | { kind: "role"; roleId: RoleId }
  | { kind: "alignment"; alignment: Alignment }
  | { kind: "player"; participantIds: readonly ParticipantId[]; order: "ordered" | "unordered" };

export type InformationConstraint = { modifierId: string; requirementId: string; allowed: readonly InformationConstraintValue[]; reason: string };

/**
 * What a pure evaluator returns. Never a partial result: either a complete,
 * ORDERED outcome built only from the frozen primitives, or an explicit
 * reason to ask / stop.
 */
export type AbilityEvaluation =
  | { kind: "outcome"; outcome: AbilityOutcome }
  | { kind: "needsInput"; requirements: readonly AbilityInputRequirement[]; message: string }
  | { kind: "notApplicable"; message: string }
  | { kind: "unsupported"; message: string }
  | { kind: "illegal"; message: string };

/** A small PURE function: no store, no clock, no randomness, no Reminder
 * reads (architecture-guarded). */
export type AbilityEvaluator = (context: AbilityEvaluationContext) => AbilityEvaluation;

/** The canonical Ability Semantics Registry: RoleId -> descriptor, for
 * characters whose semantics are verified against authoritative BOTC
 * sources. */
export type AbilitySemanticsRegistry = ReadonlyMap<RoleId, AbilityDescriptor>;

/**
 * Phase 10F: production semantics. Deliberately EMPTY at this checkpoint --
 * no proof-character mechanic is encoded until its rules matrix is verified
 * against authoritative BOTC sources (PHASE10F Sections 17 and 20). Until a
 * character is added here, its ability resolves through the Manual workspace.
 */
export const CANONICAL_ABILITY_SEMANTICS: AbilitySemanticsRegistry = new Map();

export type SemanticsResolution =
  | { kind: "supported"; descriptor: AbilityDescriptor; role: RoleDef }
  /** No verified semantics for a canonical character. */
  | { kind: "unsupported"; role: RoleDef | undefined; reason: "noSemantics" | "unknownRole" }
  /** The definition is not proven canonical (homebrew / imported / custom /
   * modified) -- an official RoleId alone never transfers automation. */
  | { kind: "homebrew"; role: RoleDef };

/**
 * The ONE place an ability's semantics are resolved: the active registry's
 * definition of `roleId` must be the genuine canonical Role (Role Ownership
 * Boundary), and only then is the semantics registry consulted.
 */
export function resolveAbilitySemantics(
  roleId: RoleId,
  registry: RoleRegistry,
  semantics: AbilitySemanticsRegistry = CANONICAL_ABILITY_SEMANTICS,
): SemanticsResolution {
  const role = typeof roleId === "string" && roleId ? registry.get(roleId) : undefined;
  if (!role) return { kind: "unsupported", role: undefined, reason: "unknownRole" };
  if (!isCanonicalRole(role)) return { kind: "homebrew", role };
  const descriptor = semantics.get(roleId);
  if (!descriptor || descriptor.roleId !== roleId) return { kind: "unsupported", role, reason: "noSemantics" };
  return { kind: "supported", descriptor, role };
}
