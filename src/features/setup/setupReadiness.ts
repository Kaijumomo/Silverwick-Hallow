import type { SetupAction, SetupContext, SetupFinding } from "./setupContext";

export type SetupCommandResult = { ok: true } | { ok: false; message: string };
export function setupReadiness(findings: SetupFinding[], action: SetupAction): SetupCommandResult {
  const blockers = findings.filter(f => f.severity === "blocker" && (!f.actions || f.actions.includes(action)));
  return blockers.length ? { ok: false, message: blockers[0]!.message } : { ok: true };
}
/** Operation prerequisites, never BOTC judgment. Shared by UI and commands. */
export function readinessFindings(context: SetupContext): SetupFinding[] {
  const { game, population: p, pool, ordinary, travelers } = context;
  const out: SetupFinding[] = [];
  const block = (code: string, message: string, actions?: SetupAction[]) =>
    out.push({ code, message, actions, source: "shared", severity: "blocker" });
  if (game.phase !== "setup") block("not-setup", "This game is no longer in setup.");
  if (p.targetNonTravelerCount === null) block("target-unspecified", "Set the intended non-Traveler count before starting.");
  else if (p.targetNonTravelerCount !== p.occupiedNonTravelerCount)
    block("population-mismatch", `Reconcile the target (${p.targetNonTravelerCount}) with ${p.occupiedNonTravelerCount} occupied ordinary seats.`);
  if (p.emptyPlannedSeatCount) block("empty-seats", "Fill or remove unused ordinary seats before starting.");
  if (!ordinary.length) block("no-recipients", "Seat at least one ordinary player before starting.");
  if (!pool.length || pool.length !== ordinary.length)
    block("pool-recipients", `Deal needs one pooled role for each occupied ordinary seat (${pool.length} roles, ${ordinary.length} recipients).`, ["deal"]);
  if (pool.length) block("undealt-pool", "Deal the pool, or clear it to begin with manually assigned roles.", ["manual"]);
  if (ordinary.some(p => !p.actualRole)) block("missing-assignments", "Assign an actual role to every ordinary player before beginning Night 1.", ["manual"]);
  if (travelers.some(p => !p.actualRole)) block("missing-traveler-role", "Assign an actual Traveler role before beginning Night 1.");
  return out;
}
