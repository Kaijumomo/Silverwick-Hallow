import { useEffect } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";
import { advanceToNight, blockNominee } from "../day/advance";
import { buildDayCard, buildNominationArt } from "../day/dayCard";
import { useDayUi } from "../day/dayUi";
import { buildNominations } from "../day/nomination";
import { buildSlayer } from "../day/slayer";
import { dayTokenDecor, dayTokenTap } from "../day/tokens";
import { usePublishTokenDecorations, useTokenTapInterceptor } from "../board/overlay";
import type { SliceResult } from "./types";

/**
 * Package 4E: the Day. The nomination card and its vote, the Day card, the Slayer's face-off, the
 * dock's Nominate / Execute / Begin Night controls. All of it drives the Voting engine and the ability
 * coordinator through their existing commands; this file only decides what the V2 design shows.
 * Seat decoration and the seat-tap route live in day/tokens.tsx for the board slice to call.
 */
export function useDayVm(ctx: V6Ctx): SliceResult {
  const { game, ui, privacy, voting } = ctx;
  const day = game.phase === "day";
  useDayUi((s) => s.log);

  // The Day's overlays belong to the Day: leaving it, or hiding the tokens, puts the shot away.
  useEffect(() => { if (!day && ui.slay) ui.set({ slay: null }); }, [day, ui.slay]);
  useEffect(() => { if (privacy && ui.slay) ui.set({ slay: null }); }, [privacy, ui.slay]);

  // The Day's marks and seat taps reach the board through its two overlay seams.
  usePublishTokenDecorations("day", day ? dayTokenDecor(ctx) : null);
  useTokenTapInterceptor("day", day ? (id) => dayTokenTap(ctx, id) : null);

  if (!day) return { vm: { ns: { on: false, cardOn: false }, dayC: { on: false }, sv: { open: false }, nomDim: 0, nomArt: null } };

  const { ns, nomDim } = buildNominations(ctx);
  const block = blockNominee(game);
  const open = !!voting?.open;
  const resumable = !open && voting?.round?.status === "voting";

  const nominate = () => {
    if (privacy) { flash("Show tokens to open nominations."); return; }
    if (!voting) return;
    if (open) { voting.close(); return; }
    ui.set({ slay: null, panel: null, card: false, popMode: "main" });
    useStorytellerStore.getState().selectPlayer(null);
    voting.show();
  };

  const execute = () => {
    if (privacy) { flash("Show tokens to continue."); return; }
    if (block) { ui.set({ slay: null, panel: null, card: false }); voting?.show("finish"); return; }
    advanceToNight(ctx);
  };

  return {
    vm: {
      ns, nomDim: ui.slay ? 1 : nomDim, nomArt: buildNominationArt(ctx),
      dayC: buildDayCard(ctx), sv: buildSlayer(ctx),
    },
    advance: { text: block ? `Execute ${game.players[block.nominee.playerId]?.name ?? block.nominee.nameAtTime}` : `Begin Night ${game.day + 1}`, run: execute },
    pill: {
      blockOn: !!block, blockText: block ? `On the block · ${block.tally}` : "",
      nominate, nomActive: open, nomColor: open ? "#f4a595" : "rgba(222,216,204,.75)", nomShort: open ? "Close" : resumable ? "Resume" : "Nominate",
    },
  };
}
