import { useEffect, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { GameScreen } from "@/features/game/GameScreen";
import { HomeScreen } from "@/features/home/HomeScreen";
import { NewGameScreen } from "@/features/newgame/NewGameScreen";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { seedTabletTrial, seedShellDesignTrial, type TrialSize } from "./seed";
import "./trial.css";

export default function TabletTrial() {
  const game = useStorytellerStore(s => s.game);
  const view = useStorytellerStore(s => s.view);
  const [error, setError] = useState<string | null>(null);
  const [resetSize, setResetSize] = useState<TrialSize | "design" | null>(null);
  function reset(size: TrialSize | "design") {
    try { if (size === "design") seedShellDesignTrial(); else seedTabletTrial(size); setError(null); setResetSize(null); }
    catch (problem) { setError(problem instanceof Error ? problem.message : "The sample table could not open."); }
  }
  useEffect(() => {
    // Reads current state so Strict Mode cannot seed twice.
    if (!useStorytellerStore.getState().game) reset(15);
  }, []);
  return <div className="tablet-trial">
    <div className="tablet-trial-banner" aria-label="Local tablet trial">
      <span><strong>Local trial</strong><span className="tablet-trial-hint"> · Saved on this device · Online lobbies disabled</span></span>
      <div className="tablet-trial-actions">
        <button onClick={() => setResetSize("design")}>Design 20</button>
        <button onClick={() => setResetSize(15)}>Reset 15</button>
        <button onClick={() => setResetSize(20)}>Reset 20</button>
      </div>
    </div>
    {error && <div role="alert" className="tablet-trial-error">{error}</div>}
    {view === "home" ? <HomeScreen /> : view === "newgame" ? <NewGameScreen /> : game ? <GameScreen /> : <p role="status">Preparing the practice table…</p>}
    {resetSize !== null && <ConfirmDialog title="Reset the practice table?" danger
      confirmLabel={`Reset ${resetSize}`} cancelLabel="Keep playing"
      onConfirm={() => reset(resetSize)} onCancel={() => setResetSize(null)}>
        <p>Replace this device’s trial with {resetSize === "design" ? "the 20-player design table on Night 2" : `${resetSize} players on Day 2`}. Your trial votes and corrections will be cleared.</p>
        {resetSize !== "design" && <p>Alice is the Virgin; Bartholomew is the Pacifist. Cass has the Bureaucrat’s three votes. Hana has a dead vote; Ignatius has spent theirs.</p>}
    </ConfirmDialog>}
  </div>;
}
