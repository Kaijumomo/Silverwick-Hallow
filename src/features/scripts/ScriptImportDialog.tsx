import { useState, type DragEvent, type ChangeEvent } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { parseClocktowerScript } from "@/data/customScript";
import { Modal } from "@/components/Modal";

type Tab = "paste" | "upload";

type ImportDialogProps = {
  onClose: () => void;
  onImported: (scriptId: string, scriptName: string) => void;
};

export function ScriptImportDialog({ onClose, onImported }: ImportDialogProps) {
  const addCustomScript = useStorytellerStore((s) => s.addCustomScript);
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
    onImported(result.script.id, result.script.name);
    onClose();
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
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  };

  return (
    <Modal title="Import script" onClose={onClose}>
        <div className="dialog-tabs">
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
        <div className="dialog-body">
          {tab === "paste" ? (
            <>
              <p className="behavior-help">
                Paste a clocktower.online JSON array. String entries (e.g.{" "}
                <code>"washerwoman"</code>) reference official roles; objects
                define homebrew characters.
              </p>
              <textarea
                className="textarea import-textarea"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder='[{"id":"_meta","name":"My Script"},"washerwoman","imp"]'
                spellCheck={false}
              />
              <div className="dialog-row">
                <button className="btn btn-gold" onClick={onPasteSubmit}>
                  Import
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="behavior-help">
                Drop a <code>.json</code> file from clocktower.online, or
                tap to browse.
              </p>
              <label
                className={`dropzone ${dragOver ? "drag-over" : ""}`}
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
            </>
          )}
          {error && (
            <div className="error-list" role="alert">
              <strong>Could not import:</strong>
              <p>{error}</p>
            </div>
          )}
        </div>
    </Modal>
  );
}
