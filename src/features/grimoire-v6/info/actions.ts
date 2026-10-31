import { create } from "zustand";
import { buildRegistry } from "@/data/roleRegistry";
import { endGameWithIntent } from "@/firebase/terminal";
import { useStorytellerStore, type TerminalIntent } from "@/stores/storytellerStore";
import { captureInfoContext, changeInfoBluff, infoContextCurrent, type InfoContext } from "@/features/info/infoCommands";
import { characterCard, infoRecipients, setupPayload, seatedPlayers, type SetupView } from "@/features/info/infoModel";
import type { PresentationPayload } from "@/features/info/PlayerPresentation";
import type { STPlayerRecord, StorytellerLobbyRecord, Script } from "@/stores/types";
import { flash, useV6Ui, type ShowState } from "../v6Store";
import { ICON } from "../icons";
import { useInfoShow } from "./showStore";
import { SETUP_LABEL } from "./tokens";

/**
 * The Info slice's commands. Everything here is a presentation or a thin wrapper over an existing
 * command: showing information never changes the game, records no delivery and writes no history.
 * Each returns a refusal message (for the design's toast) or undefined on success, so the board's
 * character picker can reuse them for its "show" and "bluff" modes.
 */

const STALE = "The game or connection changed. Review the information again.";

function open(context: InfoContext, payload: PresentationPayload, ui: ShowState, setup?: SetupView) {
  useInfoShow.getState().open({ context, payload, ...(setup ? { setup } : {}) });
  useV6Ui.getState().set({ show: ui, picker: null, card: false });
  useStorytellerStore.getState().selectPlayer(null);
}

export function closeShow() {
  useInfoShow.getState().clear();
  useV6Ui.getState().set({ show: null });
}

/** "You Are", "This Player Is", "Selected You", "This Character": a token with a chosen character. */
export function presentCharacter(heading: string, roleId: string, context: InfoContext = captureInfoContext()): string | undefined {
  if (!infoContextCurrent(context)) return STALE;
  const role = context.script ? buildRegistry(context.script).get(roleId) : undefined;
  if (!role) return "That character is not on this script.";
  open(context, { kind: "character", heading, character: characterCard(role) }, { kind: "char", title: heading, roleId });
  return undefined;
}

/** "Did You Vote Today?", "You Are Good" ...: a token without a character. */
export function presentMessage(symbol: "vote" | "nominate" | "good" | "evil", heading: string, context: InfoContext = captureInfoContext()): string | undefined {
  if (!infoContextCurrent(context)) return STALE;
  const tone = symbol === "good" || symbol === "evil" ? symbol : undefined;
  open(context, { kind: "message", heading, symbol, ...(tone ? { tone } : {}) }, { kind: "text", title: heading, icon: ICON[symbol], iconColor: "#e8584a", iconBg: "rgba(176,186,204,.1)" });
  return undefined;
}

/** The radial menu's Show: the player's own shown character, exactly what the phone would show them. */
export function presentPlayerToken(player: STPlayerRecord): string | undefined {
  const context = captureInfoContext();
  const game = context.game;
  if (!infoContextCurrent(context) || !game || game.players[player.id] !== player || !seatedPlayers(game).includes(player)) return "The player or game changed. Select their token again.";
  if (!player.shownRole) return `${player.name} has no character yet.`;
  return presentCharacter("You Are", player.shownRole, context);
}

const NO_RECIPIENT: Record<SetupView, string> = {
  traveler: "No living, non-exiled evil Traveller is seated. This information becomes available when an eligible evil Traveller joins.",
  minion: "No eligible Minion is seated. Assign a Minion during setup before showing this information.",
  demon: "No Demon or apparent Demon is seated. Assign a recipient during setup before showing this information.",
  bluffs: "No Demon or apparent Demon is seated. Assign a recipient during setup before showing this information.",
};

/** The single Demon (or apparent Demon) whose bluffs the Info card edits. */
export function bluffRecipient(game: StorytellerLobbyRecord, script: Script | undefined) {
  return script ? infoRecipients(game, script, "bluffs")[0] : undefined;
}

/**
 * First-night and Demon-bluff information, shown to the first eligible recipient, or to `recipientId` when the
 * Night step names one (separate Demons keep separate bluffs). The Night card and the Info card share this one
 * V2 Reveal; showing it is presentation only, and Night Next stays the completion command.
 */
export function presentSetup(view: SetupView, recipientId?: string, context: InfoContext = captureInfoContext()): string | undefined {
  if (!infoContextCurrent(context)) return STALE;
  const game = context.game!, script = context.script;
  if (!script) return STALE;
  const eligible = infoRecipients(game, script, view);
  if (!eligible.length) return NO_RECIPIENT[view];
  try {
    open(context, setupPayload(game, script, view, recipientId ?? eligible[0]!.id), { kind: "setup", key: view === "traveler" ? "traveller" : view === "bluffs" ? "bluffs" : view === "demon" ? "demon" : "minion" }, view);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : "Review the information before showing it.";
  }
}

export const setupLabel = (view: SetupView) => SETUP_LABEL[view];

/** Sets (or clears, when `roleId` is omitted) one of the Demon's three bluffs. */
export function applyBluff(slot: number, roleId?: string): string | undefined {
  const context = captureInfoContext();
  const game = context.game, script = context.script;
  if (!game || !script) return STALE;
  const recipient = bluffRecipient(game, script);
  if (!recipient) return NO_RECIPIENT.bluffs;
  return changeInfoBluff(context, recipient.id, slot, roleId);
}

/** Shows a refusal in the design's toast. */
export function report(message: string | undefined) {
  if (message) flash(message);
}

// ── End the game ──────────────────────────────────────────────────────────────

export type EndChoice = "good" | "evil" | "noResult";
const INTENT: Record<EndChoice, TerminalIntent> = {
  good: { kind: "declare", winner: "good" },
  evil: { kind: "declare", winner: "evil" },
  noResult: { kind: "noResult" },
};

type EndStatus = { busy: boolean; error: string | null; set: (patch: Partial<Pick<EndStatus, "busy" | "error">>) => void };
export const useEndStatus = create<EndStatus>()((set) => ({ busy: false, error: null, set: (patch) => set(patch) }));

let inFlight = false;

/**
 * The Storyteller's declaration, through the same terminal service as before (online lobbies are closed
 * authoritatively first). The result is never inferred: only the explicit choice, or the already-confirmed
 * recovery of an interrupted ending, is recorded.
 */
export async function confirmEnd(choice: EndChoice): Promise<boolean> {
  if (inFlight) return false;
  inFlight = true;
  useEndStatus.getState().set({ busy: true, error: null });
  try {
    const result = await endGameWithIntent(INTENT[choice]);
    if (!result.ok) {
      useEndStatus.getState().set({ error: result.message });
      flash(result.message);
      return false;
    }
    useStorytellerStore.getState().selectPlayer(null);
    useV6Ui.getState().set({ endOpen: false, panel: null, card: false, winScene: choice !== "noResult" });
    return true;
  } catch {
    const message = "The game could not be ended. Please try again.";
    useEndStatus.getState().set({ error: message });
    flash(message);
    return false;
  } finally {
    inFlight = false;
    useEndStatus.getState().set({ busy: false });
  }
}

/** The outcome an interrupted ending must be retried with (never a different one). */
export function recoveryChoice(): EndChoice | null {
  const terminal = useStorytellerStore.getState().terminalClose;
  if (terminal?.confirmedRecovery) return terminal.confirmedRecovery.kind === "endedWithResult" ? terminal.confirmedRecovery.result.winner : "noResult";
  if (terminal?.recoveryPending) return terminal.intent.kind === "declare" ? terminal.intent.winner : "noResult";
  return null;
}

export function endInFlight() {
  return inFlight;
}
