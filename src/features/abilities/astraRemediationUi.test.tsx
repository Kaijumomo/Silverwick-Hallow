// Phase 10F -- SOL-10F-A1 (PHASE10F Section 31), through the unified Grimoire's Night card and
// ability workspace (Package 4: the Night Order rows, inline flow and manual-outcome drawer are retired;
// a direct board pick commits at the tap, so the A2 bound-at-selection staleness is exercised in the
// RequirementInput and coordinator tests): follow-up answers never
// transfer to a new subject, and selections are bound to the participation
// instance chosen at selection time (seat reuse => stale, never retargeted).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { NightScreen, continueAction, resetNightUi, selectNightStep, workspace } from "@/features/grimoire-v6/night/port/v6Night";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useTargetPicker } from "./abilityUi";
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { choose as pickChoice } from "@/test/pickers";
const open = (g: StorytellerLobbyRecord) => {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript }, selectedPlayerId: null });
  resetNightUi();
};
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.setState({ active: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
/** Opens Player 0's Night step and its ability workspace. */
const openWorkspace = () => { render(<NightScreen />); selectNightStep("p0"); continueAction(); };

describe("SOL-10F-A1 -- follow-up answers stay with their prerequisites (workspace)", () => {
  const harlotGame = () => patchPlayer(proofGame(["harlot", "chef", "monk", "imp", "empath", "saint", "spy"]), "p0",
    { isTraveler: true, actualAlignment: "good", travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 } });

  it("Harlot: consent for Player 1, then target Player 2 -> Player 2's consent is required; no stale field remains", () => {
    open(harlotGame());
    openWorkspace();
    const ws = workspace();
    pickChoice("The living player chosen", "p1", ws);
    fireEvent.click(within(within(ws).getByRole("radiogroup", { name: "Player 1 agrees" })).getByRole("radio", { name: "Yes" }));
    expect(within(ws).getByRole("radiogroup", { name: /The Harlot and the chosen player die/ })).toBeInTheDocument();
    pickChoice("The living player chosen", "p2", ws);
    expect(within(ws).queryByRole("radiogroup", { name: "Player 1 agrees" })).toBeNull();
    expect(within(ws).queryByRole("radiogroup", { name: /The Harlot and the chosen player die/ })).toBeNull();
    const consent = within(ws).getByRole("radiogroup", { name: "Player 2 agrees" });
    expect(within(consent).getByRole("radio", { name: "Yes" })).not.toBeChecked();
    expect(within(ws).queryByRole("button", { name: /Confirm and record|Resolve$/ })).toBeNull(); // nothing is recordable until Player 2 answers
  });

  const AL = ["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];
  const label = "The 3 players chosen, in order (or nobody)";
  const choose = (ws: HTMLElement, ids: string[]) => ids.forEach((id, index) => pickChoice(`${label} ${index + 1}`, id, ws));
  const answer = (ws: HTMLElement, name: string | RegExp, live: boolean) =>
    fireEvent.click(within(within(ws).getByRole("radiogroup", { name })).getByRole("radio", { name: live ? "Yes" : "No" }));

  it("Al-Hadikhia: replacing player 1 invalidates that position's choice and every later one", () => {
    open(proofGame(AL));
    openWorkspace();
    const ws = workspace();
    choose(ws, ["p1", "p2", "p3"]);
    answer(ws, /^1\. Player 1/, true);
    answer(ws, /^2\. Player 2/, true);
    choose(ws, ["p4"]);
    expect(within(ws).queryByRole("radiogroup", { name: /^1\. Player 1/ })).toBeNull();
    expect(within(ws).queryByRole("radiogroup", { name: /^2\. Player 2/ })).toBeNull();
    const fresh = within(ws).getByRole("radiogroup", { name: /^1\. Player 4/ });
    expect(within(fresh).getByRole("radio", { name: "Yes" })).not.toBeChecked();
  });

  it("Al-Hadikhia: changing choice 1 clears the later dependent choices", () => {
    open(proofGame(AL));
    openWorkspace();
    const ws = workspace();
    choose(ws, ["p1", "p2", "p3"]);
    answer(ws, /^1\. Player 1/, true);
    answer(ws, /^2\. Player 2/, true);
    answer(ws, /^1\. Player 1/, false);
    const second = within(ws).getByRole("radiogroup", { name: /^2\. Player 2/ });
    expect(within(second).getByRole("radio", { name: "Yes" })).not.toBeChecked();
    expect(within(ws).queryByRole("radiogroup", { name: /^3\. Player 3/ })).toBeNull();
  });
});
