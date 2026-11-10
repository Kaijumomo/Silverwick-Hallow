import { useEffect, useState } from "react";
import { useStorytellerStore, takeMigrationResetFlag } from "@/stores/storytellerStore";
import { HomeV6 } from "@/features/grimoire-v6/home/HomeV6";
import { GrimoireV6Screen } from "@/features/grimoire-v6/GrimoireV6Screen";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { StorytellerSession, UnattachedLobbyWarnings } from "@/firebase/StorytellerSession";

/** The Storyteller's app (Home, Setup and the Grimoire). Loaded only on the Storyteller route (F-13). */
export default function StorytellerApp() {
  const view = useStorytellerStore((s) => s.view);
  const hasGame = useStorytellerStore((s) => !!s.game);
  const wizarding = useV6Ui((s) => !!s.wiz);
  const [migrationResetBanner, setMigrationResetBanner] = useState(false);

  useEffect(() => {
    if (takeMigrationResetFlag()) setMigrationResetBanner(true);
  }, []);

  // The unified Grimoire carries Setup too: New Game opens it on the wizard, Resume on the saved game.
  const showGrimoire = (view === "game" && hasGame) || (view === "newgame" && (wizarding || hasGame));

  return (
    <div className="app">
      <StorytellerSession />
      {/* ASTRA-10G-R1-001: shell-level, so it survives Storyteller navigation. */}
      {view !== "newgame" && <UnattachedLobbyWarnings />}
      {migrationResetBanner && (
        <div className="error-list" role="alert" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 9999, maxWidth: 480 }}>
          <strong>Save data reset</strong>
          <p>Your saved game was incompatible with this version and was cleared.</p>
          <button className="btn btn-sm" onClick={() => setMigrationResetBanner(false)}>dismiss</button>
        </div>
      )}
      {showGrimoire ? <VotingProvider><GrimoireV6Screen /></VotingProvider> : <HomeV6 />}
    </div>
  );
}
