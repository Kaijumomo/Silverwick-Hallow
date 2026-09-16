import { useMemo, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { ScriptTabs } from "./ScriptTabs";
import { PlayerCountTable } from "./PlayerCountTable";
import { PlayerCountStepper } from "./PlayerCountStepper";
import { ImportPanel } from "./ImportPanel";
import { MIN_PLAYERS } from "@/data/setupCounts";
import type { Script } from "@/stores/types";
import { closeMultiplayerSession } from "@/firebase/storytellerSync";
import { lifecycleMessage } from "@/firebase/lifecycle";

/**
 * New Game plans the game (script + player count); it no longer builds the
 * character bag. That moves to the Grimoire Setup workspace, which the
 * Storyteller opens deliberately after entering the Grimoire -- Fill/Re-roll,
 * manual role selection, and Fabled/Lorics all live there now.
 */
export function NewGameScreen() {
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const setView = useStorytellerStore((s) => s.setView);
  const newGame = useStorytellerStore((s) => s.newGame);
  const customScripts = useStorytellerStore((s) => s.customScripts);
  const game = useStorytellerStore((s) => s.game);

  const firstBuiltinId = Object.keys(BUILTIN_SCRIPTS)[0] ?? "tb";

  const [selectedScriptId, setSelectedScriptId] = useState<string | "import">(
    firstBuiltinId
  );
  const [playerCount, setPlayerCount] = useState(MIN_PLAYERS);

  const allScripts: Record<string, Script> = useMemo(
    () => ({ ...BUILTIN_SCRIPTS, ...customScripts }),
    [customScripts]
  );

  const activeScript =
    selectedScriptId !== "import" ? allScripts[selectedScriptId] : undefined;

  const handleStart = async () => {
    if (starting) return;
    if (!activeScript) return;
    if (
      game &&
      !window.confirm("Start a new game? The current game will be discarded.")
    ) {
      return;
    }
    setStarting(true);
    setStartError(null);
    try {
      await closeMultiplayerSession();
      newGame(activeScript.id, { plannedPlayerCount: playerCount });
    } catch (error) { setStartError(lifecycleMessage(error)); }
    finally { setStarting(false); }
  };

  return (
    <div className="ng-screen">
      <header className="ng-header">
        <button
          className="btn btn-sm ng-back-btn"
          onClick={() => setView("home")}
        >
          ← Home
        </button>
        <h1 className="ng-title">New Game</h1>
      </header>

      <div className="ng-body">
        <div className="ng-left">
          <section className="ng-section">
            <h2 className="ng-section-title">Script</h2>
            <ScriptTabs
              customScripts={customScripts}
              selectedId={selectedScriptId}
              onSelect={setSelectedScriptId}
            />
            {selectedScriptId === "import" && (
              <ImportPanel
                onImported={(script) => setSelectedScriptId(script.id)}
              />
            )}
          </section>

          <section className="ng-section">
            <h2 className="ng-section-title">Players</h2>
            <PlayerCountStepper value={playerCount} onChange={setPlayerCount} />
            <PlayerCountTable
              selected={playerCount}
              onSelect={setPlayerCount}
            />
          </section>
        </div>
      </div>

      {/* Bottom action bar */}
      <footer className="ng-footer">
        {startError && <p role="alert">{startError}</p>}
        <button className="btn" onClick={() => setView("home")}>
          Cancel
        </button>
        <button
          className="btn btn-gold ng-start-btn"
          disabled={!activeScript || starting}
          onClick={handleStart}
        >
          Create setup
          {activeScript && (
            <span className="ng-start-meta">
              {" "}· {activeScript.name} · {playerCount} players
            </span>
          )}
        </button>
      </footer>
    </div>
  );
}
