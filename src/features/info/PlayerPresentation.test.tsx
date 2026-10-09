import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { PlayerPresentation, type PresentationPayload } from "./PlayerPresentation";

afterEach(cleanup);

const empath = { id: "empath", name: "Empath", type: "Townsfolk", ability: "Each night, you learn how many of your 2 alive neighbours are evil.", icon: "/icons/empath.png" };
const characterPayload: PresentationPayload = { kind: "character", heading: "You Are", character: empath };

describe("local player presentation", () => {
  it.each(["You Are", "This Player Is", "Selected You"])("presents only the selected character for %s", heading => {
    render(<PlayerPresentation payload={{ ...characterPayload, heading }} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: heading });
    expect(within(dialog).getByRole("heading", { name: empath.name })).toBeInTheDocument();
    expect(within(dialog).getByText(empath.ability)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    expect(dialog.querySelector("img")).toHaveAttribute("src", empath.icon);
    expect(within(dialog).queryByText(/seat|bluff|owner|delivered/i)).toBeNull();
  });

  it.each([
    ["Did You Vote Today?", "vote", undefined],
    ["Did You Nominate Today?", "nominate", undefined],
    ["You Are Good", "good", "good"],
    ["You Are Evil", "evil", "evil"],
  ] as const)("keeps %s a display with no gameplay controls", (heading, symbol, tone) => {
    render(<PlayerPresentation payload={{ kind: "message", heading, symbol, tone }} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: heading });
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    expect(within(dialog).getByRole("button", { name: "Return to Grimoire" })).toBeInTheDocument();
    expect(dialog.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(within(dialog).queryByRole("textbox")).toBeNull();
  });

  it.each([
    [{ heading: "Your Demon", names: ["Hollis"] }],
    [{ heading: "Your Minions", names: ["Elspeth", "Jonah"] }, { heading: "These Characters Are Not in Play", characters: [empath] }],
    [{ heading: "Your Demon", names: ["Hollis"] }, { heading: "Your Minions", names: ["Elspeth", "Jonah"] }],
    [{ heading: "These Characters Are Not in Play", characters: [empath] }],
  ])("renders exactly the supplied setup groups: %j", (...groups) => {
    render(<PlayerPresentation payload={{ kind: "setup", groups }} onClose={vi.fn()} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByRole("heading", { level: 2 })).toHaveLength(groups.length);
    for (const group of groups) {
      expect(within(dialog).getByRole("heading", { level: 2, name: group.heading })).toBeInTheDocument();
      if ("names" in group) for (const name of group.names ?? []) expect(within(dialog).getByText(name)).toBeInTheDocument();
    }
    // A bluff display includes art/name, not the ability or private ownership.
    expect(within(dialog).queryByText(empath.ability)).toBeNull();
  });

  it("isolates the grimoire, traps focus, refuses backdrop dismissal and restores focus on Return", () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return <><main data-testid="grimoire"><button onClick={() => setOpen(true)}>Show information</button><p>Private roster</p></main>
        {open && <PlayerPresentation payload={characterPayload} onClose={() => setOpen(false)} />}</>;
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Show information" });
    trigger.focus(); fireEvent.click(trigger);
    expect(screen.getByTestId("grimoire").closest("[inert]")).not.toBeNull();
    const returnButton = screen.getByRole("button", { name: "Return to Grimoire" });
    expect(returnButton).toHaveFocus();
    fireEvent.keyDown(returnButton, { key: "Tab" });
    expect(returnButton).toHaveFocus();
    fireEvent.keyDown(returnButton, { key: "Tab", shiftKey: true });
    expect(returnButton).toHaveFocus();
    fireEvent.click(document.querySelector(".player-presentation-layer")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(returnButton);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId("grimoire").closest("[inert]")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("uses the current close callback on Escape and replaces old payload content", () => {
    const oldClose = vi.fn();
    const currentClose = vi.fn();
    const { rerender } = render(<PlayerPresentation payload={characterPayload} onClose={oldClose} />);
    rerender(<PlayerPresentation payload={{ kind: "message", heading: "You Are Evil", symbol: "evil", tone: "evil" }} onClose={currentClose} />);
    expect(screen.queryByText(empath.name)).toBeNull();
    expect(screen.queryByText(empath.ability)).toBeNull();
    expect(screen.getByRole("dialog", { name: "You Are Evil" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(currentClose).toHaveBeenCalledTimes(1);
    expect(oldClose).not.toHaveBeenCalled();
  });
});
