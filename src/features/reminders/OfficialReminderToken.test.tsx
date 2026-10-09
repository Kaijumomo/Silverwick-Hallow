import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { GrimoireCircle } from "@/features/grimoire/GrimoireCircle";
import { PlayersInteraction } from "@/features/players/PlayersInteraction";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { setupGame, setupScript } from "@/test/setupFixtures";
import { iconUrlFor } from "@/data/iconUrl";
import { canonicalRoles } from "@/data/canonical";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  usePrivacyStore.setState({ enabled: false });
  const game = setupGame(["chef", "poisoner", "monk"]);
  game.players.p0!.effects = [{ id: "poison", type: "poisoned", sourceCharacter: "poisoner", state: "active",
    lifetime: { kind: "manual" }, expiry: { kind: "none" } }];
  store.setState({ game, lobby: null, customScripts: { [setupScript.id]: setupScript }, grimoireMode: "ring" });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("renders official source art instead of custom condition artwork and removes private DOM under privacy", () => {
  render(<PlayersInteraction.Provider value={{ active: true, swapping: false, tap: () => false }}><GrimoireCircle /></PlayersInteraction.Provider>);
  const token = document.querySelector('[data-official-reminder="poisoner"]');
  expect(token).toHaveTextContent("Poisoned");
  expect(token?.querySelector("img")).toHaveAttribute("src", iconUrlFor(canonicalRoles(["poisoner"])[0]!));
  expect(document.querySelector('img[src="/status/poisoned.png"]')).toBeNull();
  expect(document.querySelector('[data-player-id="p0"]')).toHaveAccessibleName(/Poisoned/);
  act(() => usePrivacyStore.setState({ enabled: true }));
  expect(document.querySelector("[data-official-reminder]")).toBeNull();
  expect(document.querySelector('[data-player-id="p0"]')).not.toHaveAccessibleName(/Poisoned/);
});

it("moves display to the current target while keeping old-target inert notation inert", () => {
  const game = store.getState().game!;
  game.players.p0!.reminders = [{ id: "annotation", label: "Poisoned", sourceCharacter: "poisoner" }];
  render(<PlayersInteraction.Provider value={{ active: true, swapping: false, tap: () => false }}><GrimoireCircle /></PlayersInteraction.Provider>);
  const poison = game.players.p0!.effects[0]!;
  act(() => store.setState({ game: { ...game, players: { ...game.players,
    p0: { ...game.players.p0!, effects: [] }, p2: { ...game.players.p2!, effects: [poison] },
  } } }));
  expect(document.querySelector('[data-player-id="p0"] [data-official-reminder="poisoner"]')).toHaveAttribute("data-reminder-kind", "notation");
  expect(document.querySelector('[data-player-id="p0"] [data-reminder-kind="effect"]')).toBeNull();
  expect(document.querySelector('[data-player-id="p2"] [data-official-reminder="poisoner"]')).toHaveTextContent("Poisoned");
  expect(document.querySelector('[data-player-id="p2"] [data-official-reminder="poisoner"]')).toHaveAttribute("data-reminder-kind", "effect");
  expect(store.getState().game!.players.p0!.reminders).toHaveLength(1);
  expect(store.getState().game!.players.p0!.effects).toEqual([]);
  expect(store.getState().game!.players.p2!.effects).toEqual([poison]);
});
