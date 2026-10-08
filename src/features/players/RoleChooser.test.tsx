import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { canonicalRoles } from "@/data/canonical";
import { RoleChooser, type RoleChooserProps } from "./RoleChooser";

afterEach(cleanup);
const roles = canonicalRoles(["washerwoman", "chef", "baron", "imp", "drunk", "gunslinger"]);
function distribution(overrides: Partial<Extract<RoleChooserProps, { mode: "distribute" }>> = {}) {
  return { mode: "distribute" as const, roles, scriptName: "Trouble Brewing", onClose: vi.fn(),
    selected: ["washerwoman", "baron", "imp"], residents: 5, travelers: 0,
    required: { townsfolk: 1, outsider: 2, minion: 1, demon: 1 }, canDistribute: false,
    onToggle: vi.fn(), onClear: vi.fn(), onRandom: vi.fn(), onDistribute: vi.fn(), ...overrides };
}

describe("RoleChooser", () => {
  it("keeps a random draft separate from distribution and obeys caller validation", () => {
    const props = distribution();
    const view = render(<RoleChooser {...props} />);
    expect(screen.getByLabelText("Outsiders: 0 selected, 2 required")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Washerwoman" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Random setup" }));
    expect(props.onRandom).toHaveBeenCalledOnce();
    expect(props.onDistribute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Distribute to 5 players" }));
    expect(props.onDistribute).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Chef" }));
    expect(props.onToggle).toHaveBeenCalledWith("chef");
    // Controlled selection: the component cannot assign a role or update the draft itself.
    expect(screen.getByRole("button", { name: "Chef" })).toHaveAttribute("aria-pressed", "false");
    view.rerender(<RoleChooser {...props} canDistribute />);
    fireEvent.click(screen.getByRole("button", { name: "Distribute to 5 players" }));
    expect(props.onDistribute).toHaveBeenCalledOnce();
  });

  it("requires Traveler seats and prevents duplicate actions while pending", () => {
    const props = distribution();
    const view = render(<RoleChooser {...props} />);
    expect(screen.getByRole("button", { name: "Gunslinger" })).toBeDisabled();
    view.rerender(<RoleChooser {...props} travelers={1} pending canDistribute />);
    fireEvent.click(screen.getByRole("button", { name: "Random setup" }));
    fireEvent.click(screen.getByRole("button", { name: "Distributing…" }));
    expect(props.onRandom).not.toHaveBeenCalled();
    expect(props.onDistribute).not.toHaveBeenCalled();
  });

  it("uses the authoritative resident-only distribution label when Travelers are managed separately", () => {
    render(<RoleChooser {...distribution({ travelers: 2, distributionLabel: "Distribute to 5 residents" })} />);
    expect(screen.getByRole("button", { name: "Distribute to 5 residents" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Distribute to 7 players" })).not.toBeInTheDocument();
  });

  it("labels current and occupied characters while distinguishing private swaps from in-game changes", () => {
    const onChoose = vi.fn();
    const props = { mode: "choose" as const, roles, scriptName: "Trouble Brewing", onClose: vi.fn(),
      player: { id: "ada", name: "Ada", seat: 1, roleId: "chef" }, holders: { washerwoman: ["Cleo"] }, allowSwap: true, onChoose };
    const view = render(<RoleChooser {...props} />);
    expect(screen.getByRole("button", { name: "Chef, current" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Private setup: choosing an occupied/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Washerwoman, in use by Cleo" }));
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onChoose).toHaveBeenCalledWith("washerwoman");
    view.rerender(<RoleChooser {...props} allowSwap={false} />);
    expect(screen.queryByText(/Private setup: choosing an occupied/)).not.toBeInTheDocument();
    expect(screen.getByText(/Only Ada’s character will change/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Washerwoman, in use by Cleo" })).toBeEnabled();
  });

  it("supports search, keyboard ability preview, and canonical Wiki links without linking homebrew", () => {
    const homebrew = { id: "moon", name: "Moon Keeper", type: "townsfolk" as const, ability: "Count the silver moons." };
    render(<RoleChooser {...distribution({ roles: [...roles, homebrew] })} />);
    fireEvent.focus(screen.getByRole("button", { name: "Chef" }));
    const detail = screen.getByRole("region", { name: "Character details" });
    expect(within(detail).getByText(/pairs of evil/)).toBeInTheDocument();
    expect(within(detail).getByRole("link")).toHaveAttribute("href", "https://wiki.bloodontheclocktower.com/Chef");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "silver" } });
    fireEvent.focus(screen.getByRole("button", { name: "Moon Keeper" }));
    expect(within(detail).queryByRole("link")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "no matching characters" } });
    expect(screen.getByText("No characters match this search.")).toBeInTheDocument();
  });

  it("uses the shared dialog Escape and focus-return contract", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const view = render(<RoleChooser {...distribution({ onClose })} />);
    expect(screen.getByRole("button", { name: "Close character chooser" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("keeps complete holder names accessible when the visual badge is shortened", () => {
    const holder = "Alexandria Catherine Longname";
    render(<RoleChooser mode="choose" roles={roles} scriptName="Trouble Brewing" onClose={vi.fn()}
      player={{ id: "ada", name: "Ada", seat: 1, roleId: "chef" }} holders={{ washerwoman: [holder] }} allowSwap onChoose={vi.fn()} />);
    const tile = screen.getByRole("button", { name: `Washerwoman, in use by ${holder}` });
    expect(within(tile).getByTitle(holder)).toHaveTextContent(holder);
    expect(within(tile).getByTitle("Washerwoman")).toBeInTheDocument();
  });

  it("touch activation updates the complete ability preview and toggles once without requiring hover", () => {
    const props = distribution();
    render(<RoleChooser {...props} />);
    const chef = screen.getByRole("button", { name: "Chef" });
    fireEvent.pointerDown(chef, { pointerType: "touch" });
    fireEvent.focus(chef);
    expect(props.onToggle).not.toHaveBeenCalled();
    fireEvent.pointerUp(chef, { pointerType: "touch" });
    fireEvent.click(chef);
    expect(props.onToggle).toHaveBeenCalledOnce();
    expect(props.onToggle).toHaveBeenCalledWith("chef");
    const detail = screen.getByRole("region", { name: "Character details" });
    expect(within(detail).getByText(roles.find(role => role.id === "chef")!.ability!)).toBeInTheDocument();
    expect(within(detail).getByRole("link")).toHaveAttribute("href", "https://wiki.bloodontheclocktower.com/Chef");
  });
});
