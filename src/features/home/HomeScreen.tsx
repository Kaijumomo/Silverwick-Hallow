import { useEffect, useMemo, useRef, useState } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { Almanac } from "@/features/almanac/Almanac";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import { getConfigSource } from "@/firebase/config";
import { canonicalJoin, normaliseCode } from "@/firebase/lobby";
import { ROOM_CODE_LENGTH } from "@/firebase/roomCode";
import { getBuiltinScript } from "@/data/scripts";
import { isTabletTrial, TABLET_TRIAL_OFFLINE_MESSAGE } from "@/config/trial";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { clearJoinPrefill, writeJoinPrefill } from "./joinPrefill";
import { buildReferenceCategories, type ReferenceCategory } from "./referenceCategories";

type HomePath = "player" | "storyteller" | "reference";

const PATHS: { id: HomePath; title: string; blurb: string }[] = [
  { id: "player", title: "Player", blurb: "Join a game with your name and its code." },
  { id: "storyteller", title: "Storyteller", blurb: "Run the Grimoire and guide the night." },
  { id: "reference", title: "Character Reference", blurb: "Browse scripts and abilities." },
];

const NAME_MAX = 20;

// The panel heading lives beside the left column's title block, and the panel
// body starts level with the path list, so the two columns read as one page.
const PANEL_HEADS: Record<HomePath, { title: string; sub: string }> = {
  player: { title: "Join the town", sub: "Give your name and the Storyteller\u2019s code." },
  storyteller: { title: "The Grimoire", sub: "The town awaits its Storyteller." },
  reference: { title: "Character Reference", sub: "Browse scripts and abilities." },
};

type Props = {
  /** Page navigation; injectable for tests. Defaults to a normal page load. */
  navigate?: (url: string) => void;
};

function defaultNavigate(url: string) {
  window.location.assign(url);
}

/** Only fields present on the saved game; nothing is invented. */
function resumeSummary(game: StorytellerLobbyRecord, scriptName: string | undefined): string {
  const parts: string[] = [];
  if (scriptName) parts.push(scriptName);
  if (game.phase === "night") parts.push(`Night ${game.day}`);
  else if (game.phase === "day") parts.push(`Day ${game.day}`);
  else if (game.phase === "setup") parts.push("Setup");
  const n = Object.keys(game.players).length;
  parts.push(`${n} ${n === 1 ? "player" : "players"}`);
  return parts.join(" · ");
}

export function HomeScreen({ navigate = defaultNavigate }: Props) {
  const game = useStorytellerStore((s) => s.game);
  const customScripts = useStorytellerStore((s) => s.customScripts);
  const setView = useStorytellerStore((s) => s.setView);

  const unfinished = !!game && game.phase !== "ended";
  const finished = !!game && game.phase === "ended";

  // Storyteller-first (tablet is the primary device); the design's default was Player.
  const [path, setPath] = useState<HomePath>("storyteller");
  const [reference, setReference] = useState<ReferenceCategory | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const configSource = getConfigSource();

  // A hand-off left behind by an abandoned join must never reach a later one.
  useEffect(() => {
    clearJoinPrefill();
  }, []);

  const categories = useMemo(() => buildReferenceCategories(), []);

  const scriptName = game
    ? (getBuiltinScript(game.scriptId) ?? customScripts?.[game.scriptId])?.name
    : undefined;

  return (
    <main className="home-door" data-path={path}>
      {configSource !== "env" && (
        <button
          className="btn btn-sm home-gear-btn"
          onClick={() => setConfigOpen(true)}
          aria-label={configSource === "localStorage" ? "Reconfigure Firebase" : "Configure Firebase"}
          title={configSource === "localStorage" ? "Reconfigure Firebase" : "Configure Firebase"}
        >
          ⚙
        </button>
      )}
      <div className="home-door-glow" aria-hidden="true" />

      <div className="home-door-left">
        <header className="home-door-head">
          <p className="home-door-kicker">A Blood on the Clocktower companion</p>
          <h1 className="home-door-title">
            Silverwick <span>Hollow</span>
          </h1>
          <p className="home-door-tagline">Light the candles. The town is gathering.</p>
        </header>
        <nav className="home-door-paths" aria-label="Choose how to begin">
          {PATHS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="home-door-path"
              aria-pressed={path === p.id}
              onClick={() => setPath(p.id)}
            >
              <span className="home-door-path-text">
                <span className="home-door-path-title">{p.title}</span>
                <span className="home-door-path-blurb">{p.blurb}</span>
              </span>
              <span className="home-door-chevron" aria-hidden="true">›</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="home-door-right">
        <Ornament />
        <div className="home-door-mid" aria-live="polite">
        <div className="home-door-panelhead">
          <h2 id="home-panel-h" className="home-door-heading">{PANEL_HEADS[path].title}</h2>
          <p className="home-door-sub">
            {isTabletTrial && path === "player" ? TABLET_TRIAL_OFFLINE_MESSAGE : PANEL_HEADS[path].sub}
          </p>
        </div>
        {path === "player" && <PlayerPanel navigate={navigate} />}
        {path === "storyteller" && (
          <section className="home-door-panel" aria-labelledby="home-panel-h">
            <ul className="home-door-rows">
              <li>
                <button className="home-door-row home-door-row-primary" aria-label="New Game" aria-describedby="home-new-sub" onClick={() => setView("newgame")}>
                  <span className="home-door-row-text">
                    <span className="home-door-row-title">New Game</span>
                    <span className="home-door-row-sub" id="home-new-sub">Choose a script and gather the town</span>
                  </span>
                  <span className="home-door-chevron" aria-hidden="true">›</span>
                </button>
              </li>
              {unfinished && game && (
                <li>
                  <button className="home-door-row" aria-label="Resume Game" aria-describedby="home-resume-sub" onClick={() => setView("game")}>
                    <span className="home-door-row-text">
                      <span className="home-door-row-title">Resume Game</span>
                      <span className="home-door-row-sub" id="home-resume-sub">{resumeSummary(game, scriptName)}</span>
                    </span>
                    <span className="home-door-chevron" aria-hidden="true">›</span>
                  </button>
                </li>
              )}
              {/* Phase 10G (Section 18): a finished game stays reviewable until
                  New Game explicitly replaces it. */}
              {finished && game && (
                <li>
                  <button className="home-door-row" aria-label="Review finished game" aria-describedby="home-review-sub" onClick={() => setView("game")}>
                    <span className="home-door-row-text">
                      <span className="home-door-row-title">Review finished game</span>
                      <span className="home-door-row-sub" id="home-review-sub">{resumeSummary(game, scriptName)}</span>
                    </span>
                    <span className="home-door-chevron" aria-hidden="true">›</span>
                  </button>
                </li>
              )}
              <li>
                <button
                  className="home-door-row home-door-row-secondary"
                  disabled={isTabletTrial}
                  aria-label="Public Display"
                  aria-describedby="home-display-sub"
                  onClick={() => {
                    const raw = window.prompt("Lobby code for public display?");
                    const code = raw ? normaliseCode(raw) : null;
                    if (code) navigate(`?display=public&code=${encodeURIComponent(code)}`);
                  }}
                >
                  <span className="home-door-row-text">
                    <span className="home-door-row-title">Public Display</span>
                    <span className="home-door-row-sub" id="home-display-sub">
                      {isTabletTrial ? TABLET_TRIAL_OFFLINE_MESSAGE : "Show the town on a shared screen"}
                    </span>
                  </span>
                  <span className="home-door-chevron" aria-hidden="true">›</span>
                </button>
              </li>
            </ul>
          </section>
        )}
        {path === "reference" && (
          <section className="home-door-panel home-door-panel-wide" aria-labelledby="home-panel-h">
            <ul className="home-door-tiles">
              {categories.map((c) => (
                <li key={c.id}>
                  <button className="home-door-tile" onClick={() => setReference(c)} data-category={c.id}>
                    {/* Temporary typographic mark: approved edition artwork is
                        not yet in the repo (see Package 1 asset inventory). */}
                    <span className="home-door-mark" data-temporary-art="true" aria-hidden="true">
                      {c.mark}
                    </span>
                    <span className="home-door-tile-name">{c.name}</span>
                    <span className="home-door-tile-count">
                      {c.id === "carousel" ? (
                        <>
                          {c.roles.length} characters
                          <br />
                          Experimental
                        </>
                      ) : (
                        <>
                          {c.scriptCount} characters
                          <br />+ {c.travelerCount} Travellers
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        </div>
        <Ornament />
      </div>

      <p className="home-door-disclaimer">
        Unofficial fan companion. Not affiliated with The Pandemonium Institute.
      </p>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}

      {reference && (
        <Almanac
          title={`Character reference — ${reference.name}`}
          roles={reference.roles}
          onClose={() => setReference(null)}
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
    </main>
  );
}

function Ornament() {
  return (
    <div className="home-door-ornament" aria-hidden="true">
      <i />
      <b />
      <i />
    </div>
  );
}

function PlayerPanel({ navigate }: { navigate: (url: string) => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const normalised = normaliseCode(code);
  let valid = false;
  if (!isTabletTrial) {
    try {
      canonicalJoin(normalised, trimmed);
      valid = true;
    } catch {
      valid = false;
    }
  }

  const cells = Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => normalised[i] ?? "");
  const activeCell = Math.min(normalised.length, ROOM_CODE_LENGTH - 1);

  const enter = () => {
    if (!valid) return;
    try {
      const joined = canonicalJoin(normalised, trimmed);
      // The name goes to sessionStorage only; the URL carries just the code.
      writeJoinPrefill(joined.name, joined.code);
      navigate(`?join=${encodeURIComponent(joined.code)}`);
    } catch {
      setError("Check your name and the eight-character code.");
    }
  };

  if (isTabletTrial) {
    return (
      <section className="home-door-panel" aria-labelledby="home-panel-h" />
    );
  }

  return (
    <form
      className="home-door-panel"
      aria-labelledby="home-panel-h"
      onSubmit={(e) => {
        e.preventDefault();
        enter();
      }}
    >
      <label className="home-door-field">
        <span className="home-door-label">Your name</span>
        <input
          className="home-door-name"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          placeholder="Write it here"
          onChange={(e) => {
            setName(e.target.value.replace(/[\r\n\t]/g, " "));
            setError(null);
          }}
        />
      </label>

      <div className="home-door-field home-door-field-code">
        <label className="home-door-label" htmlFor="home-code">Game code</label>
        <div className="home-door-code" onClick={() => codeInput.current?.focus()}>
          {cells.map((ch, i) => (
            <span
              key={i}
              className="home-door-cell"
              aria-hidden="true"
              data-active={i === activeCell ? "true" : undefined}
            >
              {ch}
            </span>
          ))}
          <input
            id="home-code"
            ref={codeInput}
            className="home-door-code-input"
            value={code}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Game code, eight characters"
            onChange={(e) => {
              // Hyphens are tolerated (XXXX-XXXX); anything else non-alphanumeric is dropped.
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, ROOM_CODE_LENGTH + 1));
              setError(null);
            }}
          />
        </div>
      </div>

      <div className="home-door-join">
        <button type="submit" className="home-door-cta" disabled={!valid}>
          Enter the Town
        </button>
        <p className="home-door-hint" role={error ? "alert" : undefined}>
          {error ?? (trimmed ? `Signed, ${trimmed}` : "Sign the ledger to continue")}
        </p>
      </div>
    </form>
  );
}
