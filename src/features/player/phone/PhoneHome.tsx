import { PhoneFrame } from "./PhoneParts";

const BUY_URL = "https://bloodontheclocktower.com/products/blood-on-the-clocktower-the-game";
const GITHUB_URL = "https://github.com/Kaijumomo/Silverwick-Hallow";

const PATHS = [
  { id: "player", title: "Player", desc: "Join with your name and a code.", primary: true },
  { id: "reference", title: "Character Reference", desc: "Scripts, abilities, night order.", primary: false },
  { id: "howto", title: "How to Play", desc: "Night, day, voting and how to win.", primary: false },
] as const;

export type PhonePath = (typeof PATHS)[number]["id"];

/** Phone Home (Player Flow v2, design v7). The phone shows only player paths (Player, Character Reference,
 * How to Play, and Rejoin game when this phone has a saved game); the Storyteller remains part of the app,
 * just not offered on a phone Home. */
export function PhoneHome({ onPick, trial, rejoin }: { onPick: (path: PhonePath) => void; trial?: boolean; rejoin?: { label: string; onRejoin: () => void } }) {
  return (
    <PhoneFrame glow="join" label="home">
      <main className="swp-page">
        <header className="swp-home-hero">
          <p className="swp-home-kicker">A Blood on the Clocktower companion</p>
          <h1 className="swp-home-title">Silverwick<br />Hollow</h1>
          <p className="swp-home-tag">Light the candles. The town is gathering.</p>
        </header>
        <nav className="swp-paths" aria-label="Choose how to begin">
          {rejoin && (
            <button type="button" className="swp-path swp-path-primary" onClick={rejoin.onRejoin}>
              <span className="swp-path-text">
                <span className="swp-path-title">Rejoin game</span>
                <span className="swp-path-desc">{rejoin.label}</span>
              </span>
              <span className="swp-path-chev" aria-hidden="true">›</span>
            </button>
          )}
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
        {/* Community Created Content footer (TPI community content policy; design v7). */}
        <div className="swp-home-foot">
          <a className="swp-home-badge" href={BUY_URL} target="_blank" rel="noopener" aria-label="Community Created Content. Buy Blood on the Clocktower">
            <img src="/brand/CommunityCreatedContentParchment.png" alt="Community Created Content" />
          </a>
          <div className="swp-home-credit">
            <span className="swp-home-disclaimer">Unofficial fan companion. Not affiliated with The Pandemonium Institute.</span>
            <span className="swp-home-links">
              <a href={BUY_URL} target="_blank" rel="noopener">Buy the game</a>
              <a href={GITHUB_URL} target="_blank" rel="noopener">GitHub</a>
            </span>
          </div>
        </div>
      </main>
    </PhoneFrame>
  );
}
