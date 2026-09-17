import { isInitialRevealComplete } from "@/stores/identity";
import { isPostDeal, type SetupContext } from "./setupContext";
import { sameCounts } from "./setupPolicies";
import type { SetupAnalysis } from "./setupAnalyzer";
import { MIN_PLAYERS, MAX_PLAYERS } from "@/data/setupCounts";
import type { PlayerId, RoleId, StorytellerLobbyRecord } from "@/stores/types";

export type RefinementGateResult = { ok: true } | { ok: false; message: string };

/**
 * Pre-Reveal Setup refinement (Shuffle/Swap/Manual Override/Edit Bag) is
 * administration of the private Deal, available only after the initial Deal
 * and before the initial Reveal commits the setup. Enforced by every
 * refinement command itself, even when invoked directly — never only a UI
 * affordance. Once Reveal succeeds, every one of these commands refuses.
 */
export function canRefineSetup(game: StorytellerLobbyRecord): RefinementGateResult {
  if (game.phase !== "setup") return { ok: false, message: "This game is no longer in setup." };
  if (!isPostDeal(game)) return { ok: false, message: "Deal the pool before refining roles." };
  if (isInitialRevealComplete(game))
    return { ok: false, message: "Setup is already revealed and can no longer be refined." };
  return { ok: true };
}

/**
 * The current dealt bag: the ordinary assigned actual-role multiset,
 * excluding Travelers, in seat order. rolePool is empty after Deal — this
 * derives the bag from live assignments instead of rehydrating it.
 */
export function currentDealtBag(context: SetupContext): RoleId[] {
  return context.assigned;
}

/**
 * Whether the current assigned composition is coherent enough to shuffle
 * safely: every occupied ordinary player has an actual role, no structural
 * blocker exists for the assigned set, and the composition matches a
 * supported candidate. Reuses the existing analyzer's own composition
 * computation — never re-derives composition rules. Manual Override and
 * Edit Bag Apply deliberately do NOT require this (an invalid intermediate
 * setup is preserved as explicit Storyteller intent); only Shuffle and
 * Reveal do, since shuffling or revealing an invalid setup fixes nothing.
 */
export function assignedBagIsCoherent(context: SetupContext, analysis: SetupAnalysis): boolean {
  if (context.ordinary.some((p) => !p.actualRole)) return false;
  if (analysis.findings.some((f) => f.source === "assigned" && f.severity === "blocker")) return false;
  // FINAL POPULATION CLOSURE, Section 10: an unsupported ordinary target
  // (outside 5-15) is never coherent, even when no specific candidate
  // mismatch is computable for it -- compositionCandidates simply returns
  // no candidates outside the supported table, which would otherwise let
  // this check silently pass through as "no known mismatch." A corrupted
  // or adversarial population must never fall back to looking like an
  // acceptable manual setup.
  const target = context.population.targetNonTravelerCount;
  if (target !== null && (target < MIN_PLAYERS || target > MAX_PLAYERS)) return false;
  const { candidates, actual } = analysis.assigned;
  if (candidates && !candidates.some((c) => sameCounts(c, actual))) return false;
  return true;
}

export type BagSeatAssignment = { playerId: PlayerId; role: RoleId };
export type BagMatchResult = { playerId: PlayerId; role: RoleId; changed: boolean };

/**
 * Stable, deterministic pairing for applying an edited bag. Every existing
 * seat whose role occurrence still exists (by count, not merely by role id
 * — duplicates are multiset-aware) in the new bag keeps its role untouched.
 * Only seats whose occurrence was removed receive one of the newly added
 * occurrences, paired in affected-seat order (the existing ordinary seat
 * order) against added-role order (the staged bag's own array order) — no
 * hidden shuffling. Returns null when the staged bag's length doesn't match
 * the number of current assignments (caller must reject before pairing).
 */
export function matchBagToAssignments(
  current: BagSeatAssignment[],
  stagedBag: RoleId[]
): BagMatchResult[] | null {
  if (current.length !== stagedBag.length) return null;

  const remainingNewCounts = new Map<RoleId, number>();
  for (const role of stagedBag) remainingNewCounts.set(role, (remainingNewCounts.get(role) ?? 0) + 1);

  const kept: BagMatchResult[] = [];
  const affectedSeats: PlayerId[] = [];
  for (const { playerId, role } of current) {
    const remaining = remainingNewCounts.get(role) ?? 0;
    if (remaining > 0) {
      remainingNewCounts.set(role, remaining - 1);
      kept.push({ playerId, role, changed: false });
    } else {
      affectedSeats.push(playerId);
    }
  }

  // Walk the staged bag in its own order; skip one occurrence per role for
  // each seat that already kept it, and treat every remaining occurrence as
  // newly added, in the order it appears.
  const keptCountByRole = new Map<RoleId, number>();
  for (const { role } of kept) keptCountByRole.set(role, (keptCountByRole.get(role) ?? 0) + 1);
  const added: RoleId[] = [];
  for (const role of stagedBag) {
    const skip = keptCountByRole.get(role) ?? 0;
    if (skip > 0) { keptCountByRole.set(role, skip - 1); continue; }
    added.push(role);
  }

  return [...kept, ...affectedSeats.map((playerId, i) => ({ playerId, role: added[i]!, changed: true }))];
}
