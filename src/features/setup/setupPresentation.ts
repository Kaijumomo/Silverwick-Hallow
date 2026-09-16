import type { SetupAnalysis } from "./setupAnalyzer";
import { isPostDeal, type SetupFinding } from "./setupContext";
import type { StorytellerLobbyRecord } from "@/stores/types";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Presentation only. Structural permission always comes from the analyzer. */
export function setupPresentation(game: StorytellerLobbyRecord, analysis: SetupAnalysis) {
  const dealt = isPostDeal(game);
  const action = dealt ? "begin" : "deal";
  const findings = analysis.findings.filter(f =>
    (!f.actions || f.actions.includes(action)) &&
    (f.severity === "blocker" || f.source === "shared" || f.source === (dealt ? "assigned" : "pool") || f.code.startsWith("traveler-")));
  const p = analysis.population;
  const target = p.targetNonTravelerCount;
  const ready = analysis.readiness[action];
  let next: "count" | "seats" | "roles" | "review" | "deal" | "begin";
  let message: string;
  if (target === null) { next = "count"; message = "Choose the number of players"; }
  else if (p.occupiedNonTravelerCount < target) {
    next = "seats"; message = `Seat ${plural(target - p.occupiedNonTravelerCount, "more player")}`;
  } else if (p.occupiedNonTravelerCount > target) {
    next = "seats"; message = `${plural(p.occupiedNonTravelerCount - target, "extra player")} seated — review seating`;
  } else if (p.emptyPlannedSeatCount) {
    next = "seats"; message = `Remove ${plural(p.emptyPlannedSeatCount, "unused seat")}`;
  } else if (!dealt && game.rolePool.length !== target) {
    next = "roles";
    message = game.rolePool.length < target ? `Choose ${plural(target - game.rolePool.length, "more role")}`
      : `Remove ${plural(game.rolePool.length - target, "extra role")}`;
  } else if (!ready.ok) {
    next = "review"; message = "Review setup before continuing";
    if (findings.some(f => f.code === "missing-traveler-role" || f.code.startsWith("traveler-type:"))) message = "Choose a character for each Traveler";
    else if (findings.some(f => f.code === "missing-perception:ordinary")) message = "Choose the identity each player will see";
    else if (dealt && findings.some(f => f.code === "missing-assignments")) message = "Choose missing roles in the grimoire";
  } else { next = dealt ? "begin" : "deal"; message = dealt ? "Roles dealt" : "Ready to deal"; }
  return { dealt, findings, next, message, ready,
    composition: dealt ? analysis.assigned : analysis.pool,
    checks: findings.filter(f => f.severity === "check" || f.severity === "warning") };
}

/** Short summaries without duplicating character rules or changing findings. */
export function findingSummary(f: SetupFinding): string {
  if (f.code.startsWith("manual-roles:")) return f.message.split(".")[0]!.replace("Review character setup: ", "Review setup for ");
  if (f.code.startsWith("composition:")) return "Review the mix of selected roles";
  if (f.code.startsWith("interaction:")) return "Confirm how the setup modifiers work together";
  if (f.code.startsWith("jinxes:")) return "Review character interactions";
  if (f.code.startsWith("custom:")) return "Review custom character setup";
  if (f.code.startsWith("traveler-alignment:")) return "Choose each Traveler’s alignment privately";
  if (f.code.startsWith("missing-perception:")) return "Review the identities players will see";
  if (f.code === "pool-and-assigned") return "Dealing will replace the roles in the grimoire";
  if (f.code.startsWith("modifier:")) return `Review ${f.message.split(":")[0]} setup`;
  return f.message.split(". ")[0]!;
}
