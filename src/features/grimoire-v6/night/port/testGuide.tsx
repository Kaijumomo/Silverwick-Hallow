import { useEffect, useLayoutEffect, useRef } from "react";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { buildRegistry } from "@/data/roleRegistry";
import { useShellStore } from "@/stores/shellStore";
import { deriveNightWork, stepResolved } from "@/features/nightOrder/nightWork";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import type { Script, StorytellerLobbyRecord } from "@/stores/types";
import { GrimoireV6Screen } from "../../GrimoireV6Screen";
import { useV6Ui } from "../../v6Store";
import { useNightPos } from "../nightPos";

type Props = { game: StorytellerLobbyRecord; script: Script; visible: boolean; onClose: () => void };

/**
 * Test shim: lets the scenarios written against the guided Night panel run unchanged against the V6 Grimoire.
 * The panel began on the first open step; the V2 strip begins on Dusk, so the shim sets the Night cursor the
 * way the old panel resolved its default. `visible` opens or closes the Night card; `onClose` fires when the
 * card is closed from inside.
 */
export function ModernNightPanel({ game, script, visible, onClose }: Props) {
  useLayoutEffect(() => {
    const cursor = useShellStore.getState().nightCursor;
    if (game.phase !== "night" || (cursor && cursor.day === game.day)) return;
    const work = deriveNightWork(game, { script, registry: buildRegistry(script), semantics: CANONICAL_ABILITY_SEMANTICS });
    const first = work.steps.find((step) => !stepResolved(game, step)) ?? work.steps.at(-1);
    if (first) useShellStore.getState().setNightCursor({ day: game.day, stepKey: first.stepKey });
    useNightPos.getState().go(0, null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { useV6Ui.getState().set({ panel: visible ? "night" : null }); }, [visible]);
  const closed = useRef(onClose);
  closed.current = onClose;
  useEffect(() => useV6Ui.subscribe((state, previous) => {
    if (previous.panel === "night" && state.panel === null) closed.current();
  }), []);
  return <VotingProvider><GrimoireV6Screen /></VotingProvider>;
}
