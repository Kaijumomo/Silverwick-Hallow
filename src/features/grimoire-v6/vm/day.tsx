import { useEffect } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import type { V6Ctx } from "../ctx";
import { flash } from "../v6Store";
import { advanceToNight, blockNominee, executeBlockIfKnown } from "../day/advance";
import { buildDayCard, buildNominationArt } from "../day/dayCard";
import { buildNominations } from "../day/nomination";
import { buildSlayer } from "../day/slayer";
import { buildKlutzCard } from "../day/klutz";
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

  // The Day's overlays belong to the Day: leaving it, or hiding the tokens, puts the shot away.
  useEffect(() => { if (!day && ui.slay) ui.set({ slay: null }); }, [day, ui.slay]);
  useEffect(() => { if (privacy && ui.slay) ui.set({ slay: null }); }, [privacy, ui.slay]);
  // The Klutz's card (PO design direction 2026-11-19) closes the same way, and when its choice is no longer owed (Undo, a recorded choice).
  const kl = day ? buildKlutzCard(ctx) : { on: false };
  // It also closes (nothing recorded) when another card takes the centre: Players, Info, Reference, a token picker or a reveal.
  const covered = (!!ui.panel && ui.panel !== "night") || !!ui.picker || !!ui.show || !!voting?.open;
  useEffect(() => { if (ui.klutz && (!day || privacy || !kl.on || covered)) ui.set({ klutz: null }); }, [day, privacy, ui.klutz, kl.on, covered]);

  // The Day's marks and seat taps reach the board through its two overlay seams.
  usePublishTokenDecorations("day", day ? dayTokenDecor(ctx) : null);
  useTokenTapInterceptor("day", day ? (id) => dayTokenTap(ctx, id) : null);

  if (!day) return { vm: { ns: { on: false, cardOn: false }, dayC: { on: false }, sv: { open: false }, kl: { on: false }, nomDim: 0, nomArt: null } };

  const { ns, nomDim } = buildNominations(ctx);
  const block = blockNominee(game);
  const open = !!voting?.open;
  const resumable = !open && voting?.round?.status === "voting";

  const nominate = () => {
    if (privacy) { flash("Show tokens to open nominations."); return; }
    if (!voting) return;
    if (open) { voting.close(); return; }
    ui.set({ slay: null, klutz: null, panel: null, card: false, popMode: "main" });
    useStorytellerStore.getState().selectPlayer(null);
    voting.show();
  };

  const execute = () => {
    if (privacy) { flash("Show tokens to continue."); return; }
    if (block) { ui.set({ slay: null, klutz: null, panel: null, card: false }); if (!executeBlockIfKnown(ctx)) voting?.show("finish"); return; }
    advanceToNight(ctx);
  };

  return {
    vm: {
      ns, nomDim: ui.slay ? 1 : nomDim, nomArt: buildNominationArt(ctx),
      dayC: buildDayCard(ctx), sv: buildSlayer(ctx), kl,
    },
    advance: { text: block ? `Execute ${game.players[block.nominee.playerId]?.name ?? block.nominee.nameAtTime}` : `Begin Night ${game.day + 1}`, run: execute },
    pill: {
      blockOn: !!block, blockText: block ? `On the block · ${block.tally}` : "",
      nominate, nomActive: open, nomColor: open ? "#f4a595" : "rgba(222,216,204,.75)", nomShort: open ? "Close" : resumable ? "Resume" : "Nominate",
    },
  };
}
