// How to Play (Claude Design v7): one seven-step walk-through of a game, shared by the tablet Home and the phone.
// Ported value for value from "Silverwick Home v7.dc.html" (tablet overlay) and "Silverwick Player Flow v2.dc.html"
// (phone). The pictures are identical on both; only the layout around them changes. It shows general rules only,
// never anything from a game in progress. Character art is the self-hosted official art (public/art), not hotlinks.
import "./howto.css";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { localCharacterArt } from "@/data/localArt";

export type HowStep = {
  k: "teams" | "night" | "day" | "nominate" | "vote" | "dead" | "victory";
  short: string;
  phase: string;
  title: string;
  body: string;
  note: string;
};

/** Step copy, verbatim from the design. */
export const HOW_STEPS: readonly HowStep[] = [
  { k: "teams", short: "Gather", phase: "Before the game", title: "The town gathers", body: "Join with your name and the Storyteller’s game code. Each player is secretly given a character, shown only on their own phone.", note: "Townsfolk and Outsiders are good. Minions and the Demon are evil." },
  { k: "night", short: "Night", phase: "Night", title: "Night falls", body: "Everyone closes their eyes. The Storyteller wakes characters one at a time, in night order, to use their abilities.", note: "Each night after the first, the Demon chooses a player to kill." },
  { k: "day", short: "Dawn", phase: "Day", title: "Dawn breaks", body: "The Storyteller announces who died in the night. The town talks, in the open or in private. Share what you know, or bluff.", note: "Your notes and guesses stay on your phone. Nobody else sees them." },
  { k: "nominate", short: "Nominate", phase: "Day", title: "Nominations", body: "Any living player may nominate someone for execution. Each player may nominate once a day and be nominated once a day.", note: "Travellers are exiled instead of executed, and anyone may vote on an exile, living or dead." },
  { k: "vote", short: "Vote", phase: "Day", title: "The vote", body: "Raise your hand to vote. A nominee is executed with votes from at least half the living players, and more votes than anyone else that day.", note: "At most one player is executed each day. Then night falls again." },
  { k: "dead", short: "The dead", phase: "Any time", title: "The dead", body: "Dead players stay in the game and on their team. They keep talking and can still win, but lose their ability.", note: "Each dead player keeps one ghost vote for the rest of the game." },
  { k: "victory", short: "Victory", phase: "The end", title: "Victory", body: "Good wins when the Demon dies. Evil wins when only two players are left alive and one of them is the Demon.", note: "Some characters change these rules. The Storyteller declares the winner." },
];

const NUM = ["I", "II", "III", "IV", "V", "VI", "VII"];
const RED = "#e8584a";
const FELL = "'IM Fell English', serif";

/** The step rail: current lit, earlier half-lit, later dark. */
export function howRail(current: number, go: (step: number) => void) {
  return HOW_STEPS.map((x, j) => ({
    title: x.short,
    go: () => go(j),
    dia: j === current ? RED : j < current ? "rgba(232,88,74,.5)" : "rgba(9,10,15,.9)",
    border: j <= current ? RED : "rgba(176,186,204,.45)",
    glow: j === current ? "0 0 12px rgba(232,88,74,.8)" : "none",
    lab: j === current ? "#ece6da" : "rgba(222,216,204,.5)",
  }));
}

type Seat = { x: number; y: number; bg: string; ring: string; glow: string; op: number };
const ALIVE = { bg: "radial-gradient(circle at 38% 30%, #ece6da, #b39b6c)", ring: "rgba(236,230,218,.4)" };
const DEAD = { bg: "#2a2b33", ring: "rgba(176,186,204,.3)", op: 0.7 };
function ring(n: number, d: number, z: number, f: (j: number) => Partial<Seat> | null): Seat[] {
  return Array.from({ length: n }, (_, j) => {
    const a = (j / n) * Math.PI * 2 - Math.PI / 2;
    const r = d / 2 - z / 2 - 2;
    const m = { ...ALIVE, ...(f(j) ?? {}) } as Partial<Seat> & typeof ALIVE;
    return {
      x: Math.round(d / 2 + Math.cos(a) * r - z / 2), y: Math.round(d / 2 + Math.sin(a) * r - z / 2),
      bg: m.bg, ring: m.ring, glow: m.glow ?? "0 4px 8px rgba(0,0,0,.5)", op: m.op ?? 1,
    };
  });
}

type Tok = { img: string; rim: string; label: string };
const tok = (id: string, evil: boolean, label = ""): Tok => ({ img: localCharacterArt(id) ?? "", rim: evil ? RED : "#86b7d4", label });

const label11: CSSProperties = { fontSize: 11, letterSpacing: ".06em", color: "rgba(222,216,204,.75)", whiteSpace: "nowrap" };
const italic14: CSSProperties = { fontFamily: FELL, fontStyle: "italic", fontSize: 14, color: "rgba(236,230,218,.7)" };

function Token({ t, size, inset = 3, style }: { t: Tok; size: number; inset?: number; style?: CSSProperties }) {
  return (
    <span style={{ position: "relative", width: size, height: size, flex: "none", borderRadius: "50%", background: "radial-gradient(circle at 38% 30%, #ece6da, #b39b6c)", boxShadow: `0 0 0 2px ${t.rim}, 0 8px 16px rgba(0,0,0,.55)`, ...style }}>
      <span style={{ position: "absolute", inset, backgroundImage: `url(${t.img})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat" }} />
    </span>
  );
}

function Teams() {
  const teams = [tok("washerwoman", false, "Townsfolk"), tok("butler", false, "Outsider"), tok("poisoner", true, "Minion"), tok("imp", true, "Demon")];
  const head: CSSProperties = { textAlign: "center", paddingBottom: 6, fontSize: 11, letterSpacing: ".28em", textTransform: "uppercase", fontWeight: 700 };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 132px)", gap: 16 }}>
        <span style={{ ...head, borderBottom: "1px solid rgba(134,183,212,.6)", color: "#86b7d4" }}>Good</span>
        <span style={{ ...head, borderBottom: "1px solid rgba(232,88,74,.6)", color: RED }}>Evil</span>
      </div>
      <div style={{ display: "flex", gap: 16 }}>
        {teams.map((t) => (
          <div key={t.label} style={{ width: 58, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <Token t={t} size={58} />
            <span style={label11}>{t.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STARS: readonly [number, number, number, number][] = [[10, 18, 4, 0.9], [128, 8, 5, 1], [136, 62, 3, 0.7], [20, 74, 3, 0.6], [104, 2, 3, 0.55]];
function Night() {
  const order = [tok("poisoner", true), tok("monk", false), tok("imp", true), tok("empath", false)];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
      <span style={{ position: "relative", width: 150, height: 96, flex: "none" }}>
        <span style={{ position: "absolute", left: 39, top: 12, width: 72, height: 72, borderRadius: "50%", boxShadow: "0 0 46px rgba(214,218,224,.28)" }} />
        <span style={{ position: "absolute", left: 39, top: 12, width: 72, height: 72, borderRadius: "50%", overflow: "hidden", transform: "rotate(-24deg)" }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "radial-gradient(circle at 30% 30%, #ffffff, #d6d9de 45%, #8d9197)" }} />
          <span style={{ position: "absolute", left: "26%", top: "-10%", width: "100%", height: "100%", borderRadius: "50%", background: "#0d0b0e" }} />
        </span>
        {STARS.map(([l, t, s, o], i) => (
          <span key={i} style={{ position: "absolute", left: l, top: t, width: s, height: s, transform: "rotate(45deg)", background: "#e6e9ee", boxShadow: "0 0 6px rgba(230,233,238,.8)", opacity: o }} />
        ))}
      </span>
      <div style={{ display: "flex", gap: 14 }}>
        {order.map((t, j) => (
          <div key={j} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <Token t={t} size={44} />
            <span style={{ fontFamily: FELL, fontSize: 14, color: "#ffb4a6" }}>{j + 1}</span>
          </div>
        ))}
      </div>
      <span style={{ ...italic14, marginTop: -8 }}>Night order</span>
    </div>
  );
}

function Ring({ nominate }: { nominate: boolean }) {
  const seats = ring(8, 200, 30, (j) => (j === 3 ? DEAD : nominate && j === 0 ? { ring: "#ece6da", glow: "0 0 16px rgba(236,230,218,.55)" } : nominate && j === 4 ? { ring: RED, glow: "0 0 18px rgba(232,88,74,.75)" } : null));
  const legend = nominate ? [{ c: "#ece6da", l: "Nominator" }, { c: RED, l: "Nominee" }] : [{ c: "#d8cfbf", l: "Alive" }, { c: "#2a2b33", l: "Died in the night" }];
  const glow = nominate ? "rgba(232,88,74,.12)" : "rgba(255,170,120,.16)";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ position: "relative", width: 200, height: 200, flex: "none" }}>
        <span style={{ position: "absolute", inset: 17, borderRadius: "50%", border: "1px dashed rgba(176,186,204,.25)", background: `radial-gradient(closest-side, ${glow}, transparent)` }} />
        {nominate && (
          <>
            <span style={{ position: "absolute", left: 99, top: 36, width: 2, height: 128, background: "linear-gradient(180deg, #ece6da, #e8584a)" }} />
            <span style={{ position: "absolute", left: 94, top: 152, width: 12, height: 12, borderRight: `2px solid ${RED}`, borderBottom: `2px solid ${RED}`, transform: "rotate(45deg)" }} />
          </>
        )}
        {seats.map((r, i) => (
          <span key={i} style={{ position: "absolute", left: r.x, top: r.y, width: 30, height: 30, borderRadius: "50%", background: r.bg, boxShadow: `0 0 0 2px ${r.ring}, ${r.glow}`, opacity: r.op }} />
        ))}
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FELL, fontSize: 20, color: "#ffb4a6" }}>{nominate ? "" : "Day 2"}</span>
      </div>
      <div style={{ display: "flex", gap: 18 }}>
        {legend.map((lg) => (
          <span key={lg.l} style={{ ...label11, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: lg.c, boxShadow: "0 0 0 1px rgba(236,230,218,.35)" }} />{lg.l}
          </span>
        ))}
      </div>
    </div>
  );
}

function Vote() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <div style={{ position: "relative", display: "flex", gap: 8, paddingTop: 26 }}>
        {Array.from({ length: 8 }, (_, j) => j < 5
          ? <span key={j} style={{ width: 26, height: 26, borderRadius: "50%", background: "radial-gradient(circle at 38% 30%, #ffb4a6, #c0392e)", boxShadow: `0 0 0 1.5px ${RED}, 0 0 10px rgba(232,88,74,.55)` }} />
          : <span key={j} style={{ width: 26, height: 26, borderRadius: "50%", background: "transparent", boxShadow: "0 0 0 1.5px rgba(176,186,204,.4), 0 0 0 0 transparent" }} />)}
        <span style={{ position: "absolute", left: 132, top: 14, bottom: -8, borderLeft: "1px dashed rgba(236,230,218,.8)" }} />
        <span style={{ position: "absolute", left: 132, top: 0, transform: "translateX(-50%)", fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", fontWeight: 700, color: "#ece6da" }}>Half</span>
      </div>
      <span style={{ fontFamily: FELL, fontSize: 34, lineHeight: 1, color: "#ffb4a6" }}>5 votes</span>
      <span style={italic14}>8 alive, so 4 votes are needed</span>
    </div>
  );
}

function Dead({ svgId }: { svgId: string }) {
  const t = tok("empath", false);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
      <span style={{ position: "relative", width: 110, height: 110, flex: "none" }}>
        <span style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", background: "radial-gradient(circle at 38% 30%, #ece6da, #b39b6c)", boxShadow: "0 0 0 2px rgba(176,186,204,.5), 0 10px 20px rgba(0,0,0,.6)" }}>
          <span style={{ position: "absolute", inset: 4, backgroundImage: `url(${t.img})`, backgroundSize: "contain", backgroundPosition: "center", backgroundRepeat: "no-repeat", filter: "grayscale(.8) brightness(.7)" }} />
          <svg viewBox="0 0 100 100" aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <defs><radialGradient id={svgId} cx=".5" cy=".2" r=".7"><stop offset="0" stopColor="#1b1320" /><stop offset="1" stopColor="#060407" /></radialGradient></defs>
            <path d="M0 0H100V55L95 58L92 54L87 61L83 57L78 64L74 60L69 67L64 62L60 69L55 64L51 71L46 65L41 70L37 63L32 68L28 61L23 65L19 58L14 62L10 56L5 59L0 55Z" fill={`url(#${svgId})`} />
            <path d="M0 55L5 59L10 56L14 62L19 58L23 65L28 61L32 68L37 63L41 70L46 65L51 71L55 64L60 69L64 62L69 67L74 60L78 64L83 57L87 61L92 54L95 58L100 55" fill="none" stroke="#fff6e0" strokeOpacity=".75" strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M0 57L5 61L10 58L14 64L19 60L23 67L28 63L32 70L37 65L41 72L46 67L51 73L55 66L60 71L64 64L69 69L74 62L78 66L83 59L87 63L92 56L95 60L100 57" fill="none" stroke="#5a3e1e" strokeOpacity=".35" strokeWidth="1.4" strokeLinejoin="round" />
            <circle cx="30" cy="30" r=".6" fill="#e8dcc0" opacity=".5" /><circle cx="72" cy="24" r=".8" fill="#e8dcc0" opacity=".6" /><circle cx="56" cy="38" r=".5" fill="#e8dcc0" opacity=".45" /><circle cx="14" cy="40" r=".5" fill="#e8dcc0" opacity=".4" />
          </svg>
        </span>
        <span title="Ghost vote" style={{ position: "absolute", right: -4, top: 2, width: 30, height: 30, borderRadius: "50%", background: "#14151d", border: "1px solid rgba(222,216,204,.55)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,.6)" }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#e8dcc0" }} />
        </span>
      </span>
      <div style={{ display: "flex", gap: 18 }}>
        <span style={{ ...label11, display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 12, height: 8, background: "#14151d", borderBottom: "1.5px solid rgba(255,246,224,.75)" }} />Dead</span>
        <span style={{ ...label11, display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#14151d", border: "1px solid rgba(222,216,204,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ width: 5, height: 5, borderRadius: "50%", background: "#e8dcc0" }} /></span>Ghost vote
        </span>
      </div>
    </div>
  );
}

function Victory() {
  const demon = tok("imp", true);
  const mini = ring(8, 70, 14, (j) => (j === 0 ? null : j === 5 ? { bg: "radial-gradient(circle at 38% 30%, #ff8a78, #8a221d)", ring: RED, glow: "0 0 10px rgba(232,88,74,.6)" } : DEAD));
  const card: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "14px 8px", borderRadius: 12 };
  const head: CSSProperties = { fontSize: 11, letterSpacing: ".24em", textTransform: "uppercase", fontWeight: 700 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 136px)", gap: 16 }}>
      <div style={{ ...card, border: "1px solid rgba(134,183,212,.35)", background: "rgba(134,183,212,.06)" }}>
        <span style={{ ...head, color: "#86b7d4" }}>Good wins</span>
        <span style={{ position: "relative", width: 70, height: 70 }}>
          <Token t={demon} size={70} style={{ position: "absolute", inset: 0, filter: "grayscale(.8) brightness(.7)" }} />
          <span style={{ position: "absolute", inset: -3, borderRadius: "50%", border: "3px solid rgba(192,57,46,.9)", transform: "rotate(-14deg)" }}>
            <span style={{ position: "absolute", left: "50%", top: "50%", width: "110%", height: 3, margin: "-1.5px 0 0 -55%", background: "rgba(192,57,46,.9)", transform: "rotate(-38deg)" }} />
          </span>
        </span>
        <span style={{ ...italic14, fontSize: 13 }}>The Demon dies</span>
      </div>
      <div style={{ ...card, border: "1px solid rgba(232,88,74,.4)", background: "rgba(232,88,74,.07)" }}>
        <span style={{ ...head, color: RED }}>Evil wins</span>
        <span style={{ position: "relative", width: 70, height: 70 }}>
          {mini.map((r, i) => (
            <span key={i} style={{ position: "absolute", left: r.x, top: r.y, width: 14, height: 14, borderRadius: "50%", background: r.bg, boxShadow: `0 0 0 1.5px ${r.ring}, ${r.glow}`, opacity: r.op }} />
          ))}
        </span>
        <span style={{ ...italic14, fontSize: 13 }}>Two left, one the Demon</span>
      </div>
    </div>
  );
}

/** The step's picture on its 300x240 artboard. */
export function HowPicture({ step, svgId }: { step: number; svgId: string }) {
  const k = HOW_STEPS[step]!.k;
  return (
    <>
      {k === "teams" && <Teams />}
      {k === "night" && <Night />}
      {(k === "day" || k === "nominate") && <Ring nominate={k === "nominate"} />}
      {k === "vote" && <Vote />}
      {k === "dead" && <Dead svgId={svgId} />}
      {k === "victory" && <Victory />}
    </>
  );
}

type Props = { step: number; onStep: (step: number) => void; onClose: () => void };

const pillBack: CSSProperties = { minHeight: 56, borderRadius: 28, border: "1px solid rgba(176,186,204,.3)", background: "transparent", fontFamily: FELL, textTransform: "uppercase", letterSpacing: ".12em", fontWeight: 400, color: "rgba(236,230,218,.78)", whiteSpace: "nowrap", cursor: "pointer" };
const pillNext: CSSProperties = { minHeight: 56, borderRadius: 28, border: "1px solid rgba(255,122,104,.7)", background: "linear-gradient(180deg, rgba(232,88,74,.28), rgba(192,57,46,.18))", boxShadow: "0 0 30px rgba(232,88,74,.22), inset 0 1px 0 rgba(236,230,218,.25)", fontFamily: FELL, textTransform: "uppercase", letterSpacing: ".14em", fontWeight: 400, color: "#ffb4a6", whiteSpace: "nowrap", cursor: "pointer" };
const railTrack: CSSProperties = { position: "absolute", left: "7%", right: "7%", top: 21, height: 1, background: "rgba(176,186,204,.25)" };
const railBtn: CSSProperties = { position: "relative", minHeight: 44, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-start", gap: 10, padding: "16px 0 0", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit" };

function Rail({ step, onStep, labels }: { step: number; onStep: (s: number) => void; labels: boolean }) {
  return (
    <>
      <span style={railTrack} />
      {howRail(step, onStep).map((sp) => (
        <button key={sp.title} type="button" onClick={sp.go} aria-label={sp.title} aria-current={sp.lab === "#ece6da" ? "step" : undefined} style={railBtn}>
          <span style={{ width: 11, height: 11, transform: "rotate(45deg)", background: sp.dia, border: `1px solid ${sp.border}`, boxShadow: sp.glow }} />
          {labels && <span style={{ fontSize: 12, letterSpacing: ".14em", textTransform: "uppercase", fontWeight: 600, color: sp.lab, whiteSpace: "nowrap" }}>{sp.title}</span>}
        </button>
      ))}
    </>
  );
}

function useStep({ step, onStep, onClose }: Props) {
  const c = HOW_STEPS[step]!;
  return {
    c, n: NUM[step]!, count: `Step ${step + 1} of 7`,
    prev: () => { if (step > 0) onStep(step - 1); }, prevOp: step > 0 ? 1 : 0.35,
    next: () => (step < 6 ? onStep(step + 1) : onClose()), nextLabel: step < 6 ? "Next" : "Done",
  };
}

/** Tablet: full-screen overlay over the Home stage (1480x924 design canvas). */
export function HowToPlayTablet(props: Props) {
  const { step, onStep, onClose } = props;
  const m = useStep(props);
  const box = useRef<HTMLDivElement>(null);
  // A modal dialog: focus moves into it on open, and Escape returns to Home (the design's "‹ Home").
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-label="How to Play" style={{ outline: "none", position: "absolute", inset: 0, zIndex: 26, background: "#0b0909", animation: "swRise .35s ease-out", display: "flex", flexDirection: "column" }}>
      <img src="/bg/BackgroundMenuTablet.png" alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 50% 60% at 30% 52%, rgba(232,88,74,.16), transparent 70%), rgba(9,10,15,.86)" }} />
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "200px minmax(0,1fr) 200px", alignItems: "center", gap: 20, padding: "28px 56px 0" }}>
        <button type="button" className="hw-home" onClick={onClose} style={{ justifySelf: "start", display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "0 18px 0 12px", borderRadius: 24, border: "1px solid rgba(176,186,204,.3)", background: "transparent", fontFamily: "inherit", fontSize: 15, fontWeight: 600, cursor: "pointer" }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>‹</span>Home
        </button>
        <h2 style={{ margin: 0, justifySelf: "center", fontFamily: FELL, textTransform: "uppercase", letterSpacing: ".08em", fontSize: 30, fontWeight: 400, color: "#ece6da" }}>How to Play</h2>
        <span style={{ justifySelf: "end", fontSize: 14, color: "rgba(236,230,218,.5)" }}>{m.count}</span>
      </div>
      <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", margin: "8px 120px 0" }}>
        <Rail step={step} onStep={onStep} labels />
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", alignItems: "center", gap: 72, padding: "0 120px 40px" }}>
        <div style={{ justifySelf: "end", position: "relative", width: 480, height: 384, flex: "none" }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: 300, height: 240, transform: "scale(1.6)", transformOrigin: "0 0", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <HowPicture step={step} svgId="swVoidHowTablet" />
          </div>
        </div>
        <StepText m={m} tablet />
      </div>
    </div>
  );
}

type StepModel = ReturnType<typeof useStep>;
function StepText({ m, tablet }: { m: StepModel; tablet?: boolean }): ReactNode {
  const eyebrow: CSSProperties = tablet
    ? { fontSize: 12, letterSpacing: ".28em", textTransform: "uppercase", fontWeight: 600, color: "rgba(222,216,204,.6)" }
    : { fontSize: 11, letterSpacing: ".24em", textTransform: "uppercase", fontWeight: 600, color: "rgba(222,216,204,.6)" };
  const ruleLine = (deg: number): CSSProperties => ({ flex: 1, height: 1, background: `linear-gradient(${deg}deg, transparent, rgba(232,88,74,.7))` });
  const gem: CSSProperties = { width: 6, height: 6, transform: "rotate(45deg)", border: `1px solid ${RED}` };
  if (tablet) {
    return (
      <div style={{ maxWidth: 500, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 14 }}>
        <span style={eyebrow}>{m.n} · {m.c.phase}</span>
        <h3 style={{ margin: 0, fontFamily: FELL, textTransform: "uppercase", letterSpacing: ".06em", fontSize: 46, fontWeight: 400, lineHeight: 1.02, color: "#ece6da" }}>{m.c.title}</h3>
        <p style={{ margin: 0, fontFamily: FELL, fontSize: 23, lineHeight: 1.45, color: "rgba(236,230,218,.85)", textWrap: "pretty" } as CSSProperties}>{m.c.body}</p>
        <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 12, width: 120 }}><span style={gem} /><span style={ruleLine(270)} /></div>
        <p style={{ margin: 0, fontFamily: FELL, fontStyle: "italic", fontSize: 19, lineHeight: 1.4, color: "rgba(236,230,218,.62)", textWrap: "pretty" } as CSSProperties}>{m.c.note}</p>
        <div style={{ display: "flex", gap: 14, paddingTop: 14 }}>
          <button type="button" onClick={m.prev} disabled={m.prevOp < 1} style={{ ...pillBack, padding: "0 30px", fontSize: 17, opacity: m.prevOp }}>Back</button>
          <button type="button" onClick={m.next} style={{ ...pillNext, padding: "0 44px", fontSize: 19 }}>{m.nextLabel}</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <div style={{ flex: "none", minHeight: 262, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
        <span style={eyebrow}>{m.n} · {m.c.phase}</span>
        <h3 style={{ margin: 0, fontFamily: FELL, textTransform: "uppercase", letterSpacing: ".06em", fontWeight: 400, color: "#ece6da", fontSize: 30, lineHeight: 1.05 }}>{m.c.title}</h3>
        <p style={{ margin: 0, fontFamily: FELL, fontSize: 18, lineHeight: 1.45, color: "rgba(236,230,218,.85)", maxWidth: 340, textWrap: "pretty" } as CSSProperties}>{m.c.body}</p>
        <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: 12, width: 120, flex: "none" }}><span style={ruleLine(90)} /><span style={gem} /><span style={ruleLine(270)} /></div>
        <p style={{ margin: 0, fontFamily: FELL, fontStyle: "italic", fontSize: 15, lineHeight: 1.4, color: "rgba(236,230,218,.62)", maxWidth: 320, textWrap: "pretty" } as CSSProperties}>{m.c.note}</p>
      </div>
      <div style={{ flex: "none", display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.5fr)", gap: 12, paddingTop: 12 }}>
        <button type="button" onClick={m.prev} disabled={m.prevOp < 1} style={{ ...pillBack, padding: "0 16px", fontSize: 16, opacity: m.prevOp }}>Back</button>
        <button type="button" onClick={m.next} style={{ ...pillNext, padding: "0 20px", fontSize: 18 }}>{m.nextLabel}</button>
      </div>
    </>
  );
}

/** Phone: the same steps stacked (picture above text), inside the phone frame. */
export function HowToPlayPhone(props: Props) {
  const { step, onStep, onClose } = props;
  const m = useStep(props);
  return (
    <section aria-label="How to Play" style={{ position: "absolute", inset: 0, zIndex: 5, display: "flex", flexDirection: "column" }}>
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 45% at 50% 32%, rgba(232,88,74,.16), transparent 70%), rgba(8,6,4,.8)" }} />
      <div className="swp-topgap" aria-hidden="true" />
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "8px 24px 30px" }}>
        <div style={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button type="button" className="hw-home" onClick={onClose} style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 44, padding: "0 16px 0 10px", borderRadius: 22, border: "1px solid rgba(176,186,204,.3)", background: "transparent", fontFamily: "inherit", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer" }}>
            <span style={{ fontSize: 20, lineHeight: 1 }}>‹</span>Home
          </button>
          <h2 style={{ margin: 0, fontSize: 11, letterSpacing: ".24em", textTransform: "uppercase", fontWeight: 600, color: "rgba(222,216,204,.6)" }}>How to Play</h2>
        </div>
        <div style={{ flex: "none", position: "relative", display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", marginTop: 10 }}>
          <Rail step={step} onStep={onStep} labels={false} />
        </div>
        <div style={{ flex: 1, minHeight: 250, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 300, height: 240, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <HowPicture step={step} svgId="swVoidHowPhone" />
          </div>
        </div>
        <StepText m={m} />
      </div>
    </section>
  );
}

