// Phase 10G, Slice 5: final Grimoire integration (PHASE10G Section 15).
// Traceability: 10G-AC-28..31; proof area 9.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GameScreen } from "@/features/game/GameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { buildRegistry } from "@/data/roleRegistry";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { PIT_HAG_ARBITRARY_DEATHS, TOYMAKER_DEMON_SKIP_OCCURRED } from "@/stores/gameRuleFacts";
import { abilityUsedMarker, actualAlignmentMarker } from "./tokenMarkers";
import type { StorytellerLobbyRecord, STPlayerRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const registry = buildRegistry(setupScript);
// p0 chef, p1 imp, p2 empath, p3 monk, p4 poisoner, p5 saint, p6 washerwoman
const ROLES = ["chef", "imp", "empath", "monk", "poisoner", "saint", "washerwoman"];
const NAMES = ["Alice", "Bob", "Carol", "Dave", "Eve", "Finn", "Gail"];

function liveGame(over: Partial<StorytellerLobbyRecord> = {}): StorytellerLobbyRecord {
  const g = setupGame(ROLES, { phase: "day", day: 2, setupRolesDealt: true, setupRolesRevealed: true, ...over });
  for (const [index, p] of Object.values(g.players).entries()) { p.actualAlignment = registry.alignmentOf(p.actualRole); p.name = NAMES[index]!; }
  return g;
}
const patch = (id: string, value: Partial<STPlayerRecord>) =>
  store.setState({ game: { ...game(), players: { ...game().players, [id]: { ...game().players[id]!, ...value } } } });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  store.setState({ game: liveGame(), lobby: null, undoStack: [], localSeq: 0, customScripts: { [setupScript.id]: setupScript }, selectedPlayerId: null, view: "game" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const token = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}, seat`) });
const openRules = () => {
  fireEvent.click(screen.getByRole("button", { name: "Info" }));
  fireEvent.click(screen.getByText("Game rules & modifiers"));
};

describe("10G-AC-28: the ability-used marker", () => {
  it("true -> exactly one concise marker; false -> none", () => {
    expect(abilityUsedMarker({ abilityUsed: false })).toBeNull();
    patch("p0", { abilityUsed: true });
    render(<GameScreen />);
    expect(document.querySelectorAll('[data-token-marker="abilityUsed"]')).toHaveLength(1);
    expect(within(token("Alice")).getByText("Ability used")).toBeInTheDocument();
    expect(token("Alice")).toHaveAccessibleName(/ability used/);
    expect(within(token("Bob")).queryByText("Ability used")).toBeNull();
  });
});

describe("10G-AC-29: the Actual Alignment marker", () => {
  it("ordinary: only an EXCEPTION to the Role's ordinary alignment is marked; perception is never substituted", () => {
    expect(actualAlignmentMarker({ isTraveler: false, actualRole: "chef", actualAlignment: "good" }, registry)).toBeNull();
    expect(actualAlignmentMarker({ isTraveler: false, actualRole: "chef", actualAlignment: "evil" }, registry)).toMatchObject({ text: "Actually evil" });
    expect(actualAlignmentMarker({ isTraveler: false, actualRole: "imp", actualAlignment: "good" }, registry)).toMatchObject({ text: "Actually good" });
    expect(actualAlignmentMarker({ isTraveler: false, actualRole: "chef" }, registry)).toBeNull();
    patch("p0", { actualAlignment: "evil" });
    patch("p2", { shownAlignment: "evil" }); // perception only: no marker
    render(<GameScreen />);
    expect(within(token("Alice")).getByText("Actually evil")).toBeInTheDocument();
    expect(within(token("Carol")).queryByText(/Actually/)).toBeNull();
    expect(within(token("Bob")).queryByText(/Actually/)).toBeNull();
  });

  it("Traveler: a resolved Actual Alignment is shown directly; unresolved shows nothing", () => {
    expect(actualAlignmentMarker({ isTraveler: true, actualRole: "gunslinger", actualAlignment: "evil" }, registry)).toMatchObject({ text: "Evil" });
    expect(actualAlignmentMarker({ isTraveler: true, actualRole: "gunslinger" }, registry)).toBeNull();
  });
});

describe("10G-AC-30: the global Rule-Fact surface", () => {
  it("shows Toymaker skip required, records it through the Rule Fact seam, then shows it satisfied", () => {
    store.setState({ game: { ...game(), fabled: ["toymaker"] } });
    render(<GameScreen />);
    openRules();
    const strip = screen.getByRole("region", { name: "Game rule facts" });
    expect(strip).toHaveTextContent("Toymaker skip is still required");
    fireEvent.click(within(strip).getByRole("button", { name: "Record Demon skip" }));
    expect(game().gameRuleFacts.map((f) => f.type)).toEqual([TOYMAKER_DEMON_SKIP_OCCURRED]);
    expect(game().players.p1!.reminders).toEqual([]);
    expect(screen.getByRole("region", { name: "Game rule facts" })).toHaveTextContent("Toymaker skip has been satisfied");
    fireEvent.click(screen.getByRole("button", { name: "Remove the recorded Toymaker skip (correction)" }));
    expect(game().gameRuleFacts).toEqual([]);
    expect(game().history.at(-1)).toMatchObject({ category: "gameRuleFact", ruleFactOperation: "remove", correction: true });
  });

  it("shows active arbitrary deaths with their expiry; a manual Pit-Hag can record them at Night", () => {
    store.setState({ game: liveGame({ phase: "night" }) });
    render(<GameScreen />);
    openRules();
    fireEvent.click(screen.getByRole("button", { name: "Record arbitrary deaths tonight" }));
    expect(screen.getByRole("region", { name: "Game rule facts" })).toHaveTextContent("Arbitrary deaths are active tonight (until Day 2)");
    expect(game().gameRuleFacts.map((f) => f.type)).toEqual([PIT_HAG_ARBITRARY_DEATHS]);
  });

  it("is absent when nothing is relevant (a Day with no Toymaker and no fact)", () => {
    render(<GameScreen />);
    openRules();
    expect(screen.queryByRole("region", { name: "Game rule facts" })).toBeNull();
  });
});

describe("10G-AC-31 / proof area 9: Privacy Mode removes every new private indicator from the DOM", () => {
  it("markers and the Rule-Fact surface disappear (DOM absence) and the game is untouched", () => {
    patch("p0", { abilityUsed: true, actualAlignment: "evil" });
    store.setState({ game: { ...game(), fabled: ["toymaker"], gameRuleFacts: [{ type: TOYMAKER_DEMON_SKIP_OCCURRED, recordedAt: { phase: "night", day: 2 } }] } });
    render(<GameScreen />);
    expect(document.querySelectorAll("[data-token-marker]").length).toBe(2);
    openRules();
    const before = game();
    act(() => usePrivacyStore.getState().setEnabled(true));
    expect(document.querySelectorAll("[data-token-marker]")).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Game rule facts" })).toBeNull();
    expect(document.body).not.toHaveTextContent(/Ability used|Actually evil|Toymaker skip|Game rule facts/);
    expect(screen.queryByRole("button", { name: "Activity" })).toBeNull();
    expect(game()).toBe(before);
  });
});
