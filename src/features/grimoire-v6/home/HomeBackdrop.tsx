import type { CSSProperties } from "react";

/** The Home design's night harbour: blood moon, stars, window lights, water shimmer and mist (a fixed seed keeps it stable). */
let seed = 11;
const rn = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

const stars = Array.from({ length: 34 }, () => {
  const big = [rn(), rn(), rn()];
  return {
    left: `${32 + big[0]! * 66}%`, top: `${1 + big[1]! * 26}%`, size: big[2]! < 0.2 ? 3 : 2,
    dur: `${(2.5 + rn() * 4).toFixed(1)}s`, delay: `${(rn() * 4).toFixed(1)}s`,
  };
});
const lights = ([[6.4, 58.6], [59.4, 65.2], [62, 67.5], [65.5, 69.2], [69, 67.8], [72.4, 66.4], [74.8, 59.5], [57.5, 68.8], [40.8, 70.6], [49.5, 70.4]] as const);

const fill: CSSProperties = { position: "absolute", inset: 0 };

export function HomeBackdrop() {
  return (
    <div aria-hidden="true" style={{ ...fill, overflow: "hidden", background: "#05060a" }}>
      <div style={{ ...fill, transformOrigin: "70% 40%" }}>
        <img src="/silverwick-home-bloodmoon.png" alt="" style={{ ...fill, width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={fill}>
          {stars.map((s, i) => (
            <span key={i} style={{ position: "absolute", left: s.left, top: s.top, width: s.size, height: s.size, borderRadius: "50%", background: "#f2ece4", boxShadow: "0 0 6px rgba(242,236,228,.8)", animation: `swHbTwinkle ${s.dur} ease-in-out ${s.delay} infinite` }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: "81.8%", top: "18.1%", width: 340, height: 340, marginLeft: -170, marginTop: -170, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(240,120,90,.34), rgba(200,80,60,.12) 55%, transparent)", mixBlendMode: "screen", animation: "swHbMoon 9s ease-in-out infinite" }} />
        <div style={{ position: "absolute", left: 0, right: "-10%", top: "4%", height: "30%", background: "radial-gradient(ellipse 30% 40% at 70% 50%, rgba(40,34,30,.35), transparent 70%), radial-gradient(ellipse 25% 35% at 40% 40%, rgba(30,26,24,.3), transparent 70%)", animation: "swHbCloud 45s ease-in-out infinite alternate" }} />
        <div style={fill}>
          {lights.map(([x, y], i) => (
            <span key={i} style={{ position: "absolute", left: `${x}%`, top: `${y}%`, width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: "50%", background: "radial-gradient(closest-side, rgba(255,190,100,.85), rgba(255,160,70,0))", animation: `swFlicker ${2.2 + (i % 4) * 0.7}s ease-in-out ${(i * 0.37).toFixed(2)}s infinite`, mixBlendMode: "screen" }} />
          ))}
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: "75%", bottom: 0, opacity: 0.5, mixBlendMode: "screen", background: "repeating-linear-gradient(180deg, rgba(255,190,110,0) 0px, rgba(255,190,110,.10) 2px, rgba(255,190,110,0) 6px, rgba(255,190,110,0) 14px)", WebkitMaskImage: "radial-gradient(ellipse 18% 90% at 58% 0%, #000, transparent 70%), radial-gradient(ellipse 10% 100% at 81% 20%, #000, transparent 70%)", maskImage: "radial-gradient(ellipse 18% 90% at 58% 0%, #000, transparent 70%), radial-gradient(ellipse 10% 100% at 81% 20%, #000, transparent 70%)", animation: "swHbShimmer 6s linear infinite" }} />
        <div style={{ position: "absolute", left: "-20%", right: "-20%", top: "58%", height: "16%", background: "radial-gradient(ellipse 40% 50% at 30% 60%, rgba(170,170,185,.18), transparent 70%), radial-gradient(ellipse 35% 45% at 75% 50%, rgba(170,170,185,.14), transparent 70%)", filter: "blur(6px)", animation: "swHbMist 38s ease-in-out infinite alternate" }} />
        <div style={{ position: "absolute", left: "-20%", right: "-20%", top: "64%", height: "12%", background: "radial-gradient(ellipse 45% 50% at 60% 50%, rgba(160,160,175,.12), transparent 70%)", filter: "blur(8px)", animation: "swHbMist 52s ease-in-out -20s infinite alternate-reverse" }} />
      </div>
    </div>
  );
}
