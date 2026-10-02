import jinxData from "@/data/canonical/jinxes.json";
import { isCanonicalRole } from "@/data/canonical";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { RoleId, StorytellerLobbyRecord } from "@/stores/types";

/**
 * Phase 10F: the hook / modifier vocabulary (PHASE10F Section 12).
 *
 * Fabled, Lorics, jinxes and passive abilities have no participant wake; they
 * participate by MODIFYING evaluations through named hook scopes. 10F defines
 * the contract and gating; it implements no Fabled/Loric/jinx mechanics.
 *
 * Gating rule (10F-AC-23): a modifier without verified semantics gates ONLY the
 * evaluations whose declared hook scopes intersect its own scopes. It never
 * globally disables unrelated automation. A modifier that may rewrite any rule
 * (Bootlegger-style homebrew rules) declares the `global` scope and gates
 * everything -- the explicit global manual gate.
 */
export type HookScope =
  | "information"
  | "death"
  | "registration"
  | "targeting"
  | "wake"
  | "setup"
  | "role"
  | "alignment"
  | "voting";

export const HOOK_SCOPES: readonly HookScope[] = ["information", "death", "registration", "targeting", "wake", "setup", "role", "alignment", "voting"];

export type ModifierSource = "fabled" | "loric" | "jinx" | "character" | "custom";

/** What a verified modifier hook may answer about one evaluation. Pure. */
export type ModifierHookResult =
  | { kind: "noEffect" }
  /** The modifier constrains the evaluation's information answer: only these
   * values may be delivered (rules-neutral shape; e.g. a "must be false"
   * information modifier). */
  | { kind: "constrainInformation"; requirementId: string; allowed: readonly unknown[]; reason: string }
  /** The modifier requires an explicit Storyteller decision. */
  | { kind: "judgment"; message: string }
  /** The modifier makes this ability not resolve automatically at all. */
  | { kind: "unsupported"; message: string };

export type ModifierHookContext = {
  roleId: RoleId;
  scopes: readonly HookScope[];
  game: StorytellerLobbyRecord;
};

export type ModifierDefinition = {
  /** `fabled:toymaker`, `loric:bootlegger`, `jinx:alchemist+boffin`, ... */
  id: string;
  source: ModifierSource;
  label: string;
  /** The scopes this modifier could affect (conservative: over-inclusive). */
  scopes: readonly (HookScope | "global")[];
  /** Present only for a VERIFIED modifier; absent means "could affect these
   * scopes, semantics unverified" -- it gates, it never guesses. */
  hook?: (context: ModifierHookContext) => ModifierHookResult;
  /** For a jinx: the characters whose evaluations it could affect. */
  characters?: readonly RoleId[];
};

/**
 * Conservative scope classification of every canonical Fabled and Loric,
 * reviewed against the pinned canonical ability text (src/data/canonical,
 * CANONICAL_REVISION). STRUCTURAL ONLY: it says which hook scopes a modifier
 * COULD touch so gating stays narrow; it encodes no mechanic and no ruling.
 * Over-inclusion is safe (it only asks the Storyteller more often); an empty
 * list means a table/procedure rule no ability evaluator reads (e.g. a talking
 * rule). Phase 11F verifies and narrows these with full semantics.
 */
export const CANONICAL_MODIFIER_SCOPES: Readonly<Record<string, readonly (HookScope | "global")[]>> = {
  // Fabled
  angel: ["death"],
  buddhist: [],
  deusexfiasco: [],
  djinn: [], // its rule IS the jinxes, gated per jinx pair below
  doomsayer: ["death"],
  duchess: ["information", "wake"],
  ferryman: ["voting"],
  fibbin: ["information"],
  fiddler: [],
  hellslibrarian: ["death"],
  revolutionary: ["registration", "information"],
  sentinel: ["setup"],
  spiritofivory: ["setup", "alignment", "role"],
  toymaker: ["death", "targeting", "setup", "information"],
  // Lorics
  bigwig: ["death", "voting"],
  bootlegger: ["global"],
  gardener: ["setup"],
  godofug: ["voting"],
  hindu: ["death", "role", "alignment"],
  knaves: ["information"],
  pope: ["setup", "information"],
  stormcatcher: ["death", "information", "setup"],
  tor: ["information", "wake", "role", "death"],
  ventriloquist: ["death"],
  zenomancer: ["information"],
};

type JinxEntry = { id: string; jinx: { id: string; reason: string }[] };
const JINX_PAIRS: readonly [RoleId, RoleId][] = (jinxData as JinxEntry[]).flatMap((entry) =>
  entry.jinx.map((j) => [entry.id, j.id] as [RoleId, RoleId]));

/**
 * SOL-10F-L1: the canonical characters currently REPRESENTED in authoritative
 * game state -- the Actual Role of at least one current occupied participant
 * (dead participants still represent their current character), and only when
 * the definition the active registry resolves for it passes the canonical
 * ownership boundary. A script-only / unassigned character, a Shown Role, and a
 * homebrew definition reusing an official id never count. Derived on every call,
 * so a Role change immediately changes what is represented.
 */
export function representedCanonicalCharacters(
  game: Pick<StorytellerLobbyRecord, "players">,
  registry: RoleRegistry,
): Set<RoleId> {
  const represented = new Set<RoleId>();
  for (const player of Object.values(game.players ?? {})) {
    if (!player || player.isEmpty || !player.participantId || typeof player.actualRole !== "string" || !player.actualRole) continue;
    if (represented.has(player.actualRole)) continue;
    const role = registry.get(player.actualRole);
    if (role && isCanonicalRole(role)) represented.add(player.actualRole);
  }
  return represented;
}

/**
 * The modifiers active for `game`: every Fabled / Loric in authoritative
 * `game.fabled` / `game.lorics` (classified above; an unknown or custom one
 * gates globally -- its rules cannot be bounded), and every canonical jinx whose
 * BOTH endpoints are currently represented (SOL-10F-L1). An active jinx with no
 * verified hook still only gates evaluations of its own two characters, to an
 * explicit Storyteller judgment / the Manual path -- never an inferred rule.
 */
export function activeModifiers(
  game: Pick<StorytellerLobbyRecord, "fabled" | "lorics" | "players">,
  registry: RoleRegistry,
  verified: ReadonlyMap<string, ModifierDefinition["hook"]> = new Map(),
): ModifierDefinition[] {
  const out: ModifierDefinition[] = [];
  const classify = (source: "fabled" | "loric", id: RoleId) => {
    const key = `${source}:${id}`;
    const scopes = Object.prototype.hasOwnProperty.call(CANONICAL_MODIFIER_SCOPES, id) ? CANONICAL_MODIFIER_SCOPES[id]! : ["global" as const];
    const hook = verified.get(key);
    out.push({ id: key, source, label: id, scopes, ...(hook ? { hook } : {}) });
  };
  for (const id of new Set(game.fabled ?? [])) classify("fabled", id);
  for (const id of new Set(game.lorics ?? [])) classify("loric", id);
  const represented = representedCanonicalCharacters(game, registry);
  const seen = new Set<string>();
  for (const [a, b] of JINX_PAIRS) {
    if (!represented.has(a) || !represented.has(b)) continue;
    const key = `jinx:${a}+${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hook = verified.get(key);
    out.push({ id: key, source: "jinx", label: `${a} / ${b} jinx`, scopes: ["global"], characters: [a, b], ...(hook ? { hook } : {}) });
  }
  return out;
}

export type ModifierGate =
  | { kind: "clear" }
  /** Unverified modifiers that could affect this evaluation: each needs an
   * explicit Storyteller judgment ("does not change this resolution") or the
   * Manual workspace. */
  | { kind: "gated"; modifiers: ModifierDefinition[] }
  /** Verified hooks constrained the evaluation (rules-neutral results). */
  | { kind: "constrained"; results: { modifier: ModifierDefinition; result: ModifierHookResult }[] };

/** Does `modifier` reach an evaluation of `roleId` touching `scopes`? */
export function modifierReaches(modifier: ModifierDefinition, roleId: RoleId, scopes: readonly HookScope[]): boolean {
  if (modifier.characters && !modifier.characters.includes(roleId)) return false;
  return modifier.scopes.includes("global") || modifier.scopes.some((scope) => (scopes as readonly string[]).includes(scope));
}

/**
 * Gates one evaluation. Unrelated modifiers are ignored (never a global
 * block); a reaching UNVERIFIED modifier gates; a reaching VERIFIED one runs
 * its pure hook.
 */
export function gateEvaluation(
  modifiers: readonly ModifierDefinition[],
  roleId: RoleId,
  scopes: readonly HookScope[],
  game: StorytellerLobbyRecord,
): ModifierGate {
  const reaching = modifiers.filter((modifier) => modifierReaches(modifier, roleId, scopes));
  const unverified = reaching.filter((modifier) => !modifier.hook);
  if (unverified.length) return { kind: "gated", modifiers: unverified };
  const results = reaching
    .map((modifier) => ({ modifier, result: modifier.hook!({ roleId, scopes, game }) }))
    .filter(({ result }) => result.kind !== "noEffect");
  return results.length ? { kind: "constrained", results } : { kind: "clear" };
}
