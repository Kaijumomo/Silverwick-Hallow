import { useMemo, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { listOfficialRoles } from "@/data/officialRoles";
import { Almanac } from "@/features/almanac/Almanac";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import { getConfigSource } from "@/firebase/config";
import { normaliseCode } from "@/firebase/lobby";

export function HomeScreen() {
  const game = useStorytellerStore((s) => s.game);
  const setView = useStorytellerStore((s) => s.setView);

  const [almanacOpen, setAlmanacOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const configSource = getConfigSource();

  const officialRoles = useMemo(() => listOfficialRoles(), []);

  return (
    <div className="home">
      {configSource !== "env" && (
        <button
          className="btn btn-sm home-gear-btn"
          onClick={() => setConfigOpen(true)}
          aria-label={
            configSource === "localStorage"
              ? "Reconfigure Firebase"
              : "Configure Firebase"
          }
          title={
            configSource === "localStorage"
              ? "Reconfigure Firebase"
              : "Configure Firebase"
          }
        >
          ⚙
        </button>
      )}

      <h1 className="home-title">Silverwick Hallow</h1>
      <p className="home-subtitle">
        An unofficial table-side grimoire for in-person social deduction. Where
        silver lanterns burn low, and every whisper leaves a mark.
      </p>

      <div className="home-actions">
        {game && game.phase !== "ended" && (
          <button className="btn btn-gold" onClick={() => setView("game")}>
            Continue current game ({Object.keys(game.players).length} players)
          </button>
        )}
        {/* Phase 10G (Section 18): a finished game stays reviewable until
            New Game explicitly replaces it. */}
        {game && game.phase === "ended" && (
          <button className="btn" onClick={() => setView("game")}>
            Review finished game
          </button>
        )}

        <button className="btn btn-gold" onClick={() => setView("newgame")}>
          New Game
        </button>

        <button className="btn" onClick={() => setAlmanacOpen(true)}>
          Browse Characters
        </button>

        <a className="btn home-player-link" href="?join=">
          Join Lobby
        </a>

        <button
          className="btn"
          onClick={() => {
            const raw = window.prompt("Lobby code for public display?");
            const code = raw ? normaliseCode(raw) : null;
            if (code) {
              window.location.search = `?display=public&code=${encodeURIComponent(code)}`;
            }
          }}
        >
          Open Public Display
        </button>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {almanacOpen && (
        <Almanac
          title="Character library — all official roles"
          roles={officialRoles}
          onClose={() => setAlmanacOpen(false)}
        />
      )}
      {configOpen && (
        <FirebaseConfigDialog
          onClose={() => setConfigOpen(false)}
          onSaved={() => {
            setConfigOpen(false);
            setToast("Firebase configured");
            window.setTimeout(() => setToast(null), 2500);
          }}
        />
      )}
    </div>
  );
}
