import { useVotingInteraction } from "./VotingWorkspace";

/** Same arrow and clockwise sweep as Claude's Card; geometry follows the real seats. */
export function VotingBoardArt({ positions, width, height, rx, ry, cy, cx = 0, disc }: {
  positions: Record<string, { x: number; y: number }>; width: number; height: number;
  rx: number; ry: number; cy: number; cx?: number; disc: number;
}) {
  const ui = useVotingInteraction();
  if (!ui?.open || ui.surface !== "nomination") return null;
  const nominator = ui.round?.nominator ?? ui.draft?.nominator;
  const nominee = ui.round?.nominee ?? ui.draft?.nominee;
  const a = nominator && positions[nominator.playerId], b = nominee && positions[nominee.playerId];
  if (!a || !b) return null;
  const d = Math.hypot(b.x - a.x, b.y - a.y) || 1, ux = (b.x - a.x) / d, uy = (b.y - a.y) / d, gap = disc / 2 + 12;
  const x1 = a.x + ux * gap, y1 = a.y + uy * gap, x2 = b.x - ux * gap, y2 = b.y - uy * gap;
  const voter = ui.voter && positions[ui.voter.playerId];
  const start = Math.atan2((b.y - cy) / Math.max(1, ry), (b.x - cx) / Math.max(1, rx));
  let end = voter ? Math.atan2((voter.y - cy) / Math.max(1, ry), (voter.x - cx) / Math.max(1, rx)) : start;
  while (end <= start + 1e-6) end += Math.PI * 2;
  const ax = rx + disc / 2 + 14, ay = ry + disc / 2 + 14;
  const path = Array.from({ length: 91 }, (_, i) => { const t = start + (end - start) * i / 90; return `${i ? "L" : "M"}${cx + ax * Math.cos(t)} ${cy + ay * Math.sin(t)}`; }).join(" ");
  return <svg className="voting-board-art" viewBox={`${-width / 2} ${-height / 2} ${width} ${height}`} width={width} height={height} aria-hidden="true">
    {nominator?.participantId !== nominee?.participantId && <g fill="none" stroke="#e88a7a" strokeWidth="2" opacity=".8"><line x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray="7 7" /><path d={`M${x2} ${y2}l${-ux * 12 - uy * 7} ${-uy * 12 + ux * 7}M${x2} ${y2}l${-ux * 12 + uy * 7} ${-uy * 12 - ux * 7}`} /></g>}
    {ui.round && !ui.round.virginPending && <><ellipse cx={cx} cy={cy} rx={ax} ry={ay} fill="none" stroke="rgba(196,158,80,.14)" /><path d={path} fill="none" stroke="#e0b96a" strokeWidth="3" strokeLinecap="round" style={{ filter: "drop-shadow(0 0 6px rgba(242,207,126,.7))" }} /><circle cx={cx + ax * Math.cos(end)} cy={cy + ay * Math.sin(end)} r="6" fill="#f2cf7e" /></>}
  </svg>;
}
