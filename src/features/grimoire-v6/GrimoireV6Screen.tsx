import { useStorytellerStore } from "@/stores/storytellerStore";
import { GrimoireV6 } from "./GrimoireV6";
import { useV6Ctx } from "./ctx";
import { useGrimoireVm } from "./useGrimoireVm";
import type { StorytellerLobbyRecord } from "@/stores/types";

function Loaded({ game }: { game: StorytellerLobbyRecord }) {
  const ctx = useV6Ctx(game);
  const vm = useGrimoireVm(ctx);
  return <GrimoireV6 vm={vm} />;
}

/** The unified Storyteller Grimoire (V2 design): header, board, dock and centred cards on one screen. */
export function GrimoireV6Screen() {
  const game = useStorytellerStore((s) => s.game);
  if (!game) return null;
  return <Loaded game={game} />;
}
