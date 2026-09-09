import { useMemo, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { ScriptTabs } from "./ScriptTabs";
import { PlayerCountTable } from "./PlayerCountTable";
import { PlayerCountStepper } from "./PlayerCountStepper";
import { RolePickerPanel } from "./RolePickerPanel";
import { ImportPanel } from "./ImportPanel";
import { MIN_PLAYERS } from "@/data/setupCounts";
import type { RoleId, Script } from "@/stores/types";
import { closeMultiplayerSession } from "@/firebase/storytellerSync";
import { lifecycleMessage } from "@/firebase/lifecycle";

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
  const [rolePool, setRolePool] = useState<RoleId[]>([]);
  const [plannedFabled, setPlannedFabled] = useState<RoleId[]>([]);
  const [plannedLorics, setPlannedLorics] = useState<RoleId[]>([]);

  const allScripts: Record<string, Script> = useMemo(
    () => ({ ...BUILTIN_SCRIPTS, ...customScripts }),
    [customScripts]
  );

  const activeScript =
    selectedScriptId !== "import" ? allScripts[selectedScriptId] : undefined;

  const handleSelectScript = (id: string | "import") => {
    setSelectedScriptId(id);
    setRolePool([]);
    setPlannedFabled([]);
    setPlannedLorics([]);
  };

  const toggleRole = (id: RoleId) => {
    setRolePool((prev) =>
      prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]
    );
  };

  const toggleFabled = (id: RoleId) => {
    setPlannedFabled((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  };

  const toggleLoric = (id: RoleId) => {
    setPlannedLorics((prev) =>
      prev.includes(id) ? prev.filter((l) => l !== id) : [...prev, id]
    );
  };

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
      newGame(activeScript.id, {
      plannedPlayerCount: playerCount,
      plannedRoles: rolePool,
      plannedFabled,
      plannedLorics,
      });
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
        {/* Left column: script tabs + player count */}
        <div className="ng-left">
          <section className="ng-section">
            <h2 className="ng-section-title">Script</h2>
            <ScriptTabs
              customScripts={customScripts}
              selectedId={selectedScriptId}
              onSelect={handleSelectScript}
            />
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

        {/* Right column: character grid or import panel */}
        <div className="ng-right">
          {selectedScriptId === "import" ? (
            <section className="ng-section">
              <h2 className="ng-section-title">Import script</h2>
              <ImportPanel
                onImported={(script) => {
                  handleSelectScript(script.id);
                }}
              />
            </section>
          ) : activeScript ? (
            <section className="ng-section">
              <h2 className="ng-section-title">
                {activeScript.name} · pick roles{" "}
                <span className="ng-section-hint">(optional)</span>
              </h2>
              <RolePickerPanel
                scriptCharacters={activeScript.characters}
                rolePool={rolePool}
                plannedFabled={plannedFabled}
                plannedLorics={plannedLorics}
                plannedPlayerCount={playerCount}
                onToggleRole={toggleRole}
                onToggleFabled={toggleFabled}
                onToggleLoric={toggleLoric}
              />
            </section>
          ) : null}
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
              {rolePool.length > 0 && ` · ${rolePool.length} roles in pool`}
            </span>
          )}
        </button>
      </footer>
    </div>
  );
}
