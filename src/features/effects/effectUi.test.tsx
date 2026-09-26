// Phase 10B: Effect UI -- one-tap manual quick controls that read the EXACT
// manual Effect, aggregated Grimoire indicators, the compact Player Drawer
// list with progressive disclosure, accessibility, stale-drawer binding and
// Privacy Mode suppression.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupScript, standardRoles } from "@/test/setupFixtures";
import { needsShownIdentity } from "@/stores/identity";
import { GameScreen } from "@/features/game/GameScreen";
import { PlayerDrawer } from "@/features/players/PlayerDrawer";
import type { EffectParticipantBinding } from "@/stores/effectResolution";
import type { PlayerId } from "@/stores/types";

const state = () => store.getState();
const game = () => state().game!;
const idOf = (name: string) => game().seatOrder.find((id) => game().players[id]!.name === name)!;
const bind = (id: PlayerId): EffectParticipantBinding => ({ playerId: id, participantId: game().players[id]!.participantId! });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  store.setState({ game: null, lobby: null, undoStack: [], selectedPlayerId: null, localSeq: 0, sync: null,
    customScripts: { [setupScript.id]: setupScript } });
  state().newGame(setupScript.id, { plannedPlayerCount: 7 });
  ["Alice", "Bob", "Carol", "Dave", "Eve", "Frank", "Grace"].forEach((n) => state().addPlayerToSeat(n));
  state().setRolePool(standardRoles(7));
  expect(state().dealRolePool().ok).toBe(true);
  for (const id of game().seatOrder) {
    if (needsShownIdentity(game().players[id]!.actualRole)) state().setShownRole(id, "chef");
    else state().showAssignedRole(id);
  }
  expect(state().revealRoles().ok).toBe(true);
  expect(state().beginNightOne().ok).toBe(true);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Drawer({ name }: { name: string }) {
  const p = store((s) => s.game!.players[idOf(name)]!);
  return <PlayerDrawer player={p} />;
}
const quick = (label: string) => within(screen.getByRole("group", { name: "Quick effects" })).getByRole("button", { name: new RegExp(`^${label}`) });
const abilityPoison = (name: string, id: string) => state().resolveEffects({ intents: [{ kind: "apply", target: bind(idOf(name)),
  effect: { id, type: "poisoned", source: bind(idOf("Bob")), sourceCharacter: "poisoner", lifetime: { kind: "throughFollowingDay" } } }] });

describe("Phase 10B quick Effects: player -> Effect -> done", () => {
  it("each quick control is one tap and opens no advanced form", () => {
    render(<Drawer name="Alice" />);
    for (const label of ["Drunk", "Poisoned", "Protected"]) {
      const button = quick(label);
      expect(button).toHaveAttribute("aria-pressed", "false");
      const seq = state().localSeq;
      fireEvent.click(button);
      expect(state().localSeq).toBe(seq + 1);
      expect(quick(label)).toHaveAttribute("aria-pressed", "true");
    }
    expect(screen.queryByRole("form", { name: "Add effect" })).toBeNull();
    expect(game().players[idOf("Alice")]!.effects.map((e) => e.id)).toEqual(["manual:drunk", "manual:poisoned", "manual:protected"]);
    fireEvent.click(quick("Poisoned"));
    expect(quick("Poisoned")).toHaveAttribute("aria-pressed", "false");
    expect(game().players[idOf("Alice")]!.effects.map((e) => e.id)).toEqual(["manual:drunk", "manual:protected"]);
  });

  it("the quick Poisoned toggle reads the exact manual Effect: an ability Poisoned neither presses nor blocks it", () => {
    abilityPoison("Alice", "ability-p");
    render(<Drawer name="Alice" />);
    expect(quick("Poisoned")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(quick("Poisoned"));
    expect(quick("Poisoned")).toHaveAttribute("aria-pressed", "true");
    expect(game().players[idOf("Alice")]!.effects.map((e) => e.id)).toEqual(["ability-p", "manual:poisoned"]);
    fireEvent.click(quick("Poisoned"));
    expect(game().players[idOf("Alice")]!.effects.map((e) => e.id)).toEqual(["ability-p"]);
  });

  it("a drawer still showing a replaced participant refuses as stale and changes nothing", () => {
    const alice = idOf("Alice");
    const stale = game().players[alice]!;
    render(<PlayerDrawer player={stale} />);
    act(() => { state().unseatPlayer(alice); state().addPlayerToSeat("Mallory"); });
    const before = game();
    fireEvent.click(quick("Drunk"));
    expect(state().game).toBe(before);
    expect(screen.getByRole("alert")).toHaveTextContent(/different player|no longer seated/);
    expect(game().players[alice]!.effects).toEqual([]);
  });
});

describe("Phase 10B aggregation and progressive disclosure", () => {
  it("three Poisoned instances show ONE Grimoire indicator with multiplicity and a spoken label; the drawer lists 'Poisoned ×3' and reveals instances on demand", () => {
    abilityPoison("Carol", "p1");
    abilityPoison("Carol", "p2");
    state().setManualEffect(bind(idOf("Carol")), "poisoned", true);
    render(<GameScreen />);
    const indicators = document.querySelectorAll('[data-effect-indicator="poisoned"]');
    expect(indicators).toHaveLength(1);
    expect(indicators[0]!.textContent).toContain("×3");
    expect(indicators[0]).toHaveAttribute("aria-hidden", "true");
    expect(indicators[0]!.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.getByRole("button", { name: /^Carol, seat 3, .*Poisoned, 3 active effects$/ })).toBeInTheDocument();

    act(() => { state().selectPlayer(idOf("Carol")); });
    const group = screen.getByRole("button", { name: /^Poisoned, 3 active effects\. Show details/ });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(group).toHaveTextContent("Poisoned ×3");
    expect(screen.queryByText("Poisoned (manual)")).toBeNull();
    fireEvent.click(group);
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Poisoned (manual)")).toBeInTheDocument();
    expect(screen.getAllByText(/Bob · Poisoner/)).toHaveLength(2);
    expect(screen.getAllByText("Ends as Night 2 begins")).toHaveLength(2);
  });

  it("suppress/resume from the details keeps the instance; a suppressed Effect leaves the Grimoire indicator", () => {
    abilityPoison("Carol", "p1");
    render(<GameScreen />);
    act(() => { state().selectPlayer(idOf("Carol")); });
    fireEvent.click(screen.getByRole("button", { name: /^Poisoned\. Show details/ }));
    fireEvent.click(screen.getByRole("button", { name: "Suppress" }));
    expect(game().players[idOf("Carol")]!.effects[0]!.state).toBe("suppressed");
    expect(document.querySelector('[data-effect-indicator="poisoned"]')).toBeNull();
    expect(screen.getByText(/1 suppressed/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(game().players[idOf("Carol")]!.effects[0]!.state).toBe("active");
    expect(document.querySelector('[data-effect-indicator="poisoned"]')).not.toBeNull();
  });

  it("the advanced workflow adds a sourced, timed Effect with smart defaults (source character pre-filled, expiry previewed)", () => {
    render(<Drawer name="Carol" />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add effect" }));
    const form = screen.getByRole("form", { name: "Add effect" });
    fireEvent.change(within(form).getByLabelText("Effect"), { target: { value: "safeFromDemon" } });
    fireEvent.change(within(form).getByLabelText("Caused by"), { target: { value: idOf("Bob") } });
    expect((within(form).getByLabelText("Character") as HTMLSelectElement).value).toBe(game().players[idOf("Bob")]!.actualRole);
    fireEvent.change(within(form).getByLabelText("Lasts"), { target: { value: "untilDawn" } });
    expect(within(form).getByText("Ends as Day 1 begins")).toBeInTheDocument();
    fireEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(screen.queryByRole("form", { name: "Add effect" })).toBeNull();
    const effect = game().players[idOf("Carol")]!.effects[0]!;
    expect(effect).toMatchObject({ type: "safeFromDemon", sourceCharacter: game().players[idOf("Bob")]!.actualRole,
      sourceParticipant: { participantId: game().players[idOf("Bob")]!.participantId }, expiry: { kind: "at", moment: { phase: "day", day: 1 } } });
  });

  it("a legacy unresolved lifetime surfaces as a concise Needs check and can be resolved in one tap", () => {
    const carol = idOf("Carol");
    const g = game();
    store.setState({ game: { ...g, players: { ...g.players, [carol]: { ...g.players[carol]!, effects: [
      { id: "legacy", type: "poisoned", lifetime: { kind: "untilDawn" }, state: "active", expiry: { kind: "unresolved" } }] } } } });
    render(<GameScreen />);
    expect(screen.getByRole("button", { name: /^Carol, seat 3, alive, needs check, Poisoned$/ })).toBeInTheDocument();
    act(() => { state().selectPlayer(carol); });
    fireEvent.click(screen.getByRole("button", { name: /^Poisoned, needs check\. Show details/ }));
    fireEvent.click(screen.getByRole("button", { name: "Ends as Day 1 begins" }));
    expect(game().players[carol]!.effects[0]!.expiry).toEqual({ kind: "at", moment: { phase: "day", day: 1 } });
  });
});

describe("Phase 10B Privacy Mode", () => {
  it("hides every private Effect visual, closes open details and the advanced form, and never reopens them when turned off", () => {
    abilityPoison("Carol", "p1");
    render(<GameScreen />);
    act(() => { state().selectPlayer(idOf("Carol")); });
    fireEvent.click(screen.getByRole("button", { name: /^Poisoned\. Show details/ }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add effect" }));
    expect(screen.getByText("Ends as Night 2 begins")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add effect" })).toBeInTheDocument();

    act(() => { usePrivacyStore.setState({ enabled: true }); });
    expect(document.querySelector("[data-effect-indicator]")).toBeNull();
    expect(screen.queryByRole("group", { name: "Quick effects" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Add effect" })).toBeNull();
    expect(screen.queryByText("Ends as Night 2 begins")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Poisoner|Poisoned/);

    act(() => { usePrivacyStore.setState({ enabled: false }); });
    // Glanceable state returns; private details stay closed until reopened.
    expect(document.querySelector('[data-effect-indicator="poisoned"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /^Poisoned\. Show details/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ends as Night 2 begins")).toBeNull();
    expect(screen.queryByRole("form", { name: "Add effect" })).toBeNull();
  });
});
