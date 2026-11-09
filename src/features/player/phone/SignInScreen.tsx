import { useState } from "react";
import { canonicalJoin } from "@/firebase/lobby";
import { BackButton, DiamondRule, PhoneFrame } from "./PhoneParts";

const CODE_LENGTH = 8;
const NAME_MAX = 20;

const cleanCode = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);

/** "Join the town": name, 8-cell game code, "Enter the Town" (design screens
 * 02-03). Validation is the join's own (`canonicalJoin`); a join error from the
 * store is shown inline under the button, as the code has always done. */
export function SignInScreen({ initialCode, initialName, error, onBack, onSubmit }: {
  initialCode: string;
  initialName: string;
  error: string | null;
  onBack: () => void;
  onSubmit: (code: string, name: string) => void;
}) {
  const [name, setName] = useState(initialName.slice(0, NAME_MAX));
  const [code, setCode] = useState(cleanCode(initialCode));
  const [formError, setFormError] = useState<string | null>(null);

  const trimmed = name.trim();
  const ready = trimmed.length > 0 && code.length === CODE_LENGTH;
  const hint = !trimmed ? "Enter your name to continue" : !ready ? "Enter the 8-letter game code" : `Signed, ${trimmed}`;
  const active = Math.min(code.length, CODE_LENGTH - 1);

  const submit = () => {
    if (!ready) return;
    try {
      const canonical = canonicalJoin(code, name);
      setFormError(null);
      onSubmit(canonical.code, canonical.name);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    }
  };

  const shown = formError ?? error;

  return (
    <PhoneFrame glow="join" label="sign-in">
      <form className="swp-page" onSubmit={(event) => { event.preventDefault(); submit(); }}>
        <BackButton label="Home" onClick={onBack} />
        <div className="swp-sign">
          <DiamondRule />
          <div className="swp-sign-head">
            <h1 className="swp-title swp-sign-title">Join the town</h1>
            <p className="swp-fell swp-sign-sub">Give your name and the Storyteller’s code.</p>
          </div>
          <label className="swp-field">
            <span className="swp-eyebrow">Your name</span>
            <input
              className="swp-name-input"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
              placeholder="Write it here"
              maxLength={NAME_MAX}
              autoComplete="off"
              aria-label="Your name"
            />
          </label>
          <div className="swp-code">
            <span className="swp-eyebrow">Game code</span>
            <label className="swp-code-cells">
              {Array.from({ length: CODE_LENGTH }, (_, i) => (
                <div key={i} className={`swp-code-cell${i === active ? " swp-code-cell-active" : ""}`}>{code[i] ?? ""}</div>
              ))}
              <input
                className="swp-code-input"
                value={code}
                onChange={(e) => setCode(cleanCode(e.target.value))}
                maxLength={CODE_LENGTH}
                autoComplete="off"
                autoCapitalize="characters"
                aria-label="Game code"
              />
            </label>
            <span className="swp-fell swp-code-help">Or scan the code on the Storyteller’s screen.</span>
          </div>
          <button type="submit" className="swp-join" disabled={!ready}>
            <span className="swp-gold">Enter the Town</span>
            <span className="swp-fell swp-join-hint">{hint}</span>
          </button>
          {shown && <p className="swp-join-error swp-fell" role="alert">{shown}</p>}
          <DiamondRule />
        </div>
      </form>
    </PhoneFrame>
  );
}
