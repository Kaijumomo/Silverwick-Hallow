import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { buildRS15 } from "@/test/representativeStates";
import { useStorytellerStore } from "@/stores/storytellerStore";
import { VotingProvider } from "@/features/voting/VotingWorkspace";
import { GrimoireV6Screen } from "@/features/grimoire-v6/GrimoireV6Screen";
import { closeShow, presentCharacter, presentSetup } from "@/features/grimoire-v6/info/actions";

/**
 * Diagnostic-only, no-game Reveal test page (branch package4-tablet-diag, never merged). Loaded by main.tsx in place of
 * <App/> (see revealRoute.ts), after main.tsx's usual stylesheet imports, so the cascade is the production one.
 * Mounts the real V2 Grimoire over a simulated 15-player table held in memory: no Firebase, no Authentication,
 * no StorytellerSession, nothing written to the device's saved game. The reveal buttons call the same
 * presentation commands the Info card uses, so the Reveal screen is the production one.
 *   ?panel=0   hide the test buttons        ?cycle=1   open and close the reveal automatically
 * and the usual ?diag=... and ?kb=... switches apply.
 */
buildRS15();
useStorytellerStore.getState().selectPlayer(null);

const REVEALS: Array<[string, () => string | undefined]> = [
  ["This Character", () => presentCharacter("This Character", "soldier")],
  ["You Are", () => presentCharacter("You Are", "washerwoman")],
  ["Minion info", () => presentSetup("minion")],
  ["Demon info", () => presentSetup("demon")],
];

function Panel() {
  const params = new URLSearchParams(location.search);
  const [open, setOpen] = useState(true);
  const [cycling, setCycling] = useState(params.get("cycle") === "1");
  const [opened, setOpened] = useState(0);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!cycling) return;
    let i = 0, stop = false;
    const run = () => {
      if (stop) return;
      const [, show] = REVEALS[i++ % REVEALS.length]!;
      setNote(show() ?? "");
      setOpened((n) => n + 1);
      setTimeout(() => { if (!stop) { closeShow(); setTimeout(run, 1200); } }, 4000);
    };
    run();
    return () => { stop = true; closeShow(); };
  }, [cycling]);
  if (params.get("panel") === "0") return null;
  const box: React.CSSProperties = { position: "fixed", left: 8, bottom: 8, zIndex: 2147483000, display: "flex", gap: 6, flexWrap: "wrap", maxWidth: "70vw", padding: 6, borderRadius: 8, background: "rgba(0,0,0,.8)", font: "12px system-ui" };
  const btn: React.CSSProperties = { minHeight: 36, padding: "0 10px", borderRadius: 6, border: "1px solid #666", background: "#222", color: "#eee", font: "inherit" };
  if (!open) return <div style={box}><button style={btn} onClick={() => setOpen(true)}>Diag</button></div>;
  return (
    <div style={box}>
      <span style={{ alignSelf: "center", color: "#9fe3a0" }}>Simulated data, no Firebase</span>
      {REVEALS.map(([label, show]) => <button key={label} style={btn} onClick={() => setNote(show() ?? "")}>{label}</button>)}
      <button style={btn} onClick={() => setCycling((c) => !c)}>{cycling ? "Stop cycle" : "Auto-cycle"}</button>
      <span style={{ alignSelf: "center", color: "#ccc" }}>opened {opened}{note ? ` · ${note}` : ""}</span>
      <button style={btn} onClick={() => setOpen(false)}>Hide</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <div className="app"><VotingProvider><GrimoireV6Screen /></VotingProvider></div>
    <Panel />
  </React.StrictMode>,
);
