import { Modal } from "@/components/Modal";
import type { Script } from "@/stores/types";
import { ImportPanel } from "./ImportPanel";

/** The Custom tile's dialog: the three existing custom-script capabilities
 * (upload a file, paste JSON, manage saved scripts) in one modal. Importing or
 * choosing a saved script selects it and closes the dialog. */
export function CustomScriptDialog({ onClose, onChoose }: { onClose: () => void; onChoose: (script: Script) => void }) {
  return (
    <Modal title="Custom script" onClose={onClose} className="sf-custom-dialog">
      <div className="dialog-body">
        <ImportPanel onImported={onChoose} onUse={onChoose} />
      </div>
    </Modal>
  );
}
