import rawRoles from "@/data/canonical/roles.json";
import jinxData from "@/data/canonical/jinxes.json";
import { CANONICAL_REVISION } from "@/data/canonical";
import { CANONICAL_MODIFIER_SCOPES, type HookScope } from "./modifiers";
import { CANONICAL_ABILITY_SEMANTICS, type AbilitySemanticsRegistry } from "./semantics";

/**
 * Phase 10F: the canonical ability COVERAGE MANIFEST (PHASE10F Section 18,
 * 10F-AC-34) -- generated from the pinned canonical data, never hand-listed,
 * so every canonical Character / Traveler / Fabled / Loric and every jinx has
 * exactly one entry. 10F tracks the proof set; Phase 11 drives the count of
 * `unclassified` entries to zero (11A..11F).
 *
 * Statuses:
 *  - supported: verified semantics are registered (CANONICAL_ABILITY_SEMANTICS);
 *  - proofPendingEvidence: a frozen 10F proof character whose production
 *    semantics await authoritative BOTC rules verification (Manual until then);
 *  - setupOwned: deliberately NOT an ability-engine concern -- Setup owns it
 *    (the Baron negative proof, Section 11);
 *  - modifierScoped: a Fabled / Loric whose hook scopes are structurally
 *    classified (gating stays narrow) but whose semantics are unverified;
 *  - gatedJudgment: a canonical jinx -- it gates its two characters'
 *    evaluations to an explicit Storyteller judgment;
 *  - unclassified: Phase 11 work.
 */
export type CoverageStatus = "supported" | "proofPendingEvidence" | "setupOwned" | "modifierScoped" | "gatedJudgment" | "unclassified";
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
};

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

export function buildCoverageManifest(semantics: AbilitySemanticsRegistry = CANONICAL_ABILITY_SEMANTICS): CoverageEntry[] {
  const entries: CoverageEntry[] = (rawRoles as RawRole[]).map((role) => {
    const kind = (role.team === "traveller" ? "traveler" : role.team) as CoverageKind;
    const wave = waveOf(role);
    if (semantics.has(role.id)) return { id: role.id, kind, status: "supported", wave };
    if (role.id === "baron") {
      return { id: role.id, kind, status: "setupOwned", wave, note: "Setup composition (Outsider count) stays Setup-owned; no ability-engine mechanic (PHASE10F Section 11)." };
    }
    const scopes = kind === "fabled" || kind === "loric" ? { scopes: CANONICAL_MODIFIER_SCOPES[role.id] ?? ["global" as const] } : {};
    if (PROOF_SET.includes(role.id)) {
      return { id: role.id, kind, status: "proofPendingEvidence", wave, ...scopes, note: "Phase 10F proof character: Manual until its rules matrix is verified from authoritative BOTC sources." };
    }
    if (kind === "fabled" || kind === "loric") return { id: role.id, kind, status: "modifierScoped", wave, ...scopes };
    return { id: role.id, kind, status: "unclassified", wave };
  });
  for (const entry of jinxData as { id: string; jinx: { id: string }[] }[]) {
    for (const jinx of entry.jinx) {
      entries.push({ id: `${entry.id}+${jinx.id}`, kind: "jinx", status: "gatedJudgment", wave: "11F", note: "Gates its two characters' evaluations to a Storyteller judgment." });
    }
  }
  return entries;
}

export type CoverageSummary = { revision: string; total: number; byStatus: Record<CoverageStatus, number> };

export function coverageSummary(manifest: readonly CoverageEntry[] = buildCoverageManifest()): CoverageSummary {
  const byStatus: Record<CoverageStatus, number> = { supported: 0, proofPendingEvidence: 0, setupOwned: 0, modifierScoped: 0, gatedJudgment: 0, unclassified: 0 };
  for (const entry of manifest) byStatus[entry.status]++;
  return { revision: CANONICAL_REVISION, total: manifest.length, byStatus };
}
