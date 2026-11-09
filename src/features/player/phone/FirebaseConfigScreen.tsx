import { useState } from "react";
import { loadFirebaseConfig, saveFirebaseConfig, type FirebaseAppConfig } from "@/firebase/config";
import { clearActiveBackend } from "@/firebase/session";
import { GoldButton, PhoneFrame } from "./PhoneParts";

const REQUIRED: (keyof FirebaseAppConfig)[] = ["apiKey", "databaseURL", "projectId"];

const FIELDS: { key: keyof FirebaseAppConfig; label: string; placeholder: string }[] = [
  { key: "apiKey", label: "apiKey", placeholder: "AIzaSy..." },
  { key: "databaseURL", label: "databaseURL", placeholder: "https://your-project-default-rtdb.firebaseio.com" },
  { key: "projectId", label: "projectId", placeholder: "your-project" },
  { key: "authDomain", label: "authDomain (optional)", placeholder: "your-project.firebaseapp.com" },
];

/** Full-screen Firebase configuration (design screens 41-43). Behaviour is the
 * existing dialog's: Save stores the config and evicts the cached backend. */
export function FirebaseConfigScreen({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const existing = loadFirebaseConfig();
  const [draft, setDraft] = useState<FirebaseAppConfig>(existing ?? { apiKey: "", databaseURL: "", projectId: "" });
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const save = () => {
    setTried(true);
    setError(null);
    try {
      saveFirebaseConfig(draft);
      clearActiveBackend();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const bad = (key: keyof FirebaseAppConfig) => tried && REQUIRED.includes(key) && !(draft[key] ?? "").toString().trim();

  return (
    <PhoneFrame glow="fb" label="firebase-config">
      <div className="swp-fb-page">
        <div className="swp-fb-head">
          <h1 className="swp-fb-brand">Silverwick Hollow</h1>
          <p className="swp-fell swp-fb-sub">Configure Firebase to join a lobby.</p>
        </div>
        <div className="swp-fb-card" role="dialog" aria-label="Configure Firebase">
          <div className="swp-fb-top">
            <span className="swp-title swp-fb-title">Configure Firebase</span>
            <button type="button" className="swp-fb-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <div className="swp-fb-body">
            <p className="swp-fb-help">
              Paste your Firebase Realtime Database credentials. The apiKey is public by Firebase design — the auth
              boundary is the security rules (see <span className="swp-fb-code">src/firebase/rules.json</span>).
            </p>
            {FIELDS.map((f) => (
              <label key={f.key} className="swp-fb-field">
                <span className="swp-fb-label">{f.label}</span>
                <input
                  className={`swp-fb-input${bad(f.key) ? " swp-fb-input-bad" : ""}`}
                  value={(draft[f.key] as string | undefined) ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: f.key === "authDomain" ? e.target.value || undefined : e.target.value }))}
                  placeholder={f.placeholder}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            ))}
            {error && (
              <div className="swp-fb-error" role="alert">
                <span className="swp-fb-error-label">Could not save</span>
                <span className="swp-fb-error-text">{error}</span>
              </div>
            )}
            <GoldButton full className="swp-fb-save" onClick={save}>Save</GoldButton>
          </div>
        </div>
      </div>
    </PhoneFrame>
  );
}
