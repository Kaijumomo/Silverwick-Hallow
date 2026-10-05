// Phase 10F -- SOL-10F-A1 / A2 (PHASE10F Section 31), through the real Night
// Order, inline flow, Grimoire picker and workspace: follow-up answers never
// transfer to a new subject, and selections are bound to the participation
// instance chosen at selection time (seat reuse => stale, never retargeted).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { pickSeatIfPicking, useTargetPicker } from "./abilityUi";
import { patchPlayer, proofGame, proofScript, reseat } from "@/test/proofFixtures";
import type { StorytellerLobbyRecord } from "@/stores/types";
import { choose as pickChoice } from "@/test/pickers";

const game = () => store.getState().game!;
const open = (g: StorytellerLobbyRecord) =>
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript }, selectedPlayerId: null });
/** Seat reuse: p{n}'s seat now holds a NEW participation instance. */
const reseatInStore = (id: string) => act(() => { store.setState({ game: reseat(game(), id) }); });
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  useSessionRuntime.setState({ backend: null });
  useTargetPicker.setState({ active: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Night() {
  const current = store((s) => s.game)!;
  return <NightOrderPanel game={current} script={proofScript} onClose={() => {}} />;
}
const card = (role: string, player: string) =>
  screen.getAllByText(role, { selector: ".step-role-name" }).map((el) => el.closest(".step-card") as HTMLElement)
    .find((el) => el.querySelector(".step-player-name")?.textContent?.startsWith(`${player} ·`))!;
const workspace = () => document.querySelector(".ability-workspace") as HTMLElement;
const POISONER_GAME = ["poisoner", "empath", "chef", "monk", "imp", "saint", "spy"];

describe("SOL-10F-A2 -- selections are bound at selection time", () => {
  it("inline: a target whose seat is reused before Resolve is refused as stale (never the replacement)", () => {
    open(proofGame(POISONER_GAME));
    render(<Night />);
    const row = () => card("Poisoner", "Player 0");
    pickChoice("The player to poison", "p1", row());
    reseatInStore("p1");
    fireEvent.click(within(row()).getByRole("button", { name: "Resolve" }));
    expect(within(row()).getByRole("alert")).toHaveTextContent(/no longer in that seat/);
    expect(game().players.p1!.effects).toEqual([]);
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("Grimoire picker: the picked participation instance is kept; seat reuse -> stale", () => {
    open(proofGame(POISONER_GAME));
    render(<Night />);
    const row = () => card("Poisoner", "Player 0");
    fireEvent.click(within(row()).getByRole("button", { name: /^Choose .+ on the Table$/ }));
    act(() => { expect(pickSeatIfPicking(game(), "p2")).toBe(true); });
    reseatInStore("p2");
    fireEvent.click(within(row()).getByRole("button", { name: "Resolve" }));
    expect(within(row()).getByRole("alert")).toHaveTextContent(/no longer in that seat/);
    expect(game().players.p2!.effects).toEqual([]);
  });

  it("an unchanged participant still resolves (inline)", () => {
    open(proofGame(POISONER_GAME));
    render(<Night />);
    pickChoice("The player to poison", "p1", card("Poisoner", "Player 0"));
    reseatInStore("p3"); // an unrelated seat changes
    fireEvent.click(within(card("Poisoner", "Player 0")).getByRole("button", { name: "Resolve" }));
    expect(game().players.p1!.effects).toEqual([expect.objectContaining({ type: "poisoned" })]);
  });

  function manualStep(kind: string, configure?: (ws: HTMLElement) => void) {
    open(proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]));
    render(<Night />);
    fireEvent.click(within(card("Imp", "Player 0")).getByRole("button", { name: "Guide" }));
    fireEvent.click(within(workspace()).getByRole("button", { name: "Resolve manually / unmodeled interaction" }));
    fireEvent.change(within(workspace()).getByRole("textbox", { name: "Reason for manual resolution" }), { target: { value: "test" } });
    fireEvent.click(within(workspace()).getByRole("button", { name: `+ ${kind}` }));
    pickChoice("Step 1 player", "p1", workspace());
    configure?.(workspace());
  }

  it.each([
    ["Death", undefined],
    ["Effect", undefined],
    ["Character change", (ws: HTMLElement) => pickChoice("Step 1 character", "slayer", ws)],
    ["Alignment change", undefined],
  ] as const)("Manual %s: seat reuse after choosing the player -> stale; the replacement is untouched", (kind, configure) => {
    manualStep(kind, configure);
    expect(within(workspace()).getByRole("button", { name: "Confirm and record" })).toBeEnabled();
    reseatInStore("p1");
    expect(within(workspace()).getByRole("alert")).toHaveTextContent(/out of date/);
    expect(within(workspace()).queryByRole("button", { name: "Confirm and record" })).toBeNull();
    expect(game().players.p1).toMatchObject({ alive: true, effects: [], actualRole: "chef", actualAlignment: "good" });
    expect(store.getState().undoStack).toHaveLength(0);
  });

  it("Manual with the chosen participant unchanged records the step", () => {
    manualStep("Death");
    fireEvent.click(within(workspace()).getByRole("button", { name: "Confirm and record" }));
    expect(game().players.p1!.alive).toBe(false);
  });

  it("a Manual step with no player blocks resolution (never silently dropped)", () => {
    open(proofGame(["imp", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"]));
    render(<Night />);
    fireEvent.click(within(card("Imp", "Player 0")).getByRole("button", { name: "Guide" }));
    fireEvent.click(within(workspace()).getByRole("button", { name: "Resolve manually / unmodeled interaction" }));
    fireEvent.change(within(workspace()).getByRole("textbox", { name: "Reason for manual resolution" }), { target: { value: "test" } });
    fireEvent.click(within(workspace()).getByRole("button", { name: "+ Death" }));
    expect(within(workspace()).getByText("Choose a player for every step.")).toBeInTheDocument();
  });
});

describe("SOL-10F-A1 -- follow-up answers stay with their prerequisites (workspace)", () => {
  const harlotGame = () => patchPlayer(proofGame(["harlot", "chef", "monk", "imp", "empath", "saint", "spy"]), "p0",
    { isTraveler: true, actualAlignment: "good", travelerArrival: { demonInfoComplete: true, firstNightComplete: true, completedAtNight: 1 } });

  it("Harlot: consent for Player 1, then target Player 2 -> Player 2's consent is required; no stale field remains", () => {
    open(harlotGame());
    render(<Night />);
    fireEvent.click(within(card("Harlot", "Player 0")).getByRole("button", { name: "Guide" }));
    const ws = workspace();
    pickChoice("The living player chosen", "p1", ws);
    fireEvent.click(within(within(ws).getByRole("radiogroup", { name: "Player 1 agrees" })).getByRole("radio", { name: "Yes" }));
    expect(within(ws).getByRole("radiogroup", { name: /The Harlot and the chosen player die/ })).toBeInTheDocument();
    pickChoice("The living player chosen", "p2", ws);
    expect(within(ws).queryByRole("radiogroup", { name: "Player 1 agrees" })).toBeNull();
    expect(within(ws).queryByRole("radiogroup", { name: /The Harlot and the chosen player die/ })).toBeNull();
    const consent = within(ws).getByRole("radiogroup", { name: "Player 2 agrees" });
    expect(within(consent).getByRole("radio", { name: "Yes" })).not.toBeChecked();
    expect(within(ws).queryByRole("button", { name: /Confirm and record|Resolve$/ })).toBeDisabled();
  });

  const AL = ["alhadikhia", "chef", "monk", "empath", "saint", "poisoner", "washerwoman"];
  const label = "The 3 players chosen, in order (or nobody)";
  const choose = (ws: HTMLElement, ids: string[]) => ids.forEach((id, index) => pickChoice(`${label} ${index + 1}`, id, ws));
  const answer = (ws: HTMLElement, name: string | RegExp, live: boolean) =>
    fireEvent.click(within(within(ws).getByRole("radiogroup", { name })).getByRole("radio", { name: live ? "Yes" : "No" }));

  it("Al-Hadikhia: replacing player 1 invalidates that position's choice and every later one", () => {
    open(proofGame(AL));
    render(<Night />);
    fireEvent.click(within(card("Al-Hadikhia", "Player 0")).getByRole("button", { name: "Guide" }));
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
    render(<Night />);
    fireEvent.click(within(card("Al-Hadikhia", "Player 0")).getByRole("button", { name: "Guide" }));
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
