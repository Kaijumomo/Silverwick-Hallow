import { useMemo } from "react";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { buildSetupGame, useStorytellerStore } from "@/stores/storytellerStore";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import type { V6UiState } from "../v6Store";

type Wizard = NonNullable<V6UiState["wiz"]>;

/** The design lays a town of more than fifteen out as fifteen seated players plus Travellers beyond the table. */
export const TABLE_MAX = 15;
export const WIZARD_MIN = 5;
export const WIZARD_MAX = 20;

export const travellersOf = (count: number): number => Math.max(0, count - TABLE_MAX);

const fabledIds = new Set<string>(FABLED.map((role) => role.id));

/** The extras the wizard has chosen, split into the two catalogues the store plans with. */
export const planExtras = (extras: readonly string[]) => ({
  plannedFabled: extras.filter((id) => fabledIds.has(id)),
  plannedLorics: extras.filter((id) => !fabledIds.has(id) && LORICS.some((role) => role.id === id)),
});

/** Draft records are only ever shown, never stored: this remembers which ones they are. */
const DRAFTS = new WeakSet<object>();
export const isDraftGame = (game: object | null | undefined): boolean => !!game && DRAFTS.has(game);

/** Steps I and II run before any game exists. */
export const wizardIsDraft = (wiz: Wizard | null, game: StorytellerLobbyRecord | null): wiz is Wizard =>
  !!wiz && (wiz.step !== "town" || !game);

/**
 * The script the wizard's choice stands for, or null while none is picked. An imported script is chosen by its
 * store id, which the wizard keeps in `customName` (the design's own field for "which custom script").
 */
export function wizardScript(wiz: Wizard, customScripts: Record<string, Script>): Script | null {
  if (!wiz.script) return null;
  if (wiz.script !== "custom") return BUILTIN_SCRIPTS[wiz.script] ?? null;
  return wiz.customName ? customScripts[wiz.customName] ?? null : null;
}

/**
 * The preview the Grimoire draws behind the wizard's first two steps: one empty seat per player counted so far,
 * laid out exactly as the real game's seats will be. It is built by the store's own pristine-game builder and is
 * never written to the store, a lobby or Firebase.
 */
export function useDraftGame(wiz: Wizard | null, enabled: boolean): StorytellerLobbyRecord | null {
  const customScripts = useStorytellerStore((s) => s.customScripts);
  const script = wiz ? wizardScript(wiz, customScripts) : null;
  const scriptId = script?.id ?? null;
  const count = wiz?.count ?? 0;
  const extrasKey = (wiz?.extras ?? []).join("|");
  return useMemo(() => {
    if (!enabled || !wiz) return null;
    const base = (scriptId ? BUILTIN_SCRIPTS[scriptId] ?? customScripts[scriptId] : undefined) ?? BUILTIN_SCRIPTS["tb"]!;
    const game = buildSetupGame(base, { plannedPlayerCount: count, plannedTravelerCount: travellersOf(count), ...planExtras(wiz.extras) });
    DRAFTS.add(game);
    return game;
    // The draft is rebuilt only when what it shows changes, so its seat ids stay put while the wizard is browsed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scriptId, count, extrasKey, customScripts]);
}
