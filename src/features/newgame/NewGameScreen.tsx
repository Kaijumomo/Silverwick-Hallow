import { useMemo, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import type { Script } from "@/stores/types";
import { EDITION_LOGO, useLoadedArt } from "@/features/home/art";
import { ScriptStep } from "./ScriptStep";
import { ExtrasStep } from "./ExtrasStep";
import { DEFAULT_TOTAL, STEP_TITLES, ROMAN, clampTotal, clampTravellers, FABLED_CHOICES, LORIC_CHOICES } from "./setupFlowModel";

/**
 * New Game: the three-step setup flow (Script & Players, Fabled & Loric,
 * Players) from the Claude Design "Ledger". Steps I and II are a local draft:
 * nothing is created, and nothing touches Firebase, until Step III. The
 * Players step (Invite to phones / Play offline) arrives in the next slice.
 */
type Step = 0 | 1 | 2;

export function NewGameScreen() {
  const setView = useStorytellerStore((s) => s.setView);
  const customScripts = useStorytellerStore((s) => s.customScripts);
  const [step, setStep] = useState<Step>(0);
  const [scriptId, setScriptId] = useState<string | null>(null);
  const [total, setTotal] = useState(DEFAULT_TOTAL);
  const [travellers, setTravellers] = useState(0);
  const [extras, setExtras] = useState<string[]>([]);

  const allScripts: Record<string, Script> = useMemo(() => ({ ...BUILTIN_SCRIPTS, ...customScripts }), [customScripts]);
  const script = scriptId ? allScripts[scriptId] : undefined;
  const logos = useLoadedArt(Object.values(EDITION_LOGO));
  const logoUrl = script && EDITION_LOGO[script.id] && logos.has(EDITION_LOGO[script.id]!) ? EDITION_LOGO[script.id] : undefined;

  const setTotalClamped = (next: number) => {
    const value = clampTotal(next);
    setTotal(value);
    setTravellers((current) => clampTravellers(value, current));
  };
  const setTravellersClamped = (next: number) => setTravellers(clampTravellers(total, next));

  const namesOf = (ids: readonly string[]) =>
    ids.map((id) => [...FABLED_CHOICES, ...LORIC_CHOICES].find((role) => role.id === id)?.name).filter((name): name is string => !!name);

  const back = () => {
    if (step === 0) setView("home");
    else setStep((step - 1) as Step);
  };

  const railLines: string[][] = [
    script ? [script.name, `${total} players`] : [],
    step < 1 ? [] : extras.length ? namesOf(extras) : ["None"],
    [],
  ];

  return (
    <div className="sf-screen">
      <img className="sf-photo" src="/bg/BackgroundMenuTablet.png" alt="" />
      <div className="sf-veil" />
      <div className="sf-sheet">
        <header className="sf-head">
          <button type="button" className="sf-back" onClick={back}>
            <span className="sf-back-chev" aria-hidden="true">‹</span>
            {step === 0 ? "Home" : "Back"}
          </button>
          <ol className="sf-steps" aria-label="Setup steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {STEP_TITLES.map((title, i) => {
              const state = i < step ? "done" : i === step ? "current" : "future";
              return (
                <li key={title} className="sf-step-item" aria-current={i === step ? "step" : undefined}>
                  <span className="sf-step-label" data-state={state}>
                    <span className="sf-step-diamond" aria-hidden="true" />
                    {title}
                  </span>
                  {i < STEP_TITLES.length - 1 && <span className="sf-step-sep" aria-hidden="true" />}
                </li>
              );
            })}
          </ol>
          {step > 0 && logoUrl ? <span className="sf-head-logo" role="img" aria-label={script?.name} style={{ backgroundImage: `url(${logoUrl})` }} /> : <span aria-hidden="true" />}
        </header>

        <div className="sf-body">
          <nav className="sf-rail" aria-label="Setup progress">
            {STEP_TITLES.map((title, i) => {
              const state = i < step ? "done" : i === step ? "current" : "future";
              return (
                <button
                  key={title}
                  type="button"
                  className="sf-rail-step"
                  data-state={state}
                  aria-current={i === step ? "step" : undefined}
                  disabled={state !== "done"}
                  onClick={() => state === "done" && setStep(i as Step)}
                >
                  {i < STEP_TITLES.length - 1 && <span className="sf-rail-line" aria-hidden="true" />}
                  <span className="sf-rail-num">{state === "done" ? "✓" : ROMAN[i]}</span>
                  <span className="sf-rail-text">
                    <span className="sf-rail-title">{title}</span>
                    {railLines[i]!.map((line, n) => <span key={`${line}-${n}`} className="sf-rail-line-text">{line}</span>)}
                  </span>
                </button>
              );
            })}
          </nav>

          {step === 0 && (
            <ScriptStep
              scripts={allScripts}
              scriptId={scriptId}
              onScript={setScriptId}
              total={total}
              travellers={travellers}
              onTotal={setTotalClamped}
              onTravellers={setTravellersClamped}
              onNext={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <ExtrasStep
              total={total}
              extras={extras}
              onToggle={(id) => setExtras((current) => current.includes(id) ? current.filter((x) => x !== id) : [...current, id])}
              onNext={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <section className="sf-main">
              <div className="sf-heading">
                <h1 className="sf-title">Players</h1>
                <span className="sf-sub">Arrives in the next slice.</span>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
