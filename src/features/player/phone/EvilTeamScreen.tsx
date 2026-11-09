import { useEffect, useState } from "react";
import { GENERIC_TEAM_ICON } from "@/features/home/art";
import { GoldButton, PhoneFrame } from "./PhoneParts";

export type TeamMate = { name: string; seat: number; designation: "Minion" | "Demon"; icon: string };
export type TeamBluff = { id: string; name: string; art: string };

type Node = { key: string; name: string; type: "Demon" | "Minion"; sub: string; art: string; me: boolean; demon: boolean; size: number; x: number; y: number };

const MY = 300;
const PER_ROW = 4;
const BASE_H = 420;
const ROW_GAP = 165;
/** With no Demon supplied the empty top of the web is closed up. */
const NO_DEMON_LIFT = 190;
const XS: Record<number, number[]> = { 1: [190], 2: [100, 280], 3: [62, 190, 318], 4: [50, 143, 237, 330] };

/** "Sworn in darkness": the evil team as threads (design screens 08): the Demon
 * sits at the top, the Minions hang below on red threads that draw in.
 *
 * Privacy (D2): only what the Storyteller gave this player. Teammates are
 * shown by name, seat and Minion/Demon designation with a generic team icon,
 * never their specific characters. */
export function EvilTeamScreen({ me, mates, bluffs, evilOf, onContinue }: {
  me: { name: string; seat: number; type: "Demon" | "Minion"; art: string; lilMonsta: boolean };
  mates: readonly TeamMate[];
  bluffs: readonly TeamBluff[];
  /** Players in the game (Travellers excluded), for "N of M players are evil". */
  evilOf: number;
  onContinue: () => void;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const quiet = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (quiet) { setShown(true); return; }
    const t = window.setTimeout(() => setShown(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  // Only what the Storyteller supplied is drawn. A Lil' Monsta holder knows their own
  // character; nobody else is told one, so a missing Demon is not turned into a named
  // character and the team size never implies a Lord of Typhon.
  const babysat = me.lilMonsta;
  const all = [
    { name: me.name, type: babysat ? "Minion" as const : me.type, sub: `You · Seat ${me.seat + 1}`, art: me.art, me: true, key: "me" },
    ...mates.map((m) => ({ name: m.name, type: m.designation, sub: `Seat ${m.seat + 1}`, art: m.icon, me: false, key: `m${m.seat}-${m.name}` })),
  ];
  const demonNode = babysat
    ? { name: "Lil' Monsta", type: "Demon" as const, sub: "Babysat by a Minion", art: GENERIC_TEAM_ICON.demon, me: false, key: "monsta" }
    : all.find((m) => m.type === "Demon") ?? null;
  const rest = all.filter((m) => m !== demonNode);
  const k = rest.length;
  const rows = Math.max(1, Math.ceil(k / PER_ROW));
  const rowSizes = Array.from({ length: rows }, (_, r) => Math.floor(k / rows) + (r < k % rows ? 1 : 0));
  const ms = rows > 1 ? 64 : k >= 4 ? 70 : k >= 3 ? 86 : 96;
  const lift = demonNode ? 0 : NO_DEMON_LIFT;
  const height = BASE_H + (rows - 1) * ROW_GAP - lift;
  const scale = rows > 1 ? Math.min(1, Math.max(0.7, 460 / height)) : 1;
  const placed: (Node & { row: number; col: number })[] = [];
  let at = 0;
  rowSizes.forEach((n, r) => {
    const xs = XS[n] ?? XS[PER_ROW]!;
    for (let c = 0; c < n; c++) placed.push({ ...rest[at++]!, demon: false, size: ms, x: xs[c]!, y: MY + r * ROW_GAP - lift, row: r, col: c });
  });
  const nodes: Node[] = [
    ...(demonNode ? [{ ...demonNode, demon: true, size: 128, x: 190, y: 74 }] : []),
    ...placed,
  ];
  // First row hangs from the Demon; later rows
  // hang from the nearest token in the row above, so no line crosses a name.
  const threads = placed.flatMap((n) => {
    const top = n.y - n.size / 2 - 6;
    if (n.row === 0) return demonNode ? [`M190 218 C190 246 ${n.x} 232 ${n.x} ${top}`] : [];
    const parent = placed.filter((q) => q.row === n.row - 1).reduce((best, q) => (Math.abs(q.x - n.x) < Math.abs(best.x - n.x) ? q : best));
    const from = parent.y + parent.size / 2 + 74;
    return [`M${parent.x} ${from} C${parent.x} ${from + 14} ${n.x} ${top - 14} ${n.x} ${top}`];
  });
  const caption = babysat
    ? "No player is the Demon. Each night you and your fellow Minions choose who babysits Lil' Monsta."
    : `Only your team sees this. ${all.length} of ${evilOf} players are evil.`;
  const showBluffs = bluffs.length > 0;

  return (
    <PhoneFrame dark evil label="evil-team">
      <div className="swp-evt">
        <div className="swp-evt-glow" style={{ opacity: shown ? 1 : 0 }} aria-hidden="true" />
        <div className="swp-evt-body">
          <div className="swp-evt-head">
            <span className="swp-evt-eyebrow">The evil team</span>
            <h1 className="swp-evt-title">Sworn in darkness</h1>
            <span className="swp-evt-caption">{caption}</span>
          </div>
          <div className="swp-evt-web" style={height !== BASE_H ? { height: height * scale } : undefined}>
           <div className="swp-evt-web-in" style={height !== BASE_H ? { height, transform: `scale(${scale})` } : undefined}>
            <svg width="380" height={height} viewBox={`0 0 380 ${height}`} className="swp-evt-svg" aria-hidden="true">
              {threads.map((d, i) => (
                <path key={i} d={d} fill="none" stroke="rgba(200,60,52,.65)" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="320"
                  strokeDashoffset={shown ? 0 : 320} style={{ transition: `stroke-dashoffset 1s ease ${300 + i * 220}ms`, filter: "drop-shadow(0 0 4px rgba(220,60,50,.6))" }} />
              ))}
            </svg>
            {nodes.map((n, i) => (
              <div key={n.key} className="swp-evt-node" style={{
                left: n.x - 70, top: n.y - n.size / 2, opacity: shown ? 1 : 0, transform: shown ? "none" : "translateY(18px) scale(.92)",
                transition: `opacity .7s ease ${150 + i * 220}ms, transform .9s cubic-bezier(.2,.8,.2,1) ${150 + i * 220}ms`,
              }}>
                <div className="swp-evt-token" style={{
                  width: n.size, height: n.size,
                  boxShadow: `0 0 0 ${n.me ? 2 : 1}px ${n.me ? "#e0b96a" : n.demon ? "rgba(227,137,76,.75)" : "rgba(217,122,108,.6)"}, 0 0 ${n.demon ? 46 : 26}px rgba(210,50,42,.55), 0 16px 30px rgba(0,0,0,.65), inset 0 -10px 20px rgba(90,60,25,.35)`,
                }}>
                  <span role="img" aria-label="" className="swp-evt-art" style={{ backgroundImage: `url(${n.art})` }} />
                </div>
                <span className="swp-evt-label">
                  <span className="swp-evt-type" style={{ color: n.type === "Demon" ? "#e3894c" : "#d97a6c" }}>{n.type}</span>
                  <span className="swp-evt-name" style={{ fontSize: n.demon ? 26 : 22, color: n.me ? "#f0d590" : "#f2e6c8" }}>{n.name}</span>
                  <span className="swp-evt-sub">{n.sub}</span>
                </span>
              </div>
            ))}
           </div>
          </div>
          {showBluffs && (
            <section className="swp-evt-bluffs" aria-label="Bluffs, not in play" style={{ opacity: shown ? 1 : 0 }}>
              <div className="swp-evt-brule"><span /><span className="swp-evt-bhead">Safe to claim</span><span /></div>
              <div className="swp-evt-brow">
                {bluffs.map((b) => (
                  <div key={b.id} className="swp-evt-bluff">
                    <div className="swp-evt-btoken"><span role="img" aria-label="" className="swp-evt-art" style={{ backgroundImage: `url(${b.art})` }} /></div>
                    <span className="swp-evt-bname">{b.name}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
        <GoldButton full onClick={onContinue}>Enter the town</GoldButton>
      </div>
    </PhoneFrame>
  );
}
