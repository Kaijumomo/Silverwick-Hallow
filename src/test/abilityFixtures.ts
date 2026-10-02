import type { AbilityDescriptor, AbilitySemanticsRegistry } from "@/abilities/semantics";
import type { ParticipantBinding } from "@/stores/abilityResolution";

/**
 * Phase 10F TEST FIXTURES -- RULES-NEUTRAL. These descriptors are keyed to
 * canonical RoleIds only so they pass the canonical ownership boundary; they
 * are NOT the semantics of those characters and encode no BOTC ruling. Each
 * exercises one architecture shape of the coordinator (a simple target ->
 * Effect, a once-per-game Life outcome, a declared/undeclared multi-domain
 * order, an information delivery, a Storyteller judgment).
 */
const target = (inputs: Record<string, unknown>, id = "target"): ParticipantBinding =>
  (inputs[id] as { participants: ParticipantBinding[] }).participants[0]!;

/** Simple class: choose one other living player -> a custom "marked" Effect. */
export const FIXTURE_SIMPLE_MARK: AbilityDescriptor = {
  roleId: "monk",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", constraints: ["notSelf", "alive"], label: "the player to mark" }],
  hooks: ["targeting"],
  presentation: { complexity: "simple", action: "Choose a player to mark" },
  evaluator: ({ actor, inputs, functioning }) => ({
    kind: "outcome",
    outcome: functioning
      ? { operations: [{ domain: "effect", intents: [{ kind: "apply", target: target(inputs), effect: { type: "marked", source: actor.binding, sourceCharacter: "monk", lifetime: { kind: "untilDawn" } } }] }] }
      : { operations: [] },
  }),
};

/** Once-per-game Life outcome: use + the target dies (single Life domain). */
export const FIXTURE_ONCE_KILL: AbilityDescriptor = {
  roleId: "slayer",
  timing: ["day"],
  invocation: "publicClaim",
  usage: { kind: "oncePerGame" },
  inputs: [{ id: "target", kind: "participant", source: "player", constraints: ["alive"], label: "the chosen player" }],
  hooks: ["death"],
  presentation: { complexity: "complex", action: "Choose a player" },
  evaluator: ({ actor, inputs, functioning }) => ({
    kind: "outcome",
    outcome: { operations: [{ domain: "life", intents: [
      { kind: "useAbility", target: actor.binding },
      ...(functioning ? [{ kind: "death" as const, target: target(inputs) }] : []),
    ] }] },
  }),
};

/** Information delivery whose answer is an explicit Storyteller choice. */
export const FIXTURE_INFO: AbilityDescriptor = {
  roleId: "empath",
  timing: ["firstNight", "otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "answer", kind: "number", source: "storyteller", label: "the number shown" }],
  hooks: ["information"],
  informationActions: ["empath-other-night"],
  presentation: { complexity: "simple", action: "Show a number" },
  evaluator: ({ actor, inputs }) => ({
    kind: "outcome",
    outcome: { operations: [{ domain: "information", recipient: actor.binding, informationActionId: "empath-other-night",
      values: [{ requirementId: "evilNeighbors", kind: "number", value: (inputs.answer as { value: number }).value }] }] },
  }),
};

/** Multi-domain WITHOUT a declared order: an incomplete definition. */
export const FIXTURE_UNORDERED: AbilityDescriptor = {
  roleId: "pithag",
  timing: ["otherNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [{ id: "target", kind: "participant", source: "player", label: "the player" }],
  hooks: ["role", "death"],
  presentation: { complexity: "complex", action: "Choose a player" },
  evaluator: ({ inputs, query }) => {
    const chosen = target(inputs);
    const player = query.participant(chosen)!;
    return { kind: "outcome", outcome: { operations: [
      { domain: "role", intents: [{ kind: "changeActualRole", target: chosen, expectedActualRole: player.actualRole, expectedIsTraveler: player.isTraveler, actualRole: player.actualRole === "monk" ? "empath" : "monk" }] },
      { domain: "life", intents: [{ kind: "death", target: chosen }] },
    ] } };
  },
};

/** The same shape WITH a declared order (Role, then Life, then notation). */
export const FIXTURE_ORDERED: AbilityDescriptor = {
  ...FIXTURE_UNORDERED,
  roleId: "imp",
  evaluator: (context) => {
    const result = FIXTURE_UNORDERED.evaluator!(context);
    if (result.kind !== "outcome") return result;
    const chosen = target(context.inputs);
    return { kind: "outcome", outcome: { mechanicalOrder: "declared", operations: [
      ...result.outcome.operations,
      { domain: "reminder", intents: [{ kind: "place", target: chosen, reminder: { label: "Chosen", source: context.actor.binding, sourceCharacter: "imp" } }] },
    ] } };
  },
};

/** Descriptor-only (no evaluator): its outcome is not modeled. */
export const FIXTURE_DESCRIPTOR_ONLY: AbilityDescriptor = {
  roleId: "chef",
  timing: ["firstNight"],
  invocation: "wake",
  usage: { kind: "unlimited" },
  inputs: [],
  hooks: ["information"],
  presentation: { complexity: "simple", action: "Show a number" },
};

export const FIXTURE_SEMANTICS: AbilitySemanticsRegistry = new Map(
  [FIXTURE_SIMPLE_MARK, FIXTURE_ONCE_KILL, FIXTURE_INFO, FIXTURE_UNORDERED, FIXTURE_ORDERED, FIXTURE_DESCRIPTOR_ONLY].map((d) => [d.roleId, d]),
);
