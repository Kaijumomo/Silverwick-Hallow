import { useState } from "react";
import { RolePoolEditor } from "./RolePoolEditor";
import type { RoleId, Script } from "@/stores/types";

type Props = {
  script: Script;
  /** The current dealt bag (ordinary assigned actual-role multiset), used
   * only to initialize the staged local edit -- never re-synced afterward,
   * so clicking roles here never touches live assignments until Apply. */
  initialBag: RoleId[];
  ordinaryCount: number;
  onApply: (staged: RoleId[]) => void;
  onCancel: () => void;
};

/**
 * Edits the currently dealt character set before Reveal. Reuses the same
 * role-grid architecture as the pre-Deal bag editor (RolePoolEditor) --
 * initialized from the live assigned multiset, not the now-empty rolePool.
 * Changes stage locally; only Apply Bag Changes commits them.
 */
export function EditBagPanel({ script, initialBag, ordinaryCount, onApply, onCancel }: Props) {
  const [staged, setStaged] = useState<RoleId[]>(() => initialBag);
  const complete = staged.length === ordinaryCount;
  return (
    <div className="setup-bag-editor setup-edit-bag">
      <h3 className="setup-editor-heading">Edit bag</h3>
      <p className="setup-selection-count">
        <strong>{staged.length}</strong> / {ordinaryCount} staged
      </p>
      {!complete && (
        <p className="setup-caption">Choose exactly one role per occupied ordinary player before applying.</p>
      )}
      <RolePoolEditor script={script} pool={staged} onChange={setStaged} />
      <div className="drawer-row setup-edit-bag-actions">
        <button className="btn btn-sm" onClick={onCancel}>Cancel</button>
        <button className="btn btn-gold" disabled={!complete} onClick={() => onApply(staged)}>
          Apply Bag Changes
        </button>
      </div>
    </div>
  );
}
