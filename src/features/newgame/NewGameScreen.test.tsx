import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewGameScreen } from "./NewGameScreen";
import { useStorytellerStore as store } from "@/stores/storytellerStore";
import { compositionFor, seatedBounds, travellerBounds, totalOf, fabledNote, scriptCardCount, builtinScriptCards, FABLED_CHOICES, LORIC_CHOICES } from "./setupFlowModel";

const morePlayers = () => screen.getByRole("button", { name: "One more player" });
const fewerPlayers = () => screen.getByRole("button", { name: "One fewer player" });
const moreTravellers = () => screen.getByRole("button", { name: "One more Traveller" });
const fewerTravellers = () => screen.getByRole("button", { name: "One fewer Traveller" });
const counterValue = (label: "players" | "travellers") => {
  const el = screen.getByText(label, { selector: ".sf-counter-label" });
  return el.parentElement!.querySelector(".sf-counter-value")!.textContent;
};
const compositionText = () => Array.from(document.querySelectorAll(".sf-comp-n")).map((n) => n.textContent).join("/");
const next = (name: RegExp) => screen.getByRole("button", { name });
const chooseScript = (name = "Trouble Brewing") => fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  store.setState({ game: null, lobby: null, undoStack: [], customScripts: {}, view: "newgame" });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("setup model", () => {
  it.each([
    [5, "3/0/1/1"], [10, "7/0/2/1"], [11, "7/1/2/1"], [15, "9/2/3/1"],
  ])("%i seated players show %s composition", (seated, expected) => {
    expect(compositionFor(seated).join("/")).toBe(expected);
  });

  it("Players is the total: seated plus Travellers", () => {
    expect(totalOf(15, 2)).toBe(17);
    expect(totalOf(15, 5)).toBe(20);
  });

  it("seated players run 5 to 15 and seated plus Travellers never passes 20", () => {
    expect(seatedBounds(0)).toEqual({ min: 5, max: 15 });
    expect(seatedBounds(2)).toEqual({ min: 5, max: 15 });
    expect(seatedBounds(8)).toEqual({ min: 5, max: 12 });
    expect(seatedBounds(15)).toEqual({ min: 5, max: 5 });
    expect(travellerBounds(5)).toEqual({ min: 0, max: 15 });
    expect(travellerBounds(15)).toEqual({ min: 0, max: 5 });
  });

  it("the three built-in script cards list 22, 25 and 25 characters, in the design's order", () => {
    const cards = builtinScriptCards();
    expect(cards.map((c) => c.id)).toEqual(["tb", "bmr", "snv"]);
    expect(cards.map(scriptCardCount)).toEqual(["22 characters", "25 characters", "25 characters"]);
  });

  it("Fabled and Loric are listed alphabetically; the Fabled note recommends Spirit of Ivory above 15", () => {
    for (const list of [FABLED_CHOICES, LORIC_CHOICES]) {
      const names = list.map((r) => r.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    }
    expect(fabledNote(15)).toBe("Help new players, fix awkward counts, or add a twist.");
    expect(fabledNote(17)).toBe("Spirit of Ivory is recommended with 17 players.");
  });
});

describe("Step I: Script & Players", () => {
  it("shows the three scripts, the Custom tile, the two counters and a disabled CTA until a script is chosen", () => {
    render(<NewGameScreen />);
    expect(screen.getByRole("heading", { name: "Choose a script" })).toBeVisible();
    for (const name of ["Trouble Brewing", "Bad Moon Rising", "Sects & Violets"]) expect(screen.getByRole("button", { name })).toBeVisible();
    expect(screen.getByRole("button", { name: /Custom/ })).toBeVisible();
    expect(next(/Fabled & Loric ›/)).toBeDisabled();
    expect(screen.getByText("Choose a script to continue.")).toHaveClass("sr-only");
    chooseScript();
    expect(next(/Fabled & Loric ›/)).toBeEnabled();
  });

  it("defaults to 10 players and 0 travellers, Travellers directly below Players with identical markup", () => {
    const { container } = render(<NewGameScreen />);
    expect(counterValue("players")).toBe("10");
    expect(counterValue("travellers")).toBe("0");
    expect(compositionText()).toBe("7/0/2/1");
    const counters = container.querySelectorAll(".sf-counters > .sf-counter");
    expect(counters).toHaveLength(2);
    expect(counters[0]).toHaveTextContent("players");
    expect(counters[1]).toHaveTextContent("travellers");
    const shape = (el: Element): string => `${el.tagName}.${el.className}[${Array.from(el.children).map(shape).join(",")}]`;
    expect(shape(counters[0]!)).toBe(shape(counters[1]!));
  });

  it("Players shows the total: Travellers add to it and the seated composition does not change", () => {
    render(<NewGameScreen />);
    fireEvent.click(moreTravellers());
    fireEvent.click(moreTravellers());
    expect(counterValue("players")).toBe("12");
    expect(counterValue("travellers")).toBe("2");
    expect(compositionText()).toBe("7/0/2/1");
  });

  it("the Players buttons move the seated count; 15 seated plus 2 Travellers is 17", () => {
    render(<NewGameScreen />);
    for (let i = 0; i < 5; i++) fireEvent.click(morePlayers());
    fireEvent.click(moreTravellers());
    fireEvent.click(moreTravellers());
    expect(counterValue("players")).toBe("17");
    expect(compositionText()).toBe("9/2/3/1");
    fireEvent.click(fewerPlayers());
    expect(counterValue("players")).toBe("16");
    expect(compositionText()).toBe("9/1/3/1");
  });

  it("Players + stops at 15 seated; both + stop at a total of 20", () => {
    render(<NewGameScreen />);
    for (let i = 0; i < 10; i++) fireEvent.click(morePlayers());
    expect(counterValue("players")).toBe("15");
    expect(morePlayers()).toBeDisabled();
    expect(moreTravellers()).toBeEnabled();
    for (let i = 0; i < 9; i++) fireEvent.click(moreTravellers());
    expect(counterValue("travellers")).toBe("5");
    expect(counterValue("players")).toBe("20");
    expect(moreTravellers()).toBeDisabled();
    expect(morePlayers()).toBeDisabled();
  });

  it("Travellers + takes the total to 20 and then stops the seated + at fewer than 15", () => {
    render(<NewGameScreen />);
    for (let i = 0; i < 10; i++) fireEvent.click(moreTravellers());
    expect(counterValue("players")).toBe("20");
    expect(counterValue("travellers")).toBe("10");
    expect(morePlayers()).toBeDisabled();
    expect(compositionText()).toBe("7/0/2/1");
  });

  it("minimums: 5 seated and 0 Travellers disable the matching - buttons", () => {
    render(<NewGameScreen />);
    expect(fewerTravellers()).toBeDisabled();
    for (let i = 0; i < 10; i++) fireEvent.click(fewerPlayers());
    expect(counterValue("players")).toBe("5");
    expect(fewerPlayers()).toBeDisabled();
    expect(moreTravellers()).toBeEnabled();
  });

  it("the rail summarises the script and the player count once chosen", () => {
    render(<NewGameScreen />);
    const rail = screen.getByRole("navigation", { name: "Setup progress" });
    expect(within(rail).queryByText("Trouble Brewing")).toBeNull();
    chooseScript("Bad Moon Rising");
    expect(within(rail).getByText("Bad Moon Rising")).toBeVisible();
    expect(within(rail).getByText("10 players")).toBeVisible();
  });

  it("Home returns to the home view without creating a game", () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Home/ }));
    expect(store.getState().view).toBe("home");
    expect(store.getState().game).toBeNull();
  });

  it("the Custom tile opens the custom-script dialog", () => {
    render(<NewGameScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Custom/ }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });
});

describe("Step II: Fabled & Loric", () => {
  const toStepTwo = () => { chooseScript(); fireEvent.click(next(/Fabled & Loric ›/)); };

  it("lists every Fabled and Loric, none chosen, with a Skip CTA", () => {
    render(<NewGameScreen />);
    toStepTwo();
    expect(screen.getByRole("heading", { name: "Fabled & Loric" })).toBeVisible();
    for (const role of [...FABLED_CHOICES, ...LORIC_CHOICES]) {
      expect(screen.getByRole("button", { name: role.name })).toHaveAttribute("aria-pressed", "false");
    }
    expect(next(/Skip to players ›/)).toBeEnabled();
    const rail = screen.getByRole("navigation", { name: "Setup progress" });
    expect(within(rail).getByText("None")).toBeVisible();
  });

  it("choosing tokens updates the CTA and the rail, and toggling off restores Skip", () => {
    render(<NewGameScreen />);
    toStepTwo();
    fireEvent.click(screen.getByRole("button", { name: "Angel" }));
    fireEvent.click(screen.getByRole("button", { name: "Bootlegger" }));
    expect(screen.getByRole("button", { name: "Angel" })).toHaveAttribute("aria-pressed", "true");
    expect(next(/Continue to players ›/)).toBeEnabled();
    const rail = screen.getByRole("navigation", { name: "Setup progress" });
    expect(within(rail).getByText("Angel")).toBeVisible();
    expect(within(rail).getByText("Bootlegger")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Angel" }));
    fireEvent.click(screen.getByRole("button", { name: "Bootlegger" }));
    expect(next(/Skip to players ›/)).toBeEnabled();
  });

  it("Back and the completed rail step return to Step I with the choices kept", () => {
    render(<NewGameScreen />);
    fireEvent.click(moreTravellers());
    toStepTwo();
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));
    expect(screen.getByRole("heading", { name: "Choose a script" })).toBeVisible();
    expect(counterValue("travellers")).toBe("1");
    expect(screen.getByRole("button", { name: "Trouble Brewing" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(next(/Fabled & Loric ›/));
    fireEvent.click(within(screen.getByRole("navigation", { name: "Setup progress" })).getByRole("button", { name: /Script & Players/ }));
    expect(screen.getByRole("heading", { name: "Choose a script" })).toBeVisible();
  });

  it("the Fabled note recommends Spirit of Ivory above 15 players", () => {
    render(<NewGameScreen />);
    for (let i = 0; i < 5; i++) fireEvent.click(morePlayers());
    for (let i = 0; i < 2; i++) fireEvent.click(moreTravellers());
    toStepTwo();
    expect(screen.getByText("Spirit of Ivory is recommended with 17 players.")).toBeVisible();
  });

  it("nothing is created by Steps I and II", () => {
    render(<NewGameScreen />);
    toStepTwo();
    fireEvent.click(screen.getByRole("button", { name: "Angel" }));
    expect(store.getState().game).toBeNull();
    expect(store.getState().lobby).toBeNull();
  });
});
