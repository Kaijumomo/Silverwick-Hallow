import "../grimoire-v6.css";
import "./home-v6-pseudo.css";
import "./home-v6-keyframes.css";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { FirebaseConfigDialog } from "@/features/firebase/FirebaseConfigDialog";
import { getConfigSource } from "@/firebase/config";
import { canonicalJoin, normaliseCode } from "@/firebase/lobby";
import { ROOM_CODE_LENGTH } from "@/firebase/roomCode";
import { getBuiltinScript } from "@/data/scripts";
import { isTabletTrial, TABLET_TRIAL_OFFLINE_MESSAGE } from "@/config/trial";
import { useMediaQuery } from "@/components/useMediaQuery";
import type { RoleType, StorytellerLobbyRecord } from "@/stores/types";
import { HomeScreen } from "@/features/home/HomeScreen";
import { clearJoinPrefill, writeJoinPrefill } from "@/features/home/joinPrefill";
import { buildReferenceCategories, type ReferenceCategory } from "@/features/home/referenceCategories";
import { ReferenceOverlay } from "@/features/home/reference/ReferenceOverlay";
import { CAROUSEL_ORBIT, EDITION_LOGO, useLoadedArt } from "@/features/home/art";
import { useV6Ui } from "../v6Store";
import { startWizard } from "../setup/flow";
import { HomeBackdrop } from "./HomeBackdrop";
import { HomeV6View } from "./HomeV6View";

type HomePath = "storyteller" | "reference" | "player";

const PATHS: readonly [HomePath, string, string][] = [
  ["storyteller", "Storyteller", "Run the Grimoire and guide the night."],
  ["reference", "Character Reference", "Browse scripts and abilities."],
];
const NAME_MAX = 16;
const STAGE_W = 1480;
const STAGE_H = 924;

/** Only fields present on the saved game; nothing is invented. */
export function resumeSummary(game: StorytellerLobbyRecord, scriptName: string | undefined): string {
  const parts: string[] = [];
  if (scriptName) parts.push(scriptName);
  if (game.phase === "night") parts.push(`Night ${game.day}`);
  else if (game.phase === "day") parts.push(`Day ${game.day}`);
  else if (game.phase === "setup") parts.push("Setup");
  const n = Object.keys(game.players).length;
  parts.push(`${n} ${n === 1 ? "player" : "players"}`);
  return parts.join(" · ");
}

function useFit(): number {
  const read = () => Math.min(1.6, window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
  const [fit, setFit] = useState(read);
  useEffect(() => {
    const on = () => setFit(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return fit;
}

type Props = { navigate?: (url: string) => void };
const defaultNavigate = (url: string) => window.location.assign(url);

function HomeTablet({ navigate = defaultNavigate }: Props) {
  const game = useStorytellerStore((s) => s.game);
  const customScripts = useStorytellerStore((s) => s.customScripts);
  const setView = useStorytellerStore((s) => s.setView);
  const [path, setPath] = useState<HomePath>("storyteller");
  const [reference, setReference] = useState<ReferenceCategory | null>(null);
  const [referenceTeam, setReferenceTeam] = useState<RoleType | null>(null);
  const [name, setName] = useState("");
  // The tablet Home offers Storyteller and Character Reference (as designed); joining is by the invitation link or QR.
  const code = "";
  const [configOpen, setConfigOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fit = useFit();
  const configSource = getConfigSource();

  // A hand-off left behind by an abandoned join must never reach a later one.
  useEffect(() => { clearJoinPrefill(); }, []);

  const categories = useMemo(() => buildReferenceCategories(), []);
  const art = useLoadedArt([...CAROUSEL_ORBIT]);
  const scriptName = game ? (getBuiltinScript(game.scriptId) ?? customScripts?.[game.scriptId])?.name : undefined;

  const trimmed = name.trim();
  const normalised = normaliseCode(code);
  let valid = false;
  if (!isTabletTrial) {
    try { canonicalJoin(normalised, trimmed); valid = true; } catch { valid = false; }
  }

  const resumeRows = game
    ? [{
        title: game.phase === "ended" ? "Review finished game" : "Resume game",
        sub: resumeSummary(game, scriptName),
        go: (e?: { preventDefault?: () => void }) => {
          e?.preventDefault?.();
          useV6Ui.getState().set({ wiz: null });
          setView("game");
        },
      }]
    : [];

  const orbit = CAROUSEL_ORBIT.filter((src) => art.has(src));
  const vm = {
    homeBg: <HomeBackdrop />,
    oC: {
      isP: path === "player", isS: path === "storyteller", isR: path === "reference",
      paths: PATHS.map(([k, title, desc]) => ({
        title, desc, titleColor: path === k ? "#f0d590" : "rgba(234,220,184,.7)", arrowColor: path === k ? "#e0b96a" : "rgba(216,201,164,.3)",
        pick: () => setPath(k),
      })),
    },
    newGame: () => startWizard(),
    resumeRows,
    openDisplay: (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      if (isTabletTrial) { setToast(TABLET_TRIAL_OFFLINE_MESSAGE); return; }
      const raw = window.prompt("Lobby code for public display?");
      const target = raw ? normaliseCode(raw) : null;
      if (target) navigate(`?display=public&code=${encodeURIComponent(target)}`);
    },
    scriptsL: categories.filter((c) => c.id !== "carousel").map((c) => ({
      name: c.name, logo: EDITION_LOGO[c.id] ?? "", count: `${c.scriptCount} characters`, open: () => setReference(c),
    })),
    openCarousel: () => { const c = categories.find((x) => x.id === "carousel"); if (c) setReference(c); },
    carouselIcons: orbit.map((src, i) => {
      const a = (i / orbit.length) * Math.PI * 2 - Math.PI / 2;
      return { src, x: Math.round(64 + Math.cos(a) * 49 - 15), y: Math.round(64 + Math.sin(a) * 49 - 15) };
    }),
    nameD: name,
    onNameD: (e: { target: { value: string } }) => setName(e.target.value.replace(/[\r\n\t]/g, " ").slice(0, NAME_MAX)),
    codeCells: Array.from({ length: ROOM_CODE_LENGTH }, (_, i) => ({
      ch: normalised[i] ?? "", border: i === Math.min(normalised.length, ROOM_CODE_LENGTH - 1) ? "rgba(224,185,106,.6)" : "rgba(196,158,80,.2)",
    })),
    joinD: { opacity: valid ? 1 : 0.4, events: valid ? "auto" : "none", hint: trimmed ? `Signed, ${trimmed}` : "Sign the ledger to continue" },
    joinGo: (e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.();
      if (!valid) return;
      const joined = canonicalJoin(normalised, trimmed);
      // The name goes to sessionStorage only; the URL carries just the code.
      writeJoinPrefill(joined.name, joined.code);
      navigate(`?join=${encodeURIComponent(joined.code)}`);
    },
  };

  const root: CSSProperties & Record<"--home-fit", number> = { "--home-fit": fit };
  return (
    <main className="hv-root" style={root} data-path={path}>
      <HomeV6View vm={vm} />
      {configSource !== "env" && (
        <button className="btn btn-sm hv-gear" onClick={() => setConfigOpen(true)}
          aria-label={configSource === "localStorage" ? "Reconfigure Firebase" : "Configure Firebase"}
          title={configSource === "localStorage" ? "Reconfigure Firebase" : "Configure Firebase"}>⚙</button>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
      {reference && (
        <ReferenceOverlay category={reference} team={referenceTeam} onTeamChange={setReferenceTeam} onClose={() => setReference(null)} />
      )}
      {configOpen && (
        <FirebaseConfigDialog onClose={() => setConfigOpen(false)}
          onSaved={() => { setConfigOpen(false); setToast("Firebase configured"); window.setTimeout(() => setToast(null), 2500); }} />
      )}
    </main>
  );
}

/** Home (V2 design) on the tablet; the phone keeps its own player Home. */
export function HomeV6(props: Props) {
  const phone = useMediaQuery("(max-width: 760px)");
  return phone ? <HomeScreen {...props} /> : <HomeTablet {...props} />;
}
