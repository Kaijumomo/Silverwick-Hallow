import rawRoles from "./roles.json";
import nightsheet from "./nightsheet.json";
import type { RoleDef, RoleType } from "@/stores/types";

export const CANONICAL_REVISION = "f10cd02e3401af227ce406287eaae7bb99a06a42";
export const CANONICAL_SOURCE = "https://github.com/ThePandemoniumInstitute/botc-release/tree/" + CANONICAL_REVISION + "/resources/data";
export const CANONICAL_VERIFIED_AT = "2026-09-07";
export const NIGHT_SHEET = nightsheet;

/** Publisher reminder markup is not an instruction to expose UI/debug tokens. */
function instruction(text: string) {
  return text.replace(/:reminder:/g, "Update the relevant reminder tokens.").replace(/\*/g, "");
}

// Numeric fields are an adapter for existing RoleDef consumers/custom scripts,
// not a second hand-maintained ordering dataset. Zero means no procedure.
export function canonicalOrder(id: string, first: boolean): number | undefined {
  const index = (first ? nightsheet.firstNight : nightsheet.otherNight).indexOf(id);
  return index < 0 ? undefined : index + 1;
}

const roles = new Map<string, RoleDef>(rawRoles.map(raw => {
  const firstNight = canonicalOrder(raw.id, true);
  const otherNight = canonicalOrder(raw.id, false);
  const role: RoleDef = {
    ...raw,
    type: (raw.team === "traveller" ? "traveler" : raw.team) as RoleType,
    edition: raw.edition === "carousel" ? "experimental" : raw.edition,
    ...(firstNight ? { firstNight, firstNightPrompt: instruction(raw.firstNightReminder || raw.ability) } : {}),
    ...(otherNight ? { otherNight, otherNightPrompt: instruction(raw.otherNightReminder || raw.ability) } : {}),
    oncePerGame: /^Once per game\b/i.test(raw.ability),
    provenance: {
      status: raw.edition === "carousel" ? "official-experimental" : "official",
      source: CANONICAL_SOURCE,
      revision: CANONICAL_REVISION,
      verifiedAt: CANONICAL_VERIFIED_AT,
    },
  };
  return [raw.id, role];
}));

export function canonicalRoles(ids: string[]): RoleDef[] {
  return ids.map(id => {
    const role = roles.get(id);
    if (!role) throw new Error("Unknown canonical role: " + id);
    return role;
  });
}

/** Missing/legacy metadata never implies verification. Imported definitions are homebrew. */
export function isCanonicalRole(role: RoleDef): boolean {
  const known = roles.get(role.id);
  return !!known && role.provenance?.revision === CANONICAL_REVISION &&
    role.provenance.status === known.provenance?.status && role.provenance.source === CANONICAL_SOURCE &&
    ["name", "type", "edition", "alignment", "ability", "flavor", "setup", "firstNight", "otherNight", "firstNightPrompt",
      "otherNightPrompt", "firstNightReminder", "otherNightReminder", "oncePerGame", "reminders", "remindersGlobal", "special"]
      .every(key => JSON.stringify(role[key]) === JSON.stringify(known[key]));
}

export function roleAuthority(role: RoleDef): string {
  switch (role.provenance?.status) {
    case "official": return isCanonicalRole(role) ? "Official · verified" : "Unverified reference";
    case "official-experimental": return isCanonicalRole(role) ? "Official · experimental" : "Unverified reference";
    case "homebrew": return "Homebrew";
    default: return "Unverified reference";
  }
}
