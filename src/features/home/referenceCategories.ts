// Home Character Reference categories (Package 1).
//
// Every supported official character (listOfficialRoles) lands in exactly one
// category:
//   - Trouble Brewing / Bad Moon Rising / Sects & Violets: the script's own
//     characters plus the Travellers published with that edition.
//   - Carousel: everything else -- the experimental characters (including the
//     experimental Travellers), the Fabled and the Loric.
// This is the official-character "Carousel", not the Storyteller's Custom Script.

import type { RoleDef } from "@/stores/types";
import { listOfficialRoles } from "@/data/officialRoles";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import canonicalList from "@/data/canonical/roles.json";

// The design lists each team in the publisher's own order (canonical roles.json),
// not the script's seating or night order. Unknown ids sort last, stably.
const PUBLISHER_ORDER = new Map<string, number>((canonicalList as { id: string }[]).map((r, i) => [r.id, i]));
const byPublisherOrder = (roles: RoleDef[]) =>
  [...roles].sort((a, b) => (PUBLISHER_ORDER.get(a.id) ?? 1e6) - (PUBLISHER_ORDER.get(b.id) ?? 1e6));

export type ReferenceCategoryId = "tb" | "bmr" | "snv" | "carousel";

export type ReferenceCategory = {
  id: ReferenceCategoryId;
  name: string;
  /** Short typographic mark used until approved edition artwork exists. */
  mark: string;
  roles: RoleDef[];
  /** Characters of the script itself (excludes Travellers). */
  scriptCount: number;
  travelerCount: number;
};

const EDITION_CATEGORIES: { id: Exclude<ReferenceCategoryId, "carousel">; name: string; mark: string }[] = [
  { id: "tb", name: "Trouble Brewing", mark: "TB" },
  { id: "bmr", name: "Bad Moon Rising", mark: "BMR" },
  { id: "snv", name: "Sects & Violets", mark: "S&V" },
];

export function buildReferenceCategories(all: RoleDef[] = listOfficialRoles()): ReferenceCategory[] {
  const claimed = new Set<string>();
  const categories: ReferenceCategory[] = EDITION_CATEGORIES.map((c) => {
    const script = BUILTIN_SCRIPTS[c.id];
    const scriptIds = new Set(script?.characters.map((r) => r.id) ?? []);
    const scriptRoles = all.filter((r) => scriptIds.has(r.id));
    const travelers = all.filter((r) => r.type === "traveler" && r.edition === c.id && !scriptIds.has(r.id));
    const roles = byPublisherOrder([...scriptRoles, ...travelers]);
    for (const r of roles) claimed.add(r.id);
    return { ...c, roles, scriptCount: scriptRoles.length, travelerCount: travelers.length };
  });
  const carousel = all.filter((r) => !claimed.has(r.id));
  categories.push({
    id: "carousel",
    name: "The Carousel",
    mark: "✦",
    roles: byPublisherOrder(carousel),
    scriptCount: carousel.length,
    travelerCount: 0,
  });
  return categories;
}
