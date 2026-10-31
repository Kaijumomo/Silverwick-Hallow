import { useEffect } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { GrimoireV6 } from "./GrimoireV6";
import { useV6Ctx } from "./ctx";
import { useGrimoireVm } from "./useGrimoireVm";
import { useV6Ui } from "./v6Store";
import { preloadRevealGrain } from "./revealGrain";
import { useDraftGame, wizardIsDraft } from "./setup/draft";
import { SetupOverlays } from "./setup/SetupOverlays";
import type { StorytellerLobbyRecord } from "@/stores/types";

function Loaded({ game }: { game: StorytellerLobbyRecord }) {
  const ctx = useV6Ctx(game);
  const vm = useGrimoireVm(ctx);
  return <GrimoireV6 vm={vm} />;
}

/**
 * The unified Storyteller Grimoire (V2 design): header, board, dock and centred cards on one screen.
 *
 * New Game opens it with no game yet: the first two wizard steps (script, Fabled & Loric) are drawn over a draft
 * table that only this screen holds; "Prepare the town" then creates the real setup game and the same screen carries
 * on with seating, dealing, preparation and Reveal.
 */
export function GrimoireV6Screen() {
  const game = useStorytellerStore((s) => s.game);
  const wiz = useV6Ui((s) => s.wiz);
  const drafting = wizardIsDraft(wiz, game);
  const draft = useDraftGame(wiz, drafting);

  useEffect(() => { preloadRevealGrain(); }, []);

  // The town step needs its game: if it was discarded from elsewhere, fall back to the last draft step.
  useEffect(() => {
    if (wiz?.step === "town" && !game) useV6Ui.getState().set({ wiz: { ...wiz, step: "extras" } });
  }, [wiz, game]);

  const shown = drafting ? draft : game;
  if (!shown) return null;
  return (
    <>
      <Loaded game={shown} />
      <SetupOverlays />
    </>
  );
}
