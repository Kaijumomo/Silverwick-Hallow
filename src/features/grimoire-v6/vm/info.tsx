import { useEffect } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { infoStatistics, seatedPlayers, type SetupView } from "@/features/info/infoModel";
import type { V6Ctx } from "../ctx";
import { TEAM_COLOR } from "../icons";
import { flash } from "../v6Store";
import { buildBluffSlots, buildRefVm, buildShowVm, buildWinVm } from "../info/builders";
import { bluffRecipient, closeShow, confirmEnd, endInFlight, presentMessage, presentSetup, recoveryChoice, report, useEndStatus } from "../info/actions";
import { useInfoShow } from "../info/showStore";
import { INFO_TOKENS, SETUP_ICON, SETUP_LABEL, SETUP_ORDER } from "../info/tokens";
import { EMPTY, type SliceResult } from "./types";

const SETUP_SUB: Record<SetupView, string> = {
  traveler: "Demon only",
  demon: "Minions and selected bluffs",
  minion: "Demon and fellow Minions",
  bluffs: "Characters not in play",
};

/**
 * Slice 4F: the Info card, the Reference dialog, the full-screen player view (Show), the End game dialog and
 * the victory scene. Reuses the existing information model (recipients, setup payloads, bluff rules), the
 * player-safe presentation payloads and the terminal service; this hook only dresses them as the V2 design.
 * Showing information never changes the game and records nothing.
 */
export function useInfoVm(ctx: V6Ctx): SliceResult {
  const { game, script, registry, ui, privacy, layout, ended } = ctx;
  const current = useInfoShow((s) => s.current);
  const status = useEndStatus();
  const terminal = useStorytellerStore((s) => s.terminalClose);
  const lobby = useStorytellerStore((s) => s.lobby);
  const selectPlayer = useStorytellerStore((s) => s.selectPlayer);

  const showOpen = !!ui.show && !!current;
  const recovery = terminal?.confirmedRecovery || terminal?.recoveryPending ? recoveryChoice() : null;
  const endOpen = ui.endOpen && !ended && !privacy;

  // An Undo (or anything else) that closes the player view also drops what it was holding.
  useEffect(() => { if (!ui.show && current) useInfoShow.getState().clear(); }, [ui.show, current]);
  // An interrupted ending must be finished (or recovered) before anything else: bring the dialog back.
  useEffect(() => { if (terminal?.recoveryPending && !ended) ui.set({ endOpen: true }); }, [terminal?.recoveryPending, ended]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showOpen && !endOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (showOpen) closeShow();
      else if (!endInFlight() && !recoveryChoice()) ui.set({ endOpen: false });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showOpen, endOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Info card ───────────────────────────────────────────────────────────────
  const { rx, ry, S } = layout;
  const ax = rx - S / 2 - 12, ay = ry - S / 2 - 30, flat = 180;
  const squeeze = ay > flat ? Math.sqrt(1 - (flat / ay) * (flat / ay)) : 0;
  const infoOn = ctx.cards.info && !privacy;
  const stats = infoStatistics(game);
  // The table's actual composition. The key is shared with the wizard's planned composition (setup slice),
  // so it is only supplied while this card is the one on screen.
  const count = (type: string) => seatedPlayers(game).filter((p) => !p.isTraveler && registry.get(p.actualRole)?.type === type).length;
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
  const composition = infoOn ? ([["townsfolk", "Townsfolk", "Townsfolk"], ["outsider", "Outsider", "Outsiders"], ["minion", "Minion", "Minions"], ["demon", "Demon", "Demons"]] as const).map(([type, one, many]) => {
    const n = count(type);
    return { n, label: plural(n, one, many), color: TEAM_COLOR[type] };
  }) : undefined;

  const recipient = infoOn ? bluffRecipient(game, script) : undefined;
  const canEdit = !ended && !ctx.mutationLocked;
  const openBluff = (slot: number) => {
    if (!recipient) { flash("Assign a Demon or apparent Demon to choose bluffs."); return; }
    if (!canEdit) { flash("This game can no longer be changed."); return; }
    ui.set({ picker: { mode: "bluff", slot }, pickHover: recipient.privateInfo?.bluffs?.[slot] ?? null });
    selectPlayer(null);
  };
  const bluffs = infoOn ? buildBluffSlots({ bluffs: recipient?.privateInfo?.bluffs ?? [], get: (id) => registry.get(id), open: openBluff }) : [];

  const setupInfo = infoOn ? SETUP_ORDER.map((view) => ({ label: SETUP_LABEL[view], sub: SETUP_SUB[view], icon: SETUP_ICON[view], open: () => report(presentSetup(view)) })) : [];
  const infoTokens = infoOn ? INFO_TOKENS.map((t) => ({
    label: t.label, icon: t.icon, color: t.color,
    open: () => {
      if (t.pick) { ui.set({ picker: { mode: "show", title: t.title ?? t.label }, pickHover: null }); selectPlayer(null); return; }
      report(presentMessage(t.symbol!, t.label));
    },
  })) : [];

  // ── Reference ───────────────────────────────────────────────────────────────
  const refOn = ctx.cards.reference && !privacy;
  const ref = refOn ? buildRefVm(ctx, (id) => ui.set({ refSel: id })) : null;

  // ── End game ────────────────────────────────────────────────────────────────
  const notice = recovery
    ? terminal?.confirmedRecovery ? "The online game has ended. Save its confirmed result here to finish." : "An ending was interrupted. Retry to recover the recorded result."
    : lobby ? "The declared result will also be shared with seated players." : "";
  const endDlg = {
    open: endOpen,
    close: () => { if (!endInFlight() && !recoveryChoice()) ui.set({ endOpen: false }); },
    // The Storyteller always chooses. While an ending is being recovered only the recorded outcome may be retried.
    good: () => void confirmEnd(recovery ?? "good"),
    evil: () => void confirmEnd(recovery ?? "evil"),
    noResult: () => void confirmEnd(recovery ?? "noResult"),
    retry: () => { if (recovery) void confirmEnd(recovery); },
    recovery: !!recovery, choices: !recovery, notice, error: status.error ?? "", busy: status.busy,
  };

  return {
    ...EMPTY,
    vm: {
      stop: (e: { stopPropagation: () => void }) => e.stopPropagation(),
      infoC: { on: infoOn, w: Math.round(Math.max(720, Math.min(900, 2 * ax * squeeze, layout.w - 60))) },
      stats: [{ n: stats.alive, label: "Alive" }, { n: stats.votes, label: "Votes" }, { n: stats.toExecute, label: "To execute" }],
      ...(composition ? { composition } : {}),
      bluffs, showBluffs: () => report(presentSetup("bluffs")), setupInfo, infoTokens,
      refM: ref ? ref.vm : { on: false },
      refEmpty: !!ref?.empty, refQuery: ui.refQuery,
      onRefQuery: (e: { target: { value: string } }) => ui.set({ refQuery: e.target.value }),
      clearRef: () => ui.set({ refQuery: "" }),
      show: buildShowVm(showOpen ? current : null, closeShow),
      endDlg,
      win: buildWinVm(ctx, () => ui.set({ winScene: false })),
    },
  };
}
