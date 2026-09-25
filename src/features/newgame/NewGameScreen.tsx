import { useMemo, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { BUILTIN_SCRIPTS } from "@/data/scripts";
import { ScriptTabs } from "./ScriptTabs";
import { PlayerCountTable } from "./PlayerCountTable";
import { PlayerCountStepper } from "./PlayerCountStepper";
import { ImportPanel } from "./ImportPanel";
import { MIN_PLAYERS, MAX_TOTAL_PLAYERS, minTravelersForTotal, maxTravelersForTotal, clampTravelersForTotal } from "@/data/setupCounts";
import type { Script } from "@/stores/types";
import { closeMultiplayerSession, useSessionRuntime } from "@/firebase/storytellerSync";
import { lifecycleMessage } from "@/firebase/lifecycle";

/**
 * New Game plans the game (script + total participants + intended
 * Travelers); it no longer builds the character bag. That moves to the
 * Grimoire Setup workspace, which the Storyteller opens deliberately after
 * entering the Grimoire -- Fill/Re-roll, manual role selection, and
 * Fabled/Lorics all live there now.
 *
 * Ordinary players = total participants - Travelers (Phase 9 Setup
 * finalization B4). The Storyteller does not choose which seat is the
 * Traveler here -- that is decided later inside the Grimoire. This screen
 * only plans totals: total planned seats and an intended Traveler count,
 * both cross-clamped so ordinary always stays within [5, 15].
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
  const [totalCount, setTotalCount] = useState(MIN_PLAYERS);
  const [travelerCount, setTravelerCount] = useState(0);
  const ordinaryCount = totalCount - travelerCount;

  const travelerMin = minTravelersForTotal(totalCount);
  const travelerMax = maxTravelersForTotal(totalCount);

  const handleTotalChange = (nextTotal: number) => {
    setTotalCount(nextTotal);
    setTravelerCount((current) => clampTravelersForTotal(nextTotal, current));
  };

  const handleTravelerChange = (nextTravelers: number) => {
    setTravelerCount(clampTravelersForTotal(totalCount, nextTravelers));
  };

  const handleOrdinarySelect = (nextOrdinary: number) => {
    // Phase 9 Setup finalization (FINAL SETUP INTEGRATION REVISION, Section
    // 4): the composition table must obey the same 20-total cap as the
    // stepper. Selecting an ordinary count never changes the ordinary count
    // itself -- if adding the current Travelers to it would exceed the cap,
    // the Traveler count reduces to the largest legal value instead (e.g.
    // 15 Travelers + click "15 ordinary" -> 15 ordinary + 5 Travelers = 20,
    // never 30).
    const cappedTotal = Math.min(nextOrdinary + travelerCount, MAX_TOTAL_PLAYERS);
    setTotalCount(cappedTotal);
    setTravelerCount(Math.max(0, cappedTotal - nextOrdinary));
  };

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
      newGame(activeScript.id, { plannedPlayerCount: totalCount, plannedTravelerCount: travelerCount });
    } catch (error) {
      // closeMultiplayerSession recorded the classified close failure (and
      // any recovery option) in the connection status shown above.
      setStartError(useSessionRuntime.getState().errors.close ?? lifecycleMessage(error));
    }
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
            <PlayerCountStepper
              value={totalCount}
              onChange={handleTotalChange}
              min={MIN_PLAYERS}
              max={MAX_TOTAL_PLAYERS}
              label="players"
            />
            <div className="ng-traveler-stepper">
              <PlayerCountStepper
                value={travelerCount}
                onChange={handleTravelerChange}
                min={travelerMin}
                max={travelerMax}
                label="Travelers"
                decrementLabel="Fewer Travelers"
                incrementLabel="More Travelers"
              />
            </div>
            <p className="ng-ordinary-line">Ordinary: <strong>{ordinaryCount}</strong></p>
            <p className="ng-ordinary-note">
              Composition is based on ordinary players. Travellers are separate.
            </p>
            <PlayerCountTable
              selected={ordinaryCount}
              onSelect={handleOrdinarySelect}
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
              {" "}· {activeScript.name} · {totalCount} players
              {travelerCount > 0 ? ` (${travelerCount} Traveler${travelerCount === 1 ? "" : "s"})` : ""}
            </span>
          )}
        </button>
      </footer>
    </div>
  );
}
