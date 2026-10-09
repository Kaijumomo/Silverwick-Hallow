// Phase 10G, Slice 4: Dawn Review + the shared unfinished-Night derivation +
// the Night dashboard modifier cleanup (PHASE10G Sections 14, 16).
// Traceability: 10G-AC-23..27, 10G-AC-32; proof areas 8 and 9.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GameScreen } from "@/features/game/GameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { CANONICAL_ABILITY_SEMANTICS } from "@/abilities/semantics";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { stripCommentsForGuard as stripComments } from "@/test/writerGuard";
import { deriveNightWork, stepResolved, unfinishedNightWork } from "./nightWork";
import type { StorytellerLobbyRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
const env = () => ({ script: setupScript, registry, semantics: CANONICAL_ABILITY_SEMANTICS });
// p0 monk, p1 ravenkeeper, p2 empath, p3 chef, p4 imp, p5 poisoner, p6 washerwoman
const ROLES = ["monk", "ravenkeeper", "empath", "chef", "imp", "poisoner", "washerwoman"];
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "night", day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const [index, p] of Object.values(g.players).entries()) { p.actualAlignment = registry.alignmentOf(p.actualRole); p.name = NAMES[index]!; }
  return g;
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  store.setState({ game: liveGame(), lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Marks every derived Night row and custom step done (store-level). */
function finishNight() {
  for (const step of deriveNightWork(game(), env()).steps) state().setNightStepStatus(game().day, step.stepKey, "done");
}
const advanceButton = () => screen.getByRole("button", { name: "→ Day" });

describe("10G-AC-23 / proof area 8: one shared derivation", () => {
  it("unfinished work is exactly the derived rows the Night Order shows as not resolved", () => {
    const work = deriveNightWork(game(), env());
    const unfinished = unfinishedNightWork(game(), work);
    expect(unfinished.rows.map((s) => s.stepKey)).toEqual(work.steps.filter((s) => !stepResolved(game(), s)).map((s) => s.stepKey));
    expect(unfinished.rows.length).toBeGreaterThan(0);
    // Resolving one row removes exactly that row.
    const first = unfinished.rows[0]!;
    state().setNightStepStatus(2, first.stepKey, "skipped");
    expect(unfinishedNightWork(game(), deriveNightWork(game(), env())).rows.map((s) => s.stepKey)).toEqual(unfinished.rows.slice(1).map((s) => s.stepKey));
  });

  it("covers custom steps and verified open triggers (Ravenkeeper died tonight)", () => {
    finishNight();
    state().setNightStepNotes(2, "manual:extra", "Check the Lunatic");
    state().recordDeath("p1");
    const unfinished = unfinishedNightWork(game(), deriveNightWork(game(), env()));
    expect(unfinished.customSteps.map((s) => s.stepKey)).toEqual(["manual:extra"]);
    expect(unfinished.triggers.map((t) => t.roleId)).toEqual(["ravenkeeper"]);
    expect(unfinished.total).toBe(2);
  });

  it("architecture: the Night Order and the game screen both read deriveNightWork, never restating the rules", () => {
    const panel = stripComments(readFileSync(resolve(__dirname, "NightOrderPanel.tsx"), "utf8"));
    const screenCode = stripComments(readFileSync(resolve(__dirname, "../game/GameScreen.tsx"), "utf8"));
    for (const code of [panel, screenCode]) {
      expect(code).toMatch(/deriveNightWork\(/);
      expect(code).not.toMatch(/computeNightOrder\(/);
      expect(code).not.toMatch(/triggerAbility\(\s*wake/);
    }
  });
});

describe("10G-AC-32: the Night dashboard query uses the active modifiers", () => {
  it("no blanket empty modifier set in the dashboard or the shared derivation", () => {
    for (const file of ["NightOrderPanel.tsx", "nightWork.ts"]) {
      expect(stripComments(readFileSync(resolve(__dirname, file), "utf8")), file).not.toMatch(/modifiers:\s*\[\s*\]/);
    }
  });

  it("a Fabled modifier in play reaches the dashboard's Rules Query", () => {
    const toy = { ...game(), fabled: ["toymaker"] };
    expect(deriveNightWork(toy, env()).query.modifierGate("imp", ["death"]).kind).not.toBe("clear");
    expect(deriveNightWork(game(), env()).query.modifierGate("imp", ["death"]).kind).toBe("clear");
  });
});

describe("10G-AC-24 / AC-25 / AC-26: Night -> Day", () => {
  it("with unfinished work, opens Dawn Review instead of advancing", () => {
    render(<GameScreen />);
    fireEvent.click(advanceButton());
    expect(game().phase).toBe("night");
    const dialog = screen.getByRole("dialog", { name: "Night 2 — before Day" });
    const rows = within(dialog).getByRole("region", { name: "Night steps not done or skipped" });
    expect(rows).toHaveTextContent("Monk — Alice");
    expect(within(dialog).getByRole("button", { name: "Review Night" })).toBeInTheDocument();
  });

  it("Continue to Day anyway advances with exactly the ordinary phase transition -- no acknowledgment is stored", () => {
    render(<GameScreen />);
    const before = game();
    fireEvent.click(advanceButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Continue to Day anyway" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(game()).toMatchObject({ phase: "day", day: 2 });
    expect(game().nightProgress).toEqual(before.nightProgress);
    expect(Object.keys(game()).sort()).toEqual([...new Set([...Object.keys(before), "voting"])].sort());
    expect(game().voting).toMatchObject({ day: 2, coverage: "known", rounds: [], activeRoundId: null, block: null });
    expect(state().undoStack).toHaveLength(1);
  });

  it("Review Night closes the review and reopens the modern Night guide", () => {
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Close Night panel" }));
    expect(screen.queryByRole("region", { name: "Night 2 guide" })).toBeNull();
    fireEvent.click(advanceButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Review Night" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Night 2 guide" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Night" })).toHaveAttribute("aria-expanded", "true");
    expect(game().phase).toBe("night");
  });

  it("Review Night still opens the existing phone Night dock", () => {
    vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ media: query, matches: true,
      addEventListener() {}, removeEventListener() {} })));
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Close night panel" }));
    expect(screen.queryByRole("region", { name: "Night 2 guide" })).toBeNull();
    fireEvent.click(advanceButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Review Night" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "Night 2 guide" })).toBeVisible();
    expect(game().phase).toBe("night");
  });

  it("a clean Night advances directly (low friction)", () => {
    finishNight();
    render(<GameScreen />);
    fireEvent.click(advanceButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(game().phase).toBe("day");
  });

  it("an open verified trigger alone still opens Dawn Review", () => {
    finishNight();
    state().recordDeath("p1");
    render(<GameScreen />);
    fireEvent.click(advanceButton());
    expect(within(screen.getByRole("dialog")).getByRole("region", { name: "Triggered abilities still open" })).toHaveTextContent("Ravenkeeper — Bob");
  });
});

describe("10G-AC-27 / proof area 9: Privacy Mode", () => {
  it("Night -> Day is disabled under Privacy Mode and tells the Storyteller why", () => {
    usePrivacyStore.setState({ enabled: true });
    render(<GameScreen />);
    const button = advanceButton();
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Turn off Privacy Mode to review the Night before continuing to Day");
    fireEvent.click(button);
    expect(game().phase).toBe("night");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an open Dawn Review is removed from the DOM when Privacy Mode turns on, and never reopens by itself", () => {
    render(<GameScreen />);
    fireEvent.click(advanceButton());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body).not.toHaveTextContent(/before Day|Night steps not done|Monk — Alice/);
    act(() => usePrivacyStore.getState().setEnabled(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(game().phase).toBe("night");
  });
});
