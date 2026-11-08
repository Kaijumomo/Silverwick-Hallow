import { create } from "zustand";
import type { PlayerId, RoleId, RoleType } from "@/stores/types";

/**
 * Package 4: UI-only state of the unified Grimoire (the V2 "Storyteller Grimoire v6" design).
 * Session-local, never persisted, never part of the game record, Undo, projections or URLs --
 * the same contract as shellStore. Authoritative game state stays in storytellerStore.
 *
 * Every field mirrors a piece of local state the design prototype keeps; the fields marked with the
 * slice that owns them are written and read only by that slice's view-model.
 */
export type PanelKind = "players" | "night" | "info" | "reference";

/** Character picker that opens over the board: one frame, several uses. */
export type PickerState =
  | { mode: "distribute" }
  | { mode: "choose"; playerId: PlayerId }
  | { mode: "show"; title: string; kicker?: string; types?: RoleType[]; onPick?: (roleId: RoleId) => string | undefined;
      /** Character tokens only: no "who holds it" names and no bluff marks (the Gambler guesses without being told who is in play). */
      tokensOnly?: boolean }
  | { mode: "bluff"; slot: number }
  | { mode: "drunk"; playerId: PlayerId };

/** What the full-screen "player view" (Show) is displaying. */
export type ShowState =
  | { kind: "char"; title: string; roleId: RoleId }
  | { kind: "text"; title: string; icon: string; iconColor: string; iconBg: string; ink?: string; ring?: string; titleColor?: string }
  | { kind: "setup"; key: "traveller" | "demon" | "minion" | "bluffs" };

export type WizardStep = "script" | "extras" | "town";

/** A question put to the Storyteller in the Grimoire's own dialog style. `input` set means it asks for a line of text. */
export type AskState = {
  title: string; body: string; okText: string; danger?: boolean;
  input?: { placeholder: string; value: string; maxLength?: number };
  run: (value: string) => void;
  /** A second answer button beside OK, for a question with two real options. */
  alt?: { text: string; run: () => void };
  /** Called when the Storyteller dismisses the question without answering it. */
  cancel?: () => void;
};

export type V6UiState = {
  // ── chrome (4A) ───────────────────────────────────────────────────────────
  panel: PanelKind | null;
  qrOpen: boolean;
  toast: string | null;
  veil: { key: string; label: string; sub: string; day: boolean } | null;
  /** The board has just been laid out for a new screen: suppress transitions for a moment. */
  settle: "on" | "hide" | null;
  // ── board and player card (4B) ────────────────────────────────────────────
  popMode: "main" | "more";
  /** The compact player card (Details) is open for the selected player. */
  card: boolean;
  swapFrom: PlayerId | null;
  remAll: boolean;
  remArm: string | null;
  picker: PickerState | null;
  pickSel: RoleId[];
  /** "The Deal": the tokens handed to seats one by one so far, and the seat that is up. Never persisted; dealt only when sealed. */
  deal: { cur: number; assign: Record<PlayerId, RoleId>; ring: string } | null;
  pickHover: RoleId | null;
  /** Distribute Roles: the Storyteller's Godfather choice, one Outsider more (+1) or fewer (-1). */
  gfMod: 1 | -1;
  // ── setup (4C) ────────────────────────────────────────────────────────────
  wiz: { step: WizardStep; script: string | null; customName: string | null; count: number; extras: string[]; focus: string | null; xtab: "fabled" | "loric" } | null;
  townCur: number | null;
  seatMode: boolean;
  seatCur: number;
  lobbyName: string;
  prepEdit: { key: string; slot: "a" | "b"; a: PlayerId | null; b: PlayerId | null; token: RoleId | null } | null;
  // ── night / day (4D, 4E) ──────────────────────────────────────────────────
  shownNumber: number | null;
  slay: { stage: "shooter" | "target" | "result"; shooter?: PlayerId; target?: PlayerId; override?: boolean } | null;
  // ── info, reference, end (4F) ─────────────────────────────────────────────
  show: ShowState | null;
  refQuery: string;
  refSel: string | null;
  endOpen: boolean;
  winScene: boolean;
  // ── in-app confirmation / name entry (replaces the browser's own dialogs) ───
  ask: AskState | null;
};

export type V6UiActions = {
  set: (patch: Partial<V6UiState>) => void;
  reset: () => void;
};

const INITIAL: V6UiState = {
  panel: null, qrOpen: false, toast: null, veil: null, settle: null,
  popMode: "main", card: false, swapFrom: null, remAll: false, remArm: null,
  picker: null, pickSel: [], deal: null, pickHover: null, gfMod: 1,
  wiz: null, townCur: null, seatMode: false, seatCur: 0, lobbyName: "", prepEdit: null,
  shownNumber: null, slay: null,
  show: null, refQuery: "", refSel: null, endOpen: false, winScene: false, ask: null,
};

export const useV6Ui = create<V6UiState & V6UiActions>()((set) => ({
  ...INITIAL,
  set: (patch) => set(patch),
  reset: () => set(INITIAL),
}));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** The design's one-line toast. */
export function flash(text: string) {
  clearTimeout(toastTimer);
  useV6Ui.getState().set({ toast: text });
  toastTimer = setTimeout(() => useV6Ui.getState().set({ toast: null }), 2800);
}

let veilTimer: ReturnType<typeof setTimeout> | undefined;
let veilSeq = 0;
/** The full-screen Night / Day transition veil. */
export function showVeil(label: string, sub: string, day: boolean) {
  clearTimeout(veilTimer);
  useV6Ui.getState().set({ veil: { key: `v${veilSeq++}`, label, sub, day } });
  veilTimer = setTimeout(() => useV6Ui.getState().set({ veil: null }), 2100);
}

/** A two-option question: resolves "first", "second", or null when dismissed. */
export function chooseAsk(title: string, body: string, first: string, second: string): Promise<"first" | "second" | null> {
  return new Promise((resolve) => useV6Ui.getState().set({
    ask: { title, body, okText: first, run: () => resolve("first"), alt: { text: second, run: () => resolve("second") }, cancel: () => resolve(null) },
  }));
}

/** A yes/no question in the Grimoire's own dialog, in place of window.confirm. Resolves false when dismissed. */
export function confirmAsk(title: string, body: string, okText: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => useV6Ui.getState().set({
    ask: { title, body, okText, danger, run: () => resolve(true), cancel: () => resolve(false) },
  }));
}
