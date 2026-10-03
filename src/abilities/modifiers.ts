import jinxData from "@/data/canonical/jinxes.json";
import { isCanonicalRole } from "@/data/canonical";
import type { RoleRegistry } from "@/data/roleRegistry";
import type { InformationConstraintValue } from "./semantics";
import { VERIFIED_MODIFIER_HOOKS } from "./characters/modifierHooks";
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
  | { kind: "constrainInformation"; requirementId: string; allowed: readonly InformationConstraintValue[]; reason: string }
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
  /** SOL-10F-A4: a hypothetical Actual Role for some seats (prospective query);
   * read-only -- no record is built or written. */
  proposedRoleOf: (playerId: string) => RoleId | undefined = () => undefined,
): Set<RoleId> {
  const represented = new Set<RoleId>();
  for (const [playerId, player] of Object.entries(game.players ?? {})) {
    if (!player || player.isEmpty || !player.participantId) continue;
    const roleId = proposedRoleOf(playerId) ?? player.actualRole;
    if (typeof roleId !== "string" || !roleId || represented.has(roleId)) continue;
    const role = registry.get(roleId);
    if (role && isCanonicalRole(role)) represented.add(roleId);
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
  verified: ReadonlyMap<string, ModifierDefinition["hook"]> = VERIFIED_MODIFIER_HOOKS,
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

/**
 * The modifier gate of ONE evaluation. SOL-10F-A3: a gated evaluation carries
 * BOTH halves -- the reaching unverified modifiers (each needs an explicit
 * Storyteller confirmation or the Manual workspace) AND every reaching verified
 * hook's result -- so answering an unverified modifier never discards a
 * verified rule.
 */
/**
 * SOL-10F-A4: the PROSPECTIVE jinx query for proposed Actual Role changes.
 * Ordinary activation (above) reads CURRENT represented characters; a
 * Role-changing ability can itself create a jinx endpoint (e.g. a Pit-Hag
 * creating a Damsel), so this derives, purely, the canonical jinxes that would
 * become ACTIVE only because of the proposed changes: both endpoints
 * represented after them (same canonical-ownership rule, never script
 * membership) and not both before. Each comes back as a jinx modifier (with its
 * verified hook when one exists).
 */
export function prospectiveJinxes(
  game: Pick<StorytellerLobbyRecord, "players">,
  registry: RoleRegistry,
  changes: readonly { playerId: string; roleId: RoleId }[],
  verified: ReadonlyMap<string, ModifierDefinition["hook"]> = VERIFIED_MODIFIER_HOOKS,
): ModifierDefinition[] {
  if (!changes.length) return [];
  const proposed = new Map(changes.map((change) => [change.playerId, change.roleId]));
  const before = representedCanonicalCharacters(game, registry);
  const after = representedCanonicalCharacters(game, registry, (playerId) => proposed.get(playerId));
  const out: ModifierDefinition[] = [];
  const seen = new Set<string>();
  for (const [a, b] of JINX_PAIRS) {
    if (!after.has(a) || !after.has(b) || (before.has(a) && before.has(b))) continue;
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
  /** At least one reaching UNVERIFIED modifier, plus every reaching verified
   * hook result (possibly none). */
  | { kind: "gated"; modifiers: ModifierDefinition[]; results: { modifier: ModifierDefinition; result: ModifierHookResult }[] }
  /** Only verified hooks reached, and they constrained the evaluation. */
  | { kind: "constrained"; results: { modifier: ModifierDefinition; result: ModifierHookResult }[] };

/** Does `modifier` reach an evaluation of `roleId` touching `scopes`? */
export function modifierReaches(modifier: ModifierDefinition, roleId: RoleId, scopes: readonly HookScope[]): boolean {
  if (modifier.characters && !modifier.characters.includes(roleId)) return false;
  return modifier.scopes.includes("global") || modifier.scopes.some((scope) => (scopes as readonly string[]).includes(scope));
}

/**
 * Gates one evaluation. Unrelated modifiers are ignored (never a global
 * block); a reaching UNVERIFIED modifier gates; EVERY reaching VERIFIED one
 * runs its pure hook (SOL-10F-A3: also alongside unverified ones).
 */
export function gateEvaluation(
  modifiers: readonly ModifierDefinition[],
  roleId: RoleId,
  scopes: readonly HookScope[],
  game: StorytellerLobbyRecord,
): ModifierGate {
  const reaching = modifiers.filter((modifier) => modifierReaches(modifier, roleId, scopes));
  const unverified = reaching.filter((modifier) => !modifier.hook);
  // Every reaching VERIFIED hook runs, whatever unverified modifiers also reach.
  const results = reaching
    .filter((modifier) => !!modifier.hook)
    .map((modifier) => ({ modifier, result: modifier.hook!({ roleId, scopes, game }) }))
    .filter(({ result }) => result.kind !== "noEffect");
  if (unverified.length) return { kind: "gated", modifiers: unverified, results };
  return results.length ? { kind: "constrained", results } : { kind: "clear" };
}
