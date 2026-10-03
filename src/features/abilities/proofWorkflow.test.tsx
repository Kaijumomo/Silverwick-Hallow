// Phase 10F Slice 7: UI scenarios for the PRODUCTION proof-character
// semantics through the real Night Order / workspace / Player Drawer entry
// points (progressive disclosure, follow-up choices by origin, one commit).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NightOrderPanel } from "@/features/nightOrder/NightOrderPanel";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { useSessionRuntime } from "@/firebase/storytellerSync";
import { useTargetPicker } from "./abilityUi";
import { patchPlayer, proofGame, proofScript } from "@/test/proofFixtures";
import type { RoleId, StorytellerLobbyRecord } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;

function open(g: StorytellerLobbyRecord) {
  store.setState({ game: g, lobby: null, undoStack: [], localSeq: 0, customScripts: { [proofScript.id]: proofScript }, selectedPlayerId: null });
}
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
const named = (roles: RoleId[], phase: "night" | "day" = "night", day = 2) => proofGame(roles, phase, day);

describe("Poisoner -- inline simple flow (target + Resolve)", () => {
  it("one commit applies the sourced poison and completes the step", () => {
    open(named(["poisoner", "empath", "chef", "monk", "imp", "saint", "spy"]));
    render(<Night />);
    const row = card("Poisoner", "Player 0");
    fireEvent.change(within(row).getByRole("combobox", { name: "The player to poison" }), { target: { value: "p1" } });
    fireEvent.click(within(row).getByRole("button", { name: "Resolve" }));
    expect(game().players.p1!.effects).toEqual([expect.objectContaining({ type: "poisoned", sourceCharacter: "poisoner" })]);
    expect(state().undoStack).toHaveLength(1);
    expect(card("Poisoner", "Player 0")).toHaveAttribute("data-status", "done");
  });
});

describe("Drunk shown as the Empath -- the Storyteller's number is a follow-up choice", () => {
  it("Guide opens the workspace; the communicated number is asked as a Storyteller choice and recorded with performedRole", () => {
    open(patchPlayer(named(["empath", "imp", "chef", "monk", "saint", "drunk", "poisoner"]), "p5",
      { shownRole: "empath", shownAlignment: null, behaviorMode: "drunk_fake_role_behavior" }));
    render(<Night />);
    fireEvent.click(within(card("Empath", "Player 5")).getByRole("button", { name: "Guide" }));
    const choices = within(workspace()).getByRole("region", { name: "Further choices" });
    expect(within(choices).getByText("Storyteller choice")).toBeInTheDocument();
    fireEvent.change(within(choices).getByRole("spinbutton", { name: "The number shown (0, 1 or 2)" }), { target: { value: "2" } });
    expect(within(workspace()).getByText(/Record what Player 5 was told: 2/)).toBeInTheDocument();
    fireEvent.click(within(workspace()).getByRole("button", { name: "Resolve" }));
    expect(game().informationDeliveries).toEqual([expect.objectContaining({ actualRole: "drunk", performedRole: "empath" })]);
    expect(game().players.p5!.actualRole).toBe("drunk");
  });
});

describe("Fortune Teller -- Night 1 Red Herring is chosen inside the same resolution", () => {
  it("the Red Herring choice appears as a Storyteller choice; Confirm records the Effect and the answer in one commit", () => {
    open(named(["fortuneteller", "imp", "chef", "monk", "saint", "poisoner", "empath"], "night", 1));
    render(<Night />);
    fireEvent.click(within(card("Fortune Teller", "Player 0")).getByRole("button", { name: "Guide" }));
    const ws = workspace();
    fireEvent.change(within(ws).getByRole("combobox", { name: "The two players chosen 1" }), { target: { value: "p2" } });
    fireEvent.change(within(ws).getByRole("combobox", { name: "The two players chosen 2" }), { target: { value: "p3" } });
    const choices = within(ws).getByRole("region", { name: "Further choices" });
    fireEvent.change(within(choices).getByRole("combobox", { name: "The Red Herring (a good player)" }), { target: { value: "p3" } });
    expect(within(ws).getByText(/Player 3 gains Red Herring/)).toBeInTheDocument();
    fireEvent.click(within(ws).getByRole("button", { name: "Confirm and record" }));
    expect(game().players.p3!.effects).toEqual([expect.objectContaining({ type: "fortuneTellerRedHerring" })]);
    expect(game().informationDeliveries.at(-1)!.values.at(-1)).toMatchObject({ kind: "boolean", value: true });
    expect(state().undoStack).toHaveLength(1);
  });
});
