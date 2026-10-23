import { createElement as E, type ReactNode } from "react";
import { currentVotingState } from "@/stores/voting";
import type { PlayerId } from "@/stores/types";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";
import { blockNominee } from "./advance";
import { slayerTap } from "./slayer";

/** What the Day paints on a seat token (merged over the board slice's token by player id). */
export type DayTokenDecor = {
  filter?: string;
  ringOn?: boolean;
  ringColor?: string;
  tagOn?: boolean;
  tagText?: string;
  tagColor?: string;
  /** The seat has voted yes in the vote under way (raised hand). */
  handOn?: boolean;
  glow?: ReactNode;
  cursor?: string;
};

const DIM = "grayscale(.9) brightness(.42)";

/**
 * Nomination and block marks for every seat: who accuses and who stands accused, who may still be
 * picked, whose turn it is to vote, and who is on the block. Empty outside the Day and in Privacy Mode.
 */
export function dayTokenDecor(ctx: V6Ctx): Record<PlayerId, DayTokenDecor> {
  const { game, voting, privacy } = ctx;
  const out: Record<PlayerId, DayTokenDecor> = {};
  if (game.phase !== "day" || privacy) return out;
  const state = currentVotingState(game);
  const block = blockNominee(game);
  const round = voting?.open ? voting.round : null;
  const draft = voting?.open && !round ? voting.draft : null;
  const nominators = new Set(state.rounds.filter((r) => r.mode === "nomination").map((r) => r.nominator.playerId));
  const nominees = new Set(state.rounds.filter((r) => r.mode === "nomination").map((r) => r.nominee.playerId));
  const nominatorId = round?.nominator.playerId ?? draft?.nominator?.playerId;
  const nomineeId = round?.nominee.playerId ?? draft?.nominee?.playerId;
  const voterId = voting?.open && round?.status === "voting" && !round.virginPending ? voting.voter?.playerId : undefined;
  const voters = round ? new Set(round.order.map((r) => r.playerId)) : null;
  const resultBlock = round?.status === "outcome" && round.result === "block";

  for (const id of game.seatOrder) {
    const p = game.players[id];
    if (!p || p.isEmpty) continue;
    const d: DayTokenDecor = {};
    if (voting?.open && voting.surface === "nomination") {
      d.cursor = "pointer";
      if (!round && !nominatorId && (!p.alive || nominators.has(id))) d.filter = DIM;
      if (!round && nominatorId && !nomineeId && nominees.has(id)) d.filter = DIM;
      if (!round && nominatorId && nomineeId && id !== nomineeId && nominees.has(id)) d.filter = DIM;
      if (round && voters && !voters.has(id)) d.filter = DIM;
      if (id === nominatorId) Object.assign(d, { ringOn: true, ringColor: "rgba(232,88,74,.9)", tagOn: true, tagText: "Nominator", tagColor: "#ffb4a6" });
      if (id === nomineeId) Object.assign(d, { ringOn: true, ringColor: "rgba(232,110,95,.95)", tagOn: true, tagText: resultBlock ? `On the block · ${round!.tally}` : "On trial", tagColor: "#f4a595" });
      if (round?.responses.some((r) => r.voter.playerId === id && r.choice === "yes")) d.handOn = true;
      if (id === voterId) d.glow = E("div", { key: "g", style: { position: "absolute", inset: -7, borderRadius: "50%", animation: "swGlow 1.8s ease-in-out infinite", pointerEvents: "none" } });
    }
    if (block && block.nominee.playerId === id && id !== nomineeId) {
      Object.assign(d, { tagOn: true, tagText: `On the block · ${block.tally}`, tagColor: "#f4a595" });
      if (!d.ringOn) Object.assign(d, { ringOn: true, ringColor: "rgba(232,110,95,.7)" });
    }
    if (Object.keys(d).length) out[id] = d;
  }
  return out;
}

/**
 * A seat tap while the Day owns the board. Returns true when the Day consumed it (the Slayer's shot, or a
 * nomination / vote tap); false leaves the tap to the board's ordinary selection.
 */
export function dayTokenTap(ctx: V6Ctx, id: PlayerId): boolean {
  const { game, ui, voting } = ctx;
  if (game.phase !== "day") return false;
  if (ui.slay) { slayerTap(ctx, id); return true; }
  if (voting?.open && voting.surface === "nomination") {
    const p = game.players[id];
    if (p && !p.isEmpty && !p.participantId) { flash("That seat is empty."); return true; }
    return voting.tap(id);
  }
  return false;
}
