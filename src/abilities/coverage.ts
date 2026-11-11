import rawRoles from "@/data/canonical/roles.json";
import jinxData from "@/data/canonical/jinxes.json";
import { CANONICAL_REVISION } from "@/data/canonical";
import { CANONICAL_MODIFIER_SCOPES, type HookScope } from "./modifiers";
import { CANONICAL_ABILITY_SEMANTICS, type AbilitySemanticsRegistry } from "./semantics";
import { COVERAGE_NOTES, OWNED_ELSEWHERE, REVIEWED_MANUAL, VERIFIED_MANUAL } from "./characters/classification";
import { hasCountPolicy, hasUncertainComposition } from "@/rules/setup/setupPolicies";
import { REVIEWED_INTERACTION_ROLES } from "./characters/passiveRules";
import {
  COVERAGE_CAVEATS, ENDING_EVIDENCE_ROLES, MODIFIER_ENDING_CAVEAT, NOT_ON_ENDING_LIST_CAVEAT, PARTIAL_CAVEATS, PARTIAL_SUPPORT, TEST_EVIDENCE,
  type CoverageEvidence, type CoverageLevel,
} from "./coverageEvidence";

export type { CoverageEvidence, CoverageLevel } from "./coverageEvidence";

/**
 * Phase 10F: the canonical ability COVERAGE MANIFEST (PHASE10F Section 18,
 * 10F-AC-34) -- generated from the pinned canonical data, never hand-listed,
 * so every canonical Character / Traveler / Fabled / Loric and every jinx has
 * exactly one entry. 10F tracks the proof set; Phase 11 drives the count of
 * `unclassified` entries to zero (11A..11F).
 *
 * Statuses:
 *  - supported: verified semantics are registered (CANONICAL_ABILITY_SEMANTICS);
 *    a guided-partial character carries a note naming its Manual branch;
 *  - verifiedManual: Phase 10F Slice 7 -- the official rules are verified
 *    (docs/ai/PHASE10F_CHARACTER_RULES_MATRIX.md) and the correct 10F
 *    representation is deliberately Manual / reference only (Tinker,
 *    Toymaker, the Drunk); NOT "evidence pending";
 *  - setupOwned: deliberately NOT an ability-engine concern -- Setup owns it
 *    (the Baron negative proof, Section 11);
 *  - modifierScoped: a Fabled / Loric whose hook scopes are structurally
 *    classified (gating stays narrow) but whose semantics are unverified;
 *  - gatedJudgment: a canonical jinx -- it gates its two characters'
 *    evaluations to an explicit Storyteller judgment;
 *  - ownedElsewhere: no AbilityDescriptor, but a dedicated reviewed module owns
 *    the behaviour (the Trouble Brewing work, B0-B9); its note names the owner
 *    and the Storyteller boundary. Presentation only: it changes no gate;
 *  - reviewedManual: an information-only character whose interactions were
 *    reviewed (it is in REVIEWED_INTERACTION_ROLES) while its own ability stays
 *    Storyteller-resolved. Presentation only: it changes no gate;
 *  - unclassified: Phase 11 work.
 *
 * Stage 5A-1: every CHARACTER entry also carries a `level` and `evidence` (see
 * coverageEvidence.ts for what each level means and does not mean).
 * `status` describes the ability DESCRIPTOR; `level` describes what the
 * repository actually does for the character. Neither authorizes any action.
 */
export type CoverageStatus = "supported" | "verifiedManual" | "setupOwned" | "modifierScoped" | "gatedJudgment" | "ownedElsewhere" | "reviewedManual" | "unclassified";
export type CoverageKind = "townsfolk" | "outsider" | "minion" | "demon" | "traveler" | "fabled" | "loric" | "jinx";
export type CoverageWave = "11A" | "11B" | "11C" | "11D" | "11E" | "11F";

export type CoverageEntry = {
  /** RoleId, or `a+b` for a jinx. */
  id: string;
  kind: CoverageKind;
  status: CoverageStatus;
  wave: CoverageWave;
  scopes?: readonly (HookScope | "global")[];
  note?: string;
  /** Orthogonal ownership inventory. Legacy status is descriptor-oriented,
   * not a whole-character automation claim. Never used to authorize actions. */
  capabilities?: readonly CoverageCapability[];
  /** Stage 5A-1: what is built for this character today. Characters only (no jinxes). */
  level?: CoverageLevel;
  /** True when the character is on REVIEWED_INTERACTION_ROLES (having it in play does not push other automation to Manual). */
  reviewedInteraction?: boolean;
  /** Files that show the level, each with one sentence. Verified by tests. */
  evidence?: readonly CoverageEvidence[];
  /** Known gaps against the official rules, read from code or from the Stage 4 review. */
  caveats?: readonly string[];
};

export type CoverageCapability = {
  owner: "abilities" | "setup" | "voting" | "identity" | "rules" | "information" | "selection" | "victory";
  boundary: string;
  evidence: string;
};

const OWNED_CAPABILITIES: Readonly<Record<string, readonly CoverageCapability[]>> = {
  bureaucrat: [{ owner: "voting", boundary: "Sourced vote weight and linked notation; no ability descriptor", evidence: "src/stores/voting.ts" }],
  virgin: [{ owner: "voting", boundary: "First nomination adjudication and Life usage; no automatic ruling", evidence: "src/stores/voting.ts" }],
  huntsman: [{ owner: "setup", boundary: "Damsel dependency warning only", evidence: "src/rules/setup/setupAnalyzer.ts" }],
  choirboy: [{ owner: "setup", boundary: "King dependency warning only", evidence: "src/rules/setup/setupAnalyzer.ts" }],
  villageidiot: [{ owner: "setup", boundary: "Duplicate allowance and manual drunkenness warning", evidence: "src/rules/setup/setupAnalyzer.ts" }],
  legion: [{ owner: "setup", boundary: "Duplicate allowance; composition manual", evidence: "src/rules/setup/setupAnalyzer.ts" }],
  pope: [{ owner: "setup", boundary: "Good character duplicate allowance only", evidence: "src/rules/setup/setupAnalyzer.ts" }],
  marionette: [{ owner: "setup", boundary: "Bounded Demon adjacency validation", evidence: "src/rules/setup/setupAnalyzer.ts" }],
  washerwoman: [{ owner: "information", boundary: "Storyteller-chosen clue validated against actual roles and registration; one delivery; no clue suggestion", evidence: "src/stores/preparedInformation.ts" }],
  librarian: [{ owner: "information", boundary: "Outsider clue or explicit zero validated against the actual roster; impaired content is the Storyteller's choice", evidence: "src/stores/preparedInformation.ts" }],
  investigator: [{ owner: "information", boundary: "Minion clue validated against actual roles and registration; impaired content is the Storyteller's choice", evidence: "src/stores/preparedInformation.ts" }],
  butler: [{ owner: "selection", boundary: "Master choice recorded as reminder notation; voting compliance is player-owned and not enforced", evidence: "src/stores/butlerSelection.ts" }],
  mayor: [{ owner: "victory", boundary: "No-execution Day-end win evidence; attack redirection stays Storyteller-controlled", evidence: "src/stores/victoryEvidence.ts" }],
  saint: [{ owner: "victory", boundary: "Functioning Saint execution evidence; Storyteller declares the result", evidence: "src/stores/victoryEvidence.ts" }],
  scarletwoman: [{ owner: "abilities", boundary: "B4 supported Imp death, star-pass, Slayer and execution succession; exceptional interactions manual", evidence: "src/abilities/characters/scarletWoman.ts" }],
  soldier: [{ owner: "rules", boundary: "Canonical functioning Soldier Demon death protection only", evidence: "src/abilities/characters/passiveRules.ts" }],
  vortox: [{ owner: "rules", boundary: "Relevant Townsfolk information goes wholly Manual; no Vortox resolver", evidence: "src/abilities/characters/passiveRules.ts" }],
};

function capabilitiesOf(role: RawRole, semantics: AbilitySemanticsRegistry): CoverageCapability[] {
  const capabilities = [...(OWNED_CAPABILITIES[role.id] ?? [])];
  if (semantics.has(role.id)) capabilities.push({ owner: "abilities", boundary: "Registered bounded evaluator; context must separately pass automation eligibility", evidence: "src/abilities/characters/index.ts" });
  if (hasCountPolicy(role.id)) capabilities.push({ owner: "setup", boundary: "Single-effect count policy; mixed effects remain manual", evidence: "src/rules/setup/setupPolicies.ts" });
  if (hasUncertainComposition(role.id)) capabilities.push({ owner: "setup", boundary: "Explicit manual composition gate", evidence: "src/rules/setup/setupPolicies.ts" });
  if (["drunk", "marionette", "lunatic"].includes(role.id)) capabilities.push({ owner: "identity", boundary: "Separate actual and shown identity; not full character mechanics", evidence: "src/stores/identity.ts" });
  if (["recluse", "spy", "zombuul", "legion", "lycanthrope"].includes(role.id)) capabilities.push({ owner: "rules", boundary: "Registration uncertainty gate only", evidence: "src/stores/rulesQuery.ts" });
  return capabilities;
}

/** The frozen Phase 10F proof set (PHASE10F Section 17). Vortox is not
 * required for 10F closure. */
export const PROOF_SET: readonly string[] = [
  "poisoner", "monk", "imp", "fortuneteller", "drunk", "ravenkeeper", "slayer", "cultleader", "pithag", "alhadikhia",
  "tinker", "harlot", "toymaker", "baron",
];

type RawRole = { id: string; team: string; edition: string };
const WAVE_BY_EDITION: Record<string, CoverageWave> = { tb: "11A", bmr: "11B", snv: "11C" };

function waveOf(role: RawRole): CoverageWave {
  if (role.team === "traveller") return "11E";
  if (role.team === "fabled" || role.team === "loric") return "11F";
  return WAVE_BY_EDITION[role.edition] ?? "11D";
}

const isModifier = (kind: CoverageKind) => kind === "fabled" || kind === "loric";

/** Stage 5A-1. Derived from the same facts the gates read (the descriptor registry and the reviewed list), plus the
 * hand-read support pieces in coverageEvidence.ts. Presentation only: it changes no gate. */
function levelOf(entry: CoverageEntry, capabilities: readonly CoverageCapability[], semantics: AbilitySemanticsRegistry) {
  const id = entry.id;
  const reviewedInteraction = REVIEWED_INTERACTION_ROLES.has(id);
  const pieces = Object.prototype.hasOwnProperty.call(PARTIAL_SUPPORT, id) ? PARTIAL_SUPPORT[id]! : [];
  const inEnding = ENDING_EVIDENCE_ROLES.includes(id);
  const evidence: CoverageEvidence[] = [];
  // One entry per file: several reasons in the same file are joined into one entry.
  const addCode = (path: string, what: string) => {
    const same = evidence.findIndex(e => e.kind === "code" && e.path === path);
    if (same < 0) evidence.push({ kind: "code", path, what });
    else if (!evidence[same]!.what.includes(what)) evidence[same] = { ...evidence[same]!, what: `${evidence[same]!.what} ${what}` };
  };
  const guided = semantics.has(id);
  if (guided) addCode("src/abilities/characters/index.ts", "Registered ability descriptor; each action must also pass automation eligibility.");
  if (reviewedInteraction) addCode("src/abilities/characters/passiveRules.ts", "On the reviewed-interaction list: in play, it does not push other automation to Manual.");
  for (const c of capabilities) addCode(c.evidence, c.boundary);
  for (const piece of pieces) addCode(piece.path, piece.what);
  if (inEnding) addCode("src/stores/victoryEvidence.ts", "Listed in the game-ending evidence allow-list (a character outside it makes the ending Manual).");
  if (entry.status === "verifiedManual") addCode("src/abilities/characters/classification.ts", "Verified-manual classification: the Storyteller resolves it by design.");
  if (isModifier(entry.kind) && entry.scopes) addCode("src/abilities/modifiers.ts", `Hook scopes classified as [${entry.scopes.join(", ")}]; semantics are not modelled.`);
  const tests = Object.prototype.hasOwnProperty.call(TEST_EVIDENCE, id) ? TEST_EVIDENCE[id]! : [];
  if (guided || reviewedInteraction) for (const path of tests) evidence.push({ kind: "test", path, what: "Test file that names or loops over this character; it does not by itself prove every behaviour above." });

  const hasPiece = pieces.length > 0 || capabilities.length > 0 || inEnding || entry.status === "verifiedManual";
  const level: CoverageLevel = guided ? "guided" : reviewedInteraction && !isModifier(entry.kind) ? "reviewed" : hasPiece ? "partial" : "generic";
  const caveats = [
    ...(Object.prototype.hasOwnProperty.call(COVERAGE_CAVEATS, id) ? COVERAGE_CAVEATS[id]! : []),
    ...(Object.prototype.hasOwnProperty.call(PARTIAL_CAVEATS, id) ? [PARTIAL_CAVEATS[id]!] : []),
    ...(isModifier(entry.kind) ? [MODIFIER_ENDING_CAVEAT] : inEnding ? [] : [NOT_ON_ENDING_LIST_CAVEAT]),
  ];
  return { level, reviewedInteraction, evidence, ...(caveats.length ? { caveats } : {}) };
}

export function buildCoverageManifest(semantics: AbilitySemanticsRegistry = CANONICAL_ABILITY_SEMANTICS): CoverageEntry[] {
  const entries: CoverageEntry[] = (rawRoles as RawRole[]).map((role) => {
    const kind = (role.team === "traveller" ? "traveler" : role.team) as CoverageKind;
    const wave = waveOf(role);
    const note = Object.prototype.hasOwnProperty.call(COVERAGE_NOTES, role.id) ? { note: COVERAGE_NOTES[role.id]! } : {};
    if (semantics.has(role.id)) return { id: role.id, kind, status: "supported", wave, ...note };
    if (role.id === "baron") {
      return { id: role.id, kind, status: "setupOwned", wave, note: "Setup composition (Outsider count) stays Setup-owned; no ability-engine mechanic (PHASE10F Section 11; matrix 17)." };
    }
    const owned = Object.prototype.hasOwnProperty.call(OWNED_ELSEWHERE, role.id) ? OWNED_ELSEWHERE[role.id]! : undefined;
    if (owned && !VERIFIED_MANUAL.has(role.id)) return { id: role.id, kind, status: "ownedElsewhere", wave, note: note.note ?? owned };
    const reviewed = Object.prototype.hasOwnProperty.call(REVIEWED_MANUAL, role.id) ? REVIEWED_MANUAL[role.id]! : undefined;
    if (reviewed && !VERIFIED_MANUAL.has(role.id)) return { id: role.id, kind, status: "reviewedManual", wave, note: note.note ?? reviewed };
    const scopes = kind === "fabled" || kind === "loric" ? { scopes: CANONICAL_MODIFIER_SCOPES[role.id] ?? ["global" as const] } : {};
    const manual = VERIFIED_MANUAL.get(role.id);
    if (manual) return { id: role.id, kind, status: "verifiedManual", wave, ...scopes, note: manual };
    if (kind === "fabled" || kind === "loric") return { id: role.id, kind, status: "modifierScoped", wave, ...scopes };
    return { id: role.id, kind, status: "unclassified", wave, ...note };
  });
  for (const entry of jinxData as { id: string; jinx: { id: string }[] }[]) {
    for (const jinx of entry.jinx) {
      entries.push({ id: `${entry.id}+${jinx.id}`, kind: "jinx", status: "gatedJudgment", wave: "11F", note: "Gates its two characters' evaluations to a Storyteller judgment." });
    }
  }
  // Attach ownership independently of old status precedence: Setup/Voting
  // support must not disappear merely because a character lacks a descriptor.
  const rolesById = new Map((rawRoles as RawRole[]).map(role => [role.id, role]));
  return entries.map(entry => {
    const role = rolesById.get(entry.id);
    if (!role) return entry;
    const capabilities = capabilitiesOf(role, semantics);
    return { ...entry, capabilities, ...levelOf(entry, capabilities, semantics) };
  });
}

export type CoverageSummary = { revision: string; total: number; characterTotal: number; jinxTotal: number; byStatus: Record<CoverageStatus, number>; byLevel: Record<CoverageLevel, number> };

export function coverageSummary(manifest: readonly CoverageEntry[] = buildCoverageManifest()): CoverageSummary {
  const byStatus: Record<CoverageStatus, number> = { supported: 0, verifiedManual: 0, setupOwned: 0, modifierScoped: 0, gatedJudgment: 0, ownedElsewhere: 0, reviewedManual: 0, unclassified: 0 };
  const byLevel: Record<CoverageLevel, number> = { guided: 0, reviewed: 0, partial: 0, generic: 0 };
  for (const entry of manifest) { byStatus[entry.status]++; if (entry.level) byLevel[entry.level]++; }
  return { revision: CANONICAL_REVISION, total: manifest.length,
    characterTotal: manifest.filter(entry => entry.kind !== "jinx").length,
    jinxTotal: manifest.filter(entry => entry.kind === "jinx").length, byStatus, byLevel };
}
