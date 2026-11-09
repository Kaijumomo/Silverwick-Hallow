// Phase 10F Slice 7: UI scenarios for the PRODUCTION proof-character semantics (progressive disclosure,
// follow-up choices by origin, one commit).
//
// Package 4: these now run through the unified Grimoire's Night card and the ability workspace it embeds.
// The Night Order rows, the inline simple flow and the Player Drawer entries are retired; the Poisoner, Drunk,
// Fortune Teller, Ravenkeeper and Slayer scenarios live in grimoire-v6/night/port and grimoire-v6/day.
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NightScreen, continueAction, resetNightUi, selectNightStep, workspace } from "@/features/grimoire-v6/night/port/v6Night";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useTargetPicker } from "./abilityUi";
import { proofGame, proofScript } from "@/test/proofFixtures";
import type { RoleId, StorytellerLobbyRecord } from "@/stores/types";
import { choose } from "@/test/pickers";

const state = () => store.getState();
const game = () => state().game!;

function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript }, selectedPlayerId: null });
  resetNightUi();
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.setState({ active: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const named = (roles: RoleId[], phase: "night" | "day" = "night", day = 2) => proofGame(roles, phase, day);

describe("Al-Hadikhia -- ordered choices in the workspace", () => {
  const AL = ["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];

  it("three ordered selects; each live/die choice appears in turn; the answer keeps 1 -> 2 -> 3", () => {
    open(named(AL));
    render(<NightScreen />);
    selectNightStep("p0");
    continueAction();
    const ws = workspace();
    const label = "The 3 players chosen, in order (or nobody)";
    choose(`${label} 1`, "p3", ws);
    choose(`${label} 2`, "p1", ws);
    choose(`${label} 3`, "p4", ws);
    const live = (name: string) => within(within(ws).getByRole("radiogroup", { name })).getByRole("radio", { name: "Yes" });
    expect(within(ws).queryByRole("radiogroup", { name: /^2\./ })).toBeNull();
    fireEvent.click(live("1. Player 3 chooses to LIVE (No: chooses to die)"));
    fireEvent.click(live("2. Player 1 chooses to LIVE (No: chooses to die)"));
    fireEvent.click(live("3. Player 4 chooses to LIVE (No: chooses to die)"));
    // The Night card commits as soon as the answer is complete: no separate Resolve step.
    expect(["p3", "p1", "p4"].map((id) => game().players[id]!.alive)).toEqual([false, false, false]);
    expect(state().undoStack).toHaveLength(1);
  });

  it("Nobody is an explicit answer: the step completes with no Life change", () => {
    open(named(AL));
    render(<NightScreen />);
    selectNightStep("p0");
    continueAction();
    fireEvent.click(within(workspace()).getByRole("checkbox", { name: "Nobody" }));
    expect(Object.values(game().nightProgress)).toEqual([expect.objectContaining({ status: "done" })]);
    expect(game().players.p1!.alive).toBe(true);
  });
});
