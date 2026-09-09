import { isCanonicalRole } from "@/data/canonical";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { activeJinxesFor } from "@/data/jinxes";
import type { BagCounts } from "@/data/setupCounts";
import type { RoleDef } from "@/stores/types";
import type { SetupContext, SetupFinding, SetupSource, SetupAction } from "./setupContext";
import { compositionCandidates, emptyCounts, formatCounts, hasCountPolicy, isBagType, sameCounts } from "./setupPolicies";
import { readinessFindings, setupReadiness } from "./setupReadiness";

export type CompositionAnalysis = {
  actual: BagCounts;
  candidates: BagCounts[] | null;
  roleCount: number;
  coverage: "supported" | "manual";
};
export type SetupAnalysis = {
  population: SetupContext["population"];
  pool: CompositionAnalysis;
  assigned: CompositionAnalysis;
  findings: SetupFinding[];
  readiness: { deal: ReturnType<typeof setupReadiness>; manual: ReturnType<typeof setupReadiness> };
};
const rank = { blocker: 0, check: 1, warning: 2, info: 3 };
export function sortSetupFindings(findings: SetupFinding[]) {
  return [...findings].sort((a, b) => rank[a.severity] - rank[b.severity]);
}
const manualRoles = new Set([
  "drunk", "marionette", "lunatic", "atheist", "legion", "lilmonsta", "huntsman",
  "hermit", "xaan", "bountyhunter", "poppygrower", "magician", "king", "snitch",
  "alchemist", "boffin", "amnesiac", "fortuneteller", "grandmother", "eviltwin",
  "puzzlemaster", "summoner", "kazali", "lordoftyphon",
]);
// Compare operational definition fields, ignoring harmless icon/format metadata.
function meaning(role: RoleDef): string {
  return JSON.stringify(["name", "type", "alignment", "ability", "setup", "firstNight", "otherNight",
    "firstNightPrompt", "otherNightPrompt", "firstNightReminder", "otherNightReminder",
    "oncePerGame"].map(key => role[key] ?? null));
}

export function analyzeSetup(context: SetupContext): SetupAnalysis {
  const { game, script, registry, population, pool, assigned } = context;
  const findings: SetupFinding[] = [];
  const add = (code: string, severity: SetupFinding["severity"], message: string,
    source: SetupSource = "shared", actions?: SetupAction[], playerId?: string) =>
    findings.push({ code, severity, message, source, actions, playerId });

  if (!script || !registry) add("missing-script", "blocker", "Restore the active script before starting.");
  const seen = new Set<string>();
  for (const [index, id] of game.seatOrder.entries()) {
    if (seen.has(id)) add("duplicate-seat:" + id, "blocker", "A seat appears more than once. Repair the seating before starting.");
    seen.add(id);
    const p = game.players[id];
    if (!p) { add("dangling-seat:" + id, "blocker", "A seat references a missing player. Repair the seating before starting."); continue; }
    if (p.id !== id) add("player-id:" + id, "blocker", "A player's ID does not match its seat record. Repair the seating before starting.");
    if (p.seat !== index) add("seat-index:" + id, "warning", "Stored seat numbering differs from seating order; review this seat.", "shared", undefined, id);
  }
  if (Object.keys(game.players).some(id => !seen.has(id)))
    add("orphan-player", "blocker", "A player record has no seat. Reconcile the seating before starting.");

  const definitions = new Map<string, RoleDef[]>();
  for (const r of [...(script?.characters ?? []), ...(script?.fabled ?? [])]) {
    definitions.set(r.id, [...(definitions.get(r.id) ?? []), r]);
  }
  function inspectRole(id: string, source: SetupSource, actions: SetupAction[], playerId?: string) {
    const role = registry?.get(id);
    if (!role) {
      add("unresolved:" + source + ":" + id, "blocker", `Character "${id}" cannot resolve in this game's runtime. Restore its definition or choose another role.`, source, actions, playerId);
      return undefined;
    }
    const defs = definitions.get(id) ?? [];
    if (defs.some(def => meaning(def) !== meaning(role) || isCanonicalRole(def) !== isCanonicalRole(role)))
      add("conflicting-definition:" + source + ":" + id, "blocker", `Conflicting definitions for ${role.name}; resolve the active script before starting.`, source, actions, playerId);
    return role;
  }

  for (const p of context.occupied) {
    if (!p.name.trim()) add("missing-name:" + p.id, "blocker", "Name each occupied player or mark the seat empty before starting.");
    const actions: SetupAction[] = p.isTraveler ? ["deal", "manual"] : ["manual"];
    const role = p.actualRole ? inspectRole(p.actualRole, "assigned", actions, p.id) : undefined;
    if (role && (p.isTraveler !== (role.type === "traveler") || !p.isTraveler && !isBagType(role.type)))
      add("traveler-type:" + p.id, "blocker", `Review ${p.name}'s Traveler flag and actual character type.`, "assigned", actions, p.id);
    // Deal atomically replaces ordinary perceptions; Traveler identities survive it.
    if (p.shownRole) inspectRole(p.shownRole, "shared", actions, p.id);
    if (p.isTraveler && !p.actualAlignment) add("traveler-alignment:" + p.id, "check",
      `${p.name}: choose actual Traveler alignment in their arrival controls. Shown alignment is not Storyteller truth.`, "assigned", actions, p.id);
  }

  // Perception may intentionally remain unset. Explain the existing runtime
  // limitation without substituting actual identity or blocking ST judgment.
  for (const [players, actions, label] of [
    [context.ordinary, ["manual"], "ordinary"],
    [context.travelers, ["deal", "manual"], "traveler"],
  ] as const) {
    const missing = players.filter(p => p.actualRole && !p.shownRole);
    if (missing.length) add("missing-perception:" + label, "check",
      `Review shown identities for ${missing.map(p => p.name).join(", ")}. Silverwick cannot derive their character wake procedures or deliver their player identities until perception is configured. Use the seat's identity controls, or handle those procedures manually if concealment is intentional.`,
      "shared", [...actions]);
  }

  const modifierDefs: RoleDef[] = [];
  for (const [ids, catalog, category] of [
    [game.fabled, FABLED, "Fabled"], [game.lorics ?? [], LORICS, "Loric"],
  ] as const) {
    for (const id of new Set(ids)) {
      const def = catalog.find(r => r.id === id);
      if (!def) { add("modifier:" + id, "check", `Unrecognized ${category} "${id}". Review its reference; setup coverage is limited.`); continue; }
      modifierDefs.push(def);
      if (id === "sentinel") continue;
      const informationOnly = ["angel", "buddhist", "hellslibrarian", "bigwig", "godofug", "ventriloquist"].includes(id);
      add("modifier:" + id, informationOnly ? "info" : "check",
        `${def.name}: ${def.ability ?? "Review this modifier."}` +
        (id === "gardener" ? " Use manual assignment for deliberate placement; random dealing does not enforce this." :
         id === "tor" ? " Review shown identities before syncing; random dealing establishes ordinary shown identities." :
         id === "pope" ? " Actual alignment is not modeled; review duplicate good characters and bluffs." :
         informationOnly ? "" : " Resolve this with the Storyteller."));
    }
  }
  const unknownModifier = [...game.fabled, ...(game.lorics ?? [])].some(id => !modifierDefs.some(r => r.id === id));
  function composition(ids: string[], source: "pool" | "assigned"): CompositionAnalysis {
    const actions: SetupAction[] = source === "pool" ? ["deal"] : ["manual"];
    const roles: RoleDef[] = [];
    for (const id of ids) {
      const role = source === "pool" ? inspectRole(id, source, actions) : registry?.get(id);
      if (!role) continue;
      if (source === "pool" && !isBagType(role.type))
        add("pool-type:" + id, "blocker", `${role.name} is not an ordinary pooled character. Assign Travelers separately and select modifiers in their controls.`, source, actions);
      roles.push(role);
    }
    const actual = emptyCounts();
    for (const r of roles) if (isBagType(r.type)) actual[r.type]++;
    const trusted = roles.filter(isCanonicalRole);
    const trustedIds = new Set(trusted.map(r => r.id));
    const activeJinxes = activeJinxesFor([...trustedIds, ...modifierDefs.map(r => r.id)]);
    if (activeJinxes.length) add("jinxes:" + source, "check",
      "Review active jinxes: " + [...new Set(activeJinxes.map(j => `${registry?.get(j.a)?.name ?? j.a} / ${registry?.get(j.b)?.name ?? j.b}: ${j.reason}`))].join(" "), source);
    const manual = trusted.filter(r => (r.setup && !hasCountPolicy(r.id) && r.id !== "villageidiot") || manualRoles.has(r.id));
    if (manual.length) add("manual-roles:" + source, "check",
      "Review character setup: " + [...new Set(manual.map(r => r.name))].join(", ") +
      ". Resolve special choices, identity, alignment, information, and seating manually; ordinary counts alone do not validate these effects.", source);
    if (roles.some(r => !isCanonicalRole(r)))
      add("custom:" + source, "check", "Custom or unverified characters: declared types are counted, but official setup mechanics are not assumed.", source);
    for (const [requiredBy, required] of [["huntsman", "damsel"], ["choirboy", "king"]] as const) {
      if (trustedIds.has(requiredBy) && !trustedIds.has(required))
        add("requires:" + source + ":" + requiredBy, "warning",
          `${registry?.get(requiredBy)?.name}: review the required ${required} character; trusted assigned support is missing.`, source);
    }
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count < 2) continue;
      const def = registry?.get(id);
      const canonical = !!def && isCanonicalRole(def);
      const pope = modifierDefs.some(r => r.id === "pope");
      const allowed = canonical && (
        id === "villageidiot" && count <= 3 || id === "legion" ||
        pope && (def.type === "townsfolk" || def.type === "outsider"));
      if (!allowed) add("duplicate:" + source + ":" + id, "warning",
        `${def?.name ?? id} appears ${count} times. Review this duplicate; no supported allowance applies.`, source);
      else if (id === "villageidiot") add("villageidiot:" + source, "check", "Village Idiot copies are allowed; choose the drunk extra manually.", source);
    }
    if (source === "assigned" && trustedIds.has("marionette")) {
      const demons = context.ordinary.filter(p => {
        const role = registry?.get(p.actualRole);
        return role && isCanonicalRole(role) && role.type === "demon";
      });
      if (demons.length === 1 && !population.occupiedTravelerCount && !population.emptyPlannedSeatCount &&
          context.ordinary.every(p => !!p.actualRole) && !activeJinxes.length) {
        const order = context.ordinary;
        for (const p of order.filter(p => p.actualRole === "marionette")) {
          const i = order.indexOf(p);
          if (![order[(i + order.length - 1) % order.length]?.id, order[(i + 1) % order.length]?.id].includes(demons[0]!.id))
            add("marionette-neighbor:" + p.id, "warning", "Marionette does not neighbor the Demon in the completed ordinary seating. Review placement.", source, undefined, p.id);
        }
      }
    }
    const result = compositionCandidates(population.targetNonTravelerCount, roles, modifierDefs, !!activeJinxes.length);
    // Missing definitions, uncertain modifiers and concealed setup exceptions must
    // not leave an apparently exact expected composition.
    const candidates = unknownModifier || roles.length !== ids.length || trustedIds.has("marionette") ? null : result.candidates;
    if (result.reason === "interaction") add("interaction:" + source, "check",
      "Multiple setup count modifiers are active. Their combined composition is not validated; review it manually.", source);
    if (ids.length && candidates && ids.length === population.targetNonTravelerCount && !candidates.some(c => sameCounts(c, actual)))
      add("composition:" + source, "warning",
        `${source === "pool" ? "Pool" : "Assigned"} composition ${formatCounts(actual)} differs from supported options: ${candidates.map(formatCounts).join(" or ")}.`, source);
    if (ids.length && population.targetNonTravelerCount !== null && ids.length !== population.targetNonTravelerCount)
      add("role-total:" + source, "info", `${ids.length} ${source === "pool" ? "pooled" : "assigned ordinary"} roles for ${population.targetNonTravelerCount} planned players.`, source);
    return { actual, candidates, roleCount: ids.length, coverage: candidates ? "supported" : "manual" };
  }
  const poolAnalysis = composition(pool, "pool");
  const assignedAnalysis = composition(assigned, "assigned");
  if (pool.length && assigned.length) add("pool-and-assigned", "warning",
    "Both a role pool and actual assignments exist. Dealing replaces ordinary assignments; clear the pool to use manual assignments.");
  if (population.targetNonTravelerCount !== null && (population.targetNonTravelerCount < 5 || population.targetNonTravelerCount > 15))
    add("unsupported-population", "warning", "Standard composition guidance covers 5–15 ordinary players. Review this population manually.");
  if (population.emptyPlannedSeatCount) add("planning-empty", "info",
    `${population.emptyPlannedSeatCount} ordinary seats are reserved and still empty. Planning can continue.`);
  findings.push(...readinessFindings(context));
  // One finding per issue/source; duplicate role copies must not repeat errors.
  const unique = [...new Map(findings.map(f => [f.code, f])).values()];
  const sorted = sortSetupFindings(unique);
  return {
    population, pool: poolAnalysis, assigned: assignedAnalysis, findings: sorted,
    readiness: { deal: setupReadiness(sorted, "deal"), manual: setupReadiness(sorted, "manual") },
  };
}
