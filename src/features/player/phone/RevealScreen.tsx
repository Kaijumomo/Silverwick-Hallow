import { useEffect, useRef, useState } from "react";
import { GoldButton, PhoneFrame } from "./PhoneParts";

export type RevealTone = "good" | "evil" | "traveller" | "plain";

export type RevealCharacter = {
  name: string;
  /** Display label, e.g. "Townsfolk", "Traveller". */
  typeLabel: string;
  typeKey: string;
  /** Omitted when the Storyteller has not told the player an alignment. */
  team?: "Good" | "Evil";
  ability?: string;
  art: string;
  tone: RevealTone;
};

const RING_WORDS = [..."SILVERWICK ✦ BY CANDLE AND MOON ✦ "];
const STARS: ReadonlyArray<readonly [number, number, number]> = [[30, 34, 5], [66, 30, 4], [72, 58, 6], [34, 66, 4], [58, 72, 3], [44, 28, 3], [26, 52, 3]];

/** The face-down moonlit silver token (design screen 06). */
function TokenBack() {
  return (
    <>
      <span className="swp-token-noise" />
      <span className="swp-token-silver" />
      <span className="swp-token-grain" />
      <span className="swp-token-rim" />
      <span className="swp-token-orbit" aria-hidden="true">
        {RING_WORDS.map((ch, i) => (
          <span key={i} className="swp-token-letter" style={{ transform: `rotate(${Math.round((i * 360 / RING_WORDS.length) * 10) / 10}deg) translateY(-96px)` }}>{ch}</span>
        ))}
      </span>
      <span className="swp-token-rim2" />
      {STARS.map(([x, y, s], i) => (
        <span key={i} className="swp-token-star" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s }} />
      ))}
      <span className="swp-token-moon">
        <span className="swp-token-moon-lit" />
        <span className="swp-token-moon-shade" />
      </span>
    </>
  );
}

/** The parchment character token (shared by Reveal and, later, the banner). */
export function TokenFace({ art, tone }: { art: string; tone: RevealTone }) {
  return (
    <span className={`swp-token-face swp-tone-${tone}`}>
      <span className="swp-token-face-ring" />
      <span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${art})` }} />
    </span>
  );
}

/** Reveal: tap the face-down token to turn it over (design screens 06-07 / 55).
 *
 * Privacy: the sealed state holds no character content at all. The face is
 * only rendered after the first turn, and removed again once the token has
 * been turned back and finished turning. Re-sealing on reload is inherent:
 * the turned state lives only in this component. */
export function RevealScreen({ character, continueLabel, onTurned, onContinue }: {
  character: RevealCharacter;
  continueLabel: string;
  /** Called once each time the token turns face up. */
  onTurned: () => void;
  onContinue: () => void;
}) {
  const [turned, setTurned] = useState(false);
  const [faceMounted, setFaceMounted] = useState(false);
  const hide = useRef<ReturnType<typeof setTimeout>>();
  const turnedRef = useRef(onTurned);
  turnedRef.current = onTurned;

  useEffect(() => () => { if (hide.current) clearTimeout(hide.current); }, []);

  const toggle = () => {
    if (hide.current) clearTimeout(hide.current);
    if (!turned) {
      setFaceMounted(true);
      setTurned(true);
      turnedRef.current();
    } else {
      setTurned(false);
      // Unmount the face once it has turned out of sight (1s flip + margin).
      hide.current = setTimeout(() => setFaceMounted(false), 1100);
    }
  };

  return (
    <PhoneFrame dark label="reveal">
      <div className="swp-page swp-reveal-page">
        <div className="swp-reveal-body">
          <span className="swp-reveal-hint" role="status">{turned ? "You are the" : "Tap the token to turn it over"}</span>
          <button
            type="button"
            className="swp-token-btn"
            onClick={toggle}
            aria-pressed={turned}
            aria-label={turned ? "Turn your token back over" : "Turn your token over"}
          >
            <span className={`swp-token-flip${turned ? " swp-token-flipped" : ""}`}>
              <span className="swp-token-side swp-token-back"><TokenBack /></span>
              <span className={`swp-token-side swp-token-front swp-tone-${character.tone}`}>
                {faceMounted && <TokenFace art={character.art} tone={character.tone} />}
              </span>
            </span>
          </button>
          {/* The block is always laid out, so the token never moves when it
              turns; its content exists only while the token is face up. */}
          <div className="swp-reveal-info">
            {turned && (
              <div className="swp-reveal-info-in">
                <h1 className="swp-reveal-name">{character.name}</h1>
                <span className="swp-reveal-type">
                  <span className={`swp-type-${character.typeKey}`}>{character.typeLabel}</span>
                  {character.team && (<><span className="swp-reveal-dot">·</span><span className={`swp-team-${character.team.toLowerCase()}`}>{character.team}</span></>)}
                </span>
                {character.ability && <p className="swp-reveal-ability">{character.ability}</p>}
              </div>
            )}
          </div>
        </div>
        <div className={`swp-reveal-cta${turned ? " swp-reveal-cta-on" : ""}`} aria-hidden={!turned}>
          <GoldButton full onClick={onContinue} disabled={!turned}>{continueLabel}</GoldButton>
        </div>
      </div>
    </PhoneFrame>
  );
}
