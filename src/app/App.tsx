import { lazy, Suspense, useEffect, useState } from "react";
import { isTabletTrial } from "@/config/trial";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { takeMigrationResetFlag } from "@/stores/storytellerStore";
import { HomeV6 } from "@/features/grimoire-v6/home/HomeV6";
import { GrimoireV6Screen } from "@/features/grimoire-v6/GrimoireV6Screen";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { useV6Ui } from "@/features/grimoire-v6/v6Store";
import { PlayerScreen } from "@/features/player/PlayerScreen";
import { PublicDisplayScreen } from "@/features/publicDisplay/PublicDisplayScreen";
import { isFirebaseConfigured } from "@/firebase/config";
import { connectFirebase } from "@/firebase/session";
import { StorytellerSession, UnattachedLobbyWarnings } from "@/firebase/StorytellerSession";

function readJoinCodeFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("join")) return null;
  const join = params.get("join") ?? "";
  return join.trim().toUpperCase();
}

function readPublicDisplayCodeFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (params.get("display") !== "public") return null;
  const code = (params.get("code") ?? "").trim().toUpperCase();
  return code.length > 0 ? code : null;
}

const TabletTrial = lazy(() => import("@/trial/TabletTrial"));

export function App() {
  return isTabletTrial
    ? <Suspense fallback={<p role="status">Opening the local tablet trial…</p>}><TabletTrial /></Suspense>
    : <NormalApp />;
}

function NormalApp() {
  const publicCode = readPublicDisplayCodeFromUrl();
  const joinCode = readJoinCodeFromUrl();
  const view = useStorytellerStore((s) => s.view);
  const hasGame = useStorytellerStore((s) => !!s.game);
  const wizarding = useV6Ui((s) => !!s.wiz);
  const [migrationResetBanner, setMigrationResetBanner] = useState(false);

  useEffect(() => {
    if (takeMigrationResetFlag()) setMigrationResetBanner(true);
  }, []);

  // Auto-init Firebase if config is present (.env.local or saved manually).
  // Lazy-loads the SDK chunk; errors surface in the action UI on retry.
  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    connectFirebase().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[firebase auto-connect]", e instanceof Error ? e.message : e);
    });
  }, []);

  // The unified Grimoire carries Setup too: New Game opens it on the wizard, Resume on the saved game.
  const showGrimoire = (view === "game" && hasGame) || (view === "newgame" && (wizarding || hasGame));

  if (publicCode !== null) {
    return (
      <div className="app">
        <PublicDisplayScreen code={publicCode} />
      </div>
    );
  }
  if (joinCode !== null) {
    return (
      <div className="app">
        <PlayerScreen initialCode={joinCode} />
      </div>
    );
  }
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
