// Launch Orbit splash (Claude Design v7: "Silverwick Launch Orbit" phone and tablet, splash-common.jsx and
// splash-orbit.jsx). Ported value for value: same timeline, layers, easing and token mix. Differences, all PO
// decisions of 2026-11-10: the token art is the self-hosted official art (public/art), not release.botc.app; a tap
// or key press skips it; it never plays when the app is opened from a join link, QR code or the Public Display; and
// with reduced motion it is a still frame that fades. It plays once per browser tab session (a reload to return
// Home does not replay it). Pure decoration: it shows no game information.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { localCharacterArt } from "@/data/localArt";

export const SPLASH_SESSION_KEY = "silverwick-splash-played";
export const SPLASH_LAUNCH_KEY = "silverwick-orbit-launch";

/** Should the splash play for this page load? Not from a join link / QR, not on the Public Display, once per tab. */
export function shouldPlaySplash(search: string = typeof window === "undefined" ? "" : window.location.search): boolean {
  if (typeof window === "undefined") return false;
  const q = new URLSearchParams(search);
  if (q.has("join") || q.get("display") === "public") return false;
  try {
    if (window.sessionStorage.getItem(SPLASH_SESSION_KEY)) return false;
  } catch { /* storage blocked: still play once for this page */ }
  return true;
}

// ---- Timeline (seconds) ----
const CUES = { Nightfall: 0, Orbit: 0.5, Settle: 2.3, Name: 3.1, Open: 4.2 } as const;
export const SPLASH_END = 5.0;
const RM_HOLD = 1.2; // reduced motion: still frame, then fade
const RM_FADE = 0.6;

// ---- Easing / tween (animations-v3.jsx) ----
const easeOutCubic = (t: number) => { const u = t - 1; return u * u * u + 1; };
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const easeInCubic = (t: number) => t * t * t;
const tween = (ease: (t: number) => number) => (from: number, to: number, start: number, end: number) => (t: number) =>
  t <= start ? from : t >= end ? to : from + (to - from) * ease((t - start) / (end - start));
const enter = tween(easeOutCubic);
const draw = tween(easeInOutSine);
const exit = tween(easeInCubic);

// ---- Composition geometry (splash-common.jsx) ----
type Geo = { W: number; H: number; LAND: boolean; K: number; CX: number; CY: number; ART: number; WORD_TOP: number; TK: number; RX0: number };
export function geometry(landscape: boolean): Geo {
  const W = landscape ? 2960 : 1080, H = landscape ? 1848 : 1920;
  const K = landscape ? H / 1500 : 1;
  return {
    W, H, LAND: landscape, K, CX: W / 2, CY: landscape ? H * 0.4 : 800, ART: 720 * K,
    WORD_TOP: landscape ? H * 0.71 : 1220, TK: (landscape ? 120 : 112) * K, RX0: (landscape ? 900 : 640) * K,
  };
}

function makeStars(W: number, H: number) {
  let s = 11;
  const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: 70 }, () => ({ x: r() * W, y: r() * H * 0.9, z: 1 + r() * 2.6, d: r(), ph: r() * 6.28 }));
}

// ---- Tokens (splash-orbit.jsx) ----
type Team = "townsfolk" | "outsider" | "minion" | "demon" | "traveler";
const TC: Record<Team, string> = { townsfolk: "#86b7d4", outsider: "#94c29a", minion: "#d97a6c", demon: "#e3894c", traveler: "#b994d4" };
const POOL: Record<Team, readonly string[]> = {
  townsfolk: [
    "washerwoman", "librarian", "investigator", "chef", "empath", "fortuneteller", "undertaker", "monk", "ravenkeeper", "virgin", "slayer", "soldier", "mayor",
    "grandmother", "sailor", "chambermaid", "exorcist", "innkeeper", "gambler", "gossip", "courtier", "professor", "minstrel", "tealady", "pacifist", "fool",
    "clockmaker", "dreamer", "snakecharmer", "mathematician", "flowergirl", "towncrier", "oracle", "savant", "seamstress", "philosopher", "artist", "juggler", "sage",
  ],
  outsider: ["butler", "drunk", "recluse", "saint", "goon", "lunatic", "tinker", "moonchild", "mutant", "sweetheart", "barber", "klutz"],
  minion: ["poisoner", "spy", "scarletwoman", "baron", "godfather", "devilsadvocate", "assassin", "mastermind", "eviltwin", "witch", "cerenovus", "pithag"],
  demon: ["imp", "zombuul", "pukka", "shabaloth", "po", "fanggu", "vigormortis", "nodashii", "vortox"],
  traveler: ["scapegoat", "gunslinger", "beggar", "bureaucrat", "thief"],
};
const MIX: readonly [Team, number][] = [["townsfolk", 5], ["outsider", 2], ["minion", 1], ["demon", 1], ["traveler", 1]];

export type SplashToken = { id: string; team: Team; color: string; src: string };

/** The ten tokens for a launch: 5 Townsfolk, 2 Outsiders, 1 Minion, 1 Demon, 1 Traveller, seeded by the launch counter. */
export function drawTokens(launch: number): SplashToken[] {
  let seed = (launch * 2654435761) >>> 0;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pick = <T,>(arr: readonly T[], n: number) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
    return a.slice(0, n);
  };
  const all = MIX.flatMap(([t, n]) => pick(POOL[t], n).map((id) => ({ id, team: t })));
  return pick(all, 10).flatMap(({ id, team }) => {
    const src = localCharacterArt(id);
    return src ? [{ id, team, color: TC[team], src }] : [];
  });
}

// The launch counter advances once per page load (not per render), so every launch shows a different set.
let thisLaunch: number | null = null;
function launchNumber(): number {
  if (thisLaunch !== null) return thisLaunch;
  try {
    thisLaunch = (Number(window.localStorage.getItem(SPLASH_LAUNCH_KEY)) || 0) + 1;
    window.localStorage.setItem(SPLASH_LAUNCH_KEY, String(thisLaunch));
  } catch { thisLaunch = Date.now() % 100000; }
  return thisLaunch;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isLandscape = () => typeof window !== "undefined" && window.innerWidth > window.innerHeight;

type Props = { onDone: () => void };

export function LaunchSplash({ onDone }: Props) {
  const reduced = useMemo(prefersReducedMotion, []);
  const [land, setLand] = useState(isLandscape);
  const [fit, setFit] = useState(1);
  const [T, setT] = useState(reduced ? SPLASH_END : 0);
  const [fadeOut, setFadeOut] = useState(1);
  const done = useRef(false);
  const geo = useMemo(() => geometry(land), [land]);
  const stars = useMemo(() => makeStars(geo.W, geo.H), [geo.W, geo.H]);
  const tokens = useMemo(() => drawTokens(launchNumber()), []);

  const finish = useRef(() => {});
  finish.current = () => {
    if (done.current) return;
    done.current = true;
    onDone();
  };

  useEffect(() => {
    try { window.sessionStorage.setItem(SPLASH_SESSION_KEY, "1"); } catch { /* ignore */ }
  }, []);

  // Contain-fit the composition to the device, centred on the night colour.
  useEffect(() => {
    const size = () => {
      const l = isLandscape();
      const g = geometry(l);
      setLand(l);
      setFit(Math.min(window.innerWidth / g.W, window.innerHeight / g.H));
    };
    size();
    window.addEventListener("resize", size);
    return () => window.removeEventListener("resize", size);
  }, []);

  // Clock: the full timeline, or with reduced motion a still frame that fades.
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const s = (now - t0) / 1000;
      if (reduced) {
        setFadeOut(s <= RM_HOLD ? 1 : Math.max(0, 1 - (s - RM_HOLD) / RM_FADE));
        if (s >= RM_HOLD + RM_FADE) { finish.current(); return; }
      } else {
        setT(Math.min(s, SPLASH_END));
        if (s >= SPLASH_END) { finish.current(); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  // Tap, click or any key skips.
  useEffect(() => {
    const key = () => finish.current();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const { W, H, K, CX, CY, ART, WORD_TOP, TK, RX0 } = geo;
  // Reduced motion shows the composed moon and name, without tokens or twinkle.
  const still = reduced;
  const end = SPLASH_END;
  const C = CUES;

  const skyOn = still ? 1 : draw(0, 1, 0, C.Orbit + 0.3)(T) * exit(1, 0, end - 0.6, end)(T);
  const spin = enter(0, Math.PI * 2.4, C.Orbit, C.Name)(T);
  const rx = enter(RX0, 400 * K, C.Orbit, C.Name)(T);
  const flat = draw(0.32, 1, C.Settle - 0.3, C.Name)(T);
  const tokOut = exit(1, 0, C.Name + 0.3, C.Name + 1.0)(T);
  const pull = exit(1, 0.55, C.Name + 0.2, C.Name + 1.0)(T);
  const artOp = still ? 1 : enter(0, 1, C.Orbit, C.Settle)(T) * exit(1, 0, end - 0.55, end)(T);
  const iris = still ? 62 : enter(20, 62, C.Orbit, C.Settle + 0.4)(T);
  const artScale = still ? 1 : exit(1, 1.1, end - 0.7, end)(T);
  const flare = still ? 0 : enter(0, 1, C.Name - 0.1, C.Name + 0.25)(T) * exit(1, 0, C.Name + 0.25, C.Name + 1.0)(T);
  const drift = still ? -40 * K : draw(0, -40 * K, C.Name, C.Name + 0.9)(T);
  const glow = artOp * (still ? 1 : 0.75 + 0.25 * Math.sin(T * 2.6));
  const mask = `radial-gradient(circle at 50% 50%, #000 ${iris * 0.72}%, transparent ${iris}%)`;
  const wordStart = C.Name + 0.2;
  const wordOut = still ? 1 : exit(1, 0, end - 0.7, end - 0.15)(T);
  const sub = still ? 1 : enter(0, 1, wordStart + 0.6, wordStart + 1.1)(T) * wordOut;

  const layer: CSSProperties = { position: "absolute", inset: 0 };
  return (
    <div
      data-testid="launch-splash"
      aria-hidden="true"
      onClick={() => finish.current()}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "#05080e", overflow: "hidden", opacity: fadeOut, cursor: "pointer", touchAction: "none" }}
    >
      <div style={{ position: "absolute", left: "50%", top: "50%", width: W, height: H, transform: `translate(-50%, -50%) scale(${fit})`, transformOrigin: "center center", overflow: "hidden" }}>
        {/* Sky */}
        <div style={{ ...layer, background: "#05080e" }}>
          <div style={{ ...layer, opacity: skyOn, background: "radial-gradient(110% 60% at 50% 38%, #22385a 0%, #0c1626 55%, #05080e 100%)" }} />
          {stars.map((st, i) => {
            const a = still ? 1 : enter(0, 1, st.d * (C.Orbit + 0.3), st.d * (C.Orbit + 0.3) + 0.4)(T);
            const tw = still ? 1 : 0.55 + 0.45 * Math.sin(T * 2.2 + st.ph);
            return <div key={i} style={{ position: "absolute", left: st.x, top: st.y, width: st.z, height: st.z, borderRadius: "50%", background: "#dbe6f5", opacity: a * tw * skyOn, boxShadow: "0 0 6px rgba(219,230,245,.8)" }} />;
          })}
        </div>
        <div style={{ ...layer, transform: `translateY(${drift}px)` }}>
          {/* Moon art */}
          <div style={{ ...layer, zIndex: 5 }}>
            <div style={{ position: "absolute", left: CX - ART / 2, top: CY - ART / 2, width: ART, height: ART, transform: `translateY(0px) scale(${artScale})` }}>
              <div style={{ position: "absolute", inset: -120 * K, borderRadius: "50%", opacity: glow, background: "radial-gradient(circle, rgba(111,168,255,.28) 0%, rgba(111,168,255,.08) 40%, rgba(111,168,255,0) 68%)" }} />
              <div style={{ ...layer, opacity: artOp, background: "url('/silverwick-icon-moon.png') center / cover", WebkitMaskImage: mask, maskImage: mask }} />
            </div>
          </div>
          {/* Flare */}
          <div style={{ position: "absolute", left: CX - 460 * K, top: CY - 460 * K, width: 920 * K, height: 920 * K, zIndex: 6, borderRadius: "50%", opacity: flare, background: "radial-gradient(circle, rgba(0,0,0,0) 38%, rgba(111,168,255,.35) 44%, rgba(111,168,255,0) 52%)" }} />
          {/* Tokens */}
          {!still && tokens.map((tk, i) => {
            const a = spin + (i / tokens.length) * Math.PI * 2;
            const depth = Math.sin(a);
            const front = flat > 0.9 || depth > 0;
            const inn = enter(0, 1, C.Orbit + i * 0.06, C.Orbit + 0.4 + i * 0.06)(T);
            const s = (0.78 + 0.22 * ((depth + 1) / 2) * (1 - flat) + 0.22 * flat) * pull;
            const x = CX + Math.cos(a) * rx * pull, y = CY + depth * rx * flat * pull;
            return (
              <div key={tk.id} style={{ position: "absolute", left: x - TK / 2, top: y - TK / 2, width: TK, height: TK, transform: `scale(${s})`, opacity: inn * tokOut * (front ? 1 : 0.55), zIndex: front ? 10 : 1, borderRadius: "50%", background: "radial-gradient(circle at 40% 35%, #1d2a3f 0%, #0b1220 75%)", boxShadow: `inset 0 0 0 ${3 * K}px ${tk.color}, 0 0 ${24 * K}px ${tk.color}55, 0 ${10 * K}px ${24 * K}px rgba(0,0,0,.6)`, overflow: "hidden" }}>
                <img src={tk.src} alt="" draggable={false} style={{ position: "absolute", inset: "6%", width: "88%", height: "88%", objectFit: "contain" }} />
                <div style={{ ...layer, borderRadius: "50%", boxShadow: `inset 0 0 0 ${3 * K}px ${tk.color}` }} />
              </div>
            );
          })}
        </div>
        {/* Wordmark and tagline */}
        <div style={{ position: "absolute", left: 0, right: 0, top: WORD_TOP, display: "flex", flexDirection: "column", alignItems: "center", gap: 28 * K }}>
          <div style={{ display: "flex", fontFamily: "'Cinzel Decorative', serif", fontSize: 112 * K, color: "#e4ecf7", textShadow: "0 0 30px rgba(111,168,255,.35)" }}>
            {"Silverwick".split("").map((ch, i) => {
              const s = wordStart + i * 0.05;
              return (
                <span key={i} style={still ? undefined : { opacity: enter(0, 1, s, s + 0.5)(T) * wordOut, transform: `translateY(${enter(18, 0, s, s + 0.6)(T)}px)`, filter: `blur(${enter(8, 0, s, s + 0.5)(T)}px)` }}>{ch}</span>
              );
            })}
          </div>
          <div style={{ fontFamily: "'IM Fell English', serif", fontSize: 34 * K, letterSpacing: "0.3em", textTransform: "uppercase", textAlign: "center", maxWidth: "88%", textWrap: "balance", color: "#c9d4e3", opacity: sub } as CSSProperties}>
            Blood on the Clocktower Companion
          </div>
        </div>
      </div>
    </div>
  );
}
