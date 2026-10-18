import { useRef, useState } from "react";
import { useDialogFocus } from "./useDialogFocus";
import { isCanonicalRole } from "@/data/canonical";
import { wikiUrlFor } from "@/features/almanac/wikiUrl";
import { arcLetters, cleanReminder, jinxesOf, reminderLabels, teamOf } from "@/features/home/reference/referenceData";
import type { RoleDef } from "@/stores/types";
import { roleArt } from "./roleArt";

/** Character card (design: tarot card). The front is the character, the back
 * its reminders, night prompts and jinxes. Tapping the card turns it. */
export function TarotCard({ role, onClose }: { role: RoleDef; onClose: () => void }) {
  const [back, setBack] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialogFocus(ref, onClose);
  const team = teamOf(role.type);
  const colour = team?.color ?? "#e0b96a";
  const tokens = reminderLabels(role);
  const jinxes = jinxesOf(role.id);
  const nights: [string, string][] = [];
  if (role.firstNightReminder) nights.push(["First night", role.firstNightReminder]);
  if (role.otherNightReminder) nights.push(["Other nights", role.otherNightReminder]);
  const official = isCanonicalRole(role);
  const art = roleArt(role);
  const flip = () => setBack((b) => !b);
  return (
    <div className="swp-tarot-layer">
      <div className="swp-tarot-backdrop" onClick={onClose} />
      <button type="button" className="swp-tarot-close" aria-label="Close" onClick={onClose}>×</button>
      <div ref={ref} tabIndex={-1} className="swp-tarot" role="dialog" aria-modal="true" aria-label={role.name}>
        <div className={`swp-tarot-flip${back ? " swp-tarot-turned" : ""}`}>
          <div className="swp-tarot-face swp-tarot-front" aria-hidden={back} onClick={flip} role="button" tabIndex={back ? -1 : 0}
            aria-label={`${role.name}. Tap to turn the card`}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } }}>
            <span className="swp-tarot-bar" style={{ background: colour }} />
            <span className="swp-tarot-arch" style={{ boxShadow: `0 0 28px ${colour}55` }}>
              <span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${art})` }} />
            </span>
            <h2 className="swp-tarot-name">{role.name}</h2>
            <span className="swp-tarot-team" style={{ color: colour }}>{team?.kicker ?? role.type}</span>
            <span className="swp-tarot-orn swp-tarot-orn-gem" aria-hidden="true" />
            {role.ability && <p className="swp-tarot-ability">{role.ability}</p>}
            {role.flavor && <p className="swp-tarot-flavor">{role.flavor}</p>}
            <span className="swp-tarot-hint">Tap to turn the card</span>
          </div>
          <div className="swp-tarot-face swp-tarot-rear" aria-hidden={!back}>
            <div className="swp-tarot-scroll" onClick={flip}>
              <h2 className="swp-tarot-name swp-tarot-name-sm">{role.name}</h2>
              <span className="swp-tarot-orn swp-tarot-orn-gem" aria-hidden="true" />
              {role.flavor && <p className="swp-tarot-flavor">{role.flavor}</p>}
              {tokens.length > 0 && (
                <>
                <span className="swp-tarot-label swp-tarot-label-c">Reminder tokens</span>
                <ul className="swp-tarot-tokens" aria-label="Reminder tokens">
                  {tokens.map((label) => {
                    const { fs, letters } = arcLetters(label);
                    return (
                      <li key={label} className="swp-rem" aria-label={label}>
                        <span role="img" aria-label="" className="swp-token-art swp-rem-art" style={{ backgroundImage: `url(${art})` }} />
                        <span className="swp-rem-arc" aria-hidden="true">
                          {letters.map((l, i) => <span key={i} style={{ fontSize: Math.min(fs, 11), transform: `rotate(${l.rot}deg) translateY(29px)` }}>{l.ch}</span>)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                </>
              )}
              {nights.map(([label, text]) => (
                <div key={label} className="swp-tarot-sec swp-tarot-night">
                  <svg className="swp-moon-ico" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#e0b96a" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z" /></svg>
                  <div className="swp-tarot-night-text">
                    <span className="swp-tarot-label">{label}</span>
                    <p className="swp-tarot-text">{cleanReminder(text)}</p>
                  </div>
                </div>
              ))}
              {jinxes.length > 0 && (
                <div className="swp-tarot-sec">
                  <span className="swp-tarot-label">Jinxes</span>
                  {jinxes.map((j) => (
                    <div key={j.id} className="swp-jinx">
                      <span className="swp-jinx-icon">{j.role && <span role="img" aria-label="" className="swp-token-art" style={{ backgroundImage: `url(${roleArt(j.role)})` }} />}</span>
                      <span className="swp-jinx-text"><span className="swp-jinx-name">{j.name}</span><span className="swp-jinx-reason">{j.reason}</span></span>
                    </div>
                  ))}
                </div>
              )}
              {official && (
                <a className="swp-wiki" tabIndex={back ? 0 : -1} href={wikiUrlFor(role.name)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>Read on the official wiki<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a>
              )}
              <button type="button" className="swp-tarot-hint swp-tarot-turnback" tabIndex={back ? 0 : -1} onClick={flip}>Tap to turn back</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
