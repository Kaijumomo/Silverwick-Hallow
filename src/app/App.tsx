import { lazy, Suspense, useEffect } from "react";
import { isTabletTrial } from "@/config/trial";
import { isFirebaseConfigured } from "@/firebase/config";
import { connectFirebase } from "@/firebase/session";

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
// F-13: each route loads only its own screens, so a player's phone never downloads the Storyteller's Grimoire.
const StorytellerApp = lazy(() => import("./StorytellerApp"));
const PlayerScreen = lazy(() => import("@/features/player/PlayerScreen").then((m) => ({ default: m.PlayerScreen })));
const PublicDisplayScreen = lazy(() => import("@/features/publicDisplay/PublicDisplayScreen").then((m) => ({ default: m.PublicDisplayScreen })));

export function App() {
  return isTabletTrial
    ? <Suspense fallback={<p role="status">Opening the local tablet trial…</p>}><TabletTrial /></Suspense>
    : <NormalApp />;
}

function NormalApp() {
  const publicCode = readPublicDisplayCodeFromUrl();
  const joinCode = readJoinCodeFromUrl();

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
        <Suspense fallback={null}><PublicDisplayScreen code={publicCode} /></Suspense>
      </div>
    );
  }
  if (joinCode !== null) {
    return (
      <div className="app">
        <Suspense fallback={null}><PlayerScreen initialCode={joinCode} /></Suspense>
      </div>
    );
  }
  return <Suspense fallback={null}><StorytellerApp /></Suspense>;
}
