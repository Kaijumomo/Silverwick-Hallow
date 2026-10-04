import { deriveAlignment, type RoleRegistry } from "@/data/roleRegistry";
import type { STPlayerRecord } from "@/stores/types";

/**
 * Phase 10G (PHASE10G Section 15): Storyteller-private token markers.
 * PRESENTATION ONLY -- they never decide legality or mechanics, and the
 * caller renders none of them under Privacy Mode (DOM absence).
 */

export type TokenMarker = { key: string; text: string; spoken: string };

/** Section 15.1: one concise "used" marker when `abilityUsed` is true; none otherwise. */
export function abilityUsedMarker(player: Pick<STPlayerRecord, "abilityUsed">): TokenMarker | null {
  return player.abilityUsed === true ? { key: "abilityUsed", text: "Ability used", spoken: "ability used" } : null;
}

/**
 * Section 15.2: the Actual Alignment marker.
 *  - Ordinary participant: shown ONLY when the Actual Alignment differs from
 *    the Role's ordinary alignment (registry / type semantics) -- never a
 *    redundant restatement. Unknown Role or unresolved alignment: nothing.
 *  - Traveler: the resolved Actual Alignment itself (not inferable from a
 *    character team); unresolved stays with the existing Traveler handling.
 * Shown Alignment (perception) is never substituted.
 */
export function actualAlignmentMarker(player: Pick<STPlayerRecord, "isTraveler" | "actualRole" | "actualAlignment">, registry: RoleRegistry): TokenMarker | null {
  const actual = player.actualAlignment;
  if (actual !== "good" && actual !== "evil") return null;
  if (player.isTraveler) {
    return { key: "travelerAlignment", text: actual === "good" ? "Good" : "Evil", spoken: `Traveler, actually ${actual}` };
  }
  const role = player.actualRole ? registry.get(player.actualRole) : undefined;
  if (!role || role.type === "traveler") return null;
  return deriveAlignment(role) === actual ? null : { key: "alignmentException", text: `Actually ${actual}`, spoken: `actually ${actual}` };
}
