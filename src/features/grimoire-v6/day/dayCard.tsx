import { createElement as E, type ReactNode } from "react";
import { iconUrlFor } from "@/data/iconUrl";
import { currentVotingState } from "@/stores/voting";
import type { V6Ctx } from "../ctx";
import { roman } from "../ringLayout";
import { blockNominee } from "./advance";
import { nominationsToday, toExecute } from "./dayModel";

/** The Day card (Day I / "N nominated today" / who is on the block), opened from the dock's Day button. */
export function buildDayCard(ctx: V6Ctx): Record<string, unknown> {
  if (!ctx.cards.day) return { on: false };
  const { game, layout, registry } = ctx;
  const block = blockNominee(game);
  const holder = block ? game.players[block.nominee.playerId] : null;
  const def = holder?.actualRole ? registry.get(holder.actualRole) : undefined;
  const nominated = nominationsToday(currentVotingState(game)).length;
  return {
    on: true,
    w: Math.round(Math.max(360, Math.min(520, 2 * (layout.rx - layout.S / 2 - 60)))),
    kicker: `Day ${roman(game.day)}`, sub: `${nominated} nominated today`,
    hasBlock: !!holder, blockImg: def ? iconUrlFor(def) : "",
    title: holder ? `${holder.name} is on the block` : "No one is on the block", titleColor: holder ? "#ff8a78" : "#f2ece0",
    text: block ? `${block.tally} votes. More votes on a later nomination replaces them; a tie clears the block.` : `${toExecute(game)} votes are needed to put a nominee on the block.`,
  };
}

/**
 * The arrow from accuser to accused and the clockwise sweep that follows the vote around the town
 * (V2 "nomination art"). Geometry follows the real seats, so a dragged token carries its arrow with it.
 */
export function buildNominationArt(ctx: V6Ctx): ReactNode {
  const { game, voting, layout, positions } = ctx;
  if (!voting?.open || voting.surface !== "nomination" || game.phase !== "day") return null;
  const round = voting.round;
  const nominator = round?.nominator ?? voting.draft?.nominator;
  const nominee = round?.nominee ?? voting.draft?.nominee;
  const a = nominator && positions[nominator.playerId];
  const b = nominee && positions[nominee.playerId];
  if (!nominator || !nominee || !a || !b) return null;
  const { S, rx, ry, cx, cy, w, h, angles } = layout;
  const kids: ReactNode[] = [];
  if (nominator.playerId !== nominee.playerId) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, gap = S / 2 + 12;
    const x1 = a.x + ux * gap, y1 = a.y + uy * gap, x2 = b.x - ux * gap, y2 = b.y - uy * gap;
    kids.push(E("line", { key: "l", x1, y1, x2, y2, stroke: "rgba(232,138,122,.75)", strokeWidth: 2, strokeDasharray: "7 7" }));
    kids.push(E("path", { key: "h", d: `M${x2} ${y2} l${(-ux * 12 - uy * 7).toFixed(1)} ${(-uy * 12 + ux * 7).toFixed(1)} M${x2} ${y2} l${(-ux * 12 + uy * 7).toFixed(1)} ${(-uy * 12 - ux * 7).toFixed(1)}`, stroke: "rgba(232,138,122,.9)", strokeWidth: 2, fill: "none", strokeLinecap: "round" }));
  }
  if (round && !round.virginPending) {
    const ni = game.seatOrder.indexOf(nominee.playerId);
    const voterId = voting.voter?.playerId;
    const ci = voterId ? game.seatOrder.indexOf(voterId) : ni;
    const a0 = angles[ni], a1raw = angles[ci];
    if (a0 !== undefined && a1raw !== undefined) {
      let a1 = a1raw;
      while (a1 <= a0 + 1e-6) a1 += 2 * Math.PI;
      const R2x = rx + S / 2 + 14, R2y = ry + S / 2 + 14, steps = 90;
      let d = "";
      for (let k = 0; k <= steps; k++) { const t = a0 + ((a1 - a0) * k) / steps; d += `${k ? "L" : "M"}${(cx + R2x * Math.cos(t)).toFixed(1)} ${(cy + R2y * Math.sin(t)).toFixed(1)}`; }
      kids.push(E("ellipse", { key: "trk", cx, cy, rx: R2x, ry: R2y, stroke: "rgba(176,186,204,.14)", strokeWidth: 1, fill: "none" }));
      kids.push(E("path", { key: "sw", d, stroke: "#e8584a", strokeWidth: 3, fill: "none", strokeLinecap: "round", style: { filter: "drop-shadow(0 0 6px rgba(255,122,104,.7))" } }));
      kids.push(E("circle", { key: "tip", cx: cx + R2x * Math.cos(a1), cy: cy + R2y * Math.sin(a1), r: 6, fill: "#ff7a68", style: { filter: "drop-shadow(0 0 8px rgba(255,122,104,.9))" } }));
    }
  }
  return E("svg", { "aria-hidden": true, width: w, height: h, style: { position: "absolute", left: 0, top: 0, pointerEvents: "none", overflow: "visible", zIndex: 5 } }, ...kids);
}
