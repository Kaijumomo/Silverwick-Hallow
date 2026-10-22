/** What every view-model slice returns: the keys it owns, plus the optional hooks the shell wires together. */
export type SliceResult = {
  /** Keys merged into the view-model the generated view reads. */
  vm: Record<string, unknown>;
  /** The phase's advance control in the dock (Reveal roles, Begin Day, Execute, Begin Night ...). */
  advance?: { text: string; run: () => void };
  /** Extra "block"/nominate state the dock pill shows during the Day. */
  pill?: Record<string, unknown>;
};

export const EMPTY: SliceResult = { vm: {} };
