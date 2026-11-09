import { PhoneFrame } from "./PhoneParts";

const PATHS = [
  { id: "player", title: "Player", desc: "Join with your name and a code.", primary: true },
  { id: "reference", title: "Character Reference", desc: "Scripts, abilities, night order.", primary: false },
] as const;

export type PhonePath = (typeof PATHS)[number]["id"];

/** Phone Home (design screen 01). Per the Package 3 decision the phone shows
 * only the two player paths; the Storyteller remains part of the app, just not
 * offered on a phone Home. */
export function PhoneHome({ onPick, trial }: { onPick: (path: PhonePath) => void; trial?: boolean }) {
  return (
    <PhoneFrame glow="join" label="home">
      <main className="swp-page">
        <header className="swp-home-hero">
          <p className="swp-home-kicker">A Blood on the Clocktower companion</p>
          <h1 className="swp-home-title">Silverwick<br />Hollow</h1>
          <p className="swp-home-tag">Light the candles. The town is gathering.</p>
        </header>
        <nav className="swp-paths" aria-label="Choose how to begin">
          {PATHS.map((p) => (
            <button key={p.id} type="button" className={`swp-path${p.primary ? " swp-path-primary" : ""}`} onClick={() => onPick(p.id)} disabled={trial && p.id === "player"}>
              <span className="swp-path-text">
                <span className="swp-path-title">{p.title}</span>
                <span className="swp-path-desc">{p.desc}</span>
              </span>
              <span className="swp-path-chev" aria-hidden="true">›</span>
            </button>
          ))}
        </nav>
        <div className="swp-home-foot">Unofficial fan companion. Not affiliated with The Pandemonium Institute.</div>
      </main>
    </PhoneFrame>
  );
}
