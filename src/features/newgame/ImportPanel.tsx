import { useState, type DragEvent, type ChangeEvent } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { parseClocktowerScript } from "@/data/customScript";
import type { Script } from "@/stores/types";

type Props = {
  onImported: (script: Script) => void;
  /** Choose an already-saved imported script. */
  onUse?: (script: Script) => void;
};

type Tab = "paste" | "upload";

export function ImportPanel({ onImported, onUse }: Props) {
  const addCustomScript = useStorytellerStore((s) => s.addCustomScript);
  const removeCustomScript = useStorytellerStore((s) => s.removeCustomScript);
  const customScripts = useStorytellerStore((s) => s.customScripts);
  const [tab, setTab] = useState<Tab>("paste");
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const submitJsonText = (text: string) => {
    setError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`Invalid JSON: ${msg}`);
      return;
    }
    const result = parseClocktowerScript(parsed);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const added = addCustomScript(result.script);
    if (!added.ok) {
      setError(added.error);
      return;
    }
    setPasteText("");
    onImported(result.script);
  };

  const onPasteSubmit = () => {
    if (!pasteText.trim()) {
      setError("Paste a clocktower.online script JSON to continue.");
      return;
    }
    submitJsonText(pasteText);
  };

  const readFile = (file: File) => {
    setError(null);
    const reader = new FileReader();
    reader.onerror = () => setError("Failed to read file.");
    reader.onload = () => {
      const text = reader.result;
      if (typeof text !== "string") {
        setError("File did not contain text.");
        return;
      }
      submitJsonText(text);
    };
    reader.readAsText(file);
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) readFile(file);
    e.target.value = "";
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  const importedScripts = Object.values(customScripts);

  return (
    <div className="ng-import-panel">
      <p className="ng-import-help">
        Import a <strong>clocktower.online</strong> JSON script. String entries
        reference official roles; objects define homebrew characters.
      </p>

      <div className="dialog-tabs ng-import-tabs">
        <button
          className="tab"
          aria-pressed={tab === "paste"}
          onClick={() => setTab("paste")}
        >
          Paste JSON
        </button>
        <button
          className="tab"
          aria-pressed={tab === "upload"}
          onClick={() => setTab("upload")}
        >
          Upload file
        </button>
      </div>

      {tab === "paste" ? (
        <div className="ng-import-paste">
          <textarea
            className="textarea import-textarea"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder='[{"id":"_meta","name":"My Script"},"washerwoman","imp"]'
            spellCheck={false}
          />
          <button className="btn btn-gold" onClick={onPasteSubmit}>
            Import
          </button>
        </div>
      ) : (
        <label
          className={`dropzone${dragOver ? " drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept=".json,application/json"
            onChange={onFileChange}
            hidden
          />
          <span>Drop a script .json here, or tap to browse</span>
        </label>
      )}

      {error && (
        <div className="error-list" role="alert">
          <strong>Could not import:</strong>
          <p>{error}</p>
        </div>
      )}

      {importedScripts.length > 0 && (
        <div className="ng-import-existing">
          <div className="ng-import-existing-title">Imported scripts</div>
          {importedScripts.map((s) => (
            <div key={s.id} className="ng-import-existing-row">
              <span className="ng-import-existing-name">{s.name}</span>
              {onUse && (
                <button className="btn btn-sm" aria-label={`Use ${s.name}`} onClick={() => onUse(s)}>
                  Use
                </button>
              )}
              <button
                className="btn btn-sm btn-danger"
                aria-label={`Remove ${s.name}`}
                onClick={() => {
                  if (window.confirm(`Remove imported script "${s.name}"?`)) {
                    removeCustomScript(s.id);
                  }
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
