import { useEffect, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { takeMigrationResetFlag } from "@/stores/storytellerStore";
import { HomeScreen } from "@/features/home/HomeScreen";
import { GameScreen } from "@/features/game/GameScreen";
import { NewGameScreen } from "@/features/newgame/NewGameScreen";
import { PlayerScreen } from "@/features/player/PlayerScreen";
import { PublicDisplayScreen } from "@/features/publicDisplay/PublicDisplayScreen";
import { isFirebaseConfigured } from "@/firebase/config";
import { connectFirebase } from "@/firebase/session";
import { StorytellerSession } from "@/firebase/StorytellerSession";

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

export function App() {
  const publicCode = readPublicDisplayCodeFromUrl();
  const joinCode = readJoinCodeFromUrl();
  const view = useStorytellerStore((s) => s.view);
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
      {migrationResetBanner && (
        <div className="error-list lobby-error" role="alert" style={{ position: "fixed", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 9999, maxWidth: 480 }}>
          <strong>Save data reset</strong>
          <p>Your saved game was incompatible with this version and was cleared.</p>
          <button className="btn btn-sm" onClick={() => setMigrationResetBanner(false)}>dismiss</button>
        </div>
      )}
      {view === "game" ? (
        <GameScreen />
      ) : view === "newgame" ? (
        <NewGameScreen />
      ) : (
        <HomeScreen />
      )}
    </div>
  );
}
