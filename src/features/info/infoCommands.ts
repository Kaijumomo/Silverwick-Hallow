import { selectScriptById, useStorytellerStore } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { getPrivateInfoApplicability } from "@/stores/privatePackets";
import { buildRegistry } from "@/data/roleRegistry";
import { bluffChoiceError, revisedBluffs, seatedPlayers } from "./infoModel";

/** Ephemeral identity of an open chooser; never persisted. */
export function captureInfoContext() {
  const state = useStorytellerStore.getState();
  return { game: state.game, lobby: state.lobby, writer: useSessionRuntime.getState().backend,
    script: state.game ? selectScriptById(state, state.game.scriptId) : undefined };
}
export type InfoContext = ReturnType<typeof captureInfoContext>;
export function infoContextCurrent(context: InfoContext) {
  const state = useStorytellerStore.getState(), runtime = useSessionRuntime.getState();
  return !!context.game && state.game === context.game && state.lobby === context.lobby &&
    selectScriptById(state, context.game.scriptId) === context.script && !usePrivacyStore.getState().enabled &&
    state.terminalClose?.status !== "closing" &&
    (!state.lobby || (runtime.status === "live" && runtime.backend === context.writer && !!runtime.backend && !runtime.backend.leaseMayHaveLapsed()));
}
export function changeInfoBluff(context: InfoContext, recipientId: string, slot: number, choice?: string): string | undefined {
  if (!infoContextCurrent(context) || context.game!.phase === "ended") return "The game or connection changed. Reopen the bluff chooser.";
  const game = context.game!, script = context.script, player = game.players[recipientId];
  if (!script || !player || !seatedPlayers(game).includes(player) || !getPrivateInfoApplicability(player, buildRegistry(script)).bluffs) return "Choose a current Demon information recipient.";
  if (!Number.isInteger(slot) || slot < 0 || slot > 2) return "Choose a valid bluff slot.";
  if (choice) { const error = bluffChoiceError(game, script, recipientId, choice); if (error) return error; }
  useStorytellerStore.getState().setBluffs(recipientId, revisedBluffs(player.privateInfo?.bluffs ?? [], slot, choice));
  return undefined;
}
