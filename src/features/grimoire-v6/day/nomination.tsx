import { captureVotingContext } from "@/stores/storytellerStore";
import { executionsAt } from "@/stores/lifeEvents";
import { currentVotingState, virginNominationOutcome, votingContextChanged } from "@/stores/voting";
import type { CurrentParticipantRef, StorytellerLobbyRecord } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";
import { advanceToNight, blockNominee } from "./advance";
import { blockBefore, pipBackground, resultCopy, roundOrdinal, votesNeeded } from "./dayModel";
import { nominationExtras, type ExtraAction } from "./NominationExtras";

/** The faces the nomination card takes. The V2 design draws pick / accuse / vote / result; the rest reuse its result face. */
type Stage = "nominator" | "nominee" | "accuse" | "vote" | "result" | "virgin" | "context" | "finish" | "history";

const bind = (p: { id: string; participantId?: string }) => ({ playerId: p.id, participantId: p.participantId! });

function stageOf(ctx: V6Ctx): Stage | null {
  const voting = ctx.voting;
  if (!voting?.open) return null;
  if (voting.surface === "finish") return "finish";
  if (voting.surface === "history") return "history";
  const round = voting.round;
  if (round?.status === "voting") {
    const env = ctx.script ? { script: ctx.script, registry: ctx.registry } : undefined;
    if (votingContextChanged(ctx.game, round, env)) return "context";
    return round.virginPending ? "virgin" : "vote";
  }
  if (round?.status === "outcome") return "result";
  if (!voting.draft?.nominator) return "nominator";
  return voting.draft.nominee ? "accuse" : "nominee";
}

const nameOf = (game: StorytellerLobbyRecord) => (ref: CurrentParticipantRef) => game.players[ref.playerId]?.participantId === ref.participantId ? game.players[ref.playerId]!.name : ref.nameAtTime;

/** Everything the card, the token art and the dim of the board read, derived from the Voting engine's record. */
export function buildNominations(ctx: V6Ctx): { ns: Record<string, unknown>; nomDim: number; stage: Stage | null } {
  const { game, voting, layout } = ctx;
  const stage = stageOf(ctx);
  if (!stage || !voting) return { ns: { on: false, cardOn: false }, nomDim: ctx.ui.slay && game.phase === "day" ? 1 : 0, stage: null };

  const state = currentVotingState(game);
  const round = voting.round;
  const who = nameOf(game);
  const draftName = (b: { playerId: string } | null | undefined) => (b ? game.players[b.playerId]?.name ?? "" : "");
  const exile = round ? round.mode === "exile" : !!voting.draft?.nominee && !!game.players[voting.draft.nominee.playerId]?.isTraveler;
  const ordinal = roundOrdinal(state, stage === "nominator" || stage === "nominee" || stage === "accuse" ? null : round, exile);
  const kicker = `Day ${game.day} · ${stage === "finish" ? "Finish day" : stage === "history" ? "Nominations" : `${exile ? "Exile" : "Nomination"} ${ordinal}`}`;
  const cardW = Math.round(Math.min(560, Math.max(380, (layout.rx - layout.S / 2 - 30) * 2), layout.w - 40));

  const slotsOn = stage === "nominator" || stage === "nominee" || stage === "accuse";
  const nominator = round ? who(round.nominator) : draftName(voting.draft?.nominator);
  const nominee = round ? who(round.nominee) : draftName(voting.draft?.nominee);

  const base: Record<string, unknown> = {
    on: true, cardOn: true, panelOn: false, scrollOn: false, candleOn: false, cardW,
    pick: stage === "nominator" || stage === "nominee", kicker, kickerShort: kicker, close: voting.close,
    slots: slotsOn, accuse: stage === "accuse", vote: stage === "vote", result: false,
    s1: nominator || "Tap a player", s2: nominee || (stage === "nominee" ? "Tap a player" : "—"),
    s1Color: nominator ? "#ece6da" : "rgba(222,216,204,.4)", s2Color: nominee ? "#f2ece0" : "rgba(222,216,204,.4)",
    s1Border: stage === "nominator" ? "rgba(232,88,74,.7)" : "rgba(176,186,204,.14)",
    s2Border: stage === "nominee" ? "rgba(232,138,122,.75)" : stage === "accuse" ? "rgba(232,138,122,.4)" : "rgba(176,186,204,.14)",
    s1Ink: nominator ? "#2a1a10" : "rgba(42,26,16,.38)", s2Ink: nominee ? "#7a2418" : "rgba(42,26,16,.38)",
    s1Rule: stage === "nominator" ? "#7a2418" : "rgba(42,26,16,.3)", s2Rule: stage === "nominee" ? "#7a2418" : "rgba(42,26,16,.3)",
    stageLine: "", hint: "", hintShort: "", title: kicker,
    change: voting.change, begin: voting.begin,
    nextText: "Next nomination", next: voting.next, extraOn: false, extra: null,
  };

  const extra = (actions: ExtraAction[] = [], note: string | null = null) => ({ extraOn: true, extra: nominationExtras(actions, note) });
  const finish = (title: string, sub: string, color: string, nextText: string, onNext: () => void, actions: ExtraAction[] = []) =>
    ({ result: true, resultTitle: title, resultSub: sub, resultColor: color, nextText, next: onNext, ...extra(actions) });

  if (stage === "nominator" || stage === "nominee") {
    return { stage, nomDim: 1, ns: { ...base, stageLine: stage === "nominator" ? "Who accuses?" : "Who stands accused?",
      hint: stage === "nominator" ? "Tap the player making the nomination on the board." : "Tap the player being nominated.",
      hintShort: stage === "nominator" ? "Tap the accuser" : "Tap the accused", ...extra() } };
  }
  if (stage === "accuse") {
    return { stage, nomDim: 1, ns: { ...base, stageLine: "The accused may speak", ...extra() } };
  }

  if (stage === "vote" && round) {
    const voter = voting.voter;
    const current = voter ? game.players[voter.playerId] : null;
    const need = votesNeeded(round, state.block);
    const answered = round.responses.filter((r) => r.choice !== "skipped").length;
    return { stage, nomDim: 1, ns: { ...base, stageLine: "The vote", title: "The vote",
      voterKicker: exile ? "Now supporting" : "Now voting", voterName: voter ? who(voter) : "Review voter",
      voterSub: current ? `Seat ${current.seat + 1}${!current.alive && !exile ? " · ghost vote, spent if used" : ""}` : "The participant changed. Review this round.",
      yes: round.tally, need, countColor: round.tally >= need ? "#f4a595" : "#ff7a68", inkCount: round.tally >= need ? "#8e1f1a" : "#2a1a10",
      pips: round.order.map((_, i) => ({ bg: pipBackground(round, i) })),
      onYes: () => { if (voter) voting.run({ kind: "respond", roundId: round.id, voter, choice: "yes" }); },
      onNo: () => { if (voter) voting.run({ kind: "respond", roundId: round.id, voter, choice: "no" }); },
      undo: () => { if (answered) voting.run({ kind: "undoLast", roundId: round.id }); },
      ...extra() } };
  }

  if (stage === "result" && round) {
    const prior = blockBefore(state.rounds, round.id);
    const copy = resultCopy(round, who, prior);
    const common = { stageLine: "The verdict", title: "The verdict", inkResult: round.result === "block" ? "#8e1f1a" : "#2a1a10", yes: round.tally, need: round.threshold, pips: [] };
    if (round.result === "exilePassed") {
      const settle = (outcome: "died" | "survived") => () => { if (voting.run({ kind: "exileOutcome", roundId: round.id, outcome })) voting.close(); };
      return { stage, nomDim: 1, ns: { ...base, ...common, ...finish(copy.title, copy.sub, copy.color, "Exiled · died", settle("died"), [{ label: "Survived", onClick: settle("survived") }]) } };
    }
    if (round.result === "virgin") {
      return { stage, nomDim: 1, ns: { ...base, ...common, ...finish(copy.title, copy.sub, copy.color, `Begin Night ${game.day + 1}`, () => { advanceToNight(ctx); }) } };
    }
    return { stage, nomDim: 1, ns: { ...base, ...common, ...finish(copy.title, copy.sub, copy.color, "Next nomination", voting.next) } };
  }

  if (stage === "virgin" && round) {
    const env = ctx.script ? { script: ctx.script, registry: ctx.registry } : undefined;
    const outcome = virginNominationOutcome(game, round.nominator, round.nominee, env);
    const run = (execute: boolean, result?: "died" | "survived") => () => { voting.run({ kind: "virgin", roundId: round.id, execute, ...(result ? { outcome: result } : {}) }); };
    const trigger = outcome.kind === "trigger";
    const actions: ExtraAction[] = [{ label: "Executed · survived", onClick: run(true, "survived") }];
    if (!trigger) actions.push({ label: "Continue voting", onClick: run(false) });
    return { stage, nomDim: 1, ns: { ...base, stageLine: "The vote", ...finish(`${who(round.nominee)}’s first nomination`,
      trigger ? `${who(round.nominator)} is executed. Did they die?` : `Does the Virgin execute ${who(round.nominator)}?`, "#f4a595", "Execute · died", run(true, "died"), actions) } };
  }

  if (stage === "context" && round) {
    return { stage, nomDim: 1, ns: { ...base, ...finish("The table changed", "Review the players and living count before continuing.", "#f4a595", "Use current table",
      () => { voting.run({ kind: "acknowledgeContext", roundId: round.id }); }) } };
  }

  if (stage === "history") return { stage, nomDim: 1, ns: { ...base, ...extra() } };

  // finish: the day's execution, confirmed against what actually happened (died / survived).
  return { stage: "finish", nomDim: 1, ns: { ...base, ...buildFinish(ctx, finish) } };
}

type FinishFn = (title: string, sub: string, color: string, nextText: string, onNext: () => void, actions?: ExtraAction[]) => Record<string, unknown>;

/** The Execute / Begin Night confirmation the dock opens: records the actual outcome, then Night waits on the dock. */
function buildFinish(ctx: V6Ctx, finish: FinishFn): Record<string, unknown> {
  const { game, voting } = ctx;
  const begin = () => { advanceToNight(ctx); };
  const round = voting?.round;
  if (round?.status === "voting") return finish("A vote is still in progress", "Finish it, or deliberately abandon it, before the Day ends.", "#f4a595", "Resume vote", () => voting?.show());
  if (round?.mode === "exile" && round.result === "exilePassed") return finish("An exile needs its outcome", "Resolve the supported exile before the Day ends.", "#f4a595", "Resolve exile", () => voting?.show());

  const query = executionsAt(game, { phase: "day", day: game.day });
  const events = query.status === "known" ? query.events : query.recorded;
  if (events.length) {
    return finish("Execution recorded", events.map((e) => `${e.subject.nameAtTime}${"outcome" in e ? ` · ${e.outcome === "alreadyDead" ? "already dead" : e.outcome}` : ""}`).join("; "), "#f4a595", `Begin Night ${game.day + 1}`, begin);
  }

  const block = blockNominee(game);
  const target = block ? game.players[block.nominee.playerId] : null;
  const player = target && target.participantId === block?.nominee.participantId ? target : null;
  const record = (outcome: "died" | "survived" | "alreadyDead") => () => {
    if (!player?.participantId || !voting) return;
    const done = voting.run({ kind: "execution", target: bind(player), outcome }, captureVotingContext());
    if (!done) return;
    voting.close();
    flash(outcome === "survived" ? `${player.name} survives the execution. Begin the night when ready.` : `${player.name} is executed. Begin the night when ready.`);
  };
  if (player) {
    const pacifist = Object.values(game.players).some((p) => !p.isEmpty && p.alive && p.actualRole === "pacifist");
    const note = pacifist ? "Pacifist may apply. You decide whether an executed good player survives." : "Record what actually happened to them.";
    if (!player.alive) return finish(`${player.name} is already dead`, "Record the execution as it stands.", "#f4a595", "Record execution", record("alreadyDead"), [{ label: "No execution", tone: "quiet", onClick: begin }]);
    return finish(`Did ${player.name} die?`, note, "#f4a595", "Yes · died", record("died"), [{ label: "No · survived", onClick: record("survived") }, { label: "No execution", tone: "quiet", onClick: begin }]);
  }
  return finish("No execution", query.status === "unknown" ? "Earlier execution coverage is unknown. Confirm the actual outcome." : "No one will be executed today.", "#ddd6c8", `No execution · Begin Night ${game.day + 1}`, begin);
}
