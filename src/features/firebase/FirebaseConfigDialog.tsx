import { useState } from "react";
import {
  loadFirebaseConfig,
  saveFirebaseConfig,
  type FirebaseAppConfig,
} from "@/firebase/config";
import { clearActiveBackend } from "@/firebase/session";
import { Modal } from "@/components/Modal";

type Props = {
  onClose: () => void;
  onSaved: () => void;
};

export function FirebaseConfigDialog({ onClose, onSaved }: Props) {
  const existing = loadFirebaseConfig();
  const [draft, setDraft] = useState<FirebaseAppConfig>(
    existing ?? { apiKey: "", databaseURL: "", projectId: "" }
  );
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setError(null);
    try {
      saveFirebaseConfig(draft);
      // Evict the cached backend so the next connectFirebase() creates a fresh
      // connection using the new credentials instead of returning the stale one.
      clearActiveBackend();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const update = <K extends keyof FirebaseAppConfig>(
    key: K,
    value: FirebaseAppConfig[K]
  ) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Modal title="Configure Firebase" onClose={onClose}>
        <div className="dialog-body">
          <p className="behavior-help">
            Paste your Firebase Realtime Database credentials. The apiKey is
            public by Firebase design — the auth boundary is the security rules
            (see <code>src/firebase/rules.json</code>).
          </p>
          <label className="field">
            <span className="field-label">apiKey</span>
            <input
              className="input"
              value={draft.apiKey}
              onChange={(e) => update("apiKey", e.target.value)}
              placeholder="AIzaSy..."
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span className="field-label">databaseURL</span>
            <input
              className="input"
              value={draft.databaseURL}
              onChange={(e) => update("databaseURL", e.target.value)}
              placeholder="https://your-project-default-rtdb.firebaseio.com"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span className="field-label">projectId</span>
            <input
              className="input"
              value={draft.projectId}
              onChange={(e) => update("projectId", e.target.value)}
              placeholder="your-project"
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span className="field-label">authDomain (optional)</span>
            <input
              className="input"
              value={draft.authDomain ?? ""}
              onChange={(e) =>
                update("authDomain", e.target.value || undefined)
              }
              placeholder="your-project.firebaseapp.com"
              spellCheck={false}
            />
          </label>
          {error && (
            <div className="error-list" role="alert">
              <strong>Could not save:</strong>
              <p>{error}</p>
            </div>
          )}
          <div className="dialog-row">
            <button className="btn btn-gold" onClick={submit}>
              Save
            </button>
          </div>
        </div>
    </Modal>
  );
}
