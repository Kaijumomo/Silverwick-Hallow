import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { GameScreen } from "./GameScreen";
import { useStorytellerStore as storyteller } from "@/stores/storytellerStore";
import { usePrivacyStore } from "@/stores/privacyStore";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { FABLED } from "@/data/fabled";
import { LORICS } from "@/data/lorics";
import { TRAVELERS } from "@/data/travelers";
import type { RoleDef, Script } from "@/stores/types";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
  usePrivacyStore.setState({ enabled: false });
  storyteller.setState({ game: null, lobby: null, undoStack: [] });
  storyteller.getState().newGame("tb");
  storyteller.getState().addPlayer("Alice");
  const id = storyteller.getState().game!.seatOrder[0]!;
  storyteller.getState().assignRole(id, "chef");
  storyteller.getState().setStatus(id, "poisoned", true);
  storyteller.getState().addReminder(id, { id: "r1", label: "Secret reminder" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Storyteller privacy mode", () => {
  it("conceals token identity and effects while preserving the current game", () => {
    const view = render(<GameScreen />);
    expect(screen.getAllByText("Chef").length).toBeGreaterThan(0);
    // Phase 10B: the indicator artwork is decorative; the token's own
    // accessible name states the Effect in words.
    expect(document.querySelector('[data-effect-indicator="poisoned"]')).not.toBeNull();
    expect(screen.getByRole("button", { name: /Alice, seat 1, .*Poisoned/ })).toBeInTheDocument();
    expect(screen.getAllByText("Secret reminder").length).toBeGreaterThan(0);
    const before = structuredClone(storyteller.getState().game);

    fireEvent.click(screen.getByRole("button", { name: "Enable Privacy Mode" }));

    expect(screen.getByRole("button", { name: "Disable Privacy Mode" })).toHaveTextContent("Show tokens");
    expect(screen.queryByText("Chef")).toBeNull();
    expect(document.querySelector("[data-effect-indicator]")).toBeNull();
    expect(screen.queryByRole("button", { name: /Poisoned/ })).toBeNull();
    expect(screen.queryByText("Secret reminder")).toBeNull();
    expect(screen.getByText("role hidden")).toBeInTheDocument();
    expect(storyteller.getState().game).toEqual(before);

    view.unmount();
    render(<GameScreen />);
    expect(screen.getByRole("button", { name: "Disable Privacy Mode" })).toBeInTheDocument();

    const seat = storyteller.getState().game!.seatOrder[0]!;
    act(() => {
      storyteller.getState().removeReminder(seat, "r1");
      storyteller.getState().addReminder(seat, { id: "r2", label: "Updated while hidden" });
    });
    expect(screen.queryByText("Updated while hidden")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Disable Privacy Mode" }));
    expect(screen.getAllByText("Updated while hidden").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chef").length).toBeGreaterThan(0);
  });
});

// Phase 10D (CLOSURE-03; LUNA-CLOSURE-03-R1): the Almanac shows ONE definition
// per RoleId. The script's characters and the Traveler catalogue are listed as
// Role resolution defines them (first definition, canonical Traveler
// precedence, an admitted ordinary owner kept against Fabled/Loric); a Fabled
// or Loric catalogue entry appears only when its RoleId is not already shown.
describe("CLOSURE-03: the Almanac lists ONE definition per RoleId", () => {
  const homebrewBigwig = { id: "bigwig", name: "Homebrew Bigwig", type: "townsfolk" as const, ability: "Homebrew Townsfolk." };
  const homebrewDoomsayer = { id: "doomsayer", name: "Homebrew Doomsayer", type: "outsider" as const, ability: "Homebrew Outsider." };
  const homebrewThief = { id: "thief", name: "Homebrew Thief", type: "demon" as const, ability: "Homebrew Demon." };

  /** Opens the Storyteller Almanac for a custom script: `first` ahead of the
   * Trouble Brewing characters. `distinct` is how many different RoleIds the
   * script, the Traveler catalogue and the Fabled/Loric catalogues name. */
  function openAlmanac(first: RoleDef[]) {
    const script: Script = { id: "almanac-owner", name: "Almanac owner", characters: [...first, ...troubleBrewing.characters] };
    storyteller.setState({ game: null, lobby: null, undoStack: [], customScripts: { [script.id]: script } });
    storyteller.getState().newGame(script.id);
    render(<GameScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Reference" }));
    const almanac = within(screen.getByRole("complementary", { name: "Reference" }));
    const cards = (name: string) => almanac.queryAllByText(name, { selector: ".reference-character-name" });
    const distinct = new Set([...script.characters, ...TRAVELERS, ...FABLED, ...LORICS].map((r) => r.id)).size;
    return { almanac, cards, distinct };
  }

  it("A: a homebrew Townsfolk `bigwig` appears exactly once -- the canonical Loric Big Wig is not a second entry", () => {
    const { almanac, cards, distinct } = openAlmanac([homebrewBigwig]);
    expect(cards("Homebrew Bigwig")).toHaveLength(1);
    expect(cards("Homebrew Bigwig")[0]!.closest("section")!.querySelector("h3")).toHaveClass("type-townsfolk");
    expect(cards(LORICS.find((r) => r.id === "bigwig")!.name)).toHaveLength(0);
    expect(almanac.getByText(`${distinct} characters`)).toBeInTheDocument();
  });

  it("B: a homebrew Outsider `doomsayer` appears exactly once -- the canonical Fabled Doomsayer is not a second entry", () => {
    const { almanac, cards, distinct } = openAlmanac([homebrewDoomsayer]);
    expect(cards("Homebrew Doomsayer")).toHaveLength(1);
    expect(cards("Homebrew Doomsayer")[0]!.closest("section")!.querySelector("h3")).toHaveClass("type-outsider");
    expect(cards(FABLED.find((r) => r.id === "doomsayer")!.name)).toHaveLength(0);
    expect(almanac.getByText(`${distinct} characters`)).toBeInTheDocument();
  });

  it("C: a legacy homebrew Demon `thief` vs the canonical Traveler -- exactly one Thief, the canonical Traveler", () => {
    const { almanac, cards, distinct } = openAlmanac([homebrewThief]);
    expect(cards("Homebrew Thief")).toHaveLength(0);
    expect(cards("Thief")).toHaveLength(1);
    expect(cards("Thief")[0]!.closest("section")!.querySelector("h3")).toHaveClass("type-traveler");
    expect(cards("Chef")).toHaveLength(1);
    expect(almanac.getByText(`${distinct} characters`)).toBeInTheDocument();
  });

  it("D: every Fabled and Loric whose RoleId no displayed script/Traveler Role owns still appears, once", () => {
    const { cards } = openAlmanac([homebrewBigwig, homebrewDoomsayer]);
    expect(cards("Angel")).toHaveLength(1);
    expect(cards("Angel")[0]!.closest("section")!.querySelector("h3")).toHaveClass("type-fabled");
    expect(cards("Gardener")).toHaveLength(1);
    expect(cards("Gardener")[0]!.closest("section")!.querySelector("h3")).toHaveClass("type-loric");
    for (const role of [...FABLED, ...LORICS].filter((r) => r.id !== "bigwig" && r.id !== "doomsayer")) {
      expect(cards(role.name)).toHaveLength(1);
    }
  });

  it("E: with Loric, Fabled and Traveler collisions together, the Almanac holds no duplicate RoleId -- one entry per distinct RoleId", () => {
    const { almanac, cards, distinct } = openAlmanac([homebrewBigwig, homebrewDoomsayer, homebrewThief]);
    expect(almanac.getByText(`${distinct} characters`)).toBeInTheDocument();
    expect(almanac.getAllByRole("listitem")).toHaveLength(distinct);
    expect(cards("Homebrew Bigwig")).toHaveLength(1);
    expect(cards("Homebrew Doomsayer")).toHaveLength(1);
    expect(cards("Thief")).toHaveLength(1);
    expect(cards("Homebrew Thief")).toHaveLength(0);
  });
});
