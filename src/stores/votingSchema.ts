import { z } from "zod";

// Kept independent of schemas.ts: that module imports this persisted domain.
const participant = z.object({ kind: z.literal("participant"), participantId: z.string().min(1), playerId: z.string().min(1), nameAtTime: z.string() }).strict();
const response = z.object({ voter: participant, choice: z.enum(["yes", "no", "skipped"]), weight: z.number().int().min(-20).max(20), spentGhostVote: z.boolean(), refundSafe: z.boolean(), lifeSafe: z.boolean() }).strict().superRefine((r, ctx) => {
  if (r.choice !== "yes" && (r.weight !== 0 || r.spentGhostVote)) ctx.addIssue({ code: "custom", message: "Only a yes response carries votes or spends a token." });
  if (r.refundSafe && !r.spentGhostVote) ctx.addIssue({ code: "custom", message: "Only a consumed token can be refundable." });
  if (r.refundSafe && !r.lifeSafe) ctx.addIssue({ code: "custom", message: "Changed Life cannot carry safe token-refund evidence." });
});
const round = z.object({
  id: z.string().min(1).max(200), mode: z.enum(["nomination", "exile"]), nominator: participant, nominee: participant,
  order: z.array(participant).min(1).max(20), responses: z.array(response).max(20), threshold: z.number().int().min(1).max(20),
  status: z.enum(["voting", "outcome", "acknowledged", "abandoned"]),
  result: z.enum(["belowThreshold", "block", "tie", "exilePassed", "exileFailed", "virgin"]).nullable(),
  tally: z.number().int().min(-400).max(400), virginPending: z.boolean(), contextStamp: z.string().max(12000),
  executionEventIds: z.array(z.string().min(1)).max(1000),
}).strict().superRefine((r, ctx) => {
  if (new Set(r.order.map(p => p.participantId)).size !== r.order.length) ctx.addIssue({ code: "custom", message: "Voting order must contain distinct participants." });
  if (r.responses.some((a, i) => a.voter.participantId !== r.order[i]?.participantId)) ctx.addIssue({ code: "custom", message: "Responses must follow voting order." });
  if (r.tally !== r.responses.reduce((n, a) => n + a.weight, 0)) ctx.addIssue({ code: "custom", message: "Tally differs from accepted responses." });
  if (r.mode === "exile" && r.responses.some(a => a.spentGhostVote || (a.choice === "yes" && a.weight !== 1))) ctx.addIssue({ code: "custom", message: "Exile support cannot spend or weight votes." });
  if (r.order.at(-1)?.participantId !== r.nominee.participantId || !r.order.some(p => p.participantId === r.nominator.participantId)) ctx.addIssue({ code: "custom", message: "Round subjects must belong to its order, with nominee last." });
  if (r.virginPending && (r.mode !== "nomination" || r.status !== "voting" || r.responses.length > 0 || r.result !== null)) ctx.addIssue({ code: "custom", message: "First-nomination review must precede responses." });
  if (r.status === "voting" && (r.result !== null || r.responses.length === r.order.length)) ctx.addIssue({ code: "custom", message: "A live round has no completed result." });
  if ((r.status === "outcome" || r.status === "acknowledged") && r.result !== "virgin" && r.responses.length !== r.order.length) ctx.addIssue({ code: "custom", message: "A completed round requires every response." });
  if (r.result === "virgin" && (r.mode !== "nomination" || r.responses.length !== 0 || r.virginPending)) ctx.addIssue({ code: "custom", message: "Virgin resolution precedes ordinary voting." });
});
export const VotingDayStateSchema = z.object({
  day: z.number().int().nonnegative(), revision: z.number().int().nonnegative(), coverage: z.enum(["known", "unknown"]),
  rounds: z.array(round).max(100), activeRoundId: z.string().nullable(),
  block: z.object({ nominee: participant.nullable(), tally: z.number().int().min(1).max(400), roundId: z.string().min(1) }).strict().nullable(),
  modifiers: z.array(z.object({ id: z.string().min(1).max(200), kind: z.literal("bureaucrat"), source: participant, target: participant, appliesDay: z.number().int().positive() }).strict()).max(20),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.rounds.map(r => r.id)).size !== v.rounds.length) ctx.addIssue({ code: "custom", message: "Round ids must be unique." });
  if (new Set(v.modifiers.map(m => m.id)).size !== v.modifiers.length) ctx.addIssue({ code: "custom", message: "Modifier ids must be unique." });
  const active = v.rounds.filter(r => r.status === "voting" || r.status === "outcome");
  if (v.day === 0 && (v.rounds.length || v.block || v.modifiers.length)) ctx.addIssue({ code: "custom", message: "Setup has no voting events." });
  if (active.length > 1 || (active[0]?.id ?? null) !== v.activeRoundId) ctx.addIssue({ code: "custom", message: "Active round is inconsistent." });
  if (v.block && !v.rounds.some(r => r.id === v.block!.roundId && r.mode === "nomination")) ctx.addIssue({ code: "custom", message: "Block must name a recorded nomination." });
  let block: typeof v.block = null;
  for (const r of v.rounds) {
    if (r.status === "voting" || r.status === "abandoned" || r.result === "virgin") continue;
    let result: typeof r.result;
    if (r.mode === "exile") result = r.tally >= r.threshold ? "exilePassed" : "exileFailed";
    else if (r.tally < r.threshold || (block && r.tally < block.tally)) result = "belowThreshold";
    else {
      result = block && r.tally === block.tally ? "tie" : "block";
      block = { nominee: result === "tie" ? null : r.nominee, tally: r.tally, roundId: r.id };
    }
    if (r.result !== result) ctx.addIssue({ code: "custom", message: "Round outcome disagrees with its accepted tally." });
  }
  if (JSON.stringify(v.block) !== JSON.stringify(block)) ctx.addIssue({ code: "custom", message: "Execution block disagrees with recorded rounds." });
});
