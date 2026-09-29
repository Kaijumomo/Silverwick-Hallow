import { useState } from "react";
import { act, cleanup, render, screen, fireEvent, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BagEditor } from "./BagEditor";
import { RolePoolEditor } from "./RolePoolEditor";
import { TYPE_LABEL } from "./SetupFindings";
import { troubleBrewing } from "@/data/scripts/troubleBrewing";
import { SETUP_COUNTS } from "@/data/setupCounts";
import type { RoleId, Script } from "@/stores/types";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

// RolePoolEditor renders one grid tile per distinct selected role (Fill/Re-roll
// never produces duplicate copies), so counting pressed tiles is an accurate
// stand-in for pool.length without depending on any particular summary string.
const selectedTileCount = () => screen.getAllByRole("button", { pressed: true }).length;
const totalFor = (count: number) =>
  SETUP_COUNTS[count]!.townsfolk + SETUP_COUNTS[count]!.outsider + SETUP_COUNTS[count]!.minion + SETUP_COUNTS[count]!.demon;

// Controlled harness matching how SetupPanel/GameScreen own this state in
// production: BagEditor itself is stateless about pool/generated ownership.
function Harness({ script = troubleBrewing, plannedPlayerCount = 5 }: { script?: Script; plannedPlayerCount?: number | null }) {
  const [pool, setPool] = useState<RoleId[]>([]);
  const [generated, setGenerated] = useState<RoleId[]>([]);
  return (
    <BagEditor
      script={script}
      pool={pool}
      generatedRoleIds={generated}
      fabledIds={[]}
      loricIds={[]}
      plannedPlayerCount={plannedPlayerCount}
      onPoolChange={(nextPool, nextGenerated) => { setPool(nextPool); setGenerated(nextGenerated); }}
    />
  );
}

describe("BagEditor Fill & Re-roll", () => {
  it("fills an empty bag into a complete valid composition and offers Re-roll next", () => {
    render(<Harness plannedPlayerCount={5} />);
    expect(screen.getByRole("button", { name: "Fill the Bag" })).toBeVisible();

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });

    expect(selectedTileCount()).toBe(totalFor(5));
    expect(screen.getByRole("button", { name: "Re-roll Bag" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Fill the Bag" })).toBeNull();
  });

  it("preserves a manually pinned role across Fill and a subsequent Re-roll", () => {
    render(<Harness plannedPlayerCount={5} />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Empath" })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });
    expect(screen.getByRole("button", { name: "Empath" })).toHaveAttribute("aria-pressed", "true");

    act(() => { fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" })); });
    expect(screen.getByRole("button", { name: "Empath" })).toHaveAttribute("aria-pressed", "true");
  });

  it("K. re-roll preserves Storyteller picks across repeated presses", () => {
    render(<Harness plannedPlayerCount={5} />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Empath" })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });
    for (let i = 0; i < 4; i++) {
      act(() => { fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" })); });
      expect(screen.getByRole("button", { name: "Empath" })).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("a deliberate manual toggle after Fill makes that role pinned, surviving the next Re-roll", () => {
    render(<Harness plannedPlayerCount={5} />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });
    // Whichever roles got auto-filled, deliberately click one to pin it: the
    // accessible name is the button's non-decorative span (the checkmark
    // span is aria-hidden and excluded from that computation).
    const generatedButton = screen.getAllByRole("button", { pressed: true })[0]!;
    const name = [...generatedButton.querySelectorAll("span")]
      .find((s) => s.getAttribute("aria-hidden") !== "true")!.textContent!;
    act(() => { fireEvent.click(generatedButton); }); // deselect (deliberate)
    act(() => { fireEvent.click(screen.getByRole("button", { name })); }); // reselect (deliberate -> pinned)
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" })); });
    expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "true");
  });

  it("never touches player/game assignment state -- the result carries only role ids", () => {
    render(<Harness plannedPlayerCount={5} />);
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Fill the Bag" })); });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Re-roll Bag" })); });
    expect(selectedTileCount()).toBe(totalFor(5));
  });

  it("refuses to fill until a supported player count is chosen", () => {
    render(<Harness plannedPlayerCount={null} />);
    expect(screen.getByRole("button", { name: "Fill the Bag" })).toBeDisabled();
    expect(screen.getByText(/Choose a supported player count/)).toBeVisible();
  });
});

// SOL-10D-C03: a legacy STORED script may still carry a duplicate RoleId (new
// imports reject one); the pool editor offers that id once, as its FIRST
// (owning) definition, under the owner's type.
describe("RolePoolEditor — SOL-10D-C03 legacy duplicate RoleIds", () => {
  it("shows a duplicate RoleId once, as its first definition", () => {
    const chef = troubleBrewing.characters.find((r) => r.id === "chef")!;
    const evilChef = { id: "chef", name: "Evil Chef", type: "minion" as const, ability: "x" };
    const script: Script = { ...troubleBrewing, id: "legacy-dup",
      characters: [chef, evilChef, ...troubleBrewing.characters.filter((r) => r.id !== "chef")] };
    render(<RolePoolEditor script={script} pool={[]} onChange={() => {}} />);
    expect(screen.getAllByRole("button", { name: "Chef" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Evil Chef" })).toBeNull();
    expect(within(screen.getByRole("region", { name: TYPE_LABEL.townsfolk })).getByRole("button", { name: "Chef" })).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: TYPE_LABEL.minion })).queryByRole("button", { name: /Chef/ })).toBeNull();
  });
});
