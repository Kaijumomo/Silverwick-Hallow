import { useState } from "react";
import type { Script } from "@/stores/types";
import { BUILTIN_SCRIPT_IDS } from "@/data/scripts";
import { EDITION_LOGO, GENERIC_TEAM_ICON, useLoadedArt } from "@/features/home/art";
import { CustomScriptDialog } from "./CustomScriptDialog";
import { ROMAN, TEAM_COLOR, builtinScriptCards, compositionFor, scriptCardCount, seatedBounds, totalOf, travellerBounds } from "./setupFlowModel";

type Props = {
  scripts: Record<string, Script>;
  scriptId: string | null;
  onScript: (id: string) => void;
  seated: number;
  travellers: number;
  onSeated: (n: number) => void;
  onTravellers: (n: number) => void;
  onNext: () => void;
};

const COMPOSITION = [
  { key: "townsfolk", label: "Townsfolk", color: TEAM_COLOR.townsfolk },
  { key: "outsider", label: "Outsiders", color: TEAM_COLOR.outsider },
  { key: "minion", label: "Minions", color: TEAM_COLOR.minion },
  { key: "demon", label: "Demon", color: TEAM_COLOR.demon },
] as const;

/** One counter of the player strip. Total Players and Travellers share it, so
 * they cannot drift apart visually or in how they respond. */
function Counter({ kind, value, label, less, more, onChange, min, max }: {
  kind: "players" | "travellers"; value: number; label: string; less: string; more: string; onChange: (n: number) => void; min: number; max: number;
}) {
  return (
    <div className="sf-counter" data-kind={kind}>
      <button type="button" className="sf-counter-btn" aria-label={less} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
      <div className="sf-counter-mid">
        <span className="sf-counter-value" aria-live="polite">{value}</span>
        <span className="sf-counter-label">{label}</span>
      </div>
      <button type="button" className="sf-counter-btn" aria-label={more} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

export function ScriptStep({ scripts, scriptId, onScript, seated, travellers, onSeated, onTravellers, onNext }: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const cards = builtinScriptCards();
  const logos = useLoadedArt(Object.values(EDITION_LOGO));
  const chosen = scriptId ? scripts[scriptId] : undefined;
  const customChosen = !!chosen && !BUILTIN_SCRIPT_IDS.has(chosen.id);
  const seatedLimits = seatedBounds(travellers);
  const travellerLimits = travellerBounds(seated);
  const total = totalOf(seated, travellers);
  const composition = compositionFor(seated);

  return (
    <section className="sf-main" aria-labelledby="sf-step-title">
      <div className="sf-heading">
        <h1 className="sf-title" id="sf-step-title">Choose a script</h1>
        <span className="sf-sub">Each tale is a card.</span>
      </div>

      <div className="sf-scripts" data-chosen={chosen ? "true" : "false"}>
        {cards.map((card, i) => {
          const on = scriptId === card.id;
          const logo = EDITION_LOGO[card.id];
          return (
            <button key={card.id} type="button" className="sf-script-card sf-leather" aria-pressed={on} aria-label={card.name} onClick={() => onScript(card.id)}>
              <span className="sf-script-num">{ROMAN[i]}</span>
              <span
                className="sf-script-logo"
                aria-hidden="true"
                style={logo && logos.has(logo) ? { backgroundImage: `url(${logo})` } : undefined}
              >
                {logo && logos.has(logo) ? null : card.name}
              </span>
              <span className="sf-script-count">{scriptCardCount(card)}</span>
              {on && (
                <span className="sf-script-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </span>
              )}
            </button>
          );
        })}
        <button type="button" className="sf-custom" aria-pressed={customChosen} aria-haspopup="dialog" onClick={() => setImportOpen(true)}>
          <span className="sf-custom-plus" aria-hidden="true">+</span>
          <span className="sf-custom-name">Custom</span>
          <span className="sf-custom-hint">{customChosen ? chosen!.name : "Import a JSON file"}</span>
        </button>
      </div>

      <div className="sf-strip">
        <div className="sf-counters">
          <Counter kind="players" value={total} label="players" less="One fewer player" more="One more player" onChange={(n) => onSeated(seated + (n - total))} min={seatedLimits.min + travellers} max={seatedLimits.max + travellers} />
          <Counter kind="travellers" value={travellers} label="travellers" less="One fewer Traveller" more="One more Traveller" onChange={onTravellers} min={travellerLimits.min} max={travellerLimits.max} />
        </div>
        <div className="sf-strip-divider" />
        <div className="sf-comp">
          {COMPOSITION.map((item, i) => (
            <div key={item.key} className="sf-comp-item">
              <span className="sf-comp-icon" role="img" aria-label={item.label} style={{ backgroundImage: `url(${GENERIC_TEAM_ICON[item.key]})` }} />
              <span className="sf-comp-text">
                <span className="sf-comp-n" style={{ color: item.color }}>{composition[i]}</span>
                <span className="sf-comp-label">{item.label}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="sf-foot">
        <div className="sf-foot-status" />
        <button type="button" className="sf-cta" disabled={!chosen} aria-describedby="sf-script-reason" onClick={onNext}>
          Fabled &amp; Loric ›
        </button>
        {!chosen && <span id="sf-script-reason" className="sr-only">Choose a script to continue.</span>}
      </div>

      {importOpen && (
        <CustomScriptDialog
          onClose={() => setImportOpen(false)}
          onChoose={(script) => { onScript(script.id); setImportOpen(false); }}
        />
      )}
    </section>
  );
}
